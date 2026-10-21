import React from 'react'
import { renderToString } from 'react-dom/server'
import { WebSocket } from 'ws'
import { afterEach, expect, it, vi } from 'vitest'
import { createChatStatus, isLiveStatus, statusLabel, visibleStatus } from '../server/chat-status.mjs'
import { ChatStatusRow } from '../src/components/SlackChat'
import ChatContent from '../src/components/ChatContent'
import { handleMessage, startPlan, handleGoal } from '../server/delegation.mjs'
import { inprocessBuilding } from './helpers/inprocess-building'
import { writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const states = ['received', 'routing', 'thinking', 'planning', 'awaiting_approval', 'working', 'done', 'failed'] as const
afterEach(() => { vi.useRealTimers() })

it.each(states)('renders %s with the correct live/terminal treatment', state => {
  const status = createChatStatus({ state, agent: { name: 'Reviewer', role: 'code-reviewer' }, detail: state === 'failed' ? 'quota exhausted' : undefined }, 1000, 'request-1')!
  const html = renderToString(React.createElement(ChatStatusRow, { status, now: 4000 }))
  expect(html).toContain(statusLabel(status))
  expect(html.includes('slack-typing-dots')).toBe(isLiveStatus(status))
  expect(html.replace(/<!--[\s\S]*?-->/g, '').includes('3s')).toBe(isLiveStatus(status))
  if (state === 'failed') expect(html).toContain('Reviewer could not finish: quota exhausted')
})

it('expires only done at six seconds, preserves approval/failure, and rejects unknown states', () => {
  const make = (state: string) => createChatStatus({ state }, 1000, 'id')
  expect(visibleStatus(make('done'), 6999)).not.toBeNull()
  expect(visibleStatus(make('done'), 7000)).toBeNull()
  expect(visibleStatus(make('awaiting_approval'), 999999)).not.toBeNull()
  expect(visibleStatus(make('failed'), 999999)).not.toBeNull()
  expect(make('invented')).toBeNull()
})

it('hides multiline and unfinished HTML comments only at render time', () => {
  const original = 'Verified. <!-- GOAL_COMPLETE -->\n<!-- hidden\ncomment -->Visible.<!-- unfinished'
  const html = renderToString(React.createElement(ChatContent, { text: original, messageId: 1 }))
  expect(html).toContain('Verified.'); expect(html).toContain('Visible.')
  expect(html).not.toMatch(/GOAL_COMPLETE|hidden|unfinished|&lt;!--/)
  expect(original).toContain('<!-- GOAL_COMPLETE -->')
})

function delegation() {
  let state: any = {}
  const updates: any[] = []
  const deps = {
    cwd: undefined, now: () => 1000, read: () => state, write: (patch: any) => { state = { ...state, ...patch } },
    status: async (update: any) => { updates.push(update) },
    agent: () => ({ service: 'fixture' }), hire: async () => {}, working: async () => {}, finish: async () => {}, say: async () => {},
    run: vi.fn(async (_role: string, _prompt: string, opts: any) => ({ text: opts.operation ? '{"kind":"task","confidence":1}' : opts.mode === 'plan' ? '- Inspect\nGOAL: repair' : 'Verified.' })),
  }
  return { deps, updates, state: () => state }
}

it('reports routing, planning, approval, working and done for an approved task', async () => {
  const f = delegation()
  await handleMessage(f.deps, 'Fix the failing tests', (job: any) => startPlan(f.deps, job))
  expect(f.updates.map(u => u.state)).toEqual(['routing', 'planning', 'awaiting_approval'])
  await handleGoal(f.deps, '/goal')
  expect(f.updates.map(u => u.state)).toEqual(['routing', 'planning', 'awaiting_approval', 'working', 'done'])
  expect(f.state().plan).toBeUndefined()
})

it('reports plain chat thinking, classifier failure and worker failure with a reason', async () => {
  const plain = delegation()
  expect(await handleMessage(plain.deps, 'hello', async () => {})).toBe('chat')
  expect(plain.updates.at(-1).state).toBe('thinking')
  const failed = delegation()
  failed.deps.run.mockRejectedValue(new Error('fixture failure'))
  await handleMessage(failed.deps, 'Fix the tests', async () => {})
  expect(failed.updates.at(-1)).toMatchObject({ state: 'failed', detail: 'task routing is unavailable' })
  await startPlan(failed.deps, { name: 'Reviewer', role: 'code-reviewer', task: 'fixture' })
  expect(failed.updates.at(-1)).toMatchObject({ state: 'failed', detail: expect.any(String) })
})

it('progress transport failure cannot prevent work', async () => {
  const f = delegation()
  f.deps.status = async () => { throw new Error('offline') }
  await startPlan(f.deps, { name: 'Reviewer', role: 'code-reviewer', task: 'fixture' })
  expect(f.state().plan).toBeDefined()
})

async function connect(port: number, path: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  const messages: any[] = []
  await new Promise<void>((resolve, reject) => {
    socket.on('error', reject)
    socket.on('message', bytes => { const message = JSON.parse(String(bytes)); messages.push(message); if (message.type === 'snapshot') resolve() })
  })
  return { socket, messages }
}

it('the real chat-backend reports a fake provider failure instead of leaving thinking stuck', async () => {
  const f = await inprocessBuilding()
  try {
    writeFileSync(join(f.a.context.home, 'auth-token'), f.server.AUTH_TOKEN)
    writeFileSync(join(f.a.context.home, 'backend.json'), JSON.stringify({ backend: 'codex', enabledServices: ['codex'] }))
    const cli = join(f.root, 'failed-cli.mjs')
    writeFileSync(cli, `for await (const _ of process.stdin) {}\nconsole.log(JSON.stringify({type:'error',message:'fixture authentication failed'}));process.exit(1)`)
    await f.request('/chat', 'POST', {}, { sender: 'Boss', text: 'hello' })
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../scripts/chat-backend.mjs', import.meta.url)), 'codex', 'Hello', '--json'], {
      cwd: f.root, timeout: 10000,
      env: { ...process.env, AGENT_OFFICE_HOME: f.a.context.home, AGENT_OFFICE_ROOT: join(f.root, 'building'), AGENT_OFFICE_PORT: String(f.port),
        CHAT_AI_ROLE: 'assistant', AGENT_OFFICE_BIN_CODEX: `"${process.execPath}" "${cli}"` },
    }).catch(error => error)
    expect(result.code, result.stderr).toBe(1)
    expect(f.a.state.chatStatus).toMatchObject({ state: 'failed', agent: { name: 'Claude' }, detail: expect.stringContaining('no answer') })
  } finally { await f.close() }
})

it('broadcasts received/thinking, clears on a reply, expires safely and isolates snapshots and live updates', async () => {
  const f = await inprocessBuilding()
  const sockets: WebSocket[] = []
  try {
    const a = await connect(f.port, '/ws'); sockets.push(a.socket)
    expect(a.messages.at(-1).chatStatus).toBeNull()
    await f.request('/chat', 'POST', {}, { sender: 'Boss', text: 'hello' })
    await vi.waitFor(() => expect(a.messages.filter(m => m.type === 'chat_status').map(m => m.status?.state)).toEqual(['received', 'thinking']))
    const reconnect = await connect(f.port, '/ws'); sockets.push(reconnect.socket)
    expect(reconnect.messages.at(-1).chatStatus.state).toBe('thinking')
    await f.request('/chat/reply', 'POST', { Authorization: `Bearer ${f.server.AUTH_TOKEN}` }, { sender: 'Claude', role: 'assistant', text: 'Hello <!-- GOAL_COMPLETE -->' })
    expect(f.a.state.chatStatus).toBeNull()
    expect((await f.request('/chat')).body.messages.at(-1).text).toContain('<!-- GOAL_COMPLETE -->')
    expect((await f.request('/event', 'POST', {}, { type: 'chat_status', status: { state: 'working' } })).status).toBe(401)
    const auth = { Authorization: `Bearer ${f.server.AUTH_TOKEN}` }
    expect((await f.request('/event', 'POST', auth, { type: 'chat_status', status: { state: 'planning', agent: { name: 'Reviewer', role: 'code-reviewer' } } })).status).toBe(200)
    expect(f.a.state.chatStatus.state).toBe('planning')
    expect((await f.request('/event', 'POST', auth, { type: 'chat_status', status: { state: 'invented' } })).status).toBe(400)
    expect(f.a.state.chatStatus.state).toBe('planning')
    vi.useFakeTimers()
    f.server.setChatStatus({ state: 'thinking' })
    const firstTimer = f.a.state.chatStatusTimer
    f.server.setChatStatus({ state: 'planning' })
    expect(f.a.state.chatStatusTimer).toBeNull()
    vi.advanceTimersByTime(180_000)
    expect(f.a.state.chatStatus.state).toBe('planning')
    f.server.setChatStatus({ state: 'thinking' })
    expect(f.a.state.chatStatusTimer).not.toBe(firstTimer)
    vi.advanceTimersByTime(180_000)
    expect(f.a.state.chatStatus).toBeNull()
    f.server.setChatStatus({ state: 'done' })
    vi.advanceTimersByTime(6000)
    expect(f.a.state.chatStatus).toBeNull()
    vi.useRealTimers()
    f.attach()
    const b = await connect(f.port, '/o/off_abc123/ws'); sockets.push(b.socket)
    f.runInOffice(f.a, () => f.server.setChatStatus({ state: 'awaiting_approval', agent: { name: 'Reviewer', role: 'code-reviewer' } }))
    await vi.waitFor(() => expect(a.messages.at(-1).status?.state).toBe('awaiting_approval'))
    expect(b.messages.filter(m => m.type === 'chat_status')).toEqual([])
    expect(b.messages.at(-1).chatStatus).toBeNull()
    f.runInOffice(f.b, () => f.server.setChatStatus({ state: 'thinking', agent: { name: 'Only B', role: 'assistant' } }))
    await vi.waitFor(() => expect(b.messages.at(-1).status?.agent.name).toBe('Only B'))
    expect(f.a.state.chatStatus.agent.name).toBe('Reviewer')
    const handle = f.b.state.chatStatusTimer
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    f.b.close()
    expect(clear).toHaveBeenCalledWith(handle)
    clear.mockRestore()
  } finally {
    vi.useRealTimers()
    for (const socket of sockets) socket.terminate()
    await f.close()
  }
})
