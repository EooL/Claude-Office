import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Settings, cooldowns and the catalogue live under AGENT_OFFICE_HOME, read when the modules load
const home = mkdtempSync(join(tmpdir(), 'office-routes-'))
process.env.AGENT_OFFICE_HOME = home
// A catalogue that is already there, so no CLI is asked for its models
writeFileSync(join(home, 'catalogue.json'), JSON.stringify({
  builtAt: Date.now(),
  models: ['codex', 'claude', 'agy'].map(service => ({
    service, id: `${service}-pro-1`, label: service, note: '', efforts: ['low', 'high'], billing: 'plan', tier: 'strong', strength: 68,
    gen: 1, family: `${service}-pro-#`, deprecated: false, preview: false, effortInId: '', confidence: 0.9,
  })),
}))

const { mountBackends } = await import('../server/backends.js')
const { mountBrains } = await import('../server/brainRoutes.js')

let server: Server
let base = ''
const post = (path: string, body: unknown, method = 'POST') =>
  fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  const requireUi = (req: any, res: any, next: () => void) => (req.headers.authorization === 'Bearer ui' ? next() : res.status(401).json({ error: 'Unauthorized' }))
  mountBackends(app, { requireUi })
  mountBrains(app, { requireUi })
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(() => { server.close(); rmSync(home, { recursive: true, force: true }) })

const authed = { 'Content-Type': 'application/json', Authorization: 'Bearer ui' }
const send = (path: string, body: unknown, method = 'POST') => fetch(`${base}${path}`, { method, headers: authed, body: JSON.stringify(body) })

describe('allowing services', () => {
  it('lists every service with whether it is installed and enabled', async () => {
    const { services } = await (await fetch(`${base}/backends`)).json()
    expect(services.map((s: any) => s.name)).toEqual(['claude', 'codex', 'agy', 'opencode', 'qoder'])
    for (const s of services) expect(typeof s.enabled).toBe('boolean')
  })

  it('needs the UI token, a known service and a boolean', async () => {
    expect((await post('/backends/enable', { name: 'agy', enabled: false })).status).toBe(401)
    expect((await send('/backends/enable', { name: 'nope', enabled: false })).status).toBe(400)
    expect((await send('/backends/enable', { name: 'agy', enabled: 'no' })).status).toBe(400)
  })

  it('turns a service off and on, and the list says so', async () => {
    const off = await (await send('/backends/enable', { name: 'agy', enabled: false })).json()
    expect(off.services.find((s: any) => s.name === 'agy').enabled).toBe(false)
    const on = await (await send('/backends/enable', { name: 'agy', enabled: true })).json()
    expect(on.services.find((s: any) => s.name === 'agy').enabled).toBe(true)
  })

  it('the first service ever chosen is the only one allowed; a later one is added to the list', async () => {
    // a settings file that says nothing yet: the first choice decides
    writeFileSync(join(home, 'backend.json'), '{}')
    const installed = (await (await fetch(`${base}/backends`)).json()).services.filter((s: any) => s.available).map((s: any) => s.name)
    if (installed.length < 2) return // nothing to compare on a machine with fewer than two services installed
    expect((await send('/backends/select', { name: installed[0] })).status).toBe(200)
    let { services } = await (await fetch(`${base}/backends`)).json()
    expect(services.filter((s: any) => s.enabled).map((s: any) => s.name)).toEqual([installed[0]])
    expect((await send('/backends/select', { name: installed[1] })).status).toBe(200)
    ;({ services } = await (await fetch(`${base}/backends`)).json())
    expect(services.filter((s: any) => s.enabled).map((s: any) => s.name).sort()).toEqual([installed[0], installed[1]].sort())
  })
})

describe('full tool access over HTTP', () => {
  it('needs the token, a service that has the mode, and a boolean; and shows the state in the list', async () => {
    expect((await post('/backends/full-access', { name: 'agy', enabled: true })).status).toBe(401)
    expect((await send('/backends/full-access', { name: 'nope', enabled: true })).status).toBe(400)
    expect((await send('/backends/full-access', { name: 'codex', enabled: true })).status).toBe(400)
    expect((await send('/backends/full-access', { name: 'agy', enabled: 'yes' })).status).toBe(400)
    const on = await (await send('/backends/full-access', { name: 'agy', enabled: true })).json()
    expect(on.services.find((s: any) => s.name === 'agy')).toMatchObject({ fullAccessSupported: true, fullAccess: true })
    const off = await (await send('/backends/full-access', { name: 'agy', enabled: false })).json()
    expect(off.services.find((s: any) => s.name === 'agy').fullAccess).toBe(false)
  })
})

describe('brains over HTTP', () => {
  it('lists three auto brains and what the chat and the orchestrator run on', async () => {
    const o = await (await fetch(`${base}/brains`)).json()
    expect(o.brains.map((b: any) => b.id)).toEqual(['deep', 'balanced', 'quick'])
    expect(o.operations.chat.brain).toBeNull()
    expect(o.operations.orchestrator.steps.length).toBeGreaterThan(0)
  })

  it('choosing a brain for the chat and for the orchestrator is saved apart, and needs the token', async () => {
    expect((await post('/brains/operation', { operation: 'chat', brain: 'quick' })).status).toBe(401)
    expect((await send('/brains/operation', { operation: 'nope', brain: 'quick' })).status).toBe(400)
    expect((await send('/brains/operation', { operation: 'chat', brain: 'missing' })).status).toBe(400)
    await send('/brains/operation', { operation: 'chat', brain: 'quick' })
    const o = await (await send('/brains/operation', { operation: 'orchestrator', brain: 'deep' })).json()
    expect(o.operations.chat.brain).toBe('quick')
    expect(o.operations.orchestrator.brain).toBe('deep')
    expect((await (await send('/brains/operation', { operation: 'chat', brain: null })).json()).operations.chat.brain).toBeNull()
  })

  it('creates, links, previews and deletes a brain', async () => {
    const made = await (await send('/brains', { name: 'Mine', steps: [{ service: 'codex', model: 'codex-pro-1', effort: 'high' }] })).json()
    const mine = made.brains.find((b: any) => b.name === 'Mine')
    expect(mine).toMatchObject({ builtin: false, steps: [{ service: 'codex', model: 'codex-pro-1' }] })

    const linked = await (await send('/brains/link', { role: 'debugger', brain: mine.id })).json()
    expect(linked.agents.debugger).toBe(mine.id)
    expect((await send('/brains/link', { role: 'nope', brain: mine.id })).status).toBe(400)

    const preview = await (await post('/brains/preview', { tier: 'strong', effort: 'high' })).json()
    expect(preview.steps.length).toBeGreaterThan(0)

    const after = await (await send(`/brains/${mine.id}`, {}, 'DELETE')).json()
    expect(after.brains.find((b: any) => b.id === mine.id)).toBeUndefined()
    expect(after.agents.debugger).toBeUndefined()
  })

  it('sets a brain for every unconfigured agent in one go, and needs the token', async () => {
    expect((await post('/brains/auto-assign', {})).status).toBe(401)
    const before = await (await fetch(`${base}/brains`)).json()
    expect(before.unconfigured.length).toBeGreaterThan(0)
    const done = await (await send('/brains/auto-assign', {})).json()
    expect(done.assigned.debugger).toBe('deep')
    expect(done.unconfigured).toEqual([])
    expect(done.agents.debugger).toBe('deep')
  })

  it('shows a service that is out for now without the text its CLI printed', async () => {
    const { setCooldown, clearCooldown } = await import('../server/availability.mjs')
    setCooldown('codex', { kind: 'limit', retryAfterMs: 60_000, message: 'secret@example.com hit the limit' })
    try {
      const o = await (await fetch(`${base}/brains`)).json()
      expect(o.cooldowns.codex).toMatchObject({ kind: 'limit' })
      expect(JSON.stringify(o)).not.toContain('secret@example.com')
      const blocked = o.brains.flatMap((b: any) => b.steps).find((s: any) => s.service === 'codex')
      expect(blocked.blocked).toMatchObject({ kind: 'limit' })
    } finally {
      clearCooldown()
    }
  })

  it('a brain needs a name and, when it is fixed, steps', async () => {
    expect((await send('/brains', { name: '', auto: true })).status).toBe(400)
    expect((await send('/brains', { name: 'X' })).status).toBe(400)
  })

  it('rejects malformed steps without breaking subsequent requests', async () => {
    for (const steps of [{}, 'bad', [null], [{ service: 'missing' }], [{ service: 'codex', model: {} }], [{ service: 'codex', effort: [] }]]) {
      expect((await send('/brains', { name: 'Invalid', auto: true, steps })).status).toBe(400)
    }
    expect((await fetch(`${base}/brains`)).status).toBe(200)
  })
})
