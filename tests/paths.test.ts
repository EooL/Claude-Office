import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let root: string
let home: string
let registryRoot: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'office-paths-'))
  home = join(root, 'legacy-home')
  registryRoot = join(root, 'building-root')
  vi.stubEnv('AGENT_OFFICE_HOME', home)
  vi.stubEnv('AGENT_OFFICE_ROOT', registryRoot)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  rmSync(root, { recursive: true, force: true })
})

it('resolves the synthesized legacy office and G0 without creating either directory', async () => {
  const before = readdirSync(root)
  const { g0Dir, officeHome, officeTmp } = await import('../server/paths.mjs')
  expect(g0Dir()).toBe(home)
  expect(officeHome()).toBe(home)
  expect(officeHome('default')).toBe(home)
  expect(officeTmp()).toBe(join(home, 'tmp'))
  expect(readdirSync(root)).toEqual(before)
  expect(existsSync(home)).toBe(false)
  expect(existsSync(registryRoot)).toBe(false)
})

it('uses registered home paths verbatim and keeps shared state at its legacy location', async () => {
  const otherHome = join(root, 'an-explicit-storage-directory')
  mkdirSync(registryRoot)
  writeFileSync(join(registryRoot, 'building.json'), JSON.stringify({
    schemaVersion: 1,
    g0Home: home,
    offices: [
      { id: 'default', home, cwd: join(root, 'legacy-project') },
      { id: 'off_abc123', home: otherHome, cwd: join(root, 'other-project') },
    ],
  }))
  const { g0Dir, officeHome, officeTmp } = await import('../server/paths.mjs')
  expect(g0Dir()).toBe(home)
  expect(officeHome('off_abc123')).toBe(otherHome)
  expect(officeTmp('off_abc123')).toBe(join(otherHome, 'tmp'))
  expect(existsSync(otherHome)).toBe(false)
  expect(readdirSync(registryRoot)).toEqual(['building.json'])
})

it.each(['../default', 'off_short', 'off_ABC123', 'off_abcdefghijklm', '', null, 'off_abc123\n', 'default\n'])(
  'rejects malformed ids without filesystem effects: %s', async id => {
    const { officeHome, officeTmp } = await import('../server/paths.mjs')
    expect(() => officeHome(id as string)).toThrow('Invalid office id')
    expect(() => officeTmp(id as string)).toThrow('Invalid office id')
    expect(readdirSync(root)).toEqual([])
  },
)

it('refuses an unregistered but well-formed id rather than deriving a path', async () => {
  const { officeHome } = await import('../server/paths.mjs')
  expect(() => officeHome('off_abc123')).toThrow('Unknown office id')
  expect(readdirSync(root)).toEqual([])
})

it('retains legacy G0 when a valid registry omits the optional explicit G0 path', async () => {
  mkdirSync(registryRoot)
  writeFileSync(join(registryRoot, 'building.json'), JSON.stringify({
    schemaVersion: 1,
    offices: [{ id: 'default', home, cwd: join(root, 'project') }],
  }))
  const { g0Dir } = await import('../server/paths.mjs')
  expect(g0Dir()).toBe(home)
})

it('migrated persistence stays in G0 while real script helpers select the registered office', async () => {
  const selected = join(root, 'selected-home')
  const project = join(root, 'project')
  for (const dir of [registryRoot, home, selected, project]) mkdirSync(dir)
  writeFileSync(join(registryRoot, 'building.json'), JSON.stringify({ schemaVersion: 1, g0Home: home, offices: [
    { id: 'default', home, cwd: root }, { id: 'off_abc123', home: selected, cwd: project },
  ] }))
  vi.stubEnv('OFFICE_ID', 'off_abc123')
  const settings = await import('../server/settings.mjs')
  settings.writeSettings({ enabledServices: ['agy'] })
  ;(await import('../server/catalogue.mjs')).saveCatalogue({ builtAt: 1, models: [] })
  ;(await import('../server/brains.mjs')).noteUsed('assistant', { service: 'fixture', model: 'tiny' })
  ;(await import('../server/availability.mjs')).setCooldown('fixture', { kind: 'limit', retryAfterMs: 1, message: 'fixture' }, 1)
  expect(readdirSync(home).sort()).toEqual(['backend.json', 'brain-last.json', 'catalogue.json', 'cooldowns.json'])
  writeFileSync(join(selected, 'auth-token'), 'selected-token')
  const calls: { path: string; token: string | undefined }[] = []
  const server = createServer((req, res) => {
    calls.push({ path: req.url!, token: req.headers.authorization })
    req.resume(); res.end('{}')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  vi.stubEnv('AGENT_OFFICE_PORT', String((server.address() as { port: number }).port))
  const run = (script: string, args: string[]) => new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const target = join(__dirname, '..', 'scripts', script)
    // This machine's Node asserts in win/async.c on office-run's forced exit
    // after fetch. Test path selection with the same script and natural drain;
    // forced process teardown is outside this path regression's scope.
    const command = script === 'office-run.mjs'
      ? ['--input-type=module', '-e', 'process.exit = code => { process.exitCode = code }; await import(process.argv[1])', pathToFileURL(target).href, ...args]
      : [target, ...args]
    const child = spawn(process.execPath, command, { cwd: project, env: { ...process.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.resume()
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('script helper timed out')) }, 8000)
    child.stderr.on('data', data => { stderr += data })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); resolve({ code, stderr }) })
  })
  try {
    await (await import('../scripts/office-client.mjs')).say('Fixture', 'assistant', 'tiny')
    await (await import('../scripts/report-usage.mjs')).reportUsage('agy', { durationMs: 1 })
    expect(await run('delegate.mjs', ['goal-run', '/goal'])).toMatchObject({ code: 0 })
    expect(existsSync(join(selected, 'delegation.json'))).toBe(true)
    expect(existsSync(join(home, 'delegation.json'))).toBe(false)
    const { acquireProcessLock } = await import('../server/process-lock.mjs')
    const unlock = acquireProcessLock(join(selected, 'watcher-supervisor.lock'))!
    try { expect(await run('watcher-run.mjs', [])).toMatchObject({ code: 0 }) } finally { unlock() }
    const fake = join(root, 'agy.mjs')
    writeFileSync(fake, 'console.log(JSON.stringify({status:"SUCCESS",response:"tiny"}))')
    vi.stubEnv('AGENT_OFFICE_BIN_AGY', `"${process.execPath}" "${fake}"`)
    const result = await run('office-run.mjs', ['agy', 'tiny'])
    expect(result.code, result.stderr).toBe(0)
    expect(calls.map(call => call.path)).toContain('/usage')
    expect(calls.map(call => call.path)).toContain('/event')
    expect(calls.map(call => call.path)).toContain('/chat/reply')
    expect(calls.every(call => call.token === 'Bearer selected-token')).toBe(true)
    expect(readdirSync(registryRoot)).toEqual(['building.json'])
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
