import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listen, loadOffice, removeOffice, type Office } from './helpers'

const exec = promisify(execFile)
const delegate = fileURLToPath(new URL('../scripts/delegate.mjs', import.meta.url))
let office: Office
let env: NodeJS.ProcessEnv
const read = () => JSON.parse(readFileSync(join(office.dir, 'delegation.json'), 'utf8'))
async function until<T>(fn: () => T | Promise<T>) {
  const end = Date.now() + 15_000
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value } catch {}
    await new Promise(r => setTimeout(r, 30))
  }
  throw new Error('Delegation fixture did not reach the expected state')
}
const command = (name: string, text: string) => exec(process.execPath, [delegate, name, text], { env, cwd: office.dir, timeout: 15_000 })

beforeAll(async () => {
  office = await loadOffice()
  const port = await listen(office.server.httpServer)
  writeFileSync(join(office.dir, 'auth-token'), office.server.AUTH_TOKEN)
  writeFileSync(join(office.dir, 'backend.json'), JSON.stringify({
    backend: 'codex', enabledServices: ['agy', 'codex'],
    agents: { 'code-reviewer': { brain: 'reviewer' } },
    brains: { reviewer: { name: 'Reviewer', steps: [{ service: 'agy' }, { service: 'codex' }] } },
  }))
  const cli = join(office.dir, 'fixture-cli.mjs')
  writeFileSync(cli, `
    import {appendFileSync,writeFileSync} from 'node:fs';
    const args=process.argv.slice(2), agy=args[0]==='-p';
    appendFileSync('calls.jsonl',JSON.stringify({service:agy?'agy':'codex',args})+'\\n');
    if(agy){console.log(JSON.stringify({status:'ERROR',error:'headless mode cannot prompt for command permission; auto-denied'}));process.exit(1)}
    let prompt='';for await(const d of process.stdin)prompt+=d;
    const classifier=prompt.includes('You sort messages');
    const write=args[args.indexOf('-s')+1]==='workspace-write';
    if(!classifier)await new Promise(r=>setTimeout(r,1000));
    if(write)appendFileSync('edits.txt','one execution\\n');
    const text=classifier?JSON.stringify({kind:'task',confidence:1,task:'review'}):write?'Fixture edit completed; verify the result.':'- Inspect the fixture\\n- Prepare the change\\nGOAL: update the fixture';
    writeFileSync(args[args.indexOf('-o')+1],text);
    console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
  `)
  const override = `"${process.execPath}" "${cli}"`
  env = { ...process.env, AGENT_OFFICE_HOME: office.dir, AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_BIN_CODEX: override, AGENT_OFFICE_BIN_AGY: override }
})

afterAll(async () => {
  await new Promise<void>(r => office.server.httpServer.close(() => r()))
  removeOffice(office)
})

describe('the real detached delegation runtime with isolated CLI fixtures', () => {
  it('starts a visible worker, falls back after a permission failure and persists a plan', async () => {
    const task = 'Review the fixture and prepare an English PR description with screenshots'
    await fetch(`http://127.0.0.1:${env.AGENT_OFFICE_PORT}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: 'Boss', text: task }) })
    const request = (await (await fetch(`http://127.0.0.1:${env.AGENT_OFFICE_PORT}/chat`)).json()).messages.findLast((m: any) => m.text === task)
    expect((await command('message', task)).stdout).toBe('handled')
    await until(() => read().busy?.kind === 'plan')
    await until(async () => (await fetch(`http://127.0.0.1:${env.AGENT_OFFICE_PORT}/agents`)).json().then(o => o.agents.length > 0))
    await until(() => read().plan)
    expect(read().plan).toMatchObject({ task, service: 'codex' })
    expect(read().lastJob.status).toBe('planned')
    expect(read().plan).toMatchObject({ sessionId: 'office-chat', createdBy: { kind: 'boss', name: 'Boss', messageId: request.id }, routedBy: 'assistant' })
    const worker = office.server.activeAgents.get(read().lastJob.id)
    expect(worker).toMatchObject({ sessionId: 'office-chat', createdBy: { messageId: request.id } })
    const circuits = JSON.parse(readFileSync(join(office.dir, 'cooldowns.json'), 'utf8'))
    expect(circuits['agy@plan']).toMatchObject({ state: 'open', kind: 'permission' })
    const calls = readFileSync(join(office.dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    expect(calls.filter(c => c.service === 'agy')).toHaveLength(1)
  })

  it('admits one concurrent goal, makes a real fixture edit once and releases the reservation', async () => {
    const headers = { Authorization: `Bearer ${office.server.AUTH_TOKEN}`, 'Content-Type': 'application/json' }
    const base = `http://127.0.0.1:${env.AGENT_OFFICE_PORT}`
    const { actions } = await (await fetch(`${base}/chat/actions`, { headers })).json()
    expect(actions[0].kind).toBe('goal')
    const approvals = await Promise.all([0, 1].map(() => fetch(`${base}/chat/actions/approve`, { method: 'POST', headers, body: JSON.stringify({ id: actions[0].id }) })))
    expect(approvals.map(r => r.status).sort()).toEqual([200, 409])
    const messages = (await (await fetch(`${base}/chat`)).json()).messages
    const goal = messages.findLast((m: any) => m.msg_type === 'goal')
    expect(goal.text).toMatch(/^\/goal --plan-id=/)
    await Promise.all([command('goal', goal.text), command('goal', goal.text)])
    await until(() => read().lastJob?.status === 'finished')
    await until(() => { try { readFileSync(join(office.dir, 'delegation.lock')); return false } catch { return true } })
    expect(readFileSync(join(office.dir, 'edits.txt'), 'utf8')).toBe('one execution\n')
    expect(read().plan).toBeUndefined()
    expect(read().busy).toBeUndefined()
    expect(read().lastJob.createdBy).toMatchObject({ kind: 'boss', name: 'Boss', messageId: goal.id })
  })
})
