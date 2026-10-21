import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { listen, loadOffice, officeProtocols, type Office } from './helpers'

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/server-routes.json'), 'utf8'))
const root = mkdtempSync(join(tmpdir(), 'office-characterization-'))
const instances: Array<{ office: Office; db: any; context: { home: string; cwd: string; tmp: string }; timers: ReturnType<typeof setInterval>[] }> = []
const sockets: WebSocket[] = []
let office: Office

async function importOffice(home: string, ui: string) {
  const intervals = vi.spyOn(globalThis, 'setInterval')
  try {
    const instance = await loadOffice({ dir: home, seedCatalogue: false, env: { AGENT_OFFICE_UI_DIR: ui } })
    const { default: db } = await import('../server/chat-db.js')
    const { defaultOfficeContext: context } = await import('../server/office-context.mjs')
    const calls = intervals.mock.calls.map(([, delay]) => delay)
    const timers = intervals.mock.results.filter(r => r.type === 'return').map(r => r.value)
    instances.push({ office: instance, db, context, timers })
    return { office: instance, db, calls }
  } finally { intervals.mockRestore() }
}

function routes(app: any): string[] {
  const result: string[] = []
  const legacy = app._router.stack.filter((layer: any) => layer.handle?.stack && layer.regexp.fast_slash)
  expect(legacy, 'one shared router at the legacy root').toHaveLength(1)
  const shared = app._router.stack.filter((layer: any) => layer.handle === legacy[0].handle)
  expect(shared, 'the same router mounted once at root and once at the office prefix').toHaveLength(2)
  for (const layer of legacy[0].handle.stack) {
    expect(layer.handle?.stack, 'new nested router: teach this collector its mount prefix').toBeUndefined()
    if (!layer.route) continue
    for (const path of [layer.route.path].flat()) {
      for (const method of Object.keys(layer.route.methods)) result.push(`${method.toUpperCase()} ${path}`)
    }
  }
  return result
}

async function connect(url: string, protocols: string[] = []) {
  const ws = new WebSocket(url, protocols)
  sockets.push(ws)
  const messages: any[] = []
  ws.on('message', raw => messages.push(JSON.parse(String(raw))))
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  return {
    ws, messages,
    at: (index: number) => vi.waitFor(() => {
      expect(messages[index], `missing WebSocket message ${index}`).toBeDefined()
      return messages[index]
    }, { timeout: 3000, interval: 10 }),
  }
}

beforeAll(async () => {
  const ui = join(root, 'built-ui')
  mkdirSync(ui)
  writeFileSync(join(ui, 'index.html'), '<!doctype html><title>fixture</title>')
  const home = join(root, 'created-on-import')
  expect(existsSync(home)).toBe(false)
  const imported = await importOffice(home, ui)
  office = imported.office
  expect(imported.calls).toEqual([60_000, 300_000])
})

afterAll(async () => {
  for (const ws of sockets) ws.terminate()
  for (const { office: instance, db, timers } of instances) {
    for (const timer of timers) clearInterval(timer)
    await new Promise<void>(resolve => instance.server.wss.close(() => resolve()))
    if (instance.server.httpServer.listening) await new Promise<void>(resolve => instance.server.httpServer.close(() => resolve()))
    db.close()
  }
  rmSync(root, { recursive: true, force: true })
})

describe('Building phase 0: current single-office behavior', () => {
  it('pins every explicit route registered by index and its mount modules, in registration order', () => {
    expect(office.server.UI_AVAILABLE).toBe(true)
    expect(routes(office.server.app)).toEqual(fixture.routes)
  })

  it('adds only the root fallback route when the UI build is absent', async () => {
    const missing = await importOffice(join(root, 'no-ui-home'), join(root, 'absent-ui'))
    expect(missing.office.server.UI_AVAILABLE).toBe(false)
    expect(routes(missing.office.server.app)).toEqual([...fixture.routes, ...fixture.withoutUi])
  })

  it('creates private runtime/database/marker and unref timers on import, but neither listens nor writes a token', () => {
    const { server, dir } = office
    expect(existsSync(dir)).toBe(true)
    expect(readFileSync(join(dir, 'chat.db')).subarray(0, 16).toString()).toBe('SQLite format 3\u0000')
    expect(instances[0].db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(server.RUNTIME_DIR).toBe(instances[0].context.home)
    expect(instances[0].db.name).toBe(join(instances[0].context.home, 'chat.db'))
    expect(instances[0].context.cwd).toBe(process.cwd())
    expect(existsSync(instances[0].context.tmp)).toBe(false)
    expect(existsSync(server.ANSWER_MARKER_FILE)).toBe(true)
    expect(existsSync(server.TOKEN_FILE)).toBe(false)
    expect(server.httpServer.listening).toBe(false)
    expect(server.httpServer.address()).toBeNull()
    expect(server.wss.clients.size).toBe(0)
    expect(instances[0].timers.every(timer => !timer.hasRef())).toBe(true)
    if (process.platform !== 'win32') expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(server.activeAgents).toBeInstanceOf(Map)
    expect(server.sessions).toBeInstanceOf(Map)
    expect(server.activity).toBeInstanceOf(Map)
    for (const name of ['broadcast', 'processEvent', 'start'] as const) expect(server[name]).toBeTypeOf('function')
    expect(server.AUTH_TOKEN).toMatch(/^[a-f0-9]{64}$/)
  })

  it('sends auth first, redacts the unauthenticated snapshot, trusts the token subprotocol and broadcasts to every client', async () => {
    const { server } = office
    const session = { sessionId: 'phase0-shared-session', project: 'phase0', cwd: root }
    const secret = 'PHASE0_PRIVATE_PROMPT'
    server.processEvent({ type: 'session_started', ...session, source: 'startup' })
    server.processEvent({ type: 'session_prompt', ...session, text: secret, promptId: 'p0' })
    const url = `ws://127.0.0.1:${await listen(server.httpServer)}/ws`
    const readOnly = await connect(url)
    const trusted = await connect(url, officeProtocols(server))
    const another = await connect(url, officeProtocols(server))
    expect(await readOnly.at(0)).toEqual({ type: 'auth', trusted: false })
    expect(await trusted.at(0)).toEqual({ type: 'auth', trusted: true })
    expect(await another.at(0)).toEqual({ type: 'auth', trusted: true })
    expect(trusted.ws.protocol).toBe(server.WS_PROTOCOL)
    const redacted = await readOnly.at(1)
    expect(redacted.type).toBe('snapshot')
    expect(redacted).not.toHaveProperty('uiToken')
    expect(JSON.stringify(redacted)).not.toContain(secret)
    const full = await trusted.at(1)
    expect(full.type).toBe('snapshot')
    expect(full.uiToken).toBe(server.UI_TOKEN)
    expect(JSON.stringify(full)).toContain(secret)
    const marker = { type: 'phase0_broadcast', marker: 'ALL_CURRENT_CONNECTIONS' }
    server.broadcast(marker)
    for (const client of [readOnly, trusted, another]) {
      await vi.waitFor(() => expect(client.messages).toContainEqual(marker))
    }
    server.broadcast({ type: 'session_prompt', sessionId: session.sessionId, text: secret, messageId: 123 })
    for (const client of [readOnly, trusted, another]) {
      await vi.waitFor(() => expect(client.messages.some(m => m.type === 'session_prompt')).toBe(true))
      const message = client.messages.find(m => m.type === 'session_prompt')
      if (client === readOnly) {
        expect(message).not.toHaveProperty('text')
        expect(message).not.toHaveProperty('messageId')
      } else expect(message.text).toBe(secret)
    }
  })
})
