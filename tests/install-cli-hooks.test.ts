import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { renameSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { CLIS, prepareInstall, applyInstall, configPath, hooksInstalled, hookHandler, runInstaller, CODEX_TRUST, pluginSource } from '../scripts/install-cli-hooks.mjs'
import { checkCliHooks } from '../scripts/doctor.mjs'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function home() { const d = mkdtempSync(join(tmpdir(), 'office-cli-install-')); dirs.push(d); return d }
function put(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)) }
describe('explicit CLI hook installer', () => {
  it('hardening: refuses junctions in a config path before reading or writing', () => {
    const dir = home(), outside = home()
    put(join(outside, 'hooks.json'), { owner: true })
    try { symlinkSync(outside, join(dir, '.codex'), 'junction') } catch (e: any) {
      if (['EPERM', 'EACCES'].includes(e.code)) return
      throw e
    }
    expect(() => prepareInstall('codex', { home: dir })).toThrow(/link|junction/i)
    expect(readdirSync(outside)).toEqual(['hooks.json'])
  })

  it('hardening: does not mistake an owner command mentioning the tracker for our handler', () => {
    const dir = home(), file = configPath('codex', dir)
    const owner = { hooks: { Stop: [{ hooks: [{ command: 'echo D:/other/hooks/cli-tracker.mjs' }] }] } }
    put(file, owner)
    expect(prepareInstall('codex', { home: dir, uninstall: true }).changed).toBe(false)
  })

  it('hardening: rejects shell metacharacters in string hook commands', () => {
    for (const char of ['&', '^', '%', '!', '\u0000']) expect(() => hookHandler('codex', 'Stop', `C:/Office${char}/hooks/cli-tracker.mjs`)).toThrow('unsupported')
  })

  it('hardening: Windows delayed expansion changes a bang-containing tracker path', () => {
    if (process.platform !== 'win32') return
    const env = { ...process.env, OFFICE_TEST_PATH: 'expanded' }
    const result = spawnSync('cmd.exe', ['/d', '/v:on', '/c', 'echo node "C:/Office!OFFICE_TEST_PATH!/hooks/cli-tracker.mjs" codex Stop'], { encoding: 'utf8', env, windowsHide: true })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Officeexpanded/hooks')
    expect(() => hookHandler('codex', 'Stop', 'C:/Office!OFFICE_TEST_PATH!/hooks/cli-tracker.mjs')).toThrow('unsupported')
  })
  it('default and --print/--dry-run never create anything', () => {
    const dir = home(); const lines: string[] = []
    runInstaller(['all', '--home', dir, '--print'], line => lines.push(line))
    runInstaller(['all', '--home', dir, '--write', '--dry-run'], () => {})
    expect(readdirSync(dir)).toEqual([])
    expect(lines).toContain(CODEX_TRUST)
    expect(lines.join('\n')).not.toContain('decision')
  })
  for (const cli of CLIS) it(`${cli}: create, idempotence, backup, uninstall and owner preservation`, () => {
    const dir = home(), file = configPath(cli, dir)
    const owner = cli === 'agy' ? { 'ai-memory': { Stop: [{ command: 'owner-command' }] } } : { model: 'owner-model', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'owner-command' }] }] } }
    if (cli !== 'opencode') put(file, owner)
    const original = existsSync(file) ? readFileSync(file, 'utf8') : null
    const toml = join(dir, '.codex', 'config.toml'); mkdirSync(dirname(toml), { recursive: true }); writeFileSync(toml, 'notify = ["owner.exe", "turn-ended"]\r\n')
    applyInstall(prepareInstall(cli, { home: dir }))
    expect(hooksInstalled(cli, dir)).toBe(true)
    const bytes = readFileSync(file, 'utf8'), backups = readdirSync(dirname(file)).filter(x => x.includes('.backup.'))
    if (original !== null) { expect(backups).toHaveLength(1); expect(readFileSync(join(dirname(file), backups[0]), 'utf8')).toBe(original) }
    expect(prepareInstall(cli, { home: dir }).changed).toBe(false)
    applyInstall(prepareInstall(cli, { home: dir }))
    expect(readFileSync(file, 'utf8')).toBe(bytes)
    expect(readdirSync(dirname(file)).filter(x => x.includes('.backup.'))).toEqual(backups)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    applyInstall(prepareInstall(cli, { home: dir, uninstall: true }))
    expect(hooksInstalled(cli, dir)).toBe(false)
    if (cli === 'opencode') expect(existsSync(file)).toBe(false)
    else expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(owner)
    expect(readFileSync(toml, 'utf8')).toBe('notify = ["owner.exe", "turn-ended"]\r\n')
    expect(prepareInstall(cli, { home: dir, uninstall: true }).changed).toBe(false)
    expect(readdirSync(dirname(file)).filter(x => x.includes('.tmp.'))).toEqual([])
  })
  it('Codex SessionEnd is registered without async (Codex runs it synchronously and warns at start-up); other events stay async', () => {
    const tracker = 'D:/work/Claude-Office/hooks/cli-tracker.mjs'
    expect(hookHandler('codex', 'SessionEnd', tracker).async).toBeUndefined()
    expect(hookHandler('codex', 'Stop', tracker).async).toBe(true)
    expect(hookHandler('qoder', 'SessionEnd', tracker).async).toBe(true)
  })
  it('refuses invalid JSON and prints only its path, without leaking contents or making backups', () => {
    const dir = home(), file = configPath('codex', dir)
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, '{"secret":"not-to-log",')
    const result = spawnSync(process.execPath, ['scripts/install-cli-hooks.mjs', 'codex', '--home', dir, '--write'], { encoding: 'utf8' })
    expect(result.status).toBe(1); expect(result.stderr).toContain(file); expect(result.stderr).not.toContain('not-to-log')
    expect(readdirSync(dirname(file))).toEqual(['hooks.json'])
  })
  it('`all` skips agy; agy needs --unverified-agy-contract and prints a warning', () => {
    const dir = home(); const lines: string[] = []
    runInstaller(['all', '--home', dir, '--write'], l => lines.push(l))
    expect(existsSync(configPath('agy', dir))).toBe(false)
    expect(existsSync(configPath('codex', dir))).toBe(true)
    expect(() => runInstaller(['agy', '--home', dir, '--write'], () => {})).toThrow('--unverified-agy-contract')
    expect(existsSync(configPath('agy', dir))).toBe(false)
    lines.length = 0
    runInstaller(['agy', '--home', dir, '--write', '--unverified-agy-contract'], l => lines.push(l))
    expect(lines.join('\n')).toMatch(/WARNING: agy PreToolUse reply contract is unconfirmed/)
    expect(hooksInstalled('agy', dir)).toBe(true)
    runInstaller(['agy', '--home', dir, '--write', '--uninstall'], () => {})
    expect(hooksInstalled('agy', dir)).toBe(false)
  })
  it('retries a rename that fails with EPERM, and on final failure leaves the target, no temp and no backup', () => {
    const dir = home(), file = configPath('codex', dir)
    put(file, { model: 'owner' })
    const eperm = () => Object.assign(new Error('busy'), { code: 'EPERM' })
    let calls = 0
    const flaky = (from: string, to: string) => { if (++calls <= 2) throw eperm(); renameSync(from, to) }
    applyInstall(prepareInstall('codex', { home: dir }), { rename: flaky, pause: () => {} })
    expect(calls).toBe(3)
    expect(hooksInstalled('codex', dir)).toBe(true)
    applyInstall(prepareInstall('codex', { home: dir, uninstall: true }), { rename: flaky, pause: () => {} })
    const before = readFileSync(file, 'utf8')
    const plan = prepareInstall('codex', { home: dir })
    const names = readdirSync(dirname(file)).sort()
    expect(() => applyInstall(plan, { rename: () => { throw eperm() }, pause: () => {} })).toThrow('nothing was changed')
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(readdirSync(dirname(file)).sort()).toEqual(names)
  })
  it('validates all targets before writing any', () => {
    const dir = home(); put(configPath('qoder', dir), [])
    expect(() => runInstaller(['all', '--home', dir, '--write'], () => {})).toThrow('expected an object')
    expect(existsSync(configPath('codex', dir))).toBe(false)
  })
  it('repoints a moved checkout and uses unique backups', () => {
    const dir = home(), file = configPath('codex', dir)
    applyInstall(prepareInstall('codex', { home: dir, tracker: 'C:\\Old Folder\\hooks\\cli-tracker.mjs' }))
    applyInstall(prepareInstall('codex', { home: dir, tracker: 'D:\\New Folder\\hooks\\cli-tracker.mjs' }))
    applyInstall(prepareInstall('codex', { home: dir, tracker: 'D:\\Third Folder\\hooks\\cli-tracker.mjs' }))
    expect(readdirSync(dirname(file)).filter(x => x.includes('.backup.'))).toHaveLength(2)
    expect(readFileSync(file, 'utf8')).not.toContain('Old Folder')
  })
  it('preserves mixed owner handlers in the same group on uninstall', () => {
    const dir = home(), file = configPath('codex', dir)
    put(file, { hooks: { Stop: [{ matcher: 'Bash', hooks: [hookHandler('codex', 'Stop', 'D:/Office/hooks/cli-tracker.mjs'), { command: 'owner' }] }] } })
    applyInstall(prepareInstall('codex', { home: dir, uninstall: true }))
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ hooks: { Stop: [{ matcher: 'Bash', hooks: [{ command: 'owner' }] }] } })
  })
  it('quotes Windows paths with spaces, uses exec arguments for Qoder and refuses shell expansion characters', () => {
    const path = 'C:\\Users\\Example User\\Office\\hooks\\cli-tracker.mjs'
    expect(hookHandler('codex', 'Stop', path).command).toBe('node "C:/Users/Example User/Office/hooks/cli-tracker.mjs" codex Stop')
    expect(hookHandler('agy', 'PreToolUse', path).command).toBe('node "C:/Users/Example User/Office/hooks/cli-tracker.mjs" agy PreToolUse')
    expect(hookHandler('qoder', 'Stop', path).args).toEqual(['C:/Users/Example User/Office/hooks/cli-tracker.mjs', 'qoder', 'Stop'])
    expect(() => hookHandler('codex', 'Stop', 'C:/$HOME/hooks/cli-tracker.mjs')).toThrow('unsupported')
    expect(pluginSource(path)).toContain("if (process.env.AGENT_OFFICE_RUN === '1') return {}")
  })
  it('refuses overwriting or uninstalling an unmanaged OpenCode plugin', () => {
    const dir = home(), file = configPath('opencode', dir); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'export const Owner = async () => ({})')
    expect(() => prepareInstall('opencode', { home: dir })).toThrow('unmanaged')
    expect(() => prepareInstall('opencode', { home: dir, uninstall: true })).toThrow('unmanaged')
  })
  it('doctor reports installed/not installed for PATH entries without executing a CLI or changing exit severity', () => {
    const dir = home(), bin = join(dir, 'bin'); mkdirSync(bin)
    for (const name of ['codex', 'agy', 'opencode', 'qodercli']) writeFileSync(join(bin, process.platform === 'win32' ? `${name}.exe` : name), '', { mode: 0o755 })
    expect(checkCliHooks({ home: dir, path: bin }).map(x => x.title)).toEqual(CLIS.map(cli => `${cli} hooks: not installed`))
    for (const cli of CLIS) applyInstall(prepareInstall(cli, { home: dir }))
    expect(checkCliHooks({ home: dir, path: bin }).map(x => x.title)).toEqual(CLIS.map(cli => `${cli} hooks: installed`))
    expect(checkCliHooks({ home: dir, path: bin }).every(x => x.level === 'PASS')).toBe(true)
    expect(checkCliHooks({ home: dir, path: join(dir, 'missing') })).toEqual([])
  })
})
