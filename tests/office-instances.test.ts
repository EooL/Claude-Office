import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { expect, it, vi } from 'vitest'
import { loadOffice, postAuthed, postEvent } from './helpers'
import { Server } from 'node:http'

it('characterizes the default facade identities, signal sequence and video filtering', async () => {
  const root = mkdtempSync(join(tmpdir(), 'office-instance-default-'))
  const intervals = vi.spyOn(globalThis, 'setInterval')
  let office: Awaited<ReturnType<typeof loadOffice>> | undefined
  let chat: typeof import('../server/chat-db.js') | undefined
  try {
    office = await loadOffice({ dir: root })
    chat = await import('../server/chat-db.js')
    const again = await import('../server/index.js')
    const { defaultOffice } = await import('../server/default-office.mjs')
    for (const key of ['activeAgents', 'sessions', 'activity', 'pendingStarts', 'pendingNeedsYou'] as const) {
      const marker = {}
      defaultOffice.state[key].set('proxy-identity-check', marker)
      expect(office.server[key].get('proxy-identity-check')).toBe(marker)
      office.server[key].delete('proxy-identity-check')
      expect(defaultOffice.state[key].has('proxy-identity-check')).toBe(false)
    }
    expect({ ...office.server.settings }).toEqual(defaultOffice.state.settings)
    expect(chat.default).toBe(defaultOffice.chat.db)
    for (const key of ['addMessage', 'getMessages', 'markInboxRead', 'markSeen', 'addReaction', 'getThread'] as const) expect(chat[key]).toBe(defaultOffice.chat[key])
    expect(defaultOffice.context.id).toBe('default')
    for (const key of ['activeAgents', 'sessions', 'activity', 'AUTH_TOKEN', 'broadcast', 'processEvent'] as const) expect(again[key]).toBe(office.server[key])
    expect((await import('../server/chat-db.js')).default).toBe(chat.default)
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const before = chat.addMessage({ sender: 'same-agent', text: 'before' })
    now.mockReturnValue(2000)
    expect((await postAuthed(office.server, '/chat/video-mode', { enabled: true })).body).toEqual({ ok: true, videoPaused: true })
    chat.addMessage({ sender: 'same-agent', text: 'during' })
    expect((await request(office.server.app).get('/chat')).body.messages.map((m: any) => m.id)).toEqual([before.id])
    expect((await postAuthed(office.server, '/chat/video-mode', { enabled: false })).body).toEqual({ ok: true, videoPaused: false })
    expect((await request(office.server.app).get('/chat')).body.messages).toHaveLength(2)
    for (const kind of ['test_start', 'test_ok']) expect((await postEvent(office.server, { type: 'signal', sessionId: 'same-session', signals: [{ kind }] })).status).toBe(200)
    expect((await request(office.server.app).get('/signals')).body.signals.map((s: any) => s.seq)).toEqual([1, 2])
    now.mockRestore()
  } finally {
    for (const result of intervals.mock.results) if (result.type === 'return') clearInterval(result.value)
    vi.restoreAllMocks()
    if (office) {
      await new Promise<void>(resolve => office!.server.wss.close(() => resolve()))
      if (office.server.httpServer.listening) await new Promise<void>(resolve => office!.server.httpServer.close(() => resolve()))
    }
    chat?.default.close()
    rmSync(root, { recursive: true, force: true })
  }
})

it('constructs two offices in one process with isolated state, statements and database lifetimes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'office-instances-'))
  const defaultHome = join(root, 'unused-default')
  vi.stubEnv('AGENT_OFFICE_HOME', defaultHome)
  vi.stubEnv('AGENT_OFFICE_ROOT', join(root, 'unused-building'))
  vi.resetModules()
  const { createOffice } = await import('../server/office.mjs')
  expect(readdirSync(root)).toEqual([]) // Importing the explicit factory never opens the facade.
  const timers = vi.spyOn(globalThis, 'setInterval')
  const timeouts = vi.spyOn(globalThis, 'setTimeout')
  const listening = vi.spyOn(Server.prototype, 'listen')
  let a: ReturnType<typeof createOffice> | undefined
  let b: ReturnType<typeof createOffice> | undefined
  try {
    a = createOffice({ home: join(root, 'a'), cwd: join(root, 'project-a') })
    b = createOffice({ home: join(root, 'b'), cwd: join(root, 'project-b') })
    expect(timers).not.toHaveBeenCalled()
    expect(timeouts).not.toHaveBeenCalled()
    expect(listening).not.toHaveBeenCalled()
    for (const key of Object.keys(a.state)) {
      if (typeof a.state[key] === 'object') expect(a.state[key], key).not.toBe(b.state[key])
    }
    for (const office of [a, b]) {
      office.state.activeAgents.set('same-agent', { id: 'same-agent' })
      office.state.sessions.set('same-session', { id: 'same-session' })
      expect(office.chat.db.name).toBe(join(office.context.home, 'chat.db'))
      expect(readFileSync(office.chat.db.name).subarray(0, 16).toString()).toBe('SQLite format 3\0')
      expect(existsSync(join(office.context.home, 'auth-token'))).toBe(false)
      expect(existsSync(office.context.tmp)).toBe(false)
    }
    const weakKey = {}
    a.state.waitCalls.set(weakKey, 'only-a')
    a.state.trustedClients.add(weakKey)
    expect(b.state.waitCalls.has(weakKey)).toBe(false)
    expect(b.state.trustedClients.has(weakKey)).toBe(false)
    a.state.activeAgents.get('same-agent').onlyA = true
    expect(b.state.activeAgents.get('same-agent').onlyA).toBeUndefined()
    const row = { sender: 'same-agent', text: 'same-message' }
    expect(a.chat.addMessage(row).id).toBe(1)
    expect(b.chat.getMessages()).toEqual([])
    expect(b.chat.addMessage(row).id).toBe(1)
    a.chat.addMessage({ ...row, text: 'only-a' })
    expect(b.chat.getMessages().map(message => message.text)).toEqual(['same-message'])
    expect(a.chat.db).not.toBe(b.chat.db)
    a.close(); a.close()
    expect(a.chat.db.open).toBe(false)
    expect(b.chat.db.open).toBe(true)
    b.chat.addMessage({ ...row, text: 'b-after-a-close' })
    expect(b.chat.getMessages()).toHaveLength(2)
    expect(existsSync(defaultHome)).toBe(false)
    expect(existsSync(join(root, 'unused-building'))).toBe(false)
  } finally {
    a?.close(); b?.close()
    vi.restoreAllMocks(); vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  }
})
