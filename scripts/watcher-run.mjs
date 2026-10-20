// One supervisor owns the chat watcher. Repeated office launches reuse the live watcher.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acquireProcessLock } from '../server/process-lock.mjs'
import { homeDir } from '../server/settings.mjs'
import { bashCommand } from './runtime-launchers.mjs'

const release = acquireProcessLock(join(homeDir, 'watcher-supervisor.lock'))
if (!release) {
  console.log('The office chat watcher is already supervised.')
  process.exit(0)
}
const bash = bashCommand()
try {
  const pid = readFileSync(join(homeDir, 'chat-watcher.pid'), 'utf8').trim()
  if (/^\d+$/.test(pid) && spawnSync(bash, ['-c', 'kill -0 "$1" 2>/dev/null', 'office-watcher', pid], { windowsHide: true }).status === 0) {
    console.log('Reusing the existing office chat watcher.')
    release()
    process.exit(0)
  }
} catch { /* no existing watcher */ }

const script = fileURLToPath(new URL('./chat-ai-watcher.sh', import.meta.url))
const child = spawn(bash, [script], { stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32' })
let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.on('error', () => child.kill())
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill() }
  }
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.once('error', error => { console.error(`Chat watcher failed to start: ${error.message}`); release(); process.exitCode = 1 })
child.once('exit', code => { release(); process.exitCode = stopping ? 0 : code ?? 1 })
