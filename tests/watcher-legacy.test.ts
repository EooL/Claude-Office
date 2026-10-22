import { afterEach, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bashCommand } from '../scripts/runtime-launchers.mjs'
import { inspectWatcher, legacyWatchers, stopWatcher } from '../scripts/watcher-process.mjs'
import { reconcileWatchers } from '../scripts/watcher-run.mjs'

const dirs: string[] = []
const children: ChildProcess[] = []
const owned: any[] = []
function home() { const dir = mkdtempSync(join(tmpdir(), 'watcher-legacy-')); dirs.push(dir); return dir }
async function fake(home: string) {
  // A fake shell loop with a watcher-shaped argv[0], never the shipped watcher.
  const child = spawn(bashCommand(), ['-c', 'echo $$; while :; do sleep 0.1; done', '/fake/chat-ai-watcher.sh'], {
    env: { ...process.env, AGENT_OFFICE_HOME: home }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  const pid = await new Promise<number>((resolve, reject) => {
    child.once('error', reject); child.stdout!.once('data', data => resolve(Number(String(data).trim())))
  })
  const record = { pid, home, namespace: 'bash', started: Date.now() }; owned.push(record)
  return record
}
afterEach(async () => {
  for (const record of owned.splice(0)) if (inspectWatcher(record) === 'healthy') await stopWatcher(record)
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
})

it.skipIf(process.platform !== 'win32' && process.platform !== 'linux')('identifies legacy fake loops, keeps the oldest same-home watcher, and leaves another home alive', async () => {
  const ours = home(), theirs = home()
  const oldest = await fake(ours)
  await new Promise(resolve => setTimeout(resolve, 100))
  const duplicate = await fake(ours), unrelated = await fake(theirs)
  writeFileSync(join(ours, 'chat-watcher.pid'), String(duplicate.pid))
  const found = legacyWatchers(ours, [])
  expect(found.map(record => record.pid).sort()).toEqual([oldest.pid, duplicate.pid].sort())
  expect(found.every(record => record.birth && inspectWatcher(record) === 'healthy')).toBe(true)
  expect((await reconcileWatchers(found, { home: ours })).pid).toBe(oldest.pid)
  expect(inspectWatcher(oldest)).toBe('healthy')
  expect(inspectWatcher(duplicate)).toBe('dead')
  expect(inspectWatcher(unrelated)).toBe('healthy')
}, 30000)
