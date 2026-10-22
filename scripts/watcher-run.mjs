// The reservation covers reuse, startup, and shutdown, not just spawning.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { acquireProcessLock } from '../server/process-lock.mjs'
import { officeHome } from '../server/paths.mjs'
import { watcherCommand } from './runtime-launchers.mjs'
import { inspectWatcher, legacyWatchers, stopWatcher } from './watcher-process.mjs'

export async function reconcileWatchers(records, { home = records[0]?.home, inspect = inspectWatcher, stop = stopWatcher } = {}) {
  const healthy = []
  for (const record of records) {
    if (record.home !== home) continue
    const status = await inspect(record)
    if (status === 'unknown') throw new Error('Cannot identify an existing chat watcher; refusing to start another.')
    if (status === 'healthy') healthy.push(record)
  }
  healthy.sort((a, b) => a.started - b.started || a.pid - b.pid)
  for (const duplicate of healthy.slice(1)) await stop(duplicate)
  return healthy[0]
}

export async function runWatcher({ home = officeHome(process.env.OFFICE_ID ?? 'default'), command, env = process.env } = {}) {
  home = resolve(home)
  const release = acquireProcessLock(join(home, 'watcher-supervisor.lock'))
  if (!release) { console.log('The office chat watcher is already supervised.'); return }
  let child, timer, record, stopping = false
  const recordsDir = join(home, 'watcher-processes')
  const finish = () => { clearInterval(timer); release(); process.off('SIGINT', stop); process.off('SIGTERM', stop) }
  const stop = async () => {
    if (stopping) return
    stopping = true
    // A reused watcher belongs to its original owner.
    if (child) { try { await stopWatcher(record) } catch (error) { console.error(error.message) } }
    else finish()
  }
  try {
    mkdirSync(recordsDir, { recursive: true })
    const records = []
    for (const file of readdirSync(recordsDir)) {
      if (!file.endsWith('.json')) continue
      const value = JSON.parse(readFileSync(join(recordsDir, file), 'utf8'))
      if (value.home !== home) continue
      const status = inspectWatcher(value)
      if (status === 'dead') unlinkSync(join(recordsDir, file))
      else records.push(value)
    }
    records.push(...legacyWatchers(home, records, { scan: !command }))
    const existing = await reconcileWatchers(records, { home })
    process.on('SIGINT', stop); process.on('SIGTERM', stop)
    if (existing) {
      console.log('Reusing the existing office chat watcher.')
      timer = setInterval(() => { if (inspectWatcher(existing) === 'dead') finish() }, 1000)
      return
    }
    const token = randomUUID()
    const [bin, args] = command ?? watcherCommand()
    child = spawn(bin, [...args, `--office-watcher=${token}`, `--office-home=${Buffer.from(home).toString('base64url')}`], {
      env: { ...env, AGENT_OFFICE_HOME: home }, stdio: 'inherit', windowsHide: true,
      detached: process.platform !== 'win32',
    })
    await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject) })
    record = { pid: child.pid, home, token, started: Date.now(), namespace: 'native' }
    const recordFile = join(recordsDir, `${token}.json`)
    child.once('exit', code => {
      try { unlinkSync(recordFile) } catch {}
      finish(); process.exitCode = stopping ? 0 : code ?? 1
    })
    writeFileSync(recordFile, JSON.stringify(record), { mode: 0o600 })
    console.log('Office chat watcher started.')
  } catch (error) {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      // Keep the reservation until this owned child actually exits, including
      // failures publishing its record. Never release and race a replacement.
      if (record) await stopWatcher(record)
      else child.kill()
    } else finish()
    throw error
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runWatcher().catch(error => { console.error(error.message); process.exitCode = 1 })
}
