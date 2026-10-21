import WebSocket from 'ws'
import { expect, it } from 'vitest'
import { startTwoOffices, type ProcessOffice } from './helpers/two-offices'

type Message = Record<string, any>
async function connect(office: ProcessOffice) {
  const socket = new WebSocket(office.url.replace('http:', 'ws:') + '/ws', ['agent-office', `agent-office.token.${office.token}`])
  const messages: Message[] = []
  socket.on('message', data => messages.push(JSON.parse(data.toString())))
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  return { socket, messages }
}

async function post(office: ProcessOffice, path: string, body: object, token = office.token) {
  return fetch(office.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) })
}

it('two real processes isolate identical session/agent ids, chat, events and tokens', async () => {
  const pair = await startTwoOffices()
  const clients: Awaited<ReturnType<typeof connect>>[] = []
  try {
    const { a, b } = pair
    expect(a.token).not.toBe(b.token)
    const sessionId = 'aaaaaaaa-1111-4111-8111-111111111111'
    const agentId = 'shared-agent-id'
    for (const office of [a, b]) {
      expect((await post(office, '/event', { type: 'session_started', sessionId, project: 'same-project', cwd: office.cwd })).status).toBe(200)
      expect((await post(office, '/event', { type: 'agent_spawned', sessionId, agent: { id: agentId, name: 'same-agent', role: 'frontend', task: 'same-task' } })).status).toBe(200)
      expect((await post(office, '/chat', { sender: 'same-sender', text: 'same-message' })).status).toBe(200)
    }
    const ca = await connect(a); clients.push(ca)
    const cb = await connect(b); clients.push(cb)
    expect((await post(b, '/event', { type: 'agent_completed', agentId }, a.token)).status).toBe(401)
    const marker = 'only-office-a-chat-marker'
    expect((await post(a, '/chat', { sender: 'same-sender', text: marker })).status).toBe(200)
    expect((await post(a, '/event', { type: 'agent_completed', agentId })).status).toBe(200)
    await expect.poll(() => ca.messages.some(message => message.type === 'agent_completed' && message.agentId === agentId), { timeout: 3000 }).toBe(true)
    await expect.poll(() => ca.messages.some(message => message.type === 'chat_message' && message.text === marker), { timeout: 3000 }).toBe(true)
    // A bounded negative observation, with B still responsive on its own socket.
    await new Promise(resolve => setTimeout(resolve, 150))
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('B socket heartbeat timed out')), 3000)
      cb.socket.once('pong', () => { clearTimeout(timer); resolve() }); cb.socket.ping()
    })
    expect(cb.messages.some(message => message.type === 'agent_completed' && message.agentId === agentId)).toBe(false)
    expect(JSON.stringify(cb.messages)).not.toContain(marker)
    for (const [office, completed] of [[a, true], [b, false]] as const) {
      const headers = { Authorization: `Bearer ${office.token}` }
      const chat = await (await fetch(office.url + '/chat', { headers, signal: AbortSignal.timeout(3000) })).json()
      expect(JSON.stringify(chat).includes(marker)).toBe(completed)
      const agents = await (await fetch(office.url + '/agents', { headers, signal: AbortSignal.timeout(3000) })).json()
      // The current list excludes completed agents; only A clocks this shared id out.
      expect(agents.agents.some((agent: Message) => agent.id === agentId)).toBe(!completed)
    }
  } finally {
    clients.forEach(({ socket }) => socket.terminate())
    await pair.stop()
    await pair.stop() // Fixture cleanup is explicitly idempotent.
  }
}, 45_000)
