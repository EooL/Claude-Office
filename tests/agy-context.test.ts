// Antigravity gets the project context in its prompt (its shell commands are refused headless): the file list comes from
// the office, named files are included with line numbers, nothing outside the project or secret is ever included.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'office-agy-context-'))
const oldHome = process.env.AGENT_OFFICE_HOME
process.env.AGENT_OFFICE_HOME = join(root, 'home')
mkdirSync(process.env.AGENT_OFFICE_HOME, { recursive: true })
const { agyContext, runAdapter } = await import('../server/adapters.mjs')

afterAll(() => {
  if (oldHome === undefined) delete process.env.AGENT_OFFICE_HOME
  else process.env.AGENT_OFFICE_HOME = oldHome
  delete process.env.AGENT_OFFICE_BIN_AGY
  delete process.env.AGENT_OFFICE_AGY_CONTEXT
  rmSync(root, { recursive: true, force: true })
})

let n = 0
const folder = () => { const d = join(root, `p${++n}`); mkdirSync(d, { recursive: true }); return d }
const put = (dir: string, rel: string, text = 'x\n') => {
  const full = join(dir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}

describe('agyContext: the file list', () => {
  it('hardening: does not execute a repository fsmonitor or inherit another Git directory', () => {
    const d = folder(), other = folder(), marker = join(d, 'EXECUTED')
    for (const dir of [d, other]) {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      put(dir, dir === d ? 'safe.js' : 'OUTSIDE_MARKER.js')
      execFileSync('git', ['add', '.'], { cwd: dir })
    }
    execFileSync('git', ['config', 'core.fsmonitor', `echo EXECUTED > '${marker.replaceAll('\\', '/')}'`], { cwd: d })
    agyContext({ prompt: '', cwd: d })
    expect(() => readFileSync(marker)).toThrow()
    const prev = process.env.GIT_DIR
    try {
      process.env.GIT_DIR = join(other, '.git')
      expect(agyContext({ prompt: '', cwd: d })).not.toContain('OUTSIDE_MARKER')
    } finally { if (prev === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = prev }
  })
  it('comes from git ls-files and honours the cap', () => {
    const d = folder()
    execFileSync('git', ['init', '-q'], { cwd: d })
    for (let i = 0; i < 7; i++) put(d, `src/f${i}.js`)
    put(d, 'untracked.txt')
    execFileSync('git', ['add', 'src'], { cwd: d })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', 'commit', '-q', '-m', 'x'], { cwd: d })
    const text = agyContext({ prompt: 'hello', cwd: d, limits: { maxList: 5 } })
    expect(text).toContain('src/f0.js')
    expect(text).not.toContain('src/f6.js')
    expect(text).not.toContain('untracked.txt')
    expect(text).toContain('2 more not listed')
    expect(text).toContain('do not run shell commands'.replace('do', 'Do'))
  })

  it('outside git: a walk that skips node_modules, .git, dot-folders, large and binary files', () => {
    const d = folder()
    put(d, 'a/keep.js')
    put(d, 'node_modules/m/x.js')
    put(d, '.git/config')
    put(d, '.hidden/h.js')
    put(d, 'dist/o.js')
    put(d, 'big.txt', 'y'.repeat(1_100_000))
    put(d, 'logo.png')
    const text = agyContext({ prompt: '', cwd: d })
    expect(text).toContain('a/keep.js')
    for (const bad of ['node_modules', '.git', '.hidden', 'dist/o.js', 'big.txt', 'logo.png']) expect(text).not.toContain(bad)
  })

  it('is empty for a project with nothing in it', () => {
    expect(agyContext({ prompt: 'look at nothing.js and src/none', cwd: folder() })).toBe('')
  })
})

describe('agyContext: named files', () => {
  it('hardening: suppresses secret directories, internal files and their names', () => {
    const d = folder()
    const names = ['.AWS/config.json', '.SSH/config.json', '.git-credentials', '.netrc', '.pypirc', 'vault.kdbx', 'node_modules/pkg/index.js', '.ENV.local']
    for (const name of names) put(d, name, 'PRIVATE_MARKER')
    const text = agyContext({ prompt: names.join(' '), cwd: d })
    expect(text).not.toContain('PRIVATE_MARKER')
    for (const name of names) expect(text).not.toContain(name)
  })
  it('includes a named file with line numbers, and nothing unsafe', () => {
    const d = folder()
    const outside = folder()
    put(d, 'src/app.mjs', 'one\ntwo\n')
    put(d, '.env', 'KEY=secret-value')
    put(d, 'auth-token', 'tok-secret')
    put(d, '.git/config', 'git-config-secret')
    put(outside, 'x.txt', 'outside-secret')
    let linked = true
    try { symlinkSync(outside, join(d, 'escape'), 'junction') } catch { linked = false }
    const prompt = `Read src/app.mjs and ../${outside.split(/[\\/]/).pop()}/x.txt and ${join(outside, 'x.txt')} and .env and auth-token and .git/config and escape/x.txt`
    const text = agyContext({ prompt, cwd: d })
    expect(text).toContain('--- FILE: src/app.mjs (3 lines) ---')
    expect(text).toContain('   1| one')
    for (const bad of ['outside-secret', 'secret-value', 'tok-secret', 'git-config-secret']) expect(text, `${bad} (symlink ${linked})`).not.toContain(bad)
  })

  it('caps at 12 files, 40,000 characters per file and 150,000 in all', () => {
    const d = folder()
    for (let i = 0; i < 15; i++) put(d, `s/f${i}.js`, 'a'.repeat(1000))
    const many = agyContext({ prompt: Array.from({ length: 15 }, (_, i) => `s/f${i}.js`).join(' '), cwd: d })
    expect(many.match(/--- FILE:/g)?.length).toBe(12)
    const e = folder()
    for (let i = 0; i < 6; i++) put(e, `b/f${i}.js`, 'a'.repeat(100_000))
    const big = agyContext({ prompt: Array.from({ length: 6 }, (_, i) => `b/f${i}.js`).join(' '), cwd: e })
    expect(big).toContain('[truncated')
    expect(big.match(/--- FILE:/g)?.length).toBe(4)
    expect((big.match(/a/g) ?? []).length).toBeLessThanOrEqual(150_000 + 200)
  })

  it('never throws on a missing or absent folder', () => {
    expect(agyContext({ prompt: 'src/a.js', cwd: join(root, 'does-not-exist') })).toBe('')
    expect(agyContext({ prompt: 'x' })).toBe('')
    expect(agyContext()).toBe('')
  })
})

describe('the agy adapter', () => {
  const recorder = join(root, 'recorder.mjs')
  writeFileSync(recorder, `
import { writeFileSync } from 'node:fs'
writeFileSync(process.env.RECORD_TO, JSON.stringify({ argv: process.argv.slice(2) }))
console.log(JSON.stringify({ status: 'SUCCESS', response: 'ok', result: 'ok', type: 'text', part: { text: 'ok' } }))
`)
  process.env.AGENT_OFFICE_BIN_AGY = `"${process.execPath}" "${recorder}"`
  process.env.AGENT_OFFICE_BIN_CODEX = `"${process.execPath}" "${recorder}"`
  const project = folder()
  put(project, 'src/app.mjs', 'hello\n')
  const run = async (name: string, mode: 'chat' | 'plan' | 'write') => {
    const file = join(root, `rec-${++n}.json`)
    process.env.RECORD_TO = file
    await runAdapter(name, 'Check src/app.mjs please', { mode, cwd: project, timeoutMs: 40000 })
    return JSON.parse(readFileSync(file, 'utf8')).argv.join('\n') as string
  }

  it('adds the block for chat and plan only, and only for agy', async () => {
    for (const mode of ['chat', 'plan'] as const) {
      const argv = await run('agy', mode)
      expect(argv).toContain('--- FILE: src/app.mjs')
      expect(argv).toContain('PROJECT FILE LIST')
      expect(argv.indexOf('PROJECT FILE LIST')).toBeLessThan(argv.indexOf('Use only your file read'))
    }
    expect(await run('agy', 'write')).not.toContain('PROJECT FILE LIST')
    expect(await run('codex', 'chat')).not.toContain('PROJECT FILE LIST')
  })

  it('AGENT_OFFICE_AGY_CONTEXT=0 switches it off', async () => {
    process.env.AGENT_OFFICE_AGY_CONTEXT = '0'
    try { expect(await run('agy', 'chat')).not.toContain('PROJECT FILE LIST') } finally { delete process.env.AGENT_OFFICE_AGY_CONTEXT }
  })
})
