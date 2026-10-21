import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ProcessOffice {
  home: string
  cwd: string
  url: string
  token: string
  child: ChildProcess
}

async function unusedPort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

/** Real entry points, isolated by processes rather than in-process office contexts. */
export async function startTwoOffices() {
  const root = mkdtempSync(join(tmpdir(), 'office-two-processes-'))
  const offices: ProcessOffice[] = []
  let stopping: Promise<void> | undefined
  const stop = () => stopping ??= (async () => {
    await Promise.all(offices.map(async ({ child }) => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
      const exited = once(child, 'exit')
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { killer.kill(); reject(new Error('taskkill timed out')) }, 10_000)
          killer.once('error', error => { clearTimeout(timer); reject(error) })
          killer.once('exit', () => { clearTimeout(timer); resolve() })
        })
      } else {
        try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
      }
      await Promise.race([exited, new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('office process did not exit')), 10_000)
        timer.unref()
      })])
    }))
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })()
  try {
    for (const name of ['a', 'b']) {
      const home = join(root, name, 'runtime')
      const cwd = join(root, name, 'workspace')
      const userHome = join(root, name, 'user')
      for (const dir of [home, cwd, userHome]) mkdirSync(dir, { recursive: true })
      // Exercise real startup without catalogue probes of subscription-backed CLIs.
      writeFileSync(join(home, 'backend.json'), JSON.stringify({ enabledServices: [] }))
      const port = await unusedPort()
      const child = spawn(process.execPath, [fileURLToPath(new URL('../../server/index.js', import.meta.url))], {
        cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HOME: userHome, USERPROFILE: userHome,
          AGENT_OFFICE_HOME: home, AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_HOST: '127.0.0.1',
          AGENT_OFFICE_CONFIG_DIR: cwd, CLAUDE_CONFIG_DIR: join(userHome, '.claude'),
          AGENT_OFFICE_REGISTRY_DIR: join(home, 'registry'), AGENT_OFFICE_TASKS_DIR: join(home, 'tasks') },
      })
      let output = ''
      let spawnError: Error | undefined
      child.once('error', error => { spawnError = error })
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', data => { output = (output + data).slice(-8000) })
      const office = { home, cwd, url: `http://127.0.0.1:${port}`, token: '', child }
      offices.push(office)
      const deadline = Date.now() + 20_000
      while (true) {
        if (spawnError || child.exitCode !== null) throw new Error(`Office startup failed: ${spawnError ?? output}`)
        try {
          const response = await fetch(`${office.url}/health`, { signal: AbortSignal.timeout(500) })
          if (response.ok) {
            office.token = readFileSync(join(home, 'auth-token'), 'utf8').trim()
            break
          }
        } catch { /* Startup is bounded, including each health request. */ }
        if (Date.now() > deadline) throw new Error(`Office health timeout: ${output}`)
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    return { a: offices[0], b: offices[1], stop }
  } catch (error) {
    await stop()
    throw error
  }
}
