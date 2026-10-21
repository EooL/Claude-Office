// agent-enrich.mjs — option C of docs/agent-job-description-options.md: the structure of a job description comes from
// rules (agent-profiles.mjs), the prose from a model, and the result is saved as a DRAFT the owner approves.
//
// The model gets a chat-mode call (no tools, changes nothing). Its answer is validated strictly and MERGED into the
// default profile: the mandatory must-not rules always stay first, nothing the model writes can loosen them.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProfileError, TOOLS, defaultProfile, loadProfile, saveProfile, serializeProfile, validateProfile } from './agent-profiles.mjs'
import { listRoles } from './roles.mjs'

const TIMEOUT_MS = 120_000
const FACT_CHARS = 3000

// key -> [kind, max length, min items, max items]
const SCHEMA = {
  whoYouAre: ['string', 600],
  mission: ['string', 400],
  responsibilities: ['list', 160, 3, 8],
  receive: ['string', 400],
  handBack: ['string', 400],
  mustNot: ['list', 160, 4, 12],
  askFirst: ['list', 160, 2, 8],
  done: ['list', 160, 2, 6],
}
const TITLES = ['Who you are', 'Mission and responsibilities', 'What you receive and what you hand back', 'What you must not do', 'Ask the boss first when', 'Definition of done']

// ---------------------------------------------------------------------------------------------------------------
// Body <-> sections

const bullets = (xs) => xs.map((x) => `- ${x}`).join('\n')
const bulletsOf = (text) => text.split('\n').map((l) => /^\s*[-*]\s+(.+)$/.exec(l)?.[1]).filter(Boolean)

/** { title: text } of the level-1 sections of a profile body. */
function sectionsOf(body) {
  const out = {}
  let cur = null
  for (const line of String(body).split('\n')) {
    const m = /^# (.+?)\s*$/.exec(line)
    if (m) { cur = m[1]; out[cur] = '' } else if (cur) out[cur] += `${line}\n`
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim()
  return out
}

const hashOf = (profile) => createHash('sha256').update(serializeProfile(profile)).digest('hex').slice(0, 12)

// ---------------------------------------------------------------------------------------------------------------
// Prompt

const SECRET_LINE = /(api[_-]?key|token|passw(or)?d|secret|credential|private[_-]?key)\s*[:=]|\b(sk-|ghp_|xox[bp]-|AKIA)[A-Za-z0-9_-]{8,}/i

function projectFacts(cwd) {
  const out = []
  for (const name of cwd ? ['AGENTS.md', 'README.md'] : []) {
    const file = join(cwd, name)
    if (!existsSync(file)) continue
    try {
      const text = readFileSync(file, 'utf8').slice(0, FACT_CHARS).split('\n').filter((l) => !SECRET_LINE.test(l)).join('\n')
      out.push(`--- ${name} (first ${FACT_CHARS} characters) ---\n${text}`)
    } catch { /* unreadable: no facts from it */ }
  }
  return out.join('\n\n') || '(no AGENTS.md or README.md found)'
}

function buildPrompt(role, current, cwd) {
  const f = current.frontmatter
  const o = f.office
  const reporters = listRoles().filter((r) => r.reportsTo === role).map((r) => r.role)
  const sec = sectionsOf(current.body)
  const list = (xs) => (xs?.length ? xs.join(', ') : 'none')
  return [
    'You write the job description of one agent of a software office. Use ONLY the facts below.',
    '',
    'STRUCTURAL FACTS (fixed, do not change them)',
    `Display name: ${o.displayName}`,
    `Role id: ${role}`,
    `Reports to: ${o.reportsTo ?? 'the boss'}`,
    `Who reports to it: ${list(reporters)}`,
    `Routing words: ${list(o.routes)}`,
    `Model tier: ${f.model}`,
    `Access: ${Object.entries(o.access).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `Tools: ${list(f.tools)}`,
    `Disallowed tools: ${list(f.disallowedTools)}`,
    '',
    'CURRENT TEXT OF THE SIX SECTIONS',
    ...TITLES.map((t) => `## ${t}\n${sec[t] ?? ''}`),
    '',
    'PROJECT FACTS',
    projectFacts(cwd),
    '',
    'TASK',
    'Rewrite the prose so it fits this role in this project. Output ONLY one JSON object, nothing before or after it, with exactly these keys:',
    '- whoYouAre: string, at most 600 characters',
    '- mission: string, at most 400 characters',
    '- responsibilities: array of 3 to 8 strings, each at most 160 characters',
    '- receive: string, at most 400 characters (what you receive)',
    '- handBack: string, at most 400 characters (what you hand back)',
    '- mustNot: array of 4 to 12 strings, each at most 160 characters (extra rules; the mandatory baseline rules are added for you)',
    '- askFirst: array of 2 to 8 strings, each at most 160 characters',
    '- done: array of 2 to 6 strings, each at most 160 characters',
    'Rules: do not invent tools, services, people, repositories or commands that are not in the facts above. Write plain English. No markdown headings, no HTML, no URLs. Never loosen a rule: committing, pushing, deploying, reading secrets, leaving the project folder and destructive commands need the boss.',
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------------------------
// Validation

const HTML = /<\/?[a-z][^>]*>/i
const HEADING = /(^|\n)\s*(#{1,6}\s|```)/
const URL_RE = /https?:\/\/|\bwww\./i
const CAMEL_TOOL = /\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b|\bBash\([^)]*\)/g
const USE_PHRASE = /\b(you (can|may) use|may use|can use)\b/i
// a permissive phrase followed (in the same sentence) by a risky action
const RISKY = '(commit|push|deploy|tag a release|force[- ]push|read[^.]*(secret|\\.env|credential|token|key)|print[^.]*(secret|credential)|outside the project|rm -rf|reset --hard|destructive|drop (the )?(table|data)|delete[^.]*(data|database))'
const LOOSEN = [
  new RegExp(`\\b(you (may|can|are allowed to|are free to)(?! not)|feel free to|go ahead and|it is (ok|fine|okay) to|it is allowed to)\\b[^.]*\\b${RISKY}`, 'i'),
  new RegExp(`\\b${RISKY}\\b[^.]*\\bwithout (asking|approval|permission|the boss|confirmation)`, 'i'),
  /\b(ignore|override|disregard)\b[^.]*\b(rules?|instructions?|baseline|restrictions?)\b/i,
]
// a must-not rule that names a risky action but is not a prohibition
const RISKY_WORD = /\b(commit|push|deploy|tag|secrets?|\.env|credentials?|outside the project|rm -rf|reset --hard|destructive)\b/i
const PROHIBITION = /\b(never|not|don'?t|no|without|unless|only if|only when|until|before|ask)\b/i

function parseAnswer(raw) {
  const text = String(raw ?? '').trim()
  const fenced = /^```[a-z]*\s*\n([\s\S]*?)\n?```$/i.exec(text)
  try { return { value: JSON.parse(fenced ? fenced[1] : text) } } catch (e) { return { errors: [`the answer is not valid JSON (${e.message})`] } }
}

/** Check the model's answer against the schema and the safety rules. { value } or { errors: string[] }. */
export function validateAnswer(raw) {
  const { value: v, errors = [] } = parseAnswer(raw)
  if (errors.length) return { errors }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { errors: ['the answer must be one JSON object'] }
  const bad = (m) => errors.push(m)
  for (const k of Object.keys(v)) if (!(k in SCHEMA)) bad(`unknown key "${k}"`)
  const check = (where, s, max) => {
    if (typeof s !== 'string' || !s.trim()) return bad(`${where} must be a non-empty string`)
    if (s.length > max) bad(`${where} is ${s.length} characters, the limit is ${max}`)
    if (HTML.test(s)) bad(`${where} contains HTML`)
    if (HEADING.test(s)) bad(`${where} contains a markdown heading or code fence`)
    if (URL_RE.test(s)) bad(`${where} contains a URL`)
    if (USE_PHRASE.test(s)) {
      for (const t of s.match(CAMEL_TOOL) ?? []) if (!TOOLS.includes(t) && !TOOLS.some((x) => x.startsWith(`${t}(`))) bad(`${where} mentions the tool "${t}", which is not in the vocabulary (${TOOLS.join(', ')})`)
    }
    if (LOOSEN.some((re) => re.test(s))) bad(`${where} loosens a baseline rule`)
  }
  for (const [k, [kind, max, min, top]] of Object.entries(SCHEMA)) {
    if (!(k in v)) { bad(`missing key "${k}"`); continue }
    if (kind === 'string') check(k, v[k], max)
    else if (!Array.isArray(v[k])) bad(`${k} must be an array of strings`)
    else {
      if (v[k].length < min || v[k].length > top) bad(`${k} must have ${min} to ${top} items, it has ${v[k].length}`)
      v[k].forEach((s, i) => {
        check(`${k}[${i}]`, s, max)
        if (typeof s === 'string' && /\n/.test(s)) bad(`${k}[${i}] must be a single line`)
        if (k === 'mustNot' && typeof s === 'string' && RISKY_WORD.test(s) && !PROHIBITION.test(s)) bad(`${k}[${i}] names a risky action but is not a prohibition`)
      })
    }
  }
  return errors.length ? { errors } : { value: v }
}

// ---------------------------------------------------------------------------------------------------------------
// Merge and diff

function buildProfile(role, current, answer) {
  const base = sectionsOf(defaultProfile(role).body)
  const baseline = bulletsOf(base['What you must not do'])
  const seen = new Set()
  const mustNot = [...baseline, ...answer.mustNot].map((s) => s.trim()).filter((s) => !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
  const frontmatter = JSON.parse(JSON.stringify(current.frontmatter))
  frontmatter.office.status = 'draft'
  const body = [
    '# Who you are', answer.whoYouAre.trim(),
    '# Mission and responsibilities', `${answer.mission.trim()} Your responsibilities:`, bullets(answer.responsibilities),
    '# What you receive and what you hand back', `You receive: ${answer.receive.trim()}`, `You hand back: ${answer.handBack.trim()}`,
    '# What you must not do', bullets(mustNot),
    '# Ask the boss first when', bullets(answer.askFirst),
    '# Definition of done', bullets(answer.done),
  ].join('\n')
  return { frontmatter, body }
}

/** Changed lines only, "- old" / "+ new", from a longest-common-subsequence line diff. */
export function lineDiff(before, after) {
  const a = String(before).split('\n'); const b = String(after).split('\n')
  const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
  const out = []
  let i = 0; let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++ } else if (j < b.length && (i === a.length || t[i][j + 1] >= t[i + 1][j])) out.push(`+ ${b[j++]}`)
    else out.push(`- ${a[i++]}`)
  }
  return out.join('\n')
}

// ---------------------------------------------------------------------------------------------------------------

async function defaultRun(role, prompt, opts) {
  const { runForRole } = await import('../scripts/brain-run.mjs')
  return runForRole(role, prompt, opts, { announceExhausted: false })
}

const fail = (field, message) => { throw new ProfileError([{ field, message }]) }

/**
 * Ask the role's brain for better prose and save it as a draft. Throws ProfileError (nothing written) when the role
 * is locked, approved (without force), the model fails or its answer is invalid twice.
 * Returns { role, text, status: 'draft', diff, hash, usage?, saved }.
 */
export async function enrichProfile(role, { home, cwd, run = defaultRun, now = Date.now, dryRun = false, force = false } = {}) {
  const loaded = loadProfile(role, { home })
  const current = loaded.profile
  const o = current.frontmatter.office
  if (o.locked === true) fail('office.locked', `the profile of ${role} is locked; unlock it before enriching it`)
  if (o.status === 'approved' && !force) fail('office.status', `the profile of ${role} is approved; use force to replace it with a draft`)

  const basePrompt = buildPrompt(role, current, cwd)
  let prompt = basePrompt
  let answer; let usage
  for (let attempt = 1; ; attempt++) {
    let res
    try { res = await run(role, prompt, { mode: 'chat', timeoutMs: TIMEOUT_MS, cwd }) } catch (e) { fail('model', `the model call failed: ${e?.message ?? e}`) }
    if (!res || res.error || !res.text || (res.code !== undefined && res.code !== 0)) fail('model', `the model call failed: ${res?.error ?? 'no answer'}`)
    usage = res.usage ?? usage
    const v = validateAnswer(res.text)
    if (v.value) { answer = v.value; break }
    if (attempt === 2) throw new ProfileError(v.errors.map((message) => ({ field: 'answer', message })))
    prompt = `${basePrompt}\n\nYour previous answer was rejected for these reasons. Fix them and output only the JSON object again:\n${v.errors.map((e) => `- ${e}`).join('\n')}`
  }

  const profile = buildProfile(role, current, answer)
  const check = validateProfile(profile, { role })
  if (!check.ok) throw new ProfileError(check.errors)
  const text = serializeProfile(profile)
  const diff = lineDiff(serializeProfile(current), text)
  if (!dryRun) saveProfile(role, text, { home, status: 'draft' })
  return { role, text, status: 'draft', diff, hash: hashOf(profile), saved: !dryRun, ...(usage ? { usage } : {}) }
}
