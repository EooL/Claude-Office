import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { startTwoOffices } from './helpers/two-offices'

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)).replaceAll('\\', '/')).sort()
}

it('real startup and persistence retain the legacy file layout without creating a building root', async () => {
  const pair = await startTwoOffices()
  const { a } = pair
  const root = join(a.cwd, 'building-root')
  vi.stubEnv('AGENT_OFFICE_HOME', a.home)
  vi.stubEnv('AGENT_OFFICE_ROOT', root)
  vi.stubEnv('OFFICE_ID', 'default')
  vi.resetModules()
  try {
    const settings = await import('../server/settings.mjs')
    settings.writeSettings({ enabledServices: [] })
    const catalogue = await import('../server/catalogue.mjs')
    catalogue.saveCatalogue({ builtAt: Date.now(), models: [] })
    const brains = await import('../server/brains.mjs')
    brains.noteUsed('assistant', { service: 'fixture', model: 'tiny' })
    const limits = await import('../server/availability.mjs')
    limits.setCooldown('fixture', { kind: 'limit', retryAfterMs: 1, message: 'fixture' }, 1)
    const lease = limits.beginCircuit({ service: 'fixture' }, { now: 3 })
    const duringProbe = files(a.home).filter(path => path.startsWith('circuit-probes/')).map(() => 'circuit-probes/<hash>.lock')
    limits.finishCircuit(lease, { service: 'fixture' }, null, { now: 4 })
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }
    expect((await fetch(a.url + '/settings', { method: 'POST', headers, body: JSON.stringify({ logPrompts: 'summary' }) })).status).toBe(200)
    expect((await fetch(a.url + '/chat', { method: 'POST', headers, body: JSON.stringify({ sender: 'layout', text: 'tiny' }) })).status).toBe(200)
    expect((await fetch(a.url + '/event', { method: 'POST', headers, body: JSON.stringify({ type: 'agent_spawned', agent: { id: 'layout-agent', name: 'Layout', role: 'frontend', task: 'fixture' } }) })).status).toBe(200)
    expect((await fetch(a.url + '/chat/reply', { method: 'POST', headers, body: JSON.stringify({ sender: 'Fixture', recipient: 'Layout', text: 'tiny' }) })).status).toBe(200)
    // The real delegate worker takes/releases its process lock and persists a no-plan result; no provider is called.
    const worker = spawnSync(process.execPath, [resolve('scripts/delegate.mjs'), 'goal-run', '/goal'], {
      cwd: a.cwd, timeout: 10_000, windowsHide: true, encoding: 'utf8',
      env: { ...process.env, AGENT_OFFICE_HOME: a.home, AGENT_OFFICE_ROOT: root, AGENT_OFFICE_PORT: new URL(a.url).port },
    })
    expect(worker.status, worker.stderr).toBe(0)
    const { acquireProcessLock } = await import('../server/process-lock.mjs')
    const unlock = acquireProcessLock(join(a.home, 'watcher-supervisor.lock'))!
    try {
      const watcher = spawnSync(process.execPath, [resolve('scripts/watcher-run.mjs')], {
        cwd: a.cwd, timeout: 10_000, windowsHide: true, encoding: 'utf8', env: { ...process.env },
      })
      expect(watcher.status, watcher.stderr).toBe(0)
      expect(watcher.stdout).toContain('already supervised')
    } finally { unlock() }
    const runner = spawnSync(process.execPath, [resolve('scripts/office-run.mjs'), 'codex', 'tiny'], {
      cwd: a.cwd, timeout: 10_000, windowsHide: true, encoding: 'utf8', env: { ...process.env },
    })
    expect(runner.status, runner.stderr).toBe(2)
    expect(runner.stderr).toContain('not enabled')
    const snapshot = { home: files(a.home), duringProbe, root: files(a.cwd).filter(path => path.startsWith('building-root/')) }
    expect(JSON.stringify(snapshot, null, 2) + '\n').toBe(readFileSync(join(__dirname, 'fixtures/file-layout.json'), 'utf8'))
  } finally {
    vi.unstubAllEnvs()
    await pair.stop()
  }
}, 45_000)
