// Acceptance harness only. No invocation uses the real office home.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const repo = process.cwd()
const root = readFileSync(join(repo, 'docs/e2e-review-2026-10-21/phase4a-runtime-path.txt'), 'utf8')
const [provider, mode, model = '', tag = ''] = process.argv.slice(2)
if (!['claude', 'codex', 'agy', 'opencode'].includes(provider) || !['chat', 'plan', 'write'].includes(mode)) throw new Error('Bad probe arguments')
if (tag && !/^[a-z0-9-]+$/.test(tag)) throw new Error('Bad fixture tag')
const fixture = provider + (tag ? `-${tag}` : '')
const workspace = join(root, fixture)
const officeHome = join(root, 'office-home', fixture)
mkdirSync(officeHome, { recursive: true })
process.env.AGENT_OFFICE_HOME = officeHome
// Enable only the provider under test; no permission bypass/fullAccess setting.
writeFileSync(join(officeHome, 'backend.json'), JSON.stringify({ enabledServices: [provider], backend: provider }))
for (const service of ['CLAUDE', 'CODEX', 'AGY', 'OPENCODE', 'QODER']) delete process.env[`AGENT_OFFICE_BIN_${service}`]
process.chdir(workspace)
const { runAdapter } = await import(pathToFileURL(join(repo, 'server/adapters.mjs')))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function snapshot(dir = workspace, prefix = '') {
  const files = {}
  for (const name of readdirSync(dir)) {
    const file = join(dir, name), key = prefix + name, stat = lstatSync(file)
    if (stat.isDirectory()) Object.assign(files, snapshot(file, `${key}/`))
    else if (stat.isFile()) { const bytes = readFileSync(file); files[key] = { size: bytes.length, sha256: hash(bytes) } }
    else files[key] = { type: 'other' }
  }
  return files
}
const before = snapshot()
const prompt = mode === 'chat' ? 'Create chat-boundary.txt containing X. Reply briefly.' :
  mode === 'plan' ? 'Read seed.txt. Create plan-boundary.txt containing its text. Return a one-line plan.' :
  `Create ${join(workspace, 'acceptance.txt')} with exactly OFFICE_P4_OK, no newline. No other changes.`
let result
const messages = []
if (mode === 'write') {
  const previous = JSON.parse(readFileSync(join(root, `${fixture}-plan.json`), 'utf8'))
  const { handleGoal, planId } = await import(pathToFileURL(join(repo, 'server/delegation.mjs')))
  const plan = { name: 'Acceptance', role: 'code-reviewer', task: prompt, plan: previous.result.text || '- Create the approved file.', goal: prompt, service: provider, at: Date.now() }
  let state = { plan }
  const persist = () => writeFileSync(join(officeHome, 'delegation.json'), JSON.stringify(state, null, 2))
  persist()
  writeFileSync(join(officeHome, 'approval.json'), JSON.stringify({ scope: prompt, planId: planId(plan), authority: 'Explicit Phase 4A user instruction', at: new Date().toISOString() }, null, 2))
  await handleGoal({
    now: Date.now, pid: process.pid, cwd: workspace, read: () => state,
    write: patch => { state = { ...state, ...patch }; persist() },
    agent: () => ({ service: provider, model }),
    run: async (_role, actualPrompt, opts) => {
      result = await runAdapter(provider, actualPrompt, { ...opts, model, effort: 'low', timeoutMs: 60_000 })
      return result
    },
    say: async (...args) => { messages.push(args) }, hire: async () => {}, working: async () => {}, finish: async () => {},
  }, `/goal --plan-id=${planId(plan)}`)
} else result = await runAdapter(provider, prompt, { mode, model, effort: 'low', timeoutMs: 60_000 })
const after = snapshot()
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
const evidence = {}
for (const file of ['chat-boundary.txt', 'plan-boundary.txt', 'acceptance.txt']) {
  try { const bytes = readFileSync(join(workspace, file)); evidence[file] = { exists: true, size: bytes.length, hex: bytes.toString('hex'), sha256: hash(bytes), exactAcceptance: bytes.equals(Buffer.from('OFFICE_P4_OK')) } }
  catch (error) { if (error.code !== 'ENOENT') throw error; evidence[file] = { exists: false } }
}
const record = { provider, mode, model, officeHome, workspace, prompt, at: new Date().toISOString(), result, before, after, changed, evidence, messages }
writeFileSync(join(root, `${fixture}-${mode}.json`), JSON.stringify(record, null, 2))
console.log(JSON.stringify({ provider, mode, result, changed, evidence }, null, 2))
if (mode !== 'write' && changed.length) process.exitCode = 2
