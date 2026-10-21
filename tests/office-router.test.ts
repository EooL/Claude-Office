import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { request } from 'node:http'
import { expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { inprocessBuilding } from './helpers/inprocess-building'

it('starts the existing pollers inside default scope even after an explicit test attachment', async () => {
  const fixture = await inprocessBuilding()
  try {
    await new Promise<void>(resolve => fixture.server.httpServer.close(() => resolve()))
    fixture.attach()
    const { currentOffice } = await import('../server/office-scope.mjs')
    const observed: unknown[] = []
    const registryStart = fixture.server.registry.start
    const tasksStart = fixture.server.tasks.start
    vi.spyOn(fixture.server.registry, 'start').mockImplementation(function (...args) {
      observed.push(currentOffice())
      return registryStart.apply(this, args)
    })
    vi.spyOn(fixture.server.tasks, 'start').mockImplementation(function (...args) {
      observed.push(currentOffice())
      return tasksStart.apply(this, args)
    })
    await new Promise<void>((resolve, reject) => {
      fixture.server.httpServer.once('error', reject)
      fixture.server.httpServer.once('listening', resolve)
      fixture.server.start({ port: 0, host: '127.0.0.1' })
    })
    expect(observed).toEqual([fixture.a, fixture.a])
    expect(fixture.server.registry.stats().watching).toBe(true)
  } finally {
    await fixture.close()
    vi.restoreAllMocks()
  }
})

it('keeps the legacy office, then isolates explicitly scoped reads over one real listener', async () => {
  const fixture = await inprocessBuilding()
  try {
    expect((await fixture.request('/chat')).status).toBe(200)
    fixture.attach()
    for (const [office, marker] of [[fixture.a, 'only-a'], [fixture.b, 'only-b']] as const) {
      fixture.runInOffice(office, () => {
        office.chat.addMessage({ sender: 'same-agent', text: 'same-message' })
        office.chat.addMessage({ sender: 'same-agent', text: marker })
        office.state.activeAgents.set('same-agent', { id: 'same-agent', name: marker, state: 'working', sessionId: 'same-session' })
        office.state.sessions.set('same-session', { id: 'same-session', project: marker, agentIds: new Set(['same-agent']), main: { state: 'idle' } })
        office.state.settings.logPrompts = marker === 'only-a' ? 'off' : 'full'
        office.state.signalRing.push({ seq: 1, at: 1, kind: marker, sessionId: 'same-session', command: 'private' })
      })
    }
    expect(await fixture.request('/chat')).toMatchObject({ status: 400, body: { error: 'OFFICE_ID required' } })
    for (const [id, marker, opposite] of [['default', 'only-a', 'only-b'], ['off_abc123', 'only-b', 'only-a']]) {
      for (const route of ['/chat', '/agents', '/sessions', '/signals']) {
        const response = await fixture.request(`/o/${id}${route}`)
        expect(response.status, `${id}${route}`).toBe(200)
        expect(response.text).toContain(marker)
        expect(response.text).not.toContain(opposite)
        expect(response.text).not.toContain('private')
      }
      expect((await fixture.request(`/o/${id}/settings`)).body.logPrompts).toBe(id === 'default' ? 'off' : 'full')
    }
    const head = await fixture.request('/o/off_abc123/chat', 'HEAD')
    expect(head.status).toBe(200)
    expect(head.text).toBe('')
    await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const id = index % 2 ? 'default' : 'off_abc123'
      const response = await fixture.request(`/o/${id}/chat`)
      expect(response.status).toBe(200)
      expect(response.text).toContain(id === 'default' ? 'only-a' : 'only-b')
      expect(response.text).not.toContain(id === 'default' ? 'only-b' : 'only-a')
    }))
  } finally { await fixture.close() }
})

it('fails closed for unscoped routes, mutations and credentials without writing office state', async () => {
  const fixture = await inprocessBuilding()
  try {
    fixture.attach()
    const before = readdirSync(fixture.b.context.home).sort()
    for (const [method, path] of [
      ['POST', '/chat'], ['POST', '/chat/reply'], ['POST', '/event'], ['POST', '/settings'],
      ['GET', '/health'], ['GET', '/status'], ['GET', '/permissions'], ['GET', '/registry'],
      ['GET', '/tasks'], ['GET', '/backends'], ['GET', '/brains'], ['GET', '/artifacts'],
      ['GET', '/chat/cron-state'], ['GET', '/agents/same-agent'], ['GET', '/anything'],
      ['GET', '/profiles'], ['GET', '/profiles/debugger'], ['PUT', '/profiles/debugger'], ['DELETE', '/profiles/debugger'], ['POST', '/profiles/debugger/enrich'],
      ['GET', '/master-prompt'], ['POST', '/master-prompt/validate'], ['PUT', '/master-prompt'], ['DELETE', '/master-prompt'],
    ]) expect(await fixture.request(`/o/off_abc123${path}`, method)).toMatchObject({ status: 501, body: { error: 'not scoped yet' } })
    // Cookies and signed requests stay refused; a bearer token is checked against the office in scope (next test).
    for (const headers of [{ Cookie: `office_token=${fixture.server.AUTH_TOKEN}` }, { 'X-Office-Timestamp': String(Date.now()), 'X-Office-Signature': 'ab' }]) {
      expect(await fixture.request('/o/off_abc123/chat', 'GET', headers)).toMatchObject({ status: 501, body: { error: 'not scoped yet' } })
    }
    expect(readdirSync(fixture.b.context.home).sort()).toEqual(before)
    expect(fixture.b.chat.getMessages()).toEqual([])
    expect(fixture.b.state.activeAgents.size).toBe(0)
    expect(fixture.b.state.settings.logPrompts).toBe('summary')
  } finally { await fixture.close() }
})

it('each office has its own secrets: a token opens only its own office, the other office only shows the read-only view', async () => {
  const fixture = await inprocessBuilding()
  try {
    fixture.attach()
    const [a, b] = [fixture.a.auth, fixture.b.auth]
    // distinct secrets, and each office checks only its own
    expect(new Set([a.token, b.token, a.uiToken, b.uiToken]).size).toBe(4)
    expect(a.tokenMatches(a.token)).toBe(true)
    expect(a.tokenMatches(b.token)).toBe(false)
    expect(b.tokenMatches(a.token)).toBe(false)
    expect(b.uiTokenMatches(a.uiToken)).toBe(false)
    expect(a.proof('n', 'i', 'allow')).not.toBe(b.proof('n', 'i', 'allow'))
    expect(a.officeProof('c')).not.toBe(b.officeProof('c'))
    expect(b.tokenFile).toBe(join(fixture.b.context.home, 'auth-token'))
    // the default office is the one server.AUTH_TOKEN names, and nothing was written to either token file yet
    expect(fixture.server.AUTH_TOKEN).toBe(a.token)
    expect(existsSync(b.tokenFile)).toBe(false)
    // the same private signal under both offices (same id, same seq): only the holder of that office's token sees its command
    for (const office of [fixture.a, fixture.b]) {
      fixture.runInOffice(office, () => { office.state.signalRing.push({ seq: 1, at: 1, kind: 'same', sessionId: 'same-session', command: 'private-command' }) })
    }
    const seesCommand = async (id: string, token: string) => (await fixture.request(`/o/${id}/signals`, 'GET', { Authorization: `Bearer ${token}` })).text.includes('private-command')
    expect(await seesCommand('default', a.token)).toBe(true)
    expect(await seesCommand('default', b.token)).toBe(false)
    expect(await seesCommand('off_abc123', b.token)).toBe(true)
    expect(await seesCommand('off_abc123', a.token)).toBe(false)
    expect(await seesCommand('off_abc123', '')).toBe(false)
    // a token-guarded write is still not reachable for the second office, with its own token as well
    expect(await fixture.request('/o/off_abc123/event', 'POST', { Authorization: `Bearer ${b.token}` }, { type: 'x' })).toMatchObject({ status: 501 })
  } finally { await fixture.close() }
})

it('returns the same unknown-office response for malformed ids and valid non-live ids', async () => {
  const fixture = await inprocessBuilding()
  try {
    const { addOffice } = await import('../server/registry.mjs')
    addOffice({ id: 'off_abc123', home: fixture.b.context.home, cwd: fixture.b.context.cwd })
    const before = readdirSync(fixture.root).sort()
    for (const id of ['..', '%2e%2e', '%2F', 'off_abc%2F123', 'OFF_ABC123', 'off_abcdefghijklm', 'off_zzz999', 'off_ab', '%ZZ', 'off_abc123']) {
      expect(await fixture.request(`/o/${id}/chat`), id).toMatchObject({ status: 404, body: { error: 'Unknown office' } })
    }
    expect(await fixture.request('/o/off_abc123/chat', 'POST', {}, '{broken json')).toMatchObject({ status: 404, body: { error: 'Unknown office' } })
    expect(await fixture.request('/o/off_abc123/chat', 'GET', { Origin: 'https://evil.example' })).toMatchObject({ status: 403, body: { error: 'Forbidden origin' } })
    expect(await fixture.request('/o/off_abc123/chat', 'GET', { Host: 'evil.example' })).toMatchObject({ status: 421, body: { error: 'Forbidden host' } })
    expect(readdirSync(fixture.root).sort()).toEqual(before)
  } finally { await fixture.close() }
})

it('keeps explicit default writes local and throws before unscoped or unsupported helper work', async () => {
  const fixture = await inprocessBuilding()
  try {
    expect((await fixture.request('/chat', 'POST', {}, { sender: 'same-agent', text: 'legacy-only-a' })).status).toBe(200)
    fixture.attach()
    expect(() => fixture.server.activeAgents.size).toThrow('Office scope required')
    expect(() => fixture.server.broadcast({ type: 'test' })).toThrow('Office scope required')
    fixture.runInOffice(fixture.b, () => {
      expect(() => fixture.server.processEvent({ type: 'agent_spawned', agent: { id: 'same-agent' } })).toThrow('not scoped yet')
      expect(() => fixture.server.sendAgentMessage({ sender: 'same-agent', text: 'forbidden' })).toThrow('not scoped yet')
      expect(() => fixture.server.sweepStale()).toThrow('not scoped yet')
      expect(() => fixture.server.broadcast({ type: 'test' })).not.toThrow() // office-scoped since 3b
    })
    for (const path of ['/event', '/status', '/usage']) expect(await fixture.request(path, 'POST')).toMatchObject({ status: 501, body: { error: 'not scoped yet' } })
    expect((await fixture.request('/o/default/chat', 'POST', {}, { sender: 'same-agent', text: 'explicit-only-a' })).status).toBe(200)
    expect((await fixture.request('/o/default/event', 'POST', { Authorization: `Bearer ${fixture.server.AUTH_TOKEN}` }, { type: 'agent_spawned', agent: { id: 'same-agent', name: 'only-a', role: 'frontend', task: 'fixture' } })).status).toBe(200)
    expect(fixture.a.chat.getMessages().map(message => message.text)).toContain('explicit-only-a')
    expect((await fixture.request('/o/default/agents')).text).toContain('only-a')
    expect(fixture.b.chat.getMessages()).toEqual([])
    expect(fixture.b.state.activeAgents.size).toBe(0)
  } finally { await fixture.close() }
})

it('keeps default WebSockets working and refuses unknown or malformed office upgrades before sending snapshots', async () => {
  const fixture = await inprocessBuilding()
  const sockets: WebSocket[] = []
  try {
    fixture.attach()
    for (const [office, name] of [[fixture.a, 'only-a-socket'], [fixture.b, 'only-b-socket']] as const) {
      office.state.activeAgents.set('same-agent', { id: 'same-agent', name, state: 'working', role: 'frontend' })
      office.state.sessions.set('same-session', { id: 'same-session', project: name, agentIds: new Set(['same-agent']), main: { state: 'idle' } })
    }
    for (const path of ['/ws', '/o/default/ws']) {
      const ws = new WebSocket(`ws://127.0.0.1:${fixture.port}${path}`)
      sockets.push(ws)
      const messages: any[] = []
      ws.on('message', data => messages.push(JSON.parse(data.toString())))
      const first = await new Promise<any>((resolve, reject) => {
        ws.once('message', data => resolve(JSON.parse(data.toString())))
        ws.once('error', reject)
      })
      expect(first).toEqual({ type: 'auth', trusted: false })
      await expect.poll(() => messages.find(message => message.type === 'snapshot')).toBeDefined()
      const snapshot = JSON.stringify(messages.find(message => message.type === 'snapshot'))
      expect(snapshot).toContain('only-a-socket')
      expect(snapshot).not.toContain('only-b-socket')
      await new Promise<void>((resolve, reject) => {
        ws.once('pong', () => resolve())
        ws.once('error', reject)
        ws.ping()
      })
    }
    for (const [path, status] of [['/o/off_zzz999/ws', 404], ['/o/OFF_ABC123/ws', 404]] as const) {
      const response = await new Promise<{ status: number, text: string }>((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: fixture.port, path, headers: {
          Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        } }, res => {
          let text = ''
          res.setEncoding('utf8')
          res.on('data', chunk => { text += chunk })
          res.on('end', () => resolve({ status: res.statusCode!, text }))
        })
        req.on('upgrade', (_res, socket) => { socket.destroy(); reject(new Error(`Unexpected upgrade: ${path}`)) })
        req.on('error', reject)
        req.end()
      })
      expect(response.status, path).toBe(status)
      expect(response.text).not.toContain('snapshot')
      expect(response.text).not.toContain(fixture.server.AUTH_TOKEN)
    }
    // Refusing another office's upgrade does not damage default connections.
    await new Promise<void>((resolve, reject) => {
      sockets[0].once('pong', () => resolve())
      sockets[0].once('error', reject)
      sockets[0].ping()
    })
  } finally {
    for (const ws of sockets) ws.terminate()
    await fixture.close()
  }
})
