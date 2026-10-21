// One contract for every CLI the office runs under the hood: the same prompt, mode, folder and permission setting must
// mean the same thing whichever tool answers. Fake CLIs record exactly what they were started with; the golden file
// tests/fixtures/adapter-contract.json pins it (set UPDATE_ADAPTER_CONTRACT=1 to rewrite it after a deliberate change),
// and the invariants below hold whatever the golden file says.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'office-adapter-contract-'))
const oldHome = process.env.AGENT_OFFICE_HOME
process.env.AGENT_OFFICE_HOME = join(dir, 'home')
mkdirSync(process.env.AGENT_OFFICE_HOME, { recursive: true })
const { runAdapter, adapterNames, adapters } = await import('../server/adapters.mjs')
const goldenFile = join(__dirname, 'fixtures', 'adapter-contract.json')

afterAll(() => {
  if (oldHome === undefined) delete process.env.AGENT_OFFICE_HOME
  else process.env.AGENT_OFFICE_HOME = oldHome
  for (const name of adapterNames) delete process.env[`AGENT_OFFICE_BIN_${name.toUpperCase()}`]
  rmSync(dir, { recursive: true, force: true })
})

// What a fake CLI records about its own start, then answers in a shape every adapter's parser accepts.
const recorder = join(dir, 'recorder.mjs')
writeFileSync(recorder, `
import { readFileSync, writeFileSync } from 'node:fs'
let stdin = ''
try { stdin = readFileSync(0, 'utf8') } catch {}
// a prompt handed over as a file: by attach flag, or by a folder added to the workspace that holds prompt.md
const argv = process.argv.slice(2)
let promptFile = null
let promptFileContent = null
for (const flag of ['-f', '--attachment']) { const i = argv.indexOf(flag); if (i >= 0) promptFile = argv[i + 1] }
const dirIndex = argv.indexOf('--add-dir')
if (dirIndex >= 0) promptFile = argv[dirIndex + 1] + '/prompt.md'
if (promptFile) { try { promptFileContent = readFileSync(promptFile, 'utf8') } catch { promptFileContent = '<unreadable>' } }
const record = { argv, stdin, cwd: process.cwd(), permission: process.env.OPENCODE_PERMISSION ?? null, promptFile, promptFileContent }
writeFileSync(process.env.RECORD_TO, JSON.stringify(record))
const outIndex = process.argv.indexOf('-o')
if (outIndex > 0 && process.argv[outIndex + 1] !== '-') { try { writeFileSync(process.argv[outIndex + 1], 'ok') } catch {} }
const reply = 'ok'
console.log(JSON.stringify({ status: 'SUCCESS', response: reply, result: reply, type: 'text', part: { text: reply } }))
`)
for (const name of adapterNames) process.env[`AGENT_OFFICE_BIN_${name.toUpperCase()}`] = `"${process.execPath}" "${recorder}"`

const PROMPT = 'Reply "OK"; $(touch pwned) `id` & | > x\nsecond line'
type Run = { argv: string[], stdin: string, cwd: string, permission: string | null, promptFile: string | null, promptFileContent: string | null }
let counter = 0

async function start(name: string, mode: 'chat' | 'plan' | 'write', { fullAccess = false, prompt = PROMPT, cwd }: { fullAccess?: boolean, prompt?: string, cwd?: string } = {}) {
  writeFileSync(join(process.env.AGENT_OFFICE_HOME!, 'backend.json'), JSON.stringify(fullAccess ? { fullAccess: [name] } : {}))
  const file = join(dir, `record-${++counter}.json`)
  process.env.RECORD_TO = file
  const result = await runAdapter(name, prompt, { mode, model: 'test-model', cwd, timeoutMs: 40000 })
  const run: Run = JSON.parse(readFileSync(file, 'utf8'))
  return { run, result }
}

/** The recording with the volatile parts replaced, so the golden file is the same on every machine. */
function normal(run: Run, prompt: string, cwd: string) {
  const swap = (value: string) => value.split(prompt).join('<PROMPT>').split(cwd).join('<CWD>').replace(/office-[A-Za-z0-9]+[\\/]reply\.txt/, '<OUTFILE>')
  return {
    argv: run.argv.map(swap),
    stdin: swap(run.stdin),
    permission: run.permission === null ? null : JSON.parse(run.permission),
  }
}

describe('what every adapter is started with (golden)', () => {
  it('matches tests/fixtures/adapter-contract.json for every adapter, mode and access setting', async () => {
    const work = join(dir, 'project')
    mkdirSync(work, { recursive: true })
    const actual: Record<string, unknown> = {}
    for (const name of adapterNames) {
      for (const [label, mode, fullAccess] of [['chat', 'chat', false], ['plan', 'plan', false], ['write', 'write', false], ['write+fullAccess', 'write', true]] as const) {
        const { run } = await start(name, mode, { fullAccess, cwd: work })
        actual[`${name} ${label}`] = normal(run, PROMPT, work)
      }
    }
    if (process.env.UPDATE_ADAPTER_CONTRACT || !existsSync(goldenFile)) writeFileSync(goldenFile, `${JSON.stringify(actual, null, 1)}\n`)
    expect(actual).toEqual(JSON.parse(readFileSync(goldenFile, 'utf8')))
  })
})

// Anything that lets a CLI write files or run commands without asking, whatever the CLI calls it.
const WRITE_ENABLING = ['acceptEdits', 'workspace-write', 'accept-edits', 'accept_edits', '--dangerously-skip-permissions', 'bypassPermissions', 'danger-full-access', '--yolo']

describe('access: the same rules for every CLI', () => {
  it.each(adapterNames)('%s: chat and plan never carry a write-enabling flag, even with full access configured', async (name) => {
    for (const mode of ['chat', 'plan'] as const) {
      const { run } = await start(name, mode, { fullAccess: true })
      for (const flag of WRITE_ENABLING) expect(run.argv, `${name} ${mode} ${flag}`).not.toContain(flag)
      if (run.permission) {
        const rules = JSON.parse(run.permission)
        for (const key of ['edit', 'write', 'bash', 'patch', 'webfetch']) expect(rules[key], `${name} ${mode} permission ${key}`).not.toBe('allow')
        expect(rules['*']).toBe('deny')
      }
    }
  })

  it.each(adapterNames)('%s: the permission bypass appears only in write mode, only when full access is switched on, and only if the CLI has one', async (name) => {
    const off = await start(name, 'write', { fullAccess: false })
    const on = await start(name, 'write', { fullAccess: true })
    const bypass = (adapters as Record<string, { fullAccessArgs?: string[] }>)[name].fullAccessArgs ?? []
    for (const flag of bypass) {
      expect(off.run.argv, `${name} off`).not.toContain(flag)
      expect(on.run.argv, `${name} on`).toContain(flag)
    }
    // a CLI without a bypass is started identically either way (the answer file path is a fresh temp name each run)
    if (!bypass.length) expect(normal(on.run, PROMPT, process.cwd()).argv).toEqual(normal(off.run, PROMPT, process.cwd()).argv)
  })

  it.each(adapterNames)('%s: an unapproved write-mode default never grants more than the CLI\'s own edit permission', async (name) => {
    const { run } = await start(name, 'write')
    expect(run.argv).not.toContain('--dangerously-skip-permissions')
    expect(run.argv).not.toContain('danger-full-access')
  })
})

describe('context: the same folder and the same prompt bytes for every CLI', () => {
  it.each(adapterNames)('%s: runs in the folder it was given and receives the prompt as data, not through a shell', async (name) => {
    const work = join(dir, `project-${name}`)
    mkdirSync(work, { recursive: true })
    const { run } = await start(name, 'chat', { cwd: work })
    expect(run.cwd.toLowerCase().replace(/\\/g, '/')).toBe(work.toLowerCase().replace(/\\/g, '/'))
    // either an argument equal to the prompt, or on stdin: the shell metacharacters arrive untouched, nothing ran
    const delivered = run.stdin === PROMPT || run.argv.some(arg => arg === PROMPT || arg.startsWith(PROMPT))
    expect(delivered, `${name} prompt delivery`).toBe(true)
    expect(existsSync(join(work, 'pwned'))).toBe(false)
  })

  it('the folder travels the whole way: an office job through the brain chain starts the CLI in the office folder', async () => {
    const { runWithBrain } = await import('../server/brains.mjs')
    const work = join(dir, 'project-chain')
    mkdirSync(work, { recursive: true })
    writeFileSync(join(process.env.AGENT_OFFICE_HOME!, 'backend.json'), '{}')
    process.env.RECORD_TO = join(dir, 'record-chain.json')
    const outcome = await runWithBrain({
      steps: [{ service: 'agy', model: '' }, { service: 'codex', model: '' }],
      prompt: 'hello',
      opts: { mode: 'plan', timeoutMs: 40000, cwd: work },
      run: (service: string, prompt: string, options: object) => runAdapter(service, prompt, options),
    })
    expect(outcome.step?.service).toBe('agy')
    const run: Run = JSON.parse(readFileSync(join(dir, 'record-chain.json'), 'utf8'))
    expect(run.cwd.toLowerCase().replace(/\\/g, '/')).toBe(work.toLowerCase().replace(/\\/g, '/'))
  })

  it('without a folder every CLI keeps working in the folder this process runs in (unchanged default)', async () => {
    for (const name of adapterNames) {
      const { run } = await start(name, 'chat')
      expect(run.cwd.toLowerCase().replace(/\\/g, '/')).toBe(process.cwd().toLowerCase().replace(/\\/g, '/'))
    }
  })
})

describe('operations: the same outcome shape for every CLI, including when the prompt does not fit', () => {
  it.each(adapterNames)('%s: a prompt of 200,000 characters reaches the CLI whole, whichever way it takes a prompt', async (name) => {
    const big = `${'x'.repeat(199_900)}\nEND "$(touch pwned)"`
    for (const mode of ['chat', 'plan', 'write'] as const) {
      const { run, result } = await start(name, mode, { prompt: big })
      expect(result.code, `${name} ${mode}`).toBe(0)
      expect(result.error, `${name} ${mode}`).toBe('')
      const stdinTool = (adapters as Record<string, { promptVia?: string }>)[name].promptVia === 'stdin'
      if (stdinTool) {
        expect(run.stdin).toBe(big)
      } else {
        // too long for a command line: the prompt is a file the CLI is pointed at, byte for byte, and no argument carries it
        expect(run.argv.join(' ').length, `${name} ${mode} argv`).toBeLessThan(2000)
        expect(run.promptFileContent, `${name} ${mode} file`).toBe(big)
        // the file lives in a folder of its own that is gone once the run is over
        expect(existsSync(run.promptFile!), `${name} ${mode} cleaned up`).toBe(false)
      }
    }
  })

  it.each(['agy', 'opencode', 'qoder'])('%s: a long prompt in the file route gets the same access flags as a short one', async (name) => {
    const short = await start(name, 'plan', { fullAccess: false })
    const long = await start(name, 'plan', { fullAccess: false, prompt: 'y'.repeat(60_000) })
    // the same flags, plus only the file hand-over (attach flag or added folder) and the shorter instruction in place of the prompt
    const flags = (run: Run) => run.argv.filter(arg => arg.startsWith('-') && !['-f', '--attachment', '--add-dir'].includes(arg))
    expect(flags(long.run)).toEqual(flags(short.run))
    expect(long.run.permission).toEqual(short.run.permission)
    for (const flag of WRITE_ENABLING) expect(long.run.argv, `${name} ${flag}`).not.toContain(flag)
  })

  it('a prompt that cannot be passed at all is a failure of the input, not of the service', async () => {
    const { classifyFailure } = await import('../server/availability.mjs')
    const failure = classifyFailure({ text: '', error: 'agy takes the prompt as a command-line argument and this prompt is 40000 characters' })
    expect(failure?.kind).toBe('input')
    expect(failure?.retryAfterMs).toBe(0)
  })
})
