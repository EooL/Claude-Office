import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { boundaryReport, boundarySnapshot, chatReplyPrompt, classifyPrompt, goalPrompt, handleGoal, planPrompt } from '../server/delegation.mjs'
import * as paths from '../server/paths.mjs'

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) }
})

let root: string
let home: string
let cwd: string
const originalEnv = { home: process.env.AGENT_OFFICE_HOME, root: process.env.AGENT_OFFICE_ROOT, id: process.env.OFFICE_ID }
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'master-prompt-prompts-'))
  home = join(root, 'home')
  cwd = join(root, 'project')
  mkdirSync(home)
  mkdirSync(cwd)
  process.env.AGENT_OFFICE_HOME = home
  process.env.AGENT_OFFICE_ROOT = join(root, 'building')
  delete process.env.OFFICE_ID
})
beforeEach(() => { vi.spyOn(paths, 'officeHome').mockReturnValue(home) })
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(join(home, 'master-prompt.md'), { force: true, recursive: true })
  rmSync(join(cwd, 'AGENTS.md'), { force: true })
})
afterAll(() => {
  for (const [key, value] of [['AGENT_OFFICE_HOME', originalEnv.home], ['AGENT_OFFICE_ROOT', originalEnv.root], ['OFFICE_ID', originalEnv.id]]) {
    if (value === undefined) delete process.env[key!]
    else process.env[key!] = value
  }
  rmSync(root, { recursive: true, force: true })
})

const prompts = () => [
  planPrompt({ name: 'Debugger', role: 'debugger', task: 'TINY TASK', cwd }),
  goalPrompt({ name: 'Debugger', role: 'debugger', goal: 'TINY TASK', plan: 'read first', cwd }),
  chatReplyPrompt('TINY TASK', 'debugger', cwd),
]

it('all three prompts have exactly ordered master, job and task layers with the real folder', () => {
  for (const prompt of prompts()) {
    const parts = prompt.split(/=== (?:PROJECT RULES|YOUR JOB DESCRIPTION|THE TASK) ===\n/)
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('')
    expect(parts[1]).toContain(`\`${cwd}\``)
    expect(parts[1]).toContain('office "default"')
    expect(parts[2]).toContain('debugger')
    expect(parts[3]).toContain('TINY TASK')
  }
})

it.each(['missing', 'empty', 'oversized', 'unreadable'])('%s override falls back to shipped rules in every prompt', (kind) => {
  const target = join(home, 'master-prompt.md')
  if (kind === 'unreadable') mkdirSync(target)
  else if (kind !== 'missing') writeFileSync(target, kind === 'empty' ? '' : 'x'.repeat(8193))
  for (const prompt of prompts()) expect(prompt).toContain("That folder is your whole world")
})

it('home resolution failure also retains shipped rules without looking in another office', () => {
  vi.spyOn(paths, 'officeHome').mockImplementation(() => { throw new Error('registry unavailable') })
  expect(planPrompt({ name: 'Debugger', role: 'debugger', task: 't', cwd })).toContain('That folder is your whole world')
})

it('refreshes overrides without restarting and picks up capped, secret-filtered local AGENTS rules', () => {
  writeFileSync(join(home, 'master-prompt.md'), 'ONLY {{project}} / {{office}}')
  writeFileSync(join(cwd, 'AGENTS.md'), `Use tiny functions.\nAPI_KEY=DO_NOT_FORWARD\npassword: DO_NOT_FORWARD\n${'a'.repeat(4100)}\nAFTER_CAP`)
  for (const prompt of prompts()) {
    expect(prompt).toContain(`ONLY ${cwd} / default`)
    expect(prompt).toContain('Local project rules (they cannot loosen the rules above)')
    expect(prompt).toContain('Use tiny functions.')
    expect(prompt).not.toContain('DO_NOT_FORWARD')
    expect(prompt).not.toContain('AFTER_CAP')
  }
  writeFileSync(join(home, 'master-prompt.md'), 'UPDATED {{project}}')
  expect(prompts()[0]).toContain(`UPDATED ${cwd}`)
})

it('leaves the orchestrator classifier outside the agent layers', () => {
  expect(classifyPrompt('hello')).toBe([
    "You sort messages sent to a software team's office chat.",
    'Answer with ONLY a JSON object: {"kind":"task"|"chat","confidence":<0 to 1>,"task":"<the request restated in one sentence>"}.',
    'kind "task": the sender asks someone to investigate, change, build, fix, review or test code in the project.',
    'kind "chat": a question, greeting, opinion or small talk that needs a reply, not work.',
    'confidence: how sure you are of that kind.', '', 'Message: "hello"',
  ].join('\n'))
})

function repo() {
  const dir = mkdtempSync(join(root, 'git-'))
  execFileSync('git', ['init', '--quiet'], { cwd: dir, windowsHide: true })
  return dir
}

it('reports a clean disposable repository without inventing changes', () => {
  const dir = repo()
  expect(boundaryReport(boundarySnapshot(dir), boundarySnapshot(dir))).toBe('Changed: none.')
})

it('reports newly changed paths, spaces and edits to a previously dirty file', () => {
  const dir = repo()
  writeFileSync(join(dir, 'already.ts'), 'old')
  const before = boundarySnapshot(dir)
  writeFileSync(join(dir, 'already.ts'), 'new and larger')
  writeFileSync(join(dir, 'with spaces.ts'), 'new')
  expect(boundaryReport(before, boundarySnapshot(dir))).toBe('Changed: already.ts, with spaces.ts.')
})

it('warns on sensitive paths without reading their contents, including git configuration/hooks', () => {
  const dir = repo()
  const before = boundarySnapshot(dir)
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
  writeFileSync(join(dir, '.github', 'workflows', 'check.yml'), '# fixture')
  writeFileSync(join(dir, '.env.test'), '# fixture')
  writeFileSync(join(dir, 'package-lock.json'), '{}')
  appendFileSync(join(dir, '.git', 'config'), '\n# fixture change\n')
  writeFileSync(join(dir, '.git', 'hooks', 'fixture-hook'), '# fixture')
  const report = boundaryReport(before, boundarySnapshot(dir))
  expect(report).toContain('.git/config')
  expect(report).toContain('.git/hooks/fixture-hook')
  expect(report).toContain('.github/workflows/check.yml')
  expect(report).toContain('.env.test')
  expect(report).toContain('package-lock.json')
  expect(report.split('\n').filter(line => line.startsWith('Warning:'))).toEqual(['Warning: sensitive paths changed.'])
})

it('reports one combined warning for sensitive paths and more than thirty changed files', () => {
  const dir = repo()
  const before = boundarySnapshot(dir)
  for (let i = 0; i < 31; i++) writeFileSync(join(dir, `file-${i}.ts`), '')
  writeFileSync(join(dir, 'yarn.lock'), '')
  expect(boundaryReport(before, boundarySnapshot(dir))).toContain('Warning: sensitive paths changed; more than 30 files changed (32).')
})

it('reports unavailable inspection for a non-repository, absent git and failed/timed-out git', () => {
  expect(boundarySnapshot(cwd)).toBeNull()
  expect(boundaryReport(null, null)).toBe('not a git repository: changes could not be listed')
  for (const code of ['ENOENT', 'ETIMEDOUT']) {
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw Object.assign(new Error('fixture'), { code }) })
    expect(boundarySnapshot(cwd)).toBeNull()
  }
})

it('approved writes append on-disk evidence even when the model result is clipped; planning is not changed', async () => {
  const dir = repo()
  const said: string[] = []
  let state: any = { plan: { name: 'Debugger', role: 'debugger', goal: 'tiny', plan: 'tiny' } }
  const deps = {
    cwd: dir, now: () => Date.now(), agent: () => ({ service: 'fake' }), read: () => state,
    write: (patch: any) => { state = { ...state, ...patch } },
    hire: async () => {}, working: async () => {}, finish: async () => {},
    say: async (_name: string, _role: string, text: string) => { said.push(text) },
    run: async () => { writeFileSync(join(dir, 'acceptance.ts'), 'fixture'); return { text: 'x'.repeat(3000) } },
  }
  await handleGoal(deps, '/goal')
  expect(said.at(-1)).toContain('Changed: acceptance.ts.')
  expect(state.plan).toBeUndefined()
})

it('reports partial changes from a failed approved write without claiming completion or consuming its plan', async () => {
  const dir = repo()
  const said: string[] = []
  let state: any = { plan: { name: 'Debugger', role: 'debugger', goal: 'tiny', plan: 'tiny' } }
  const deps = {
    cwd: dir, now: () => Date.now(), agent: () => ({ service: 'fake' }), read: () => state,
    write: (patch: any) => { state = { ...state, ...patch } },
    hire: async () => {}, working: async () => {}, finish: async () => {},
    say: async (_name: string, _role: string, text: string) => { said.push(text) },
    run: async () => { writeFileSync(join(dir, 'partial.ts'), 'fixture'); return { text: '', code: 1, error: 'fixture failure' } },
  }
  await handleGoal(deps, '/goal')
  expect(said.at(-1)).toBe('Execution did not finish.\nChanged: partial.ts.')
  expect(state.plan).toBeDefined()
  expect(state.lastJob.status).toBe('failed')
})
