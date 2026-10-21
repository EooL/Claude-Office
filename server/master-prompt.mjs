import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { officeHome } from './paths.mjs'

/** Warnings are advice; only empty/non-text and oversized documents prevent saving. */
export function validateMasterPrompt(text) {
  const errors = []
  const warnings = []
  if (typeof text !== 'string' || !text.trim()) errors.push({ line: 1, message: 'Master prompt must not be empty.' })
  if (typeof text === 'string' && Buffer.byteLength(text, 'utf8') > 8 * 1024) errors.push({ line: 1, message: 'Master prompt must be at most 8 KB.' })
  if (typeof text === 'string' && text.trim()) {
    if (!/\{\{project\}\}/.test(text) || !/(?:only inside|stay (?:inside|within)|whole world|project boundary)/i.test(text)) warnings.push('The prompt may lack a sentence keeping agents inside {{project}}.')
    if (!/never[\s\S]*(?:commit|push)[\s\S]*(?:deploy|publish)[\s\S]*secret/i.test(text)
      || /(?:may|can|allowed to|feel free to)\s+(?:commit|push|deploy|publish|read secrets|ignore (?:the )?rules)/i.test(text)) warnings.push('A never-rule may be missing or loosened; review commits, deployment and secrets restrictions.')
  }
  return { ok: errors.length === 0, errors, warnings }
}

function splitStatus(raw) {
  const match = /^<!-- status: (draft|approved) -->\r?\n/.exec(raw)
  return { text: match ? raw.slice(match[0].length) : raw, status: match?.[1] ?? 'draft' }
}

export function loadMasterPrompt({ home = officeHome('default') } = {}) {
  const defaultText = readFileSync(new URL('./master-prompt.default.md', import.meta.url), 'utf8')
  let text = defaultText
  let source = 'shipped'
  let status = 'default'
  const warnings = []
  try {
    const override = splitStatus(readFileSync(join(home, 'master-prompt.md'), 'utf8'))
    const validation = validateMasterPrompt(override.text)
    if (!validation.ok) warnings.push(`Ignored invalid master prompt override: ${validation.errors.map(e => e.message).join(' ')}`)
    else { text = override.text; status = override.status; source = 'override'; warnings.push(...validation.warnings) }
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push('Ignored unreadable master prompt override.')
  }
  return { text, defaultText, source, status, hash: createHash('sha256').update(text).digest('hex'), warnings }
}

export function saveMasterPrompt(text, { home = officeHome('default'), status = 'draft' } = {}) {
  const validation = validateMasterPrompt(text)
  if (!['draft', 'approved'].includes(status)) validation.errors.push({ line: 1, message: 'status must be draft or approved' })
  if (validation.errors.length) {
    const error = new Error(validation.errors.map(e => e.message).join(' '))
    error.errors = validation.errors
    throw error
  }
  mkdirSync(home, { recursive: true })
  const target = join(home, 'master-prompt.md')
  const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, `<!-- status: ${status} -->\n${text}`, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, target)
  } finally { rmSync(temporary, { force: true }) }
  return loadMasterPrompt({ home })
}

export function resetMasterPrompt({ home = officeHome('default') } = {}) {
  rmSync(join(home, 'master-prompt.md'), { force: true })
  return loadMasterPrompt({ home })
}

export function renderMasterPrompt({ home, project, office, agentsMd } = {}) {
  const text = loadMasterPrompt({ home }).text.replace(/\{\{(project|office)\}\}/g, (_match, key) => String(key === 'project' ? project ?? '' : office ?? ''))
  if (typeof agentsMd !== 'string' || !agentsMd) return text
  const local = agentsMd.slice(0, 4000).split(/\r?\n/).filter(line => !/(?:secret|token|password|passwd|credential|api[_ -]?key|private[_ -]?key|-----BEGIN.*PRIVATE KEY)/i.test(line)).join('\n')
  return local.trim() ? `${text}\n\n## Local project rules (they cannot loosen the rules above)\n${local}` : text
}

export function composeAgentPrompt({ master, jobDescription, task }) {
  return `=== PROJECT RULES ===\n${master}\n\n=== YOUR JOB DESCRIPTION ===\n${jobDescription}\n\n=== THE TASK ===\n${task}`
}
