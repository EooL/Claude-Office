// delegation.mjs — a chat message that is really a job becomes an office agent doing it.
//
//   Boss types in the chat           what happens
//   ───────────────────────────────  ─────────────────────────────────────────────────────
//   a question or small talk         handleMessage → 'chat': the chat watcher answers as before
//   a job the router is sure of      an agent for that role is hired (it shows at its desk),
//                                    reads the project and posts a PLAN in the chat
//   a job it is not sure of          the agent asks "want me to take that on?" (yes / no)
//   /goal  (or /goal <changes>)      the boss approves the latest plan: the agent does the
//                                    work (it may edit files) and reports back in the chat
//
// Every agent runs on its brain (server/brains.mjs): the chain of services and models picked for it in
// Settings, with a fallback to the next when one is used up or unavailable. Everything the office shows goes through `deps`,
// so the flow runs the same against a real server (scripts/delegate.mjs) and in the tests.
//
//   deps = {
//     now(), cwd,
//     read() -> state, write(patch),                 // { pending?, plan?, busy? }; patch merges, undefined removes
//     agent(role) -> { service, model, effort },     // the first step of that role's brain
//     run(role, prompt, { mode, timeoutMs, operation? }) -> { text, usage, model, durationMs, code, step? },
//                                                    // on the role's brain, or on the orchestrator's when operation says so
//     say(name, role, text),                         // a chat line spoken by an agent
//     hire(agent), working(id, status), finish(id, { result, ...stats }),
//   }
import { routeMessage } from './roles.mjs'
import { classifyFailure } from './availability.mjs'
import { loadProfile, profileSystemPrompt } from './agent-profiles.mjs'
import { officeHome } from './paths.mjs'
import { composeAgentPrompt, renderMasterPrompt } from './master-prompt.mjs'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'

export const FOLLOW_UP_INSTRUCTION = 'When the context supports useful further work, finish with one concrete recommendation on a separate line: NEXT_ACTION: <specific task, including necessary context>. Do not invent a next step for greetings or settled questions. This is a proposal only; do not execute it or imply approval. Never recommend publishing, pushing, deploying, deleting data or changing access without stating that scope explicitly.'
// The approval of a plan is bound to this fingerprint: a plan that changed since it was shown needs a new approval.
export const planId = plan => createHash('sha256').update(JSON.stringify(plan)).digest('hex')

export const PENDING_TTL_MS = 10 * 60_000
export const BUSY_TTL_MS = 30 * 60_000
export const CONFIDENT = 0.8
const PLAN_TIMEOUT_MS = 4 * 60_000
const GOAL_TIMEOUT_MS = 20 * 60_000
const CHAT_LIMIT = 1800

// A message is worth asking the classifier about only when it reads like a request
const TASK_WORDS = [
  'fix', 'implement', 'add', 'create', 'build', 'write', 'refactor', 'review', 'check', 'update', 'remove', 'delete',
  'optimize', 'optimise', 'investigate', 'debug', 'test', 'migrate', 'rename', 'change', 'make', 'improve', 'clean',
  'can you', 'could you', 'please', 'i need', 'we need', 'look into', 'take care',
]

/** Cheap gate before the classifier call: does the message read like a request for work? */
export function looksLikeTask(text) {
  const msg = ` ${normaliseMessage(text)} `
  return TASK_WORDS.some((w) => msg.includes(` ${w}`))
}

const normaliseMessage = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'").toLowerCase().trim()
const FAILURE_TEXT = {
  permission: 'a required tool permission was denied in headless mode',
  auth: 'the service needs a login', limit: 'the usage limit was reached',
  credits: 'the service is out of credits', model: 'the selected model is unavailable',
  unavailable: 'the service is unavailable', other: 'the service returned no usable answer',
}

/** Factual text for follow-ups and for preventing a conversational model from inventing work. */
export function delegationStatus(state, now = Date.now()) {
  if (isBusy(state, now)) return `${state.busy.name} is ${state.busy.kind === 'plan' ? 'planning' : 'executing'} the task${state.busy.service ? ` via ${state.busy.service}` : ''}. No completion has been reported.`
  if (state.plan) return `The plan is ready. No agent is executing it. Say /goal to approve execution.`
  const job = state.lastJob
  if (job?.status === 'failed') return `No agent is working on the task. ${job.name}'s ${job.phase === 'plan' ? 'planning' : 'execution'} attempt failed: ${FAILURE_TEXT[job.failureKind] ?? FAILURE_TEXT.other}. Check the agent's brain in Settings; add an available fallback or configure the required CLI permission. Say "retry the last task" to start a new plan.`
  if (job?.status === 'finished') return 'The last execution has finished. Check its reported results; no agent is working now.'
  return 'No agent is working on a task. Describe the job to start planning; /goal approves execution after a plan is ready.'
}

/** A chat-only answer cannot announce a worker or a completed action. */
export function guardChatReply(text, state, now = Date.now()) {
  const reply = normaliseMessage(text)
  const claimsWork = /\b(i(?:'ll| will| am going to)|let me|i am|i'm|we(?:'ll| will))\b.{0,55}\b(take|start|work|review|fix|open|create|implement|build|handle|run)\b|\b(pr|pull request)\b.{0,30}\b(opened|created|submitted)\b|^done\b/.test(reply)
  return claimsWork ? delegationStatus(state, now) : text
}

const YES = new Set(['yes', 'y', 'yep', 'yeah', 'sure', 'ok', 'okay', 'do it', 'go', 'go ahead', 'da', 'sigur', 'confirm', 'confirmed'])
const NO = new Set(['no', 'n', 'nope', 'nah', 'cancel', 'never mind', 'nevermind', 'nu', 'lasa', 'renunta'])
const clean = (text) => String(text).toLowerCase().replace(/[.!?,]+$/g, '').trim()
export const isYes = (text) => YES.has(clean(text))
export const isNo = (text) => NO.has(clean(text))

export function classifyPrompt(text) {
  return [
    'You sort messages sent to a software team\'s office chat.',
    'Answer with ONLY a JSON object: {"kind":"task"|"chat","confidence":<0 to 1>,"task":"<the request restated in one sentence>"}.',
    'kind "task": the sender asks someone to investigate, change, build, fix, review or test code in the project.',
    'kind "chat": a question, greeting, opinion or small talk that needs a reply, not work.',
    'confidence: how sure you are of that kind.',
    '',
    `Message: ${JSON.stringify(String(text).slice(0, 1000))}`,
  ].join('\n')
}

/** The classifier's reply as { kind, confidence, task }; anything unreadable is an unsure chat. */
export function parseClassification(out) {
  const start = String(out).indexOf('{')
  const end = String(out).lastIndexOf('}')
  try {
    const d = JSON.parse(String(out).slice(start, end + 1))
    const confidence = typeof d.confidence === 'number' ? Math.min(1, Math.max(0, d.confidence)) : 0
    return { kind: d.kind === 'task' ? 'task' : 'chat', confidence, task: typeof d.task === 'string' ? d.task.slice(0, 300) : '' }
  } catch {
    return { kind: 'chat', confidence: 0, task: '' }
  }
}

/** The job description of a role as the opening of a prompt; null when it cannot be loaded (a prompt never fails because of a profile). */
export function jobDescription(role, cwd) {
  // scripts run per office: OFFICE_ID picks the home whose overrides apply
  try { return profileSystemPrompt(loadProfile(role, { home: officeHome(process.env.OFFICE_ID ?? 'default') }).profile, { cwd }).trim() } catch { return null }
}

/** Project rules are refreshed on each prompt; a local rules file is optional. */
function masterPrompt(cwd) {
  let agentsMd
  try { agentsMd = readFileSync(join(cwd, 'AGENTS.md'), 'utf8') } catch { /* optional project rules */ }
  const office = process.env.OFFICE_ID ?? 'default'
  try { return renderMasterPrompt({ home: officeHome(office), project: cwd, office, agentsMd }) } catch {
    // null skips override lookup safely, without resolving a different office's home.
    return renderMasterPrompt({ home: null, project: cwd, office, agentsMd })
  }
}

/** Every reply carries project rules before the job and the unchanged watcher task. */
export function chatReplyPrompt(prompt, role, cwd) {
  const job = role ? jobDescription(role, cwd) : null
  const watcherIntro = /^You are responding as [^\r\n]+, the office [^\r\n]+\. Stay in character\.(?=\r?$)/m
  const reply = job ? prompt.replace(watcherIntro, '') : prompt
  return composeAgentPrompt({ master: masterPrompt(cwd), jobDescription: job ?? '', task: `${reply}\n\n${FOLLOW_UP_INSTRUCTION}` })
}

const intro = ({ name, role, cwd }) => jobDescription(role, cwd) ?? `You are ${name}, the office ${role}, working in the project at ${cwd}.`

export function planPrompt({ name, role, task, cwd }) {
  return composeAgentPrompt({ master: masterPrompt(cwd), jobDescription: intro({ name, role, cwd }), task: [
    `The boss asked: ${JSON.stringify(task)}`,
    'Look at the code as needed, but change nothing. Then answer with:',
    '- a plan of 3 to 6 short bullet points, one line each,',
    '- then a last line starting with "GOAL:" that states the whole job in one sentence.',
    'Be concise. No preamble.',
  ].join('\n') })
}

export function goalPrompt({ name, role, goal, plan, cwd }) {
  return composeAgentPrompt({ master: masterPrompt(cwd), jobDescription: intro({ name, role, cwd }), task: [
    'The boss approved this plan.',
    `Goal: ${goal}`,
    'Plan:',
    plan,
    'Do the work now. Keep the changes minimal, and run the project\'s tests if you changed code.',
    'When you are finished, reply with a summary of at most 3 lines: what you changed and anything left to check.',
    FOLLOW_UP_INSTRUCTION,
  ].join('\n') })
}

/** Read-only, bounded git inspection. null means inspection was not available. */
export function boundarySnapshot(cwd) {
  try {
    const options = {
      cwd, timeout: 3000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }
    const output = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], options)
    const entries = output.split('\0')
    const files = new Map()
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry) continue
      const path = entry.slice(3)
      let stamp = ''
      try { const stat = statSync(join(cwd, path)); stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}` } catch { /* deleted */ }
      files.set(path, `${entry.slice(0, 2)}:${stamp}`)
      if (/[RC]/.test(entry.slice(0, 2))) i++ // -z renames/copies have a second (old) path
    }
    // Git does not list its own configuration/hooks in status. Observe metadata only,
    // never contents (the same applies to secret-looking project paths above).
    const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], options).trim()
    const record = (relative, absolute) => {
      try { const stat = statSync(absolute); files.set(relative, `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`) } catch { /* missing */ }
    }
    record('.git/config', join(gitDir, 'config'))
    try { for (const hook of readdirSync(join(gitDir, 'hooks'))) record(`.git/hooks/${hook}`, join(gitDir, 'hooks', hook)) } catch { /* no hooks */ }
    return files
  } catch { return null }
}

/** This is an observation, not a sandbox: it never blocks or reverts a run. */
export function boundaryReport(before, after) {
  if (!before || !after) return 'not a git repository: changes could not be listed'
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path)).sort()
  const sensitive = changed.some(path => /(?:^|\/)\.env[^/]*$|^\.git\/(?:config$|hooks\/)|^\.github\/workflows\/|(?:^|\/)(?:\.gitlab-ci\.ya?ml|Jenkinsfile|azure-pipelines\.ya?ml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.ya?ml|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock)$/.test(path))
  const warning = [sensitive ? 'sensitive paths changed' : '', changed.length > 30 ? `more than 30 files changed (${changed.length})` : ''].filter(Boolean)
  return `Changed: ${changed.length ? changed.join(', ') : 'none'}.${warning.length ? `\nWarning: ${warning.join('; ')}.` : ''}`
}

/** A plan reply split into { plan, goal }: the GOAL: line is the goal, the rest the plan. */
export function parsePlan(text) {
  const lines = String(text).split('\n')
  const goalLine = lines.find((l) => /^\s*GOAL:/i.test(l))
  const goal = goalLine ? goalLine.replace(/^\s*GOAL:\s*/i, '').trim() : ''
  const plan = lines.filter((l) => l !== goalLine).join('\n').trim()
  return { plan, goal }
}

const clip = (text, n = CHAT_LIMIT) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)
const short = (text, n = 60) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

function isBusy(state, now) {
  if (state.busy?.pid) {
    try { process.kill(state.busy.pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
  }
  return state.busy && now - state.busy.at < BUSY_TTL_MS
}

/**
 * Run a job as an agent: hire it, let it work, finish it. Returns the run result, or null
 * when the service gave no text (the agent reports the failure itself).
 */
async function work(deps, { name, role, task, mode, prompt, timeoutMs, status }) {
  const id = `deleg-${randomUUID()}`
  const primary = deps.agent(role)
  const job = { id, name, role, task, phase: mode, at: deps.now() }
  deps.write({ busy: { id, name, kind: mode, pid: deps.pid, at: deps.now() }, lastJob: { ...job, status: 'running' } })
  await deps.hire({ id, name, role, task })
  await deps.working(id, status)
  let result
  try {
    result = await deps.run(role, prompt, { mode, timeoutMs, cwd: deps.cwd })
  } catch (err) {
    result = { text: '', code: 1, error: err.message }
  }
  const failed = !result.text
  const failureKind = failed ? result.attempts?.at(-1)?.failed ?? result.attempts?.at(-1)?.skipped ?? classifyFailure(result)?.kind : undefined
  const service = result.step?.service ?? primary?.service ?? 'the configured AI services'
  await deps.finish(id, {
    result: failed ? `failed: ${FAILURE_TEXT[failureKind] ?? FAILURE_TEXT.other}` : mode === 'plan' ? 'plan ready' : 'execution finished; check the reported results',
    tokens: result.usage?.totalTokens,
    durationMs: result.durationMs,
    model: result.model || result.step?.model || service,
  })
  deps.write({ busy: undefined, lastJob: { ...job, status: failed ? 'failed' : mode === 'plan' ? 'planned' : 'finished', failureKind, service, finishedAt: deps.now() } })
  if (failed) {
    await deps.say(name, role, delegationStatus(deps.read(), deps.now()))
    return null
  }
  return { ...result, service }
}

/** The plan step: read-only run, then the plan goes to the chat and waits for /goal. */
export async function startPlan(deps, { name, role, task }) {
  const state = deps.read()
  if (isBusy(state, deps.now())) {
    await deps.say(name, role, `Hang on boss, ${state.busy.name} is still on the last job.`)
    return
  }
  // A failed replacement must never leave an unrelated old plan executable by /goal.
  deps.write({ plan: undefined })
  const result = await work(deps, {
    name, role, task, mode: 'plan', timeoutMs: PLAN_TIMEOUT_MS, status: 'reading the code',
    prompt: planPrompt({ name, role, task, cwd: deps.cwd }),
  })
  if (!result) return
  const { plan, goal } = parsePlan(result.text)
  deps.write({ pending: undefined, plan: { name, role, task, plan, goal: goal || task, service: result.service, at: deps.now() } })
  await deps.say(name, role, clip(`Boss, I have a plan:\n${plan}\n\nSay /goal to send me, or /goal <changes> to adjust it.`))
}

/** The boss said /goal: do the latest plan. */
export async function handleGoal(deps, text) {
  const state = deps.read()
  const plan = state.plan
  const expected = /--plan-id=([a-f0-9]{64})/.exec(text)?.[1]
  if (expected && (!plan || planId(plan) !== expected)) {
    await deps.say('Claude', 'assistant', 'This approval belongs to an older plan. Review and approve the latest plan instead.')
    return
  }
  if (!plan) {
    await deps.say('Claude', 'assistant', 'Boss, there is no plan waiting for a go-ahead.')
    return
  }
  if (isBusy(state, deps.now())) {
    await deps.say(plan.name, plan.role, `Hang on boss, ${state.busy.name} is still on the last job.`)
    return
  }
  const goal = String(text).replace(/--plan-id=[a-f0-9]{64}/g, '').replace(/^\s*\/goal\b/i, '').trim() || plan.goal
  // Synchronous inspection keeps the busy reservation in work() before the first await.
  const before = boundarySnapshot(deps.cwd)
  const result = await work(deps, {
    name: plan.name, role: plan.role, task: short(goal), mode: 'write', timeoutMs: GOAL_TIMEOUT_MS, status: 'working on the goal',
    prompt: goalPrompt({ name: plan.name, role: plan.role, goal, plan: plan.plan, cwd: deps.cwd }),
  })
  const report = boundaryReport(before, boundarySnapshot(deps.cwd))
  if (!result) {
    await deps.say(plan.name, plan.role, `Execution did not finish.\n${report}`)
    return
  }
  deps.write({ plan: undefined })
  await deps.say(plan.name, plan.role, `${clip(`Execution finished. Reported result:\n${result.text}`)}\n${report}`)
}

/**
 * A message from the boss. Returns 'chat' when the chat watcher should answer it as usual,
 * 'handled' when the delegation flow took it (the caller answers nothing).
 * `startInBackground(job)` begins a plan without waiting for it, so the chat stays live.
 */
export async function handleMessage(deps, text, startInBackground) {
  const state = deps.read()
  const now = deps.now()
  const message = normaliseMessage(text)
  const retry = /^(?:please )?(?:retry(?: the last task)?|try again)[.!?]*$/.test(message)
  if (retry && state.lastJob?.status === 'failed') {
    await startInBackground({ name: state.lastJob.name, role: state.lastJob.role, task: state.lastJob.task })
    return 'handled'
  }
  if (/what i (?:asked|requested)|last task|anyone working|^(?:status|progress)[?! .]*$/.test(message)) {
    await deps.say(state.lastJob?.name ?? 'Claude', state.lastJob?.role ?? 'assistant', delegationStatus(state, now))
    return 'handled'
  }

  if (state.pending && now - state.pending.at < PENDING_TTL_MS) {
    const { name, role, task } = state.pending
    if (isYes(text)) {
      deps.write({ pending: undefined })
      await startInBackground({ name, role, task })
      return 'handled'
    }
    if (isNo(text)) {
      deps.write({ pending: undefined })
      await deps.say(name, role, 'Okay boss, dropped it.')
      return 'handled'
    }
  }

  if (!looksLikeTask(text)) return 'chat'

  const { role, name } = routeMessage(text)
  let verdict
  try {
    // the orchestrator, not the agent the message routes to, decides whether it is a job
    const classified = await deps.run(role, classifyPrompt(text), { mode: 'chat', timeoutMs: 60_000, operation: 'orchestrator', cwd: deps.cwd })
    if (!classified.text) throw new Error('Task routing returned no answer')
    verdict = parseClassification(classified.text)
  } catch {
    await deps.say(name, role, 'No worker started: task routing is unavailable. Check the orchestrator brain in Settings and retry the request.')
    return 'handled'
  }
  if (verdict.kind === 'chat' && verdict.confidence >= CONFIDENT) return 'chat'

  const task = String(text).slice(0, 6000)
  if (verdict.kind === 'task' && verdict.confidence >= CONFIDENT) {
    await startInBackground({ name, role, task })
    return 'handled'
  }
  // Not sure it is a job: ask, and let the next yes / no decide
  deps.write({ pending: { name, role, task, at: now } })
  await deps.say(name, role, `Boss, do you want me to take that on? (${short(task, 120)}) Say yes or no.`)
  return 'handled'
}
