import { request } from 'node:http'
import { expect, it } from 'vitest'
import WebSocket from 'ws'
import { inprocessBuilding } from './helpers/inprocess-building'

type Client = { ws: WebSocket, messages: any[] }

async function connect(port: number, path: string, token?: string): Promise<Client> {
  const protocols = token ? ['agent-office', `agent-office.token.${token}`] : ['agent-office']
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, protocols)
  const messages: any[] = []
  ws.on('message', data => messages.push(JSON.parse(data.toString())))
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject) })
  await expect.poll(() => messages.some(m => m.type === 'snapshot')).toBe(true)
  return { ws, messages }
}
const snapshotOf = (c: Client) => c.messages.find(m => m.type === 'snapshot')

function rawUpgrade(port: number, path: string) {
  return new Promise<number>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    } }, res => { res.resume(); resolve(res.statusCode!) })
    req.on('upgrade', (_res, socket) => { socket.destroy(); reject(new Error(`Unexpected upgrade: ${path}`)) })
    req.on('error', reject)
    req.end()
  })
}

it('scopes WebSocket membership, snapshots, tokens and redaction per office', async () => {
  const fixture = await inprocessBuilding()
  const clients: Client[] = []
  const open = async (...args: Parameters<typeof connect>) => { const c = await connect(...args); clients.push(c); return c }
  try {
    fixture.attach()
    const { a, b } = fixture
    for (const [office, marker] of [[a, 'only-a'], [b, 'only-b']] as const) {
      fixture.runInOffice(office, () => {
        office.state.activeAgents.set('same-agent', { id: 'same-agent', name: marker, state: 'working', role: 'frontend' })
        office.state.sessions.set('same-session', { id: 'same-session', project: marker, agentIds: new Set(['same-agent']), main: { state: 'idle' } })
        office.state.signalRing.push({ seq: 1, at: 1, kind: marker, sessionId: 'same-session' })
      })
    }
    const bPath = '/o/off_abc123/ws'
    const aRO = await open(fixture.port, '/o/default/ws')
    const bRO = await open(fixture.port, bPath)
    const bTrusted = await open(fixture.port, bPath, b.auth.token)
    const bWrongToken = await open(fixture.port, bPath, a.auth.token)
    const aTrusted = await open(fixture.port, '/ws', a.auth.token)

    // (b) snapshots hold only their own office; unscoped fields are empty for B
    expect(JSON.stringify(snapshotOf(aRO))).toContain('only-a')
    expect(JSON.stringify(snapshotOf(aRO))).not.toContain('only-b')
    for (const c of [bRO, bTrusted, bWrongToken]) {
      const snap = snapshotOf(c)
      const text = JSON.stringify(snap)
      expect(text).toContain('only-b')
      expect(text).not.toContain('only-a')
      expect(snap).toMatchObject({ statuses: null, health: null, mcpServers: [], pendingPermissions: [], taskBoards: [] })
    }
    expect(snapshotOf(aRO).statuses).not.toBeNull()

    // (c) tokens: B's own token is trusted and gets B's uiToken; A's token or none is read-only
    expect(bTrusted.messages[0]).toEqual({ type: 'auth', trusted: true })
    expect(snapshotOf(bTrusted).uiToken).toBe(b.auth.uiToken)
    for (const c of [bRO, bWrongToken]) {
      expect(c.messages[0]).toEqual({ type: 'auth', trusted: false })
      expect(snapshotOf(c)).not.toHaveProperty('uiToken')
      expect(JSON.stringify(snapshotOf(c))).not.toContain(b.auth.uiToken)
    }
    expect(aTrusted.messages[0]).toEqual({ type: 'auth', trusted: true })
    expect(snapshotOf(aTrusted).uiToken).toBe(a.auth.uiToken)

    // (a)+(d) a broadcast reaches only sockets of the office in scope, redacted for read-only ones
    const count = () => clients.map(c => c.messages.length)
    const before = count()
    fixture.runInOffice(b, () => fixture.server.broadcast({ type: 'session_prompt', sessionId: 'same-session', text: 'secret-b-prompt', messageId: 7 }))
    await expect.poll(() => bWrongToken.messages.length).toBe(before[3] + 1)
    await expect.poll(() => bTrusted.messages.length).toBe(before[2] + 1)
    await expect.poll(() => bRO.messages.length).toBe(before[1] + 1)
    expect(bTrusted.messages.at(-1).text).toBe('secret-b-prompt')
    for (const c of [bRO, bWrongToken]) {
      expect(c.messages.at(-1)).toMatchObject({ type: 'session_prompt', sessionId: 'same-session' })
      expect(JSON.stringify(c.messages.at(-1))).not.toContain('secret-b-prompt')
    }
    await new Promise(r => setTimeout(r, 100))
    expect(aRO.messages.length).toBe(before[0])
    expect(aTrusted.messages.length).toBe(before[4])

    fixture.runInOffice(a, () => fixture.server.broadcast({ type: 'session_prompt', sessionId: 'same-session', text: 'secret-a-prompt', messageId: 8 }))
    await expect.poll(() => aTrusted.messages.length).toBe(before[4] + 1)
    await expect.poll(() => aRO.messages.length).toBe(before[0] + 1)
    expect(aTrusted.messages.at(-1).text).toBe('secret-a-prompt')
    expect(JSON.stringify(aRO.messages.at(-1))).not.toContain('secret-a-prompt')
    await new Promise(r => setTimeout(r, 100))
    expect(bTrusted.messages.length).toBe(before[2] + 1)
    expect(bRO.messages.length).toBe(before[1] + 1)

    // broadcasting with no office in scope while two are live still fails loudly
    expect(() => fixture.server.broadcast({ type: 'x' })).toThrow('Office scope required')

    // (e) unknown and malformed ids still 404 before any upgrade
    for (const path of ['/o/off_zzz999/ws', '/o/OFF_ABC123/ws', '/o/%2e%2e/ws']) expect(await rawUpgrade(fixture.port, path), path).toBe(404)

    // (f) detaching B closes nothing of A
    const { detachOffice } = await import('../server/building-runtime.mjs')
    for (const c of [bRO, bTrusted, bWrongToken]) c.ws.terminate()
    detachOffice('off_abc123')
    await new Promise<void>((resolve, reject) => { aTrusted.ws.once('pong', () => resolve()); aTrusted.ws.once('error', reject); aTrusted.ws.ping() })
    expect(aTrusted.ws.readyState).toBe(WebSocket.OPEN)
    expect(aRO.ws.readyState).toBe(WebSocket.OPEN)
    expect(await rawUpgrade(fixture.port, bPath)).toBe(404)
  } finally {
    for (const c of clients) c.ws.terminate()
    await fixture.close()
  }
})
