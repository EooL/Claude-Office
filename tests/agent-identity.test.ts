import React from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inprocessBuilding } from './helpers/inprocess-building'
import { delegationContext } from '../scripts/delegation-context.mjs'
import { startPlan, handleGoal, handleMessage } from '../server/delegation.mjs'
import AgentCard from '../src/components/AgentCard'
import type { Agent } from '../src/types'
import SessionStrip from '../src/components/SessionStrip'
import { stripCounts } from '../src/mainState'

const creator = { kind: 'boss', name: 'Boss', messageId: 42 }

describe('delegated identity', () => {
  it('retains the original pending request when an in-place store clears it on confirmation', async () => {
    const state: any = { pending: { name: 'Reviewer', role: 'assistant', task: 'inspect it', at: 1000, createdBy: creator } }
    const jobs: any[] = []
    await handleMessage({ now: () => 1001, read: () => state, write: (patch: object) => Object.assign(state, patch), identity: { createdBy: { ...creator, messageId: 43 } } }, 'yes', async (job: object) => { jobs.push(job) })
    expect(jobs[0].createdBy.messageId).toBe(42)
  })
  it('recovers the real request and session, and does not invent an id for ambiguous text-only requests', async () => {
    const read = async (path: string) => path === '/chat' ? { messages: [{ id: 42, role: 'default', sender: 'Boss', text: 'task' }] }
      : { sessions: [{ id: 'real-terminal', cwd: '/project', state: 'active' }] }
    expect(await delegationContext(read, 'task', '/project')).toEqual({ cwd: '/project', sessionId: 'real-terminal', createdBy: creator, routedBy: 'assistant' })
    const repeated = async () => ({ messages: [{ id: 1, text: 'same' }, { id: 2, text: 'same' }] })
    expect((await delegationContext(repeated, 'same', '/project')).createdBy).toEqual({ kind: 'boss', name: 'Boss' })
    expect((await delegationContext(repeated, 'same', '/project', 2)).createdBy.messageId).toBe(2)
    expect((await delegationContext(async () => null, 'task', '/project')).sessionId).toBe('office-chat')
    expect((await delegationContext(async () => ({ messages: [{ id: 9, role: 'assistant', sender: 'Architect', text: 'task' }] }), 'task', '/project')).createdBy.kind).toBe('agent')
  })
  it.each([false, true])('carries identity through hire and %s failure report without a real provider', async failed => {
    const hires: any[] = [], reports: any[] = [], state: any = {}
    const identity = { cwd: '/project', sessionId: 'office-chat', createdBy: creator, routedBy: 'assistant' }
    const deps: any = { cwd: '/project', identity, now: () => 1000, read: () => state,
      write: (patch: object) => Object.assign(state, patch), agent: () => ({ service: 'fake' }),
      run: async () => failed ? { text: '', code: 1 } : { text: '- Check code\nGOAL: check it', code: 0 },
      hire: async (agent: object) => hires.push(agent), working: async () => {}, finish: async () => {}, say: async () => {},
      report: async (...args: any[]) => reports.push(args),
    }
    await startPlan(deps, { name: 'Reviewer', role: 'assistant', task: 'check it', ...identity })
    expect(hires[0]).toMatchObject({ ...identity, name: 'Reviewer', task: 'check it' })
    expect(reports[0][3]).toMatchObject({ createdBy: creator, task: 'check it' })
    if (!failed) {
      deps.identity = { ...identity, createdBy: { ...creator, messageId: 43 } }
      await handleGoal(deps, '/goal')
      expect(hires[1].createdBy.messageId).toBe(43)
      expect(reports.at(-1)[3].createdBy.messageId).toBe(43)
    }
  })
  it('stores, exposes and persists identity; reuses a real session and preserves old-agent behavior', async () => {
    const f = await inprocessBuilding()
    const headers = { Authorization: `Bearer ${f.server.AUTH_TOKEN}` }
    try {
      const spawn = (id: string, extra: object = {}) => f.request('/event', 'POST', headers, { type: 'agent_spawned', cwd: f.a.context.cwd, sessionId: 'office-chat', agent: { id, name: id, role: 'assistant', task: 'check code', createdBy: creator, routedBy: 'assistant', ...extra } })
      expect((await spawn('worker-a')).status).toBe(200)
      const inspect = (await f.request('/agents/worker-a')).body
      expect(inspect).toMatchObject({ createdBy: creator, routedBy: 'assistant', cwd: f.a.context.cwd, sessionId: 'office-chat' })
      expect(inspect.project).toBeTruthy()
      expect(f.a.state.sessions.get('office-chat')).toMatchObject({ source: 'office-chat', hooked: false })
      expect(JSON.parse(readFileSync(join(f.a.context.home, 'agents.json'), 'utf8')).agents[0].createdBy).toEqual(creator)
      await f.request('/event', 'POST', headers, { type: 'session_started', sessionId: 'real-terminal', cwd: f.a.context.cwd })
      await spawn('worker-b')
      expect(f.a.state.activeAgents.get('worker-b').sessionId).toBe('real-terminal')
      await spawn('legacy', { createdBy: undefined })
      expect((await f.request('/agents/legacy')).body.createdBy).toBeUndefined()
      f.attach()
      expect(JSON.stringify((await f.request('/o/off_abc123/agents')).body)).not.toContain('worker-a')
      expect((await f.request('/o/off_abc123/event', 'POST', headers, { type: 'agent_spawned' })).status).toBe(501)
    } finally { await f.close() }
  })
  it('reports to Boss or a live creator inbox, clears unread with the office UI token, and falls back when gone', async () => {
    const f = await inprocessBuilding()
    const headers = { Authorization: `Bearer ${f.server.AUTH_TOKEN}` }
    try {
      await f.request('/event', 'POST', headers, { type: 'agent_spawned', agent: { id: 'creator-id', name: 'Architect', role: 'architect' } })
      const report = (createdBy: object, text: string) => f.request('/chat/reply', 'POST', headers, { sender: 'Reviewer', role: 'assistant', text, reportTo: createdBy, reportTask: 'Inspect login' })
      await report(creator, 'Finished: tests passed.')
      expect(f.a.chat.getMessages().at(-1).text).toBe('Boss — Re: Inspect login\nFinished: tests passed.')
      await report({ kind: 'agent', name: 'Architect', messageId: 5 }, 'Failed: no quota.')
      expect(f.a.state.activeAgents.get('creator-id').unread).toBe(1)
      expect(JSON.parse(readFileSync(join(f.a.context.home, 'inbox/architect.json'), 'utf8')).text).toContain('Architect — Re: Inspect login')
      expect((await f.request('/chat?recipient=Architect')).body.messages.at(-1).text).toContain('Failed: no quota.')
      expect((await f.request('/chat/inbox/read', 'POST', { Authorization: `Bearer ${f.a.auth.uiToken}` }, { recipient: 'creator-id' })).status).toBe(200)
      expect(f.a.state.activeAgents.get('creator-id').unread).toBe(0)
      f.a.state.activeAgents.delete('creator-id')
      await report({ kind: 'agent', name: 'Architect' }, 'Finished after creator left.')
      expect(f.a.chat.getMessages().at(-1).recipient).toBeNull()
      expect(f.a.chat.getMessages().at(-1).text).toContain('Finished after creator left.')
    } finally { await f.close() }
  })
})

describe('AgentCard lineage rendering', () => {
  it('does not advertise the office-chat context as an unhooked Claude Code terminal', () => {
    const session: any = { id: 'office-chat', source: 'office-chat', hooked: false, state: 'active' }
    expect(renderToString(React.createElement(SessionStrip, { sessions: [session], agents: [] }))).toBe('')
    expect(stripCounts([session])).toMatchObject({ sessions: 0, notHooked: [] })
  })
  const agent = { id: 'deleg-test', name: 'Reviewer', role: 'assistant', type: 'subagent', state: 'working', color: '#fff', hiredAt: 1000, position: { x: 0, y: 0 }, sessionId: 'office-chat', project: 'Project' } as Agent
  it('shows request and router separately', () => {
    const html = renderToString(React.createElement(AgentCard, { agentId: agent.id, agent: { ...agent, createdBy: creator as Agent['createdBy'], routedBy: 'assistant' }, onClose: () => {} }))
    expect(html).toContain('requested by Boss · message #42')
    expect(html).toContain('routed by ')
    expect(html).toContain('assistant')
    expect(html).toContain('Project')
    expect(html).not.toContain('no session')
    expect(html.replace(/<!--.*?-->/g, '')).toContain('session office-chat')
  })
  it('retains hook-created fallback wording and escapes hostile creator text', () => {
    expect(renderToString(React.createElement(AgentCard, { agentId: agent.id, agent, onClose: () => {} }))).toContain('spawned by the session')
    const html = renderToString(React.createElement(AgentCard, { agentId: agent.id, agent: { ...agent, createdBy: { kind: 'agent', name: '<script>alert(1)</script>' }, routedBy: '<img src=x>' }, onClose: () => {} }))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<img src=x>')
  })
})
