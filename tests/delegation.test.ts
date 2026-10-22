import { describe, expect, it } from 'vitest'
import {
  CONFIDENT, PENDING_TTL_MS, classifyPrompt, handleGoal, handleMessage, isNo, isYes,
  delegationStatus, guardChatReply, looksLikeTask, parseClassification, parsePlan, startPlan,
} from '../server/delegation.mjs'
import { ROLES, listRoles, routeMessage } from '../server/roles.mjs'

const NOW = 1_700_000_000_000

/** Deps whose effects are recorded, and whose service answers from a script. */
function fake(answers: string[] = [], state: Record<string, any> = {}) {
  const log: any[] = []
  let clock = NOW
  const deps = {
    now: () => clock,
    cwd: '/proj',
    read: () => state,
    write: (patch: Record<string, any>) => {
      Object.assign(state, patch)
      for (const k of Object.keys(state)) if (state[k] === undefined) delete state[k]
    },
    agent: (role: string) => ({ service: role === 'debugger' ? 'codex' : 'claude', model: role === 'debugger' ? 'gpt-x' : '', effort: '' }),
    run: async (role: string, prompt: string, opts: any) => {
      log.push(['run', role, opts.mode, prompt])
      const text = answers.shift() ?? ''
      return { text, usage: { totalTokens: 10 }, durationMs: 5, model: '', code: text ? 0 : 1, step: { service: role === 'debugger' ? 'codex' : 'claude', model: '' } }
    },
    say: async (name: string, role: string, text: string) => { log.push(['say', name, role, text]) },
    hire: async (agent: any) => { log.push(['hire', agent.name, agent.role, agent.task]) },
    working: async (id: string, status: string) => { log.push(['working', status]) },
    finish: async (id: string, info: any) => { log.push(['finish', info.result]) },
  }
  return { deps, log, state, tick: (ms: number) => { clock += ms } }
}

describe('roles', () => {
  it('keeps long plans and execution reports up to the shared 8000-character clip', async () => {
    const { deps, log, state } = fake(['p'.repeat(9000) + '\nGOAL: inspect the code', 'r'.repeat(9000)])
    await startPlan(deps, { name: 'Reviewer', role: 'assistant', task: 'inspect the code' })
    const planLine = log.filter(entry => entry[0] === 'say').at(-1)[3]
    expect(planLine).toHaveLength(8000)
    expect(planLine.endsWith('…')).toBe(true)
    expect(state.plan.plan).toHaveLength(9000) // execution retains the actual plan
    await handleGoal(deps, '/goal')
    const report = log.filter(entry => entry[0] === 'say').at(-1)[3]
    expect(report.slice(0, 8000)).toBe('Execution finished. Reported result:\n' + 'r'.repeat(7962) + '…')
  })
  it('routes by keyword like the old table, and falls back to the assistant', () => {
    expect(routeMessage('fix the crash')).toEqual({ role: 'debugger', name: 'Debugger' })
    expect(routeMessage('add a unit test')).toEqual({ role: 'test-engineer', name: 'Tester' })
    expect(routeMessage('hello there')).toEqual({ role: 'assistant', name: 'Claude' })
  })
  it('lists each role once, the assistant first', () => {
    const roles = listRoles().map(r => r.role)
    expect(roles[0]).toBe('assistant')
    expect(new Set(roles).size).toBe(roles.length)
    expect(roles).toHaveLength(new Set(ROLES.map(r => r.role)).size + 1)
  })
})

describe('reading a message', () => {
  it('only asks the classifier about what reads like a request', () => {
    expect(looksLikeTask('fix the login crash')).toBe(true)
    expect(looksLikeTask('please add a test')).toBe(true)
    expect(looksLikeTask('how is the weather')).toBe(false)
  })
  it('understands yes and no in English and Romanian', () => {
    expect(isYes('Yes!')).toBe(true)
    expect(isYes('da')).toBe(true)
    expect(isNo('nu')).toBe(true)
    expect(isYes('maybe')).toBe(false)
  })
  it('parses the classifier reply, and anything unreadable is an unsure chat', () => {
    expect(parseClassification('ok {"kind":"task","confidence":0.95,"task":"fix login"} done')).toEqual({ kind: 'task', confidence: 0.95, task: 'fix login' })
    expect(parseClassification('{"kind":"task","confidence":7}').confidence).toBe(1)
    expect(parseClassification('no json here')).toEqual({ kind: 'chat', confidence: 0, task: '' })
    expect(classifyPrompt('hi')).toContain('"kind"')
  })
  it('splits a plan from its GOAL line', () => {
    expect(parsePlan('- read it\n- fix it\nGOAL: fix the login')).toEqual({ plan: '- read it\n- fix it', goal: 'fix the login' })
    expect(parsePlan('- only a plan')).toEqual({ plan: '- only a plan', goal: '' })
  })
})

describe('handleMessage', () => {
  const jobs: any[] = []
  const start = (job: any) => { jobs.push(job) }

  it('answers the exact failed-task follow-up from durable state, without a chat-model promise', async () => {
    const { deps, log } = fake([], { lastJob: { name: 'Reviewer', role: 'code-reviewer', task: 'Review and prepare an English PR with screenshots', status: 'failed', phase: 'plan', failureKind: 'permission' } })
    const started: any[] = []
    expect(await handleMessage(deps, 'So can we do what I asked?', job => { started.push(job) })).toBe('handled')
    expect(started).toEqual([])
    expect(log).toEqual([['say', 'Reviewer', 'code-reviewer', expect.stringContaining('required tool permission was denied')]])
    expect(log[0][3]).toContain('No agent is working')
    expect(await handleMessage(deps, 'retry the last task', job => { started.push(job) })).toBe('handled')
    expect(started).toEqual([{ name: 'Reviewer', role: 'code-reviewer', task: 'Review and prepare an English PR with screenshots' }])
  })

  it('handles accented characters in a request and keeps the original requirements', async () => {
    const { deps } = fake(['{"kind":"task","confidence":1,"task":"shortened"}'])
    const text = 'Please review the changes and create a documented PR with screenshots, café résumé style.'
    const started: any[] = []
    await handleMessage(deps, text, job => { started.push(job) })
    expect(started[0].task).toBe(text)
  })

  it('leaves small talk to the chat without calling the classifier', async () => {
    const { deps, log } = fake()
    expect(await handleMessage(deps, 'how are you today', start)).toBe('chat')
    expect(log).toEqual([])
  })

  it('lets a confident chat verdict through to the chat', async () => {
    const { deps } = fake(['{"kind":"chat","confidence":0.95,"task":""}'])
    expect(await handleMessage(deps, 'can you tell me what a mutex is', start)).toBe('chat')
  })

  it('starts the plan itself when it is sure the message is a job', async () => {
    jobs.length = 0
    const { deps, log } = fake([`{"kind":"task","confidence":${CONFIDENT},"task":"fix the login crash"}`])
    expect(await handleMessage(deps, 'please fix the login crash', start)).toBe('handled')
    expect(jobs).toEqual([{ name: 'Debugger', role: 'debugger', task: 'please fix the login crash' }])
    // the classifier ran on the brain of the role the message routes to
    expect(log[0].slice(0, 3)).toEqual(['run', 'debugger', 'chat'])
  })

  it('asks before acting when it is not sure, then follows the answer', async () => {
    jobs.length = 0
    const { deps, log, state } = fake(['{"kind":"task","confidence":0.5,"task":"fix the login crash"}'])
    expect(await handleMessage(deps, 'the login crash, can you look into it', start)).toBe('handled')
    expect(log.find(l => l[0] === 'say')[3]).toMatch(/take that on/)
    expect(state.pending).toMatchObject({ role: 'debugger', task: 'the login crash, can you look into it' })
    expect(jobs).toEqual([])

    expect(await handleMessage(deps, 'yes', start)).toBe('handled')
    expect(jobs).toHaveLength(1)
    expect(state.pending).toBeUndefined()
  })

  it('drops the job on no, and ignores an answer that is too late', async () => {
    jobs.length = 0
    const a = fake([], { pending: { name: 'Debugger', role: 'debugger', task: 't', at: NOW } })
    expect(await handleMessage(a.deps, 'no', start)).toBe('handled')
    expect(a.state.pending).toBeUndefined()
    expect(a.log.at(-1)[3]).toMatch(/dropped/)

    const b = fake([], { pending: { name: 'Debugger', role: 'debugger', task: 't', at: NOW } })
    b.tick(PENDING_TTL_MS + 1)
    expect(await handleMessage(b.deps, 'yes', start)).toBe('chat')
    expect(jobs).toEqual([])
  })

  it('reports that no worker started when the classifier cannot be run', async () => {
    const { deps, log } = fake()
    deps.run = async () => { throw new Error('no cli') }
    expect(await handleMessage(deps, 'please fix the login crash', start)).toBe('handled')
    expect(log.at(-1)[3]).toContain('No worker started')
  })
})

describe('the plan and the goal', () => {
  it('records the failure for follow-ups and invalidates an older plan', async () => {
    const { deps, state } = fake([], { plan: { goal: 'old unrelated goal' } })
    deps.run = (async () => ({ text: '', error: 'headless mode cannot prompt for the command permission; auto-denied', code: 1 })) as any
    await startPlan(deps, { name: 'Reviewer', role: 'code-reviewer', task: 'Review the PR' })
    expect(state.plan).toBeUndefined()
    expect(state.lastJob).toMatchObject({ task: 'Review the PR', status: 'failed', phase: 'plan', failureKind: 'permission' })
  })
  it('finishes cleanly when all services are disabled and no primary step exists', async () => {
    const { deps, log, state } = fake()
    deps.agent = (() => undefined) as any
    deps.run = (async () => ({ text: '', code: 1 })) as any
    await startPlan(deps, { name: 'Debugger', role: 'debugger', task: 'x' })
    expect(log.find(l => l[0] === 'finish')[1]).toMatch(/^failed/)
    expect(state.busy).toBeUndefined()
    expect(state.plan).toBeUndefined()
  })
  it('hires the agent, reads the project in plan mode, posts the plan and keeps it for /goal', async () => {
    const { deps, log, state } = fake(['- find the bug\n- fix it\nGOAL: fix the login crash'])
    await startPlan(deps, { name: 'Debugger', role: 'debugger', task: 'fix the login crash' })
    expect(log.map(l => l[0])).toEqual(['hire', 'working', 'run', 'finish', 'say'])
    expect(log[2].slice(1, 3)).toEqual(['debugger', 'plan'])
    expect(log[3][1]).toBe('plan ready')
    expect(log[4][3]).toMatch(/Say \/goal/)
    expect(state.plan).toMatchObject({ role: 'debugger', goal: 'fix the login crash', service: 'codex' })
    expect(state.busy).toBeUndefined()
  })

  it('/goal runs the plan in write mode on the same agent and then forgets it', async () => {
    const { deps, log, state } = fake(['changed login.ts, tests pass'], {
      plan: { name: 'Debugger', role: 'debugger', task: 't', plan: '- fix it', goal: 'fix login', service: 'codex', at: NOW },
    })
    await handleGoal(deps, '/goal')
    expect(log.find(l => l[0] === 'run').slice(1, 3)).toEqual(['debugger', 'write'])
    expect(log.find(l => l[0] === 'finish')[1]).toContain('execution finished')
    expect(log.at(-1)[3]).toMatch(/Reported result:\nchanged login\.ts/)
    expect(state.plan).toBeUndefined()
  })

  it('/goal <changes> replaces the goal text', async () => {
    const { deps, log } = fake(['ok'], { plan: { name: 'Tester', role: 'test-engineer', task: 't', plan: '- p', goal: 'old goal', at: NOW } })
    await handleGoal(deps, '/goal only touch the login tests')
    expect(log.find(l => l[0] === 'run')[3]).toContain('Goal: only touch the login tests')
  })

  it('says so when there is no plan to approve', async () => {
    const { deps, log } = fake()
    await handleGoal(deps, '/goal')
    expect(log).toEqual([['say', 'Claude', 'assistant', expect.stringMatching(/no plan waiting/)]])
  })

  it('does not start a second job while an agent is busy', async () => {
    const { deps, log } = fake([], { busy: { name: 'Debugger', kind: 'plan', at: NOW } })
    await startPlan(deps, { name: 'Tester', role: 'test-engineer', task: 'x' })
    expect(log.map(l => l[0])).toEqual(['say'])
    expect(log[0][3]).toMatch(/Debugger is still on/)
  })

  it('an agent whose service gave nothing finishes as failed and says sorry', async () => {
    const { deps, log, state } = fake([''])
    await startPlan(deps, { name: 'Debugger', role: 'debugger', task: 'x' })
    expect(log.find(l => l[0] === 'finish')[1]).toMatch(/^failed/)
    expect(log.at(-1)[3]).toMatch(/No agent is working/)
    expect(state.plan).toBeUndefined()
    expect(state.busy).toBeUndefined()
  })
})

describe('conversational replies never claim execution', () => {
  it('replaces the observed invented takeover and completion with actual status', () => {
    for (const text of ["Yes boss, I'll take it: review, PR in English, with attached GIFs.", "I'll open the pull request now.", 'The PR has been opened.', 'Done, boss.']) {
      expect(guardChatReply(text, {}, NOW)).toContain('No agent is working')
    }
    expect(guardChatReply('A pull request lets maintainers review your changes.', {}, NOW)).toBe('A pull request lets maintainers review your changes.')
  })
  it('reports busy, approval and completion separately', () => {
    expect(delegationStatus({ busy: { name: 'Reviewer', kind: 'plan', at: NOW } }, NOW)).toContain('planning')
    expect(delegationStatus({ plan: { goal: 'x' } }, NOW)).toContain('/goal')
    expect(delegationStatus({ lastJob: { status: 'finished' } }, NOW)).toContain('no agent is working now')
  })
})
