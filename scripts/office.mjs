#!/usr/bin/env node
// office.mjs — `npm run office`: start the office (server, Vite UI, chat watcher)
// and open it in the browser. Which AI service answers is picked on the page's
// start screen (server/backends.js), not here.
//
//   npm run office
//   npm run office -- --backend codex [--model <m>]   preset the choice (skips nothing on the page)
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { services, setupHelp } from '../server/adapters.mjs'
import { readSettings, writeSettings } from '../server/settings.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }

const backend = flag('--backend')
if (backend) {
  const s = services().find((x) => x.name === backend)
  if (!s) { console.error(`Unknown service '${backend}'. Known: ${services().map((x) => x.name).join(', ')}`); process.exit(1) }
  if (!s.available) { console.error('\n' + setupHelp(s).join('\n') + '\n'); process.exit(1) }
  // the first choice ever made is also the only service allowed (more are turned on in Settings > Services)
  const first = readSettings().backend === undefined
  writeSettings({ backend, model: flag('--model') ?? '', ...(first ? { enabledServices: [backend] } : {}) })
}

const port = process.env.AGENT_OFFICE_PORT ?? 3334
const uiPort = process.env.AGENT_OFFICE_UI_PORT ?? 3333
const up = (url) => fetch(url).then((r) => r.ok || r.status < 500, () => false)
const children = []
const start = (cmd, args, env = {}) => {
  const c = spawn(cmd, args, { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, ...env } })
  c.on('error', err => console.error(`Could not start ${cmd}: ${err.message}`))
  children.push(c)
  return c
}

if (!(await up(`http://127.0.0.1:${port}/health`))) start(process.execPath, ['server/index.js'])
if (!(await up(`http://127.0.0.1:${uiPort}/`))) start(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(uiPort)])
start(process.execPath, ['scripts/watcher-run.mjs'])

setTimeout(() => spawn(process.execPath, ['scripts/open-office.mjs', '--dev'], { cwd: root, stdio: 'inherit', windowsHide: true }), 4000)

let stopping = false
const stop = async () => {
  if (stopping) return
  stopping = true
  await Promise.all(children.map(c => {
    if (process.platform !== 'win32' || !c.pid) { c.kill(); return }
    return new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', resolve)
      killer.once('exit', resolve)
    })
  }))
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
console.log('Ctrl+C stops what this command started.')
