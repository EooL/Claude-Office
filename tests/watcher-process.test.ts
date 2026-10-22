import { describe, expect, it, vi, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectWatcher, legacyWatchers, stopWatcher } from '../scripts/watcher-process.mjs'
import { reconcileWatchers } from '../scripts/watcher-run.mjs'
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawnSync: vi.fn() }))
const homes: string[] = []
afterEach(() => { vi.restoreAllMocks(); vi.mocked(spawnSync).mockReset(); for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
function home() { const dir = mkdtempSync(join(tmpdir(), 'watcher-identity-')); homes.push(dir); return dir }
function result(stdout: string, status = 0) { return { status, stdout, stderr: '', pid: 1, output: ['', stdout, ''], signal: null } as any }

describe('watcher process identity', () => {
  it('uses Bash for a live Cygwin PID, never native process.kill', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('wrong namespace') })
    vi.mocked(spawnSync).mockReturnValue(result('healthy\n'))
    expect(inspectWatcher({ pid: 315786, namespace: 'bash', home: 'D:/fake-office', birth: '123' })).toBe('healthy')
    expect(kill).not.toHaveBeenCalled()
    const args = vi.mocked(spawnSync).mock.calls[0][1] as string[]
    expect(args.slice(-3)).toEqual(['315786', 'D:/fake-office', '123'])
    expect(args[1]).toContain('/proc/$1/environ'); expect(args[1]).toContain('kill -0 "$1"')
  })
  it('distinguishes dead shell PIDs from a failed or unreadable probe', () => {
    const record = { pid: 315786, namespace: 'bash', home: home() }
    vi.mocked(spawnSync).mockReturnValueOnce(result('dead\n')).mockReturnValueOnce(result('', 1))
    expect(inspectWatcher(record)).toBe('dead'); expect(inspectWatcher(record)).toBe('unknown')
  })
  it('maps a pid-file shell PID to the managed native PID before reusing it', () => {
    const dir = home(); writeFileSync(join(dir, 'chat-watcher.pid'), '315786')
    const record = { pid: process.pid, token: 'fixture', home: dir, namespace: 'native' }
    vi.mocked(spawnSync).mockImplementation((_bin, args) => {
      if ((args as string[]).join(' ').includes('/proc/$1/winpid')) return result(`${process.pid}\n`)
      return result(`node --office-watcher=fixture --office-home=${Buffer.from(dir).toString('base64url')}`)
    })
    // On POSIX the shell PID and native PID already share one namespace.
    if (process.platform !== 'win32') writeFileSync(join(dir, 'chat-watcher.pid'), String(process.pid))
    expect(legacyWatchers(dir, [record], { scan: false })).toEqual([])
  })
  it('discovers legacy duplicates by explicit home and birth time, including without a pid file', () => {
    const dir = home()
    vi.mocked(spawnSync).mockReturnValue(result('clock 1000 100\n123 456 10000\n124 457 20000\n'))
    const found = legacyWatchers(dir, [])
    expect(found.map(r => [r.pid, r.birth, r.home])).toEqual([[123, '10000', dir], [124, '20000', dir]])
    expect(found[0].started).toBeLessThan(found[1].started)
    const source = vi.mocked(spawnSync).mock.calls[0][1]![1] as string
    expect(source).toContain('[ "$actual" = "$expected" ]')
    expect(source).toContain('/proc/$1/cmdline')
  })
  it('never stops another home or an unidentifiable process while reconciling duplicates', async () => {
    const inspect = vi.fn(() => 'healthy'), stop = vi.fn(async () => {})
    const oldest = { pid: 1, started: 1, home: 'ours' }, newer = { pid: 2, started: 2, home: 'ours' }
    const unrelated = { pid: 3, started: 0, home: 'theirs' }
    expect(await reconcileWatchers([unrelated, newer, oldest], { home: 'ours', inspect, stop })).toEqual(oldest)
    expect(inspect).not.toHaveBeenCalledWith(unrelated); expect(stop.mock.calls).toEqual([[newer]])
    inspect.mockReturnValue('unknown')
    await expect(reconcileWatchers([oldest], { inspect, stop })).rejects.toThrow('Cannot identify')
    expect(stop).toHaveBeenCalledTimes(1)
  })
  it('does not signal when identity proof is unavailable', async () => {
    vi.mocked(spawnSync).mockReturnValue(result('unknown\n'))
    await expect(stopWatcher({ pid: 315786, namespace: 'bash', home: home() })).rejects.toThrow('identity')
    expect(vi.mocked(spawnSync)).toHaveBeenCalledTimes(1)
  })
})
