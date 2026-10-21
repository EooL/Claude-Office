import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const homes: string[] = []
const databases: any[] = []
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close()
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('chat database compatibility', () => {
  it('creates independent prepared statements and keeps the other database usable after close', async () => {
    const { openChatDb } = await import('../server/chat-store.mjs')
    const root = mkdtempSync(join(tmpdir(), 'office-chat-factory-'))
    homes.push(root)
    const a = openChatDb(join(root, 'a'))
    const b = openChatDb(join(root, 'b'))
    databases.push(a.db, b.db)
    expect(a.db).not.toBe(b.db)
    expect(a.addMessage).not.toBe(b.addMessage)
    a.addMessage({ sender: 'same-agent', text: 'same text' })
    expect(b.getMessages()).toEqual([])
    b.addMessage({ sender: 'same-agent', text: 'same text' })
    expect(a.getMessages()).toHaveLength(1)
    expect(b.getMessages()).toHaveLength(1)
    a.close()
    a.close()
    b.markSeen(1)
    expect(b.getMessages()[0].seen).toBe(1)
    expect(b.addReaction(1, 'x')).toEqual(['x'])
    b.close()
  })

  it('migrates the same old schema in place and preserves existing rows', async () => {
    const root = mkdtempSync(join(tmpdir(), 'office-chat-migration-'))
    homes.push(root)
    const old = new Database(join(root, 'chat.db'))
    old.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'default', text TEXT NOT NULL, timestamp INTEGER NOT NULL, is_system INTEGER NOT NULL DEFAULT 0, reactions TEXT NOT NULL DEFAULT '[]', thread_id INTEGER, seen INTEGER NOT NULL DEFAULT 0)")
    old.prepare('INSERT INTO messages (sender,text,timestamp) VALUES (?,?,?)').run('legacy', 'preserved', 1)
    old.close()
    const { openChatDb } = await import('../server/chat-store.mjs')
    const chat = openChatDb(root)
    databases.push(chat.db)
    expect(chat.getMessages()[0]).toMatchObject({ sender: 'legacy', text: 'preserved', recipient: null, msg_type: null, read_at: null })
    chat.markInboxRead(['legacy'])
    chat.close()
  })

  it('pins the existing facade, schema, transcript filtering and mutation APIs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'office-chat-facade-'))
    homes.push(home)
    vi.stubEnv('AGENT_OFFICE_HOME', home)
    vi.stubEnv('AGENT_OFFICE_ROOT', join(home, 'root'))
    vi.stubEnv('OFFICE_ID', 'default')
    vi.resetModules()
    const chat = await import('../server/chat-db.js')
    databases.push(chat.default)
    for (const name of ['addMessage', 'getMessages', 'markInboxRead', 'markSeen', 'addReaction', 'getThread']) {
      expect(typeof (chat as any)[name]).toBe('function')
    }
    expect(chat.MAX_REACTIONS).toBe(20)
    expect(chat.default.name).toBe(join(home, 'chat.db'))
    expect(chat.default.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(chat.default.prepare('PRAGMA table_info(messages)').all().map((c: any) => c.name)).toEqual([
      'id', 'sender', 'role', 'text', 'timestamp', 'is_system', 'reactions', 'thread_id', 'seen',
      'recipient', 'msg_type', 'read_at',
    ])
    const message = chat.addMessage({ sender: 'same-agent', text: 'same text', recipient: 'Worker' })
    const reply = chat.addMessage({ sender: 'same-agent', text: 'reply', threadId: message.id })
    chat.addMessage({ sender: 'same-agent', text: 'private transcript', msgType: 'prompt' })
    expect(chat.getMessages().map((m: any) => m.id)).toEqual([message.id, reply.id])
    expect(chat.getMessages({ transcript: true })).toHaveLength(3)
    expect(chat.getMessages({ recipient: 'worker' })).toHaveLength(1)
    chat.markInboxRead(['worker'])
    chat.markSeen(message.id)
    expect(chat.getMessages({ recipient: 'WORKER' })[0]).toMatchObject({ seen: 1, read_at: expect.any(Number) })
    expect(chat.addReaction(message.id, 'x')).toEqual(['x'])
    expect(chat.addReaction(message.id, 'x')).toEqual([])
    expect(chat.getThread(message.id).map((m: any) => m.id)).toEqual([reply.id])
  })
})
