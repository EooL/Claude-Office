import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// The cooldown and settings files live under AGENT_OFFICE_HOME, read when the modules load
const home = mkdtempSync(join(tmpdir(), 'office-brains-'))
process.env.AGENT_OFFICE_HOME = home

const availability = await import('../server/availability.mjs')
const catalogue = await import('../server/catalogue.mjs')
const recommend = await import('../server/recommend.mjs')
const brains = await import('../server/brains.mjs')
const adapters = await import('../server/adapters.mjs')
const settings = await import('../server/settings.mjs')

afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('why a run did not work', () => {
  const fail = (text: string, error = '') => availability.classifyFailure({ code: 1, text, error })

  it('reads a used-up window, no credits, a missing model, a login and a service that is down', () => {
    expect(fail('', 'Claude usage limit reached. Your limit will reset at 3pm')?.kind).toBe('limit')
    expect(fail('', 'Error: 429 Too Many Requests')?.kind).toBe('limit')
    expect(fail('', 'You have hit your weekly limit')?.kind).toBe('limit')
    expect(fail('', 'Your credit balance is too low to access the API')?.kind).toBe('credits')
    expect(fail('', 'insufficient quota: add more credits')?.kind).toBe('credits')
    expect(fail('', '[claude-code:unrecognized_model] {"model":""}')?.kind).toBe('model')
    expect(fail('', "The 'x' model is not supported when using Codex with a ChatGPT account")?.kind).toBe('model')
    expect(fail('', 'Not logged in. Please run codex login')?.kind).toBe('auth')
    expect(fail('', 'overloaded_error (529)')?.kind).toBe('unavailable')
    expect(fail('', 'connect ECONNREFUSED 127.0.0.1:4096')?.kind).toBe('unavailable')
    expect(fail('', 'something odd happened')?.kind).toBe('other')
  })

  it('a run that answered worked, even when the CLI exited non-zero', () => {
    expect(availability.classifyFailure({ code: 0, text: 'pong', error: '' })).toBeNull()
    expect(availability.classifyFailure({ code: 1, text: 'pong', error: 'warning: 429 earlier' })).toBeNull()
  })

  it('an answer that is itself an error report is a failure', () => {
    expect(availability.classifyFailure({ code: 0, text: 'API Error: 429 rate limit exceeded', error: '' })?.kind).toBe('limit')
    expect(availability.classifyFailure({ code: 0, text: '', error: '' })?.kind).toBe('other')
  })

  it('a usage limit that offers to sell more credits is still a limit, and its stated clock time is when it ends', () => {
    const codex = "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 1:48 AM."
    const at = new Date(2026, 9, 21, 1, 29, 0).getTime() // 01:29 local
    const f = availability.classifyFailure({ code: 1, text: '', error: codex }, at)!
    expect(f.kind).toBe('limit')
    expect(f.hinted).toBe(true)
    expect(f.retryAfterMs).toBe(19 * 60_000 + 30_000)
    // a real empty account is still credits
    expect(fail('', 'Your credit balance is too low to access the API')?.kind).toBe('credits')
  })

  it('reads a clock time in 12 or 24 hour form, today when it is still ahead and tomorrow when it has passed', () => {
    const at = new Date(2026, 9, 21, 14, 0, 0).getTime() // 14:00
    expect(availability.parseClockHint('resets at 3pm', at)).toBe(60 * 60_000 + 30_000)
    expect(availability.parseClockHint('try again at 15:30', at)).toBe(90 * 60_000 + 30_000)
    expect(availability.parseClockHint('try again at 1:48 AM', at)).toBe((11 * 60 + 48) * 60_000 + 30_000)
    expect(availability.parseClockHint('retry at 2pm', at)).toBe(30_000) // 14:00:30 is still ahead of 14:00:00
    expect(availability.parseClockHint('retry at 1pm', at)).toBe(23 * 3_600_000 + 30_000) // 13:00:30 has passed: tomorrow
    expect(availability.parseClockHint('resets at 13pm', at)).toBe(0)
    expect(availability.parseClockHint('nothing here', at)).toBe(0)
  })

  it('says which usage window a limit is about, and leaves a weekly one alone longer', () => {
    const weekly = fail('', "You've hit your weekly limit. It resets in 2 days 4 hours.")!
    expect(weekly).toMatchObject({ kind: 'limit', window: 'weekly', hinted: true })
    expect(weekly.retryAfterMs).toBe((2 * 24 + 4) * 3_600_000)
    const five = fail('', 'You have reached your 5-hour limit, try again in 40 minutes')!
    expect(five).toMatchObject({ kind: 'limit', window: '5h' })
    expect(five.retryAfterMs).toBe(40 * 60_000)
    // no stated time: a 5-hour window is retried after half an hour, a weekly one after hours
    expect(fail('', '5-hour limit reached')!.retryAfterMs).toBe(availability.COOLDOWN_MS.limit)
    expect(fail('', 'weekly limit reached')!.retryAfterMs).toBe(availability.COOLDOWN_MS.weekly)
    expect(availability.windowOf('rate limit')).toBe('')
    expect(availability.parseRetryHint('resets in 1 hour, 30 minutes and 15 seconds')).toBe(3_600_000 + 30 * 60_000 + 15_000)
  })

  it('opens the circuit for the window that was hit, and keeps it open until the latest of two full windows ends', () => {
    const now = 1_700_000_000_000
    availability.setCooldown('agy', { kind: 'limit', window: '5h', retryAfterMs: 60 * 60_000, message: '' }, now)
    availability.setCooldown('agy', { kind: 'limit', window: 'weekly', retryAfterMs: 20 * 60_000, message: '' }, now)
    const c = availability.readCooldowns(now + 1000).agy
    expect(c.window).toBe('weekly')
    expect(c.until).toBe(now + 60 * 60_000) // the weekly one is the later: its own time was shorter, the 5-hour one still holds
    expect(availability.blockedReason({ service: 'agy', model: '' }, availability.readCooldowns(now + 1000))?.kind).toBe('limit')
    availability.clearCooldown()
  })

  it('takes the wait from the message when it names one, else a default per kind', () => {
    expect(availability.parseRetryHint('usage limit reached, resets in 3 hours')).toBe(3 * 3_600_000)
    expect(availability.parseRetryHint('please retry after 90 seconds')).toBe(90_000)
    expect(availability.parseRetryHint('try again in 20 minutes')).toBe(20 * 60_000)
    expect(availability.parseRetryHint('nothing useful')).toBe(0)
    expect(fail('', 'rate limit exceeded, retry after 30s')?.retryAfterMs).toBe(30_000)
    expect(fail('', 'usage limit reached')?.retryAfterMs).toBe(availability.COOLDOWN_MS.limit)
  })

  it('remembers a failure until its time is up, per service or (for a model problem) per model', () => {
    const now = 1_700_000_000_000
    availability.setCooldown('codex', { kind: 'limit', retryAfterMs: 60_000, message: 'limit' }, now)
    availability.setCooldown(availability.cooldownKey('qoder', 'Nope', 'model'), { kind: 'model', retryAfterMs: 60_000, message: 'no model' }, now)
    expect(availability.blockedReason({ service: 'codex', model: 'any' }, availability.readCooldowns(now + 1000))?.kind).toBe('limit')
    expect(availability.blockedReason({ service: 'qoder', model: 'Nope' }, availability.readCooldowns(now + 1000))?.kind).toBe('model')
    expect(availability.blockedReason({ service: 'qoder', model: 'Auto' }, availability.readCooldowns(now + 1000))).toBeNull()
    expect(availability.blockedReason({ service: 'codex', model: 'any' }, availability.readCooldowns(now + 61_000))).toBeNull()
    availability.clearCooldown()
  })
})

describe('telling models apart by how they describe themselves', () => {
  const c = (id: string, note = '', label = id, extra = {}) => catalogue.classifyModel({ service: 's', id, label, note, ...extra })

  it('uses the words of the description, not a table of model names', () => {
    expect(c('gpt-9-zeta', 'Frontier intelligence for the most demanding work.').tier).toBe('strong')
    expect(c('gpt-9-eta', 'Fast and affordable model for easier tasks.').tier).toBe('fast')
    expect(c('gpt-9-theta', 'Latest workhorse model for coding and everyday work.').tier).toBe('balanced')
  })

  it('reads the tier words in the id, and a size', () => {
    expect(c('acme-flash-2').tier).toBe('fast')
    expect(c('acme-ultra-2').tier).toBe('strong')
    expect(c('acme-opus-2').tier).toBe('strong')
    expect(c('acme-haiku-2').tier).toBe('fast')
    expect(c('open-120b').tier).toBe('strong')
    expect(c('tiny-7b').tier).toBe('fast')
  })

  it('says so when a name carries no signal', () => {
    const unknown = c('mystery-model')
    expect(unknown.tier).toBe('balanced')
    expect(unknown.confidence).toBeLessThan(0.5)
    expect(c('acme-flash').confidence).toBeGreaterThan(0.5)
  })

  it('reads the version, the family, a level in the id and a note about age or preview', () => {
    expect(catalogue.generationOf('gpt-6.1-sol')).toBe(6.1)
    expect(catalogue.generationOf('claude-opus-5-5')).toBe(5.5)
    expect(catalogue.generationOf('qwen3.8-max')).toBe(3.8)
    expect(catalogue.generationOf('gpt-oss-120b-medium')).toBe(0)
    expect(catalogue.familyOf('gpt-6.1-sol')).toBe(catalogue.familyOf('gpt-5.6-sol'))
    expect(catalogue.familyOf('claude-opus-5-5-high')).toBe(catalogue.familyOf('claude-opus-5-5-low'))
    expect(c('claude-opus-5-5-high').effortInId).toBe('high')
    expect(c('old-1', 'Older generation workhorse model.').deprecated).toBe(true)
    expect(c('new-1-preview').preview).toBe(true)
  })

  it('builds the catalogue from every installed service', async () => {
    const list = async (name: string) => (name === 'codex' ? [{ id: 'gpt-1-pro', label: 'GPT 1 Pro' }] : [{ id: 'other-flash-1', label: 'Other Flash' }])
    const svcs = [{ name: 'codex', available: true }, { name: 'agy', available: true }, { name: 'qoder', available: false }] as any
    const built = await catalogue.buildCatalogue({ list, svcs })
    expect(built.models.map(m => `${m.service}:${m.id}:${m.tier}`)).toEqual(['codex:gpt-1-pro:strong', 'agy:other-flash-1:fast'])
  })
})

describe('recommending from everything that is installed', () => {
  const model = (service: string, id: string, extra: Record<string, unknown> = {}) =>
    catalogue.classifyModel({ service, id, label: id, efforts: ['low', 'medium', 'high'], ...extra })
  const cat = {
    builtAt: 0,
    models: [
      model('codex', 'x-pro-2'), model('codex', 'x-flash-2'),
      model('claude', 'y-opus-3'), model('claude', 'y-haiku-3'),
      model('agy', 'z-ultra-1'),
      model('opencode', 'cloud/big-ultra-9', { billing: 'api' }),
    ],
  }

  it('puts each step on a different service, so one service running out leaves the next usable', () => {
    const steps = recommend.recommendSteps({ tier: 'strong', effort: 'high' }, cat, { max: 3 })
    expect(steps).toHaveLength(3)
    expect(new Set(steps.map(s => s.service)).size).toBe(3)
    expect(steps.every(s => ['x-pro-2', 'y-opus-3', 'z-ultra-1'].includes(s.model))).toBe(true)
    expect(steps.every(s => s.effort === 'high')).toBe(true)
  })

  it('a quick brain gets the fast models', () => {
    const steps = recommend.recommendSteps({ tier: 'fast', effort: 'low' }, cat, { max: 2 })
    expect(steps.map(s => s.model).sort()).toEqual(['x-flash-2', 'y-haiku-3'])
    expect(steps.every(s => s.effort === 'low')).toBe(true)
  })

  it('a pay-per-token model is only used when nothing else fits', () => {
    const steps = recommend.recommendSteps({ tier: 'strong', effort: 'high' }, cat, { max: 6 })
    expect(steps.at(-1)!.model).toBe('cloud/big-ultra-9')
    expect(steps.at(-1)!.why).toMatch(/pays per token/)
  })

  it('takes a model that appears later: a newer version replaces the older one of its line', () => {
    const next = { ...cat, models: [...cat.models, model('codex', 'x-pro-3')] }
    const steps = recommend.recommendSteps({ tier: 'strong', effort: 'high' }, next, { max: 3 })
    expect(steps.find(s => s.service === 'codex')!.model).toBe('x-pro-3')
  })

  it('does not pretend: a model whose tier is a guess says so, and an empty catalogue recommends nothing', () => {
    const guess = { builtAt: 0, models: [model('codex', 'mystery')] }
    expect(recommend.recommendSteps({ tier: 'balanced', effort: 'medium' }, guess)[0].why).toMatch(/a guess/)
    expect(recommend.recommendSteps({ tier: 'strong', effort: 'high' }, { builtAt: 0, models: [] })).toEqual([])
    expect(recommend.recommendSteps({ tier: 'strong', effort: 'high' }, null as any)).toEqual([])
  })

  it('asks for a level the CLI has, the closest below when it does not, and none when the id carries it', () => {
    expect(recommend.clampEffort('max', ['low', 'medium', 'high'])).toBe('high')
    expect(recommend.clampEffort('high', [])).toBe('')
    const withLevel = { builtAt: 0, models: [model('agy', 'z-pro-1-high', { efforts: [] })] }
    expect(recommend.recommendSteps({ tier: 'strong', effort: 'high' }, withLevel)[0].effort).toBe('')
  })
})

describe('brains', () => {
  const cat = {
    builtAt: 0,
    models: [
      catalogue_model('codex', 'p-pro-2'), catalogue_model('claude', 'q-opus-2'), catalogue_model('agy', 'r-flash-2'),
    ],
  }
  function catalogue_model(service: string, id: string) {
    return { service, id, label: id, note: '', efforts: ['low', 'medium', 'high'], billing: 'plan', tier: /pro|opus/.test(id) ? 'strong' : 'fast', strength: /pro|opus/.test(id) ? 68 : 36, gen: 2, family: id.replace(/\d+/g, '#'), deprecated: false, preview: false, effortInId: '', confidence: 0.75 }
  }

  it('three auto brains always exist, and a setting can change one or add another', () => {
    expect(Object.keys(brains.allBrains({}))).toEqual(['deep', 'balanced', 'quick'])
    const all = brains.allBrains({ brains: { deep: { name: 'Thinker' }, mine: { name: 'Mine', steps: [] } } })
    expect(all.deep.name).toBe('Thinker')
    expect(all.deep.auto).toBe(true)
    expect(all.mine.builtin).toBe(false)
  })

  it('an auto brain follows the catalogue, a fixed one keeps the steps it was given', () => {
    expect(brains.brainSteps(brains.allBrains({}).deep, cat).map(s => s.model)).toEqual(['p-pro-2', 'q-opus-2', 'r-flash-2'].filter(m => /pro|opus/.test(m)).concat(['r-flash-2']))
    const fixed = { name: 'F', steps: [{ service: 'agy', model: 'r-flash-2', effort: 'low' }] }
    expect(brains.brainSteps(fixed as any, cat)).toMatchObject([{ service: 'agy', model: 'r-flash-2', effort: 'low' }])
  })

  it('a built-in brain can be changed to a fixed chain and restored to automatic', () => {
    try {
      brains.saveBrain({ id: 'deep', name: 'Fixed thinker', auto: false, steps: [{ service: 'agy', model: 'r-flash-2' }] })
      const fixed = brains.allBrains().deep
      expect(fixed.auto).toBe(false)
      expect(brains.brainSteps(fixed, cat)).toMatchObject([{ service: 'agy', model: 'r-flash-2' }])
      brains.saveBrain({ id: 'deep', name: 'Deep thinker', auto: true, tier: 'strong', effort: 'high' })
      expect(brains.allBrains().deep.auto).toBe(true)
    } finally {
      brains.deleteBrain('deep')
    }
  })

  it('an agent without a brain inherits the one of the agent above it; the boss\'s direct reports fall back to the office service', () => {
    const s = { backend: 'codex', agents: { 'architect-reviewer': { brain: 'deep' } } }
    expect(brains.brainIdFor('frontend-developer', s)).toEqual({ id: 'deep', from: 'architect-reviewer' })
    expect(brains.brainIdFor('debugger', s)).toBeNull()
    expect(brains.resolveSteps('debugger', s, cat as any)[0]).toMatchObject({ service: 'codex' })
    expect(brains.resolveSteps('frontend-developer', s, cat as any).map(x => x.service)).toEqual(['codex', 'claude', 'agy'])
  })

  it('a brain with no step on an installed service falls back to the office service', () => {
    const s = { backend: 'claude', brains: { solo: { name: 'Solo', steps: [{ service: 'qoder', model: 'Auto' }] } }, agents: { debugger: { brain: 'solo' } } }
    expect(brains.resolveSteps('debugger', s, cat as any)[0].service).toBe('claude')
  })

  it('recommends the built-in brain that fits a role\'s work, with the reason', () => {
    expect(brains.recommendedBrain('debugger').id).toBe('deep')
    expect(brains.recommendedBrain('test-engineer').id).toBe('balanced')
    expect(brains.recommendedBrain('assistant').id).toBe('quick')
    expect(brains.recommendedBrain('made-up').id).toBe('balanced')
  })

  it('saves, links and deletes brains', () => {
    const made = brains.saveBrain({ name: 'My Chain', steps: [{ service: 'codex', model: 'm1' }, { service: 'agy', model: 'm2', effort: 'low' }] })
    expect(made.id).toBe('my-chain')
    expect(brains.saveBrain({ name: 'My Chain', steps: [] }).id).toBe('my-chain-2')
    expect(brains.allBrains(settings.readSettings())['my-chain'].steps).toHaveLength(2)

    brains.setAgentBrain('debugger', 'my-chain')
    expect(settings.readSettings().agents.debugger).toEqual({ brain: 'my-chain' })
    brains.deleteBrain('my-chain')
    expect(settings.readSettings().agents?.debugger).toBeUndefined()
    expect(settings.readSettings().brains['my-chain']).toBeUndefined()

    brains.saveBrain({ id: 'deep', name: 'Deep thinker', auto: true, tier: 'strong', effort: 'xhigh' })
    expect(brains.allBrains(settings.readSettings()).deep.effort).toBe('xhigh')
    brains.deleteBrain('deep')
    expect(brains.allBrains(settings.readSettings()).deep.effort).toBe('high')
  })
})

describe('running a chain', () => {
  const steps = [
    { service: 'codex', model: 'a', effort: 'high', label: 'Codex A' },
    { service: 'claude', model: 'b', effort: 'low', label: 'Claude B' },
    { service: 'agy', model: 'c', effort: '', label: 'Agy C' },
  ]
  const ok = (text: string) => ({ text, error: '', code: 0, usage: {}, reported: [], model: '', durationMs: 1 })
  const bad = (error: string) => ({ text: '', error, code: 1, usage: {}, reported: [], model: '', durationMs: 1 })

  /** A run that answers from a table of service -> result, and records what it was asked to run. */
  function harness(results: Record<string, ReturnType<typeof ok>>) {
    const calls: string[] = []
    const failures: string[] = []
    return {
      calls, failures,
      args: {
        steps,
        prompt: 'hi',
        run: async (service: string, _p: string, o: any) => { calls.push(`${service}/${o.model}/${o.effort}`); return results[service] },
        blocked: async () => null,
        fail: (step: any, f: any) => { failures.push(`${step.service}:${f.kind}`) },
      },
    }
  }

  it('uses the first step when it works, with the model and level of that step', async () => {
    const h = harness({ codex: ok('done') })
    const r = await brains.runWithBrain(h.args)
    expect(r.text).toBe('done')
    expect(r.step!.service).toBe('codex')
    expect(h.calls).toEqual(['codex/a/high'])
    expect(r.attempts).toEqual([])
  })

  it('moves on to the next step when one is used up, remembering why', async () => {
    const h = harness({ codex: bad('Claude usage limit reached, resets in 2 hours'), claude: ok('from claude') })
    const r = await brains.runWithBrain(h.args)
    expect(r.text).toBe('from claude')
    expect(r.step!.service).toBe('claude')
    expect(h.failures).toEqual(['codex:limit'])
    expect(r.attempts).toMatchObject([{ failed: 'limit' }])
  })

  it('skips a step that is blocked without running it', async () => {
    const h = harness({ claude: ok('b'), agy: ok('c') })
    h.args.blocked = async (s: any) => (s.service === 'codex' ? { kind: 'credits', until: 1, message: '' } : null)
    const r = await brains.runWithBrain(h.args)
    expect(h.calls).toEqual(['claude/b/low'])
    expect(r.attempts).toMatchObject([{ skipped: 'credits' }])
  })

  it('goes through the whole chain, and says so when none works', async () => {
    const h = harness({ codex: bad('429'), claude: bad('overloaded 529'), agy: bad('Not logged in') })
    const r = await brains.runWithBrain(h.args)
    expect(r.text).toBe('')
    expect(r.exhausted).toBe(true)
    expect(h.failures).toEqual(['codex:limit', 'claude:unavailable', 'agy:auth'])
  })

  it('with every step blocked it does not run anything', async () => {
    const h = harness({})
    h.args.blocked = async () => ({ kind: 'limit', until: 1, message: '' })
    const r = await brains.runWithBrain(h.args)
    expect(h.calls).toEqual([])
    expect(r.exhausted).toBe(true)
  })

  it('the agent says it once when its brain moves to another step, and when it is back', () => {
    const attempts = [{ step: steps[0], failed: 'limit' }]
    expect(brains.switchNotice(steps, steps[1], 'codex/a', attempts)).toBe('Heads-up boss: Codex A hit its usage limit, so I am on Claude B for now.')
    expect(brains.switchNotice(steps, steps[1], 'claude/b', attempts)).toBeNull()
    expect(brains.switchNotice(steps, steps[0], 'claude/b', [])).toBe('Back on Codex A.')
    expect(brains.switchNotice(steps, steps[0], '', [])).toBeNull()
  })

  it('Claude: either window being full opens the circuit, and with both full it waits for the later one', () => {
    const now = 1_700_000_000_000
    const sec = (ms: number) => Math.floor((now + ms) / 1000)
    const status = (rl: Record<string, number>) => ({ sessions: [{ rateLimits: rl }] })
    expect(brains.claudeWindowBlock(status({ fiveHour: 100, fiveHourResetsAt: sec(3_600_000) }), now)).toMatchObject({ kind: 'limit', window: '5h', until: sec(3_600_000) * 1000 })
    expect(brains.claudeWindowBlock(status({ fiveHour: 40, fiveHourResetsAt: sec(3_600_000), sevenDay: 100, sevenDayResetsAt: sec(3 * 86_400_000) }), now)).toMatchObject({ window: 'weekly', until: sec(3 * 86_400_000) * 1000 })
    const both = brains.claudeWindowBlock(status({ fiveHour: 100, fiveHourResetsAt: sec(3_600_000), sevenDay: 100, sevenDayResetsAt: sec(3 * 86_400_000) }), now)!
    expect(both.window).toBe('weekly')
    expect(both.until).toBe(sec(3 * 86_400_000) * 1000)
    expect(both.message).toMatch(/5-hour window and weekly window are used up/)
    expect(brains.claudeWindowBlock(status({ fiveHour: 99, fiveHourResetsAt: sec(3_600_000), sevenDay: 50, sevenDayResetsAt: sec(86_400_000) }), now)).toBeNull()
  })

  it('Claude\'s own windows, from the status line, block it until they reset', () => {
    const now = 1_700_000_000_000
    const status = (fiveHour: number, resets: number) => ({ sessions: [{ rateLimits: { fiveHour, fiveHourResetsAt: resets } }] })
    expect(brains.claudeWindowBlock(status(100, now / 1000 + 600), now)).toMatchObject({ kind: 'limit', until: now + 600_000 })
    expect(brains.claudeWindowBlock(status(80, now / 1000 + 600), now)).toBeNull()
    expect(brains.claudeWindowBlock(status(100, now / 1000 - 5), now)).toBeNull()
    expect(brains.claudeWindowBlock(null, now)).toBeNull()
  })
})

describe('what a CLI lists', () => {
  it('keeps only the opencode models it has access to, and marks the ones that cost per token', () => {
    const models = ['opencode/big-pickle', 'openai/gpt-x', 'nvidia/some', 'ollama/local'].map(id => ({ id, label: id }))
    const out = adapters.filterOpencodeModels(models, ['openai'])
    expect(out.map(m => `${m.id}:${m.billing}`)).toEqual(['opencode/big-pickle:free', 'openai/gpt-x:api', 'ollama/local:free'])
    expect(adapters.parseOpencodeProviders('┌  Credentials\n●  Anthropic api\n●  OpenAI api\n└  2 credentials')).toEqual(['anthropic', 'openai'])
  })
})

describe('which services the office may use', () => {
  const cat = {
    builtAt: 0,
    models: ['codex', 'claude', 'agy'].map(service => ({ service, id: `${service}-pro-1`, label: service, note: '', efforts: ['low', 'high'], billing: 'plan', tier: 'strong', strength: 68, gen: 1, family: `${service}-pro-#`, deprecated: false, preview: false, effortInId: '', confidence: 0.9 })),
  }

  it('a settings file without the list allows every installed service; a list allows only the ones in it', () => {
    expect(settings.isEnabled('codex', {})).toBe(true)
    expect(settings.isEnabled('codex', { enabledServices: ['claude'] })).toBe(false)
    expect(settings.isEnabled('claude', { enabledServices: ['claude'] })).toBe(true)
  })

  it('turning one off starts from the installed services of an old settings file, and writes the list', () => {
    expect(settings.setServiceEnabled('agy', false, ['claude', 'codex', 'agy'])).toEqual(['claude', 'codex'])
    expect(settings.isEnabled('agy')).toBe(false)
    expect(settings.setServiceEnabled('agy', true)).toEqual(['claude', 'codex', 'agy'])
  })

  it('the catalogue is built only from services that are installed and enabled', async () => {
    const list = async (name: string) => [{ id: `${name}-pro-1`, label: name }]
    const svcs = [{ name: 'codex', available: true, enabled: true }, { name: 'agy', available: true, enabled: false }, { name: 'claude', available: false, enabled: true }] as any
    expect((await catalogue.buildCatalogue({ list, svcs })).models.map(m => m.service)).toEqual(['codex'])
  })

  it('a brain has no steps on a service that is not enabled', () => {
    const s = { backend: 'claude', enabledServices: ['claude', 'codex'], chatBrain: 'deep' }
    expect(brains.operationSteps('chat', s, cat as any).map(x => x.service).sort()).toEqual(['claude', 'codex'])
  })

  it('with the default service not enabled the first enabled one is used, and with none enabled there is nothing to run on', () => {
    expect(brains.operationSteps('chat', { backend: 'agy', enabledServices: ['codex'] }, cat as any)[0].service).toBe('codex')
    expect(brains.operationSteps('chat', { backend: 'agy', enabledServices: [] }, cat as any)).toEqual([])
    expect(brains.resolveSteps('debugger', { backend: 'agy', enabledServices: [] }, cat as any)).toEqual([])
  })

  it('an agent whose own service is not enabled falls back instead of using it', () => {
    const s = { backend: 'claude', enabledServices: ['claude'], agents: { debugger: { service: 'codex' } } }
    expect(brains.resolveSteps('debugger', s, cat as any)[0].service).toBe('claude')
  })

  it('the orchestrator and the chat can have different brains, and agents without one use the orchestrator\'s', () => {
    const s = { backend: 'claude', chatBrain: 'quick', orchestratorBrain: 'deep' }
    expect(brains.operationSteps('chat', s, cat as any)).not.toEqual(brains.operationSteps('orchestrator', s, cat as any)) // same models here, different efforts
    expect(brains.resolveSteps('debugger', s, cat as any)).toEqual(brains.operationSteps('orchestrator', s, cat as any))
    brains.setOperationBrain('chat', 'quick')
    expect(settings.readSettings().chatBrain).toBe('quick')
    brains.setOperationBrain('chat', null)
    expect(settings.readSettings().chatBrain).toBeUndefined()
  })
})

describe('choices made before there were brains', () => {
  it('become a brain each, linked to the agent, once', () => {
    settings.writeSettings({ agents: { debugger: { service: 'codex', model: 'm', effort: 'high' }, 'code-reviewer': 'agy', tester: { brain: 'deep' } } })
    expect(brains.migrateLegacyAgents().sort()).toEqual(['code-reviewer', 'debugger'])
    const now = settings.readSettings()
    const all = brains.allBrains(now)
    expect(all[now.agents.debugger.brain]).toMatchObject({ name: 'Debugger brain', steps: [{ service: 'codex', model: 'm', effort: 'high' }] })
    expect(all[now.agents['code-reviewer'].brain].steps).toMatchObject([{ service: 'agy' }])
    expect(now.agents.tester).toEqual({ brain: 'deep' })
    expect(brains.migrateLegacyAgents()).toEqual([])
  })
})

describe('setting brains for every agent that has none', () => {
  it('names the agents with no brain of their own and none inherited', () => {
    const s = { agents: { 'architect-reviewer': { brain: 'deep' } } }
    const none = brains.unconfiguredAgents(s)
    expect(none).not.toContain('architect-reviewer')
    // the ones under Architect inherit its brain
    for (const role of ['frontend-developer', 'database-architect', 'ai-engineer']) expect(none).not.toContain(role)
    expect(none).toContain('debugger')
    expect(none).toContain('assistant')
  })

  it('gives each the brain that suits its work and leaves the configured ones alone', () => {
    settings.writeSettings({ agents: { 'architect-reviewer': { brain: 'quick' } } })
    const assigned = brains.autoAssignBrains()
    expect(assigned.debugger).toBe('deep')
    expect(assigned['test-engineer']).toBe('balanced')
    expect(assigned.assistant).toBe('quick')
    expect(assigned['architect-reviewer']).toBeUndefined()
    expect(assigned['frontend-developer']).toBeUndefined()
    const now = settings.readSettings().agents
    expect(now['architect-reviewer']).toEqual({ brain: 'quick' })
    expect(now.debugger).toEqual({ brain: 'deep' })
    expect(brains.unconfiguredAgents()).toEqual([])
    expect(brains.autoAssignBrains()).toEqual({})
  })
})

describe('launching a CLI', () => {
  // the backslash of a Windows path, built so this file holds none
  const BS = String.fromCharCode(92)
  const win = (...parts: string[]) => parts.join(BS)

  it('a timeout closes descendants that keep the output pipe open', async () => {
    const { writeFileSync, readFileSync } = await import('node:fs')
    const script = join(home, 'slow-tree.mjs')
    const pidFile = join(home, 'slow-child.pid')
    writeFileSync(script, `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); writeFileSync(${JSON.stringify(pidFile)},String(c.pid)); setInterval(()=>{},1000);`)
    process.env.AGENT_OFFICE_BIN_AGY = `"${process.execPath}" "${script}"`
    try {
      const started = Date.now()
      const result = await adapters.runAdapter('agy', 'hi', { timeoutMs: 1000 })
      expect(Date.now() - started).toBeLessThan(8000)
      expect(result.error).toContain('timed out')
      const pid = Number(readFileSync(pidFile, 'utf8'))
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      delete process.env.AGENT_OFFICE_BIN_AGY
    }
  }, 12_000)

  it('does not query a disabled service, even when it has a cached model list', async () => {
    const saved = settings.readSettings()
    const original = adapters.adapters.claude.models
    let calls = 0
    adapters.adapters.claude.models = async () => { calls++; return [{ id: 'fake', label: 'Fake' }] }
    try {
      settings.writeSettings({ enabledServices: ['claude'] })
      expect(await adapters.listModels('claude')).toEqual([{ id: 'fake', label: 'Fake' }])
      settings.writeSettings({ enabledServices: [] })
      expect(await adapters.listModels('claude')).toEqual([])
      expect(calls).toBe(1)
    } finally {
      adapters.adapters.claude.models = original
      settings.writeSettings({ enabledServices: saved.enabledServices })
    }
  })

  it('the brain CLI returns an empty selection when no service is enabled', async () => {
    const { spawnSync } = await import('node:child_process')
    const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs')
    const dir = mkdtempSync(join(tmpdir(), 'office-no-service-'))
    try {
      writeFileSync(join(dir, 'backend.json'), JSON.stringify({ enabledServices: [] }))
      const result = spawnSync(process.execPath, ['server/brains.mjs', 'chat'], { env: { ...process.env, AGENT_OFFICE_HOME: dir }, encoding: 'utf8' })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads what an npm shim forwards to, and nothing else', () => {
    const exeShim = `"%dp0%${BS}node_modules${BS}opencode-ai${BS}bin${BS}opencode.exe"   %*`
    expect(adapters.shimTarget(exeShim, 'C:/npm')).toEqual({ exe: join('C:/npm', win('node_modules', 'opencode-ai', 'bin', 'opencode.exe')) })
    const nodeShim = `"%_prog%"  "%dp0%${BS}node_modules${BS}pkg${BS}bin${BS}cli.js" %*`
    expect(adapters.shimTarget(nodeShim, 'C:/npm')).toEqual({ script: join('C:/npm', win('node_modules', 'pkg', 'bin', 'cli.js')) })
    expect(adapters.shimTarget('@echo off\nsomething-else %*', 'C:/npm')).toBeNull()
  })

  it('splits a command line on spaces, keeping a quoted path together', () => {
    expect(adapters.splitCommand('node script.js --x')).toEqual(['node', 'script.js', '--x'])
    expect(adapters.splitCommand('"C:/Program Files/nodejs/node.exe" "my script.js" a')).toEqual(['C:/Program Files/nodejs/node.exe', 'my script.js', 'a'])
  })

  it('AGENT_OFFICE_BIN_<SERVICE> replaces the CLI, counts as installed, and gets the prompt as plain data', async () => {
    const script = join(home, 'fake-cli.mjs')
    const { writeFileSync } = await import('node:fs')
    // answers with the argument list and the prompt it read on stdin, in the JSON the claude adapter reads
    writeFileSync(script, "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify({type:'result',is_error:false,result:JSON.stringify({args:process.argv.slice(2),prompt:s})})))")
    process.env.AGENT_OFFICE_BIN_CLAUDE = `"${process.execPath.replaceAll(BS, '/')}" "${script.replaceAll(BS, '/')}"`
    try {
      expect(adapters.services().find(s => s.name === 'claude')!.available).toBe(true)
      const evil = 'hi" & echo INJECTED & "'
      const r = await adapters.runAdapter('claude', evil, { model: 'm1', mode: 'chat' })
      const seen = JSON.parse(r.text)
      expect(seen.prompt).toBe(evil)
      expect(seen.args).toEqual(expect.arrayContaining(['-p', '--model', 'm1', '--safe-mode']))
      expect(seen.args).not.toContain(evil)
    } finally {
      delete process.env.AGENT_OFFICE_BIN_CLAUDE
    }
  })

  it('a service whose CLI cannot be started answers with the reason instead of throwing', async () => {
    process.env.AGENT_OFFICE_BIN_AGY = 'this-binary-does-not-exist-anywhere'
    try {
      const r = await adapters.runAdapter('agy', 'hi', { timeoutMs: 5000 })
      expect(r.text).toBe('')
      expect(r.code).not.toBe(0)
      expect(availability.classifyFailure(r)).not.toBeNull()
    } finally {
      delete process.env.AGENT_OFFICE_BIN_AGY
    }
  })
})

describe('the small state files', () => {
  it('are written whole or not at all, privately, and a damaged one reads as the fallback', async () => {
    const { readJson, writeJson } = await import('../server/jsonfile.mjs')
    const { readdirSync, writeFileSync, statSync } = await import('node:fs')
    const file = join(home, 'state-test.json')
    expect(readJson(file, { none: true })).toEqual({ none: true })
    expect(writeJson(file, { a: 1 })).toBe(true)
    expect(readJson(file, null)).toEqual({ a: 1 })
    expect(readdirSync(home).filter(f => f.startsWith('state-test.json') && f.endsWith('.tmp'))).toEqual([])
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    writeFileSync(file, '{"a": ')
    expect(readJson(file, 'fallback')).toBe('fallback')
    expect(writeJson(join(home, 'no', 'such', 'dir', 'x.json'), { b: 2 })).toBe(true) // parent made on demand
  })
})

describe('deleting a brain', () => {
  it('putting a built-in brain back to its default keeps everything that uses it', () => {
    brains.saveBrain({ id: 'deep', name: 'Mine', auto: true, tier: 'strong', effort: 'low' })
    settings.writeSettings({ agents: { debugger: { brain: 'deep' } }, chatBrain: 'deep', orchestratorBrain: 'deep' })
    brains.deleteBrain('deep')
    const now = settings.readSettings()
    expect(brains.allBrains(now).deep.name).toBe('Deep thinker')
    expect(now.agents.debugger).toEqual({ brain: 'deep' })
    expect(now.chatBrain).toBe('deep')
    expect(now.orchestratorBrain).toBe('deep')
  })

  it('removing a brain you made unlinks the agents and the operations that used it', () => {
    const { id } = brains.saveBrain({ name: 'Temp', steps: [{ service: 'codex', model: 'm' }] })
    settings.writeSettings({ agents: { debugger: { brain: id }, tester: { brain: 'deep' } }, chatBrain: id, orchestratorBrain: 'quick' })
    brains.deleteBrain(id)
    const now = settings.readSettings()
    expect(now.agents.debugger).toBeUndefined()
    expect(now.agents.tester).toEqual({ brain: 'deep' })
    expect(now.chatBrain).toBeUndefined()
    expect(now.orchestratorBrain).toBe('quick')
  })
})

describe('full tool access', () => {
  const run = async (mode: string) => {
    // the CLI is replaced by a script that answers with the arguments it was started with
    const { writeFileSync } = await import('node:fs')
    const script = join(home, 'echo-args.mjs')
    writeFileSync(script, "console.log(JSON.stringify({status:'SUCCESS',response:JSON.stringify(process.argv.slice(2))}))")
    process.env.AGENT_OFFICE_BIN_AGY = `"${process.execPath.replaceAll(String.fromCharCode(92), '/')}" "${script.replaceAll(String.fromCharCode(92), '/')}"`
    try {
      return JSON.parse((await adapters.runAdapter('agy', 'hi', { mode: mode as any, timeoutMs: 20000 })).text) as string[]
    } finally { delete process.env.AGENT_OFFICE_BIN_AGY }
  }

  it('is off by default: an approved plan gets no permission-skipping flag', async () => {
    settings.writeSettings({ fullAccess: undefined })
    expect(await run('write')).not.toContain('--dangerously-skip-permissions')
  })

  it('switched on for the service it is given only to an approved plan, never to chat or planning', async () => {
    settings.setFullAccess('agy', true)
    try {
      expect(await run('write')).toContain('--dangerously-skip-permissions')
      expect(await run('plan')).not.toContain('--dangerously-skip-permissions')
      expect(await run('chat')).not.toContain('--dangerously-skip-permissions')
    } finally { settings.setFullAccess('agy', false) }
    expect(settings.hasFullAccess('agy')).toBe(false)
  })

  it('only a service that has such a mode says so', () => {
    const list = adapters.services()
    expect(list.filter(s => s.fullAccessSupported).map(s => s.name)).toEqual(['agy'])
  })
})
