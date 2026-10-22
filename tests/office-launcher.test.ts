import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { bashCommand, watcherCommand } from '../scripts/runtime-launchers.mjs'
import { inspectWatcher, stopWatcher } from '../scripts/watcher-process.mjs'
import { reconcileWatchers } from '../scripts/watcher-run.mjs'

const dirs: string[] = []
const children: ChildProcess[] = []
const records: any[] = []
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(fn: () => boolean) {
  const deadline = Date.now() + 12000
  while (!fn()) { if (Date.now() > deadline) throw new Error('fixture timeout'); await delay(40) }
}
afterEach(async () => {
  for (const record of records.splice(0)) if (inspectWatcher(record) === 'healthy') await stopWatcher(record)
  for (const child of children.splice(0)) if (child.exitCode === null) { child.kill(); await until(() => child.exitCode !== null || child.signalCode !== null) }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
})
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'office-watcher-')); dirs.push(home)
  const fake = join(home, 'fake.mjs')
  writeFileSync(fake, `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(join(home, 'starts'))}, 'started\\n'); setInterval(()=>{},1000)`)
  const launcher = join(home, 'launch.mjs')
  writeFileSync(launcher, `import {runWatcher} from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'scripts/watcher-run.mjs')).href)}; await runWatcher({home:${JSON.stringify(home)},command:[process.execPath,[${JSON.stringify(fake)}]]})`)
  const start = () => {
    const child = spawn(process.execPath, [launcher], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    children.push(child)
    let out = ''; child.stdout!.on('data', chunk => { out += chunk }); child.stderr!.on('data', chunk => { out += chunk })
    return { child, output: () => out }
  }
  const readRecords = () => {
    const dir = join(home, 'watcher-processes')
    return existsSync(dir) ? readdirSync(dir).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8'))) : []
  }
  return { home, start, readRecords }
}

describe('single office watcher', () => {
  it('starting concurrently twice starts exactly one fake watcher', async () => {
    const f = fixture(); const a = f.start(); const b = f.start()
    await until(() => f.readRecords().length === 1 && existsSync(join(f.home, 'starts')))
    records.push(...f.readRecords())
    await until(() => (a.output() + b.output()).includes('already supervised'))
    expect(readFileSync(join(f.home, 'starts'), 'utf8')).toBe('started\n')
  }, 30000)
  it('adopts a live healthy watcher and holds the start lock across repeated launches', async () => {
    const f = fixture()
    const token = 'fixture-adopted'
    const child = spawn(process.execPath, [join(f.home, 'fake.mjs'), `--office-watcher=${token}`, `--office-home=${Buffer.from(f.home).toString('base64url')}`], { detached: true, stdio: 'ignore', windowsHide: true })
    children.push(child)
    const record = { pid: child.pid, home: f.home, token, started: Date.now(), namespace: 'native' }; records.push(record)
    mkdirSync(join(f.home, 'watcher-processes'))
    writeFileSync(join(f.home, 'watcher-processes', `${token}.json`), JSON.stringify(record))
    await until(() => existsSync(join(f.home, 'starts')))
    const second = f.start(); await until(() => second.output().includes('Reusing'))
    const third = f.start(); await until(() => third.output().includes('already supervised'))
    expect(readFileSync(join(f.home, 'starts'), 'utf8')).toBe('started\n')
  }, 30000)
  it('replaces a stale shell PID without treating it as a native PID', async () => {
    const f = fixture(); writeFileSync(join(f.home, 'chat-watcher.pid'), '2147483647')
    const proc = f.start(); await until(() => proc.output().includes('watcher started'))
    records.push(...f.readRecords())
    expect(f.readRecords()).toHaveLength(1)
  }, 30000)
  it('reclaims a dead supervisor and replaces its dead native watcher record', async () => {
    const f = fixture()
    const dead = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore', windowsHide: true })
    await new Promise(resolve => dead.once('exit', resolve))
    mkdirSync(join(f.home, 'watcher-processes'))
    writeFileSync(join(f.home, 'watcher-supervisor.lock'), JSON.stringify({ pid: dead.pid, token: 'dead-owner' }))
    writeFileSync(join(f.home, 'watcher-processes', 'dead.json'), JSON.stringify({ pid: dead.pid, home: f.home, token: 'dead-watcher', namespace: 'native' }))
    const proc = f.start(); await until(() => proc.output().includes('watcher started'))
    records.push(...f.readRecords())
    expect(f.readRecords()).toHaveLength(1)
    expect(f.readRecords()[0].token).not.toBe('dead-watcher')
  }, 30000)
  it('keeps the oldest identified watcher and stops only its same-home duplicate', async () => {
    const f = fixture(); const proc = f.start()
    await until(() => f.readRecords().length === 1 && existsSync(join(f.home, 'starts')))
    const oldest = f.readRecords()[0]; records.push(oldest)
    const token = 'fixture-duplicate'
    const child = spawn(process.execPath, [join(f.home, 'fake.mjs'), `--office-watcher=${token}`, `--office-home=${Buffer.from(f.home).toString('base64url')}`], { detached: process.platform !== 'win32', stdio: 'ignore', windowsHide: true })
    children.push(child)
    const duplicate = { ...oldest, pid: child.pid, token, started: oldest.started + 1000 }; records.push(duplicate)
    await until(() => inspectWatcher(duplicate) === 'healthy')
    expect(await reconcileWatchers([duplicate, oldest])).toEqual(oldest)
    expect(inspectWatcher(duplicate)).toBe('dead'); expect(inspectWatcher(oldest)).toBe('healthy')
    expect(proc.child.exitCode).toBeNull()
  }, 30000)
  it('never stops an unrelated live process or launches past uncertain identity', async () => {
    const record = { pid: process.pid, token: 'not-ours', home: 'unrelated', started: 0 }
    await expect(stopWatcher(record)).rejects.toThrow('identity')
    await expect(reconcileWatchers([record])).rejects.toThrow('Cannot identify')
    expect(() => process.kill(process.pid, 0)).not.toThrow()
  })
  it('uses Git Bash and bypasses the Python setsid helper on Windows', () => {
    const system = join('C:/Program Files', 'Git', 'bin', 'bash.exe')
    const user = join('C:/Users/test/AppData/Local', 'Programs', 'Git', 'bin', 'bash.exe')
    const env = { ProgramFiles: 'C:/Program Files', LOCALAPPDATA: 'C:/Users/test/AppData/Local' }
    expect(bashCommand('win32', env, p => p === system)).toBe(system)
    expect(bashCommand('win32', env, p => p === user)).toBe(user)
    expect(bashCommand('linux', env, () => true)).toBe('bash')
    expect(bashCommand('win32', { AGENT_OFFICE_BASH: 'D:/Git/bash.exe' }, () => false)).toBe('D:/Git/bash.exe')
    const [bin, args] = watcherCommand('win32', env, p => p === system)
    expect(bin).toBe(system); expect(args[0]).toMatch(/chat-ai-watcher\.sh$/)
    expect(JSON.stringify([bin, args])).not.toMatch(/python|setsid|start-office/)
    expect(watcherCommand('linux', {}, () => true)[0]).toBe('bash')
  })
})
