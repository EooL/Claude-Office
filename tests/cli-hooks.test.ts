import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHmac } from 'node:crypto'
import { normalizeEvent, sendEvent } from '../hooks/cli-tracker.mjs'
import { loadOffice, listen, removeOffice } from './helpers'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function home() { const d = mkdtempSync(join(tmpdir(), 'office-cli-hooks-')); dirs.push(d); return d }
function tracker(cli: string, event: string, input: string, env: Record<string, string>, end = true) {
  return new Promise<{ code: number | null; out: string; err: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve('hooks/cli-tracker.mjs'), cli, event], { env: { ...process.env, AGENT_OFFICE_RUN: '', ...env }, windowsHide: true })
    let out = '', err = ''
    child.stdout.on('data', b => { out += b }); child.stderr.on('data', b => { err += b })
    child.stdin.on('error', () => {})
    child.on('error', reject); child.on('close', code => resolveResult({ code, out, err }))
    if (end) child.stdin.end(input)
  })
}
const standard = { session_id: 'same', cwd: 'C:\\Projects\\Example', prompt: 'private prompt', last_assistant_message: 'reply', tool_name: 'Read', tool_input: { secret: 'never forward' }, agent_id: 'child', agent_type: 'reviewer' }
describe('CLI payload normalization (synthetic documented/inferred shapes)', () => {
  for (const cli of ['codex', 'qoder']) {
    it.each([
      ['SessionStart', 'session_started'], ['SessionEnd', 'session_ended'], ['UserPromptSubmit', 'session_prompt'], ['PreToolUse', 'agent_working'],
      ['PostToolUse', 'session_tool_done'], ['PermissionRequest', 'session_needs_you'], ['Stop', 'session_turn_end'], ['SubagentStart', 'agent_spawned'],
      ['SubagentStop', 'agent_completed'], ['PreCompact', 'session_compact'], ['PostCompact', 'session_compact'],
    ])(`${cli} %s -> %s`, (event, type) => {
      const result = normalizeEvent(cli, event, standard)
      expect(result).toMatchObject({ type, cli, sessionId: `${cli}:same`, cwd: standard.cwd, project: 'Example' })
      expect(JSON.stringify(result)).not.toContain('never forward')
    })
  }
  it.each([['SessionStart', 'session_started'], ['PreToolUse', 'agent_working'], ['PostToolUse', 'session_tool_done'], ['PreInvocation', 'agent_working'], ['PostInvocation', 'session_turn_end'], ['Stop', 'session_turn_end']])('agy %s', (event, type) => {
    expect(normalizeEvent('agy', event, { conversationId: 'x', workspacePaths: ['/tmp/project'], toolCall: { name: 'read', args: { secret: true } } })).toMatchObject({ type, cli: 'agy', sessionId: 'agy:x', project: 'project' })
  })
  it.each([['session.created', 'session_started'], ['session.deleted', 'session_ended'], ['session.idle', 'session_turn_end'], ['session.error', 'session_error'], ['session.compacted', 'session_compact'], ['permission.asked', 'session_needs_you'], ['tool.execute.before', 'agent_working'], ['tool.execute.after', 'session_tool_done'], ['message.updated', 'session_prompt']])('OpenCode inferred %s', (event, type) => {
    expect(normalizeEvent('opencode', event, { cwd: '/tmp/project', sessionID: 'x', properties: { info: { id: 'x', role: 'user' } }, tool: 'read' })).toMatchObject({ type, cli: 'opencode', sessionId: 'opencode:x' })
  })
  it('does not invent prompt text, forward errors/tool payloads, or accept missing identities', () => {
    expect(normalizeEvent('codex', 'PreToolUse', standard)).toMatchObject({ agentId: 'codex:child' })
    expect(normalizeEvent('opencode', 'session.created', { properties: { info: { id: 'child', parentID: 'parent' } } })).toMatchObject({ type: 'agent_spawned', sessionId: 'opencode:parent', agent: { id: 'opencode:child' } })
    expect(normalizeEvent('opencode', 'message.updated', { properties: { info: { sessionID: 'x', role: 'assistant' } } })).toBeNull()
    expect(normalizeEvent('agy', 'Stop', { conversationId: 'x', error: 'secret prompt' })).toMatchObject({ type: 'session_error', detail: 'Terminal reported an error' })
    expect(normalizeEvent('codex', 'SessionStart', {})).toBeNull()
    expect(normalizeEvent('unknown', 'SessionStart', standard)).toBeNull()
    expect(normalizeEvent('codex', 'unknown', standard)).toBeNull()
  })
  it.each([['PostToolUseFailure', 'session_error'], ['StopFailure', 'session_error'], ['PermissionDenied', 'session_needs_you'], ['Notification', 'session_needs_you'], ['CwdChanged', 'session_cwd'], ['Interrupt', 'session_turn_end']])('additional event %s', (event, type) => {
    expect(normalizeEvent('qoder', event, standard).type).toBe(type)
  })
})
describe('silent bounded tracker process', () => {
  it('posts signed lifecycle events to the real disposable office without changing its routes', async () => {
    const office = await loadOffice()
    const port = await listen(office.server.httpServer)
    writeFileSync(join(office.dir, 'auth-token'), office.server.AUTH_TOKEN)
    try {
      for (const cli of ['codex', 'agy', 'opencode', 'qoder']) {
        const payload = cli === 'agy' ? { conversationId: 'same', workspacePaths: ['/tmp/project'] } : cli === 'opencode' ? { cwd: '/tmp/project', properties: { info: { id: 'same' } } } : standard
        const event = cli === 'opencode' ? 'session.created' : 'SessionStart'
        expect(await tracker(cli, event, JSON.stringify(payload), { AGENT_OFFICE_HOME: office.dir, AGENT_OFFICE_EVENT_URL: `http://127.0.0.1:${port}/event` })).toEqual({ code: 0, out: '', err: '' })
        expect(office.server.sessions.get(`${cli}:same`)).toBeDefined()
      }
    } finally {
      office.server.app.locals.health.stop()
      await new Promise<void>(r => office.server.wss.close(() => r()))
      office.server.httpServer.closeAllConnections()
      await new Promise<void>(r => office.server.httpServer.close(() => r()))
      removeOffice(office)
    }
  })
  it.each(['bad json', '', '[]', 'null', 'x'.repeat(300000)])('ignores invalid/oversized input (%#)', async input => {
    expect(await tracker('codex', 'SessionStart', input, { AGENT_OFFICE_HOME: home() })).toEqual({ code: 0, out: '', err: '' })
  })
  it('missing token exits silently without making any request', async () => {
    expect(await tracker('codex', 'SessionStart', JSON.stringify(standard), { AGENT_OFFICE_HOME: home(), AGENT_OFFICE_EVENT_URL: 'invalid' })).toEqual({ code: 0, out: '', err: '' })
  })
  it('AGENT_OFFICE_RUN=1 exits without waiting for stdin, including agy', async () => {
    expect(await tracker('agy', 'PreToolUse', '', { AGENT_OFFICE_RUN: '1', AGENT_OFFICE_HOME: home() }, false)).toEqual({ code: 0, out: '', err: '' })
  })
  it.each([['PreToolUse', '{}'], ['PostToolUse', '{}'], ['Stop', '{}']])('agy %s emits only its neutral reply even on bad input', async (event, out) => {
    expect(await tracker('agy', event, 'bad json', { AGENT_OFFICE_HOME: home() })).toEqual({ code: 0, out, err: '' })
  })
  it('never prints a decision or approves a tool, for any CLI, event or input', async () => {
    const good = JSON.stringify({ conversationId: 'x', session_id: 'x', workspacePaths: ['/tmp/p'], toolCall: { name: 'read' } })
    for (const cli of ['codex', 'agy', 'opencode', 'qoder']) for (const event of ['PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop']) for (const input of ['bad json', good]) {
      const r = await tracker(cli, event, input, { AGENT_OFFICE_HOME: home() })
      expect(r.out).not.toMatch(/decision|allow/i)
    }
  })
  it('does not wait for a stdin that never closes once a full JSON object has arrived', async () => {
    const child = spawn(process.execPath, [resolve('hooks/cli-tracker.mjs'), 'agy', 'PreToolUse'], { env: { ...process.env, AGENT_OFFICE_RUN: '', AGENT_OFFICE_HOME: home() }, windowsHide: true })
    let out = ''; child.stdout.on('data', b => { out += b }); child.stdin.on('error', () => {})
    const started = Date.now()
    const code = await new Promise(r => { child.on('close', r); child.stdin.write(JSON.stringify({ conversationId: 'x' })) })
    const took = Date.now() - started
    child.stdin.destroy()
    expect({ code, out }).toEqual({ code: 0, out: '{}' })
    expect(took).toBeLessThan(1500) // node start-up included; the old behaviour waited 2000+
  })
  it('a stdin that never sends anything still ends within the 500 ms cap', async () => {
    const child = spawn(process.execPath, [resolve('hooks/cli-tracker.mjs'), 'agy', 'PreToolUse'], { env: { ...process.env, AGENT_OFFICE_RUN: '', AGENT_OFFICE_HOME: home() }, windowsHide: true })
    child.stdin.on('error', () => {})
    const started = Date.now()
    const code = await new Promise(r => child.on('close', r))
    expect(code).toBe(0)
    expect(Date.now() - started).toBeLessThan(1500)
  })
  it('signs exact bytes and honours all prompt logging levels', async () => {
    const dir = home(); writeFileSync(join(dir, 'auth-token'), 'test-token')
    for (const [level, length] of [['off', undefined], ['summary', 200], ['full', 1000]] as const) {
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ logPrompts: level }))
      let captured: any
      await sendEvent(normalizeEvent('codex', 'UserPromptSubmit', { ...standard, prompt: 'x'.repeat(1000) }), {
        env: { AGENT_OFFICE_HOME: dir, AGENT_OFFICE_EVENT_URL: 'http://127.0.0.1:1/event' },
        fetchImpl: async (_url: unknown, options: any) => { captured = options },
      })
      expect(JSON.parse(captured.body).text?.length).toBe(length)
      const ts = captured.headers['X-Office-Timestamp']
      expect(captured.headers['X-Office-Signature']).toBe(createHmac('sha256', 'test-token').update(`POST\n/event\n${ts}\n${captured.body}`).digest('hex'))
      expect(captured.body).not.toContain('test-token')
    }
  })
  it('missing server and stalled server both exit zero within the hard deadline', async () => {
    const dir = home(); writeFileSync(join(dir, 'auth-token'), 'fake-token')
    const server = createServer(() => {})
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as any).port
    try {
      const now = Date.now()
      expect(await tracker('codex', 'SessionStart', JSON.stringify(standard), { AGENT_OFFICE_HOME: dir, AGENT_OFFICE_EVENT_URL: `http://127.0.0.1:${port}/event` })).toEqual({ code: 0, out: '', err: '' })
      expect(Date.now() - now).toBeLessThan(4000)
    } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
    expect(await tracker('codex', 'SessionStart', JSON.stringify(standard), { AGENT_OFFICE_HOME: dir, AGENT_OFFICE_EVENT_URL: `http://127.0.0.1:${port}/event` })).toEqual({ code: 0, out: '', err: '' })
  })
})
