import Database from 'better-sqlite3'
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { mountChatActions, nextAction, planId } from '../server/chat-actions.mjs'
import { handleGoal } from '../server/delegation.mjs'

function fixture(existingDb?: Database.Database) {
  const db = existingDb ?? new Database(':memory:')
  db.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, sender TEXT, role TEXT, text TEXT, timestamp INTEGER, is_system INTEGER DEFAULT 0, recipient TEXT, msg_type TEXT)')
  const insert = (text: string, role = 'assistant', sender = 'Reviewer') => Number(db.prepare('INSERT INTO messages (sender,role,text,timestamp) VALUES (?,?,?,1000)').run(sender, role, text).lastInsertRowid)
  const state: any = {}
  const decisions: string[] = []
  let paused = false
  const app = express(); app.use(express.json())
  mountChatActions(app, { db, log: (text: string) => { decisions.push(text) }, requireUi: (req: any, res: any, next: any) => req.headers.authorization === 'Bearer fixture' ? next() : res.sendStatus(401), readState: () => state, paused: () => paused, now: () => 1000,
    enqueue: (text: string, msgType: string) => { const id = insert(text, msgType === 'goal' ? 'boss' : 'default', 'Boss'); db.prepare('UPDATE messages SET msg_type = ? WHERE id = ?').run(msgType, id); return { id } },
  })
  const get = () => request(app).get('/chat/actions').set('Authorization', 'Bearer fixture')
  const approve = (id: string) => request(app).post('/chat/actions/approve').set('Authorization', 'Bearer fixture').send({ id })
  const decline = (id: string) => request(app).post('/chat/actions/decline').set('Authorization', 'Bearer fixture').send({ id })
  return { db, app, state, insert, get, approve, decline, decisions, pause: () => { paused = true } }
}

describe('scoped next-step approvals', () => {
  it('requires authentication and derives a proposal from an agent message, never a client command', async () => {
    const f = fixture()
    f.insert('NEXT_ACTION: delete everything', 'default', 'Boss')
    expect((await f.get()).body.actions).toEqual([])
    const id = f.insert('Review is ready.\nNEXT_ACTION: Investigate the failing login test before changing authentication.')
    expect((await request(f.app).get('/chat/actions')).status).toBe(401)
    const action = (await f.get()).body.actions[0]
    expect(action).toMatchObject({ messageId: id, kind: 'plan' })
    expect((await f.approve('invented')).status).toBe(409)
    expect((await f.approve(action.id)).status).toBe(200)
    expect(f.db.prepare('SELECT text FROM messages ORDER BY id DESC LIMIT 1').get().text).toContain('Please investigate and plan this next step: Investigate')
    expect((await f.approve(action.id)).status).toBe(409)
    f.db.close()
  })
  it('expires recommendations after a newer user message and blocks work while busy or paused', async () => {
    const f = fixture()
    f.insert('NEXT_ACTION: Check the failing test in the checkout.')
    const action = (await f.get()).body.actions[0]
    f.state.busy = { pid: process.pid }
    expect((await f.approve(action.id)).status).toBe(409)
    delete f.state.busy
    f.pause()
    expect((await f.approve(action.id)).status).toBe(409)
    f.insert('Work on another task first', 'default', 'Boss')
    expect((await f.get()).body.actions).toEqual([])
    f.db.close()
  })
  it('binds execution approval to the current plan and enqueues exactly one authenticated goal', async () => {
    const f = fixture()
    f.state.plan = { name: 'Reviewer', role: 'code-reviewer', plan: '- Run tests', goal: 'Run the isolated tests', at: 1000 }
    f.insert('Boss, I have a plan:\n- Run tests\n\nSay /goal to send me, or /goal <changes> to adjust it.')
    const action = (await f.get()).body.actions[0]
    expect(action.kind).toBe('goal')
    f.state.plan.goal = 'A different task'
    expect((await f.approve(action.id)).status).toBe(409)
    const current = (await f.get()).body.actions[0]
    const results = await Promise.all([f.approve(current.id), f.approve(current.id)])
    expect(results.map(r => r.status).sort()).toEqual([200, 409])
    expect(f.db.prepare("SELECT text,msg_type,role FROM messages ORDER BY id DESC LIMIT 1").get()).toMatchObject({ text: `/goal --plan-id=${planId(f.state.plan)}`, msg_type: 'goal', role: 'boss' })
    f.db.close()
  })
  it('after a failed execution the same plan can be approved again, with the button on the newest message about it', async () => {
    const f = fixture()
    const plan = { name: 'Reviewer', role: 'code-reviewer', task: 't', plan: '- do it', goal: 'do it', at: 1000 }
    f.state.plan = plan
    const planRow = f.insert(`Boss, I have a plan:\n${plan.plan}\n\nSay /goal to send me, or /goal <changes> to adjust it.`)
    const first = (await f.get()).body.actions[0]
    expect(first).toMatchObject({ kind: 'goal', messageId: planRow })
    expect((await f.approve(first.id)).status).toBe(200)
    expect((await f.get()).body.actions).toEqual([]) // used while the job runs

    // the attempt fails: the plan stays pending and the agent says so, pointing at /goal again
    f.state.lastJob = { status: 'failed', name: 'Reviewer', at: 1500, finishedAt: 2000 }
    const status = f.insert('The plan is ready. No agent is executing it. Say /goal to approve execution.')
    const again = (await f.get()).body.actions
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ kind: 'goal', label: 'Approve and execute plan', messageId: status })
    expect(again[0].id).not.toBe(first.id)
    expect((await f.approve(again[0].id)).status).toBe(200)
    expect((await f.approve(again[0].id)).status).toBe(409) // one click, one approval
    f.db.close()
  })

  it('writes an approval to the chat as a line of its own, before the command it queues', async () => {
    const f = fixture()
    f.insert('Review is ready.\nNEXT_ACTION: Investigate the failing login test before changing authentication.')
    const action = (await f.get()).body.actions[0]
    expect((await f.approve(action.id)).status).toBe(200)
    expect(f.decisions).toEqual(['✔ Approved: Plan recommended step — Investigate the failing login test before changing authentication.'])
    // a repeated click neither queues nor logs again
    expect((await f.approve(action.id)).status).toBe(409)
    expect(f.decisions).toHaveLength(1)
    f.db.close()
  })

  it('declining starts nothing, is written to the chat, and the step is not offered again', async () => {
    const f = fixture()
    f.insert('Review is ready.\nNEXT_ACTION: Rewrite the whole login module.')
    const action = (await f.get()).body.actions[0]
    const before = f.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
    expect((await request(f.app).post('/chat/actions/decline').send({ id: action.id })).status).toBe(401)
    expect((await f.decline('invented')).status).toBe(409)
    expect((await f.decline(action.id)).status).toBe(200)
    expect(f.decisions).toEqual(['Ignored: Rewrite the whole login module.'])
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n).toBe(before) // nothing was queued
    expect((await f.get()).body.actions).toEqual([])
    expect((await f.decline(action.id)).status).toBe(409)
    expect((await f.approve(action.id)).status).toBe(409)
    expect(f.decisions).toHaveLength(1)
    f.db.close()
  })

  it('a declined execution approval is recorded with the plan it was about, and a later failed attempt offers a new one', async () => {
    const f = fixture()
    const plan = { name: 'Reviewer', role: 'code-reviewer', task: 't', plan: '- do it', goal: 'Refresh the PR', at: 1000 }
    f.state.plan = plan
    f.insert(`Boss, I have a plan:\n${plan.plan}\n\nSay /goal to send me, or /goal <changes> to adjust it.`)
    const action = (await f.get()).body.actions[0]
    expect((await f.decline(action.id)).status).toBe(200)
    expect(f.decisions[0]).toMatch(/^✖ Declined: Approve and execute plan — Refresh the PR/)
    expect((await f.get()).body.actions).toEqual([])
    f.db.close()
  })

  it('declining one action does not hide the other one that is still offered', async () => {
    const f = fixture()
    f.state.lastJob = { status: 'failed', name: 'Reviewer', task: 'review the PR', at: 800, finishedAt: 900 }
    f.insert('Done.\nNEXT_ACTION: Check the failing login test before changing authentication.')
    const labels = async () => (await f.get()).body.actions.map((a: any) => a.label)
    expect(await labels()).toContain('Plan recommended step')
    const retry = (await f.get()).body.actions.find((a: any) => a.label === 'Retry planning')
    expect(retry).toBeDefined()
    {
      expect((await f.decline(retry.id)).status).toBe(200)
      expect(await labels()).toContain('Plan recommended step')
    }
    f.db.close()
  })

  it('rejects a queued approval if the worker sees a different plan', async () => {
    const said: string[] = []
    await handleGoal({ read: () => ({ plan: { goal: 'Changed plan' } }), say: async (_n: string, _r: string, text: string) => { said.push(text) } }, `/goal --plan-id=${planId({ goal: 'Old plan' })}`)
    expect(said[0]).toContain('older plan')
  })
  it('requires a single bounded explicit recommendation line', () => {
    expect(nextAction('Hello there.')).toBeNull()
    expect(nextAction('NEXT_ACTION: first proposal\nNEXT_ACTION: second proposal')).toBeNull()
    expect(nextAction(`NEXT_ACTION: ${'x'.repeat(601)}`)).toBeNull()
  })
  it('recognizes prose case-insensitively, prefers the marker, and bounds the trimmed task', () => {
    expect(nextAction('Suggested next step: Inspect the failing test.')).toBe('Inspect the failing test.')
    expect(nextAction('sUgGeStEd NeXt StEpS: Inspect the failing test.\r\n')).toBe('Inspect the failing test.')
    expect(nextAction('Suggested next step: Inspect the failing test.\nNEXT_ACTION: Inspect the failing test.')).toBe('Inspect the failing test.')
    for (const prefix of ['NEXT_ACTION:', 'Suggested next step:', 'Suggested next steps:']) {
      expect(nextAction(`${prefix} short`)).toBeNull()
      expect(nextAction(`${prefix} ${'x'.repeat(601)}`)).toBeNull()
      expect(nextAction(`${prefix}       x       `)).toBeNull()
      expect(nextAction(`${prefix} ${'x'.repeat(600)}`)).toHaveLength(600)
    }
  })
  it.each(['approve', 'decline'] as const)('persists a prose suggestion %s across a new controller and rejects repeat decisions', async decision => {
    const f = fixture()
    const id = f.insert('Review complete.\nSuggested next steps: Inspect the failing test.')
    const action = (await f.get()).body.actions[0]
    expect(action).toMatchObject({ id: `next:${id}`, messageId: id, kind: 'plan' })
    expect((await f[decision](action.id)).status).toBe(200)
    const fresh = fixture(f.db)
    expect(fresh.state).not.toBe(f.state)
    const result = (await fresh.get()).body
    expect(result.actions).toEqual([])
    expect(result.decisions).toEqual([expect.objectContaining({ id: action.id, decision: decision === 'approve' ? 'started' : 'ignored' })])
    expect((await fresh.approve(action.id)).status).toBe(409)
    expect((await fresh.decline(action.id)).status).toBe(409)
    f.db.close()
  })
  it('keeps suggestion decisions in their own database and migrates an older approvals ledger', async () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE chat_action_approvals (action_id TEXT PRIMARY KEY, approved_at INTEGER NOT NULL); INSERT INTO chat_action_approvals VALUES (\'next:1\', 1000)')
    const a = fixture(db), b = fixture()
    a.insert('NEXT_ACTION: Inspect the failing test.')
    b.insert('NEXT_ACTION: Inspect the failing test.')
    expect((await a.get()).body.actions).toEqual([])
    expect((await a.get()).body.decisions).toEqual([]) // no invented outcome for legacy rows
    const action = (await b.get()).body.actions[0]
    expect((await b.decline(action.id)).status).toBe(200)
    expect((await a.get()).body.decisions).toEqual([])
    expect((await b.get()).body.decisions[0].decision).toBe('ignored')
    a.db.close(); b.db.close()
  })
})
