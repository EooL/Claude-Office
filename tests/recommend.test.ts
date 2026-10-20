import { describe, expect, it } from 'vitest'
import { adapters, parseAgyModels, parseCodexModels, parseOpencodeModels, parseQoderModels } from '../server/adapters.mjs'
import { clampEffort } from '../server/recommend.mjs'
import { PROFILES, listRoles } from '../server/roles.mjs'
import { agentConfig, agentsMap, resolveAgent } from '../server/settings.mjs'

describe('listing models', () => {
  it('reads agy\'s tab-separated list and skips its progress line', () => {
    const out = 'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\n'
    expect(parseAgyModels(out)).toEqual([
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
      { id: 'claude-opus-5-5-low', label: 'Claude Opus 5.5 (Low)' },
    ])
  })

  it('reads qoder\'s one-per-line list without its header', () => {
    expect(parseQoderModels('MODEL\nAuto\nUltimate\n')).toEqual([{ id: 'Auto', label: 'Auto' }, { id: 'Ultimate', label: 'Ultimate' }])
  })

  it('keeps only provider/model lines from opencode', () => {
    expect(parseOpencodeModels('opencode/big-pickle\nnoise\n')).toEqual([{ id: 'opencode/big-pickle', label: 'opencode/big-pickle' }])
  })

  it('takes the models codex lists, best first, with the levels each supports', () => {
    const cache = JSON.stringify({
      models: [
        { slug: 'b', display_name: 'B', visibility: 'list', priority: 2, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
        { slug: 'hidden', visibility: 'hide', priority: 1 },
        { slug: 'a', display_name: 'A', description: 'first', visibility: 'list', priority: 1, supported_reasoning_levels: [] },
      ],
    })
    expect(parseCodexModels(cache)).toEqual([
      { id: 'a', label: 'A', note: 'first', efforts: [] },
      { id: 'b', label: 'B', note: undefined, efforts: ['low', 'high'] },
    ])
  })
})

describe('reasoning levels', () => {
  it('uses the wanted level when the CLI has it, else the closest one below, else its lowest', () => {
    expect(clampEffort('high', ['low', 'medium', 'high'])).toBe('high')
    expect(clampEffort('max', ['low', 'medium', 'high'])).toBe('high')
    expect(clampEffort('low', ['medium', 'high'])).toBe('medium')
    expect(clampEffort('high', [])).toBe('')
    expect(clampEffort('high', undefined)).toBe('')
  })

  it('the CLIs that take a level say which, and agy and opencode do not pretend to', () => {
    for (const name of ['claude', 'codex', 'qoder']) expect(adapters[name].efforts?.length).toBeGreaterThan(0)
    // no model is named in an adapter any more: what a model is comes from the catalogue
    for (const a of Object.values(adapters) as any[]) expect(a.tiers).toBeUndefined()
    expect(adapters.agy.efforts).toBeUndefined()
    expect(adapters.agy.reasoningNote).toBeTruthy()
    expect(adapters.opencode.efforts).toBeUndefined()
  })
})

describe('what each role needs', () => {
  it('every role has a profile: how capable its model should be, how hard it should reason, and why', () => {
    for (const r of listRoles()) {
      expect(PROFILES[r.role], r.role).toBeTruthy()
      expect(['fast', 'balanced', 'strong']).toContain(PROFILES[r.role].tier)
      expect(PROFILES[r.role].why.length).toBeGreaterThan(10)
    }
  })
})

describe('what an agent works with', () => {
  const base = { backend: 'claude', model: 'claude-sonnet-5-5' }

  it('falls back to the office-wide service and model, and takes its own over them', () => {
    expect(agentConfig('debugger', base)).toEqual({ service: 'claude', model: 'claude-sonnet-5-5', effort: '' })
    expect(agentConfig('debugger', { ...base, agents: { debugger: { service: 'codex', effort: 'high' } } })).toEqual({ service: 'codex', model: '', effort: 'high' })
    expect(agentConfig('debugger', { ...base, agents: { debugger: { model: 'claude-opus-5-5' } } })).toEqual({ service: 'claude', model: 'claude-opus-5-5', effort: '' })
  })

  it('still reads the old one-word-per-role form', () => {
    expect(agentConfig('debugger', { ...base, agents: { debugger: 'codex' } }).service).toBe('codex')
    expect(agentsMap({ agents: { debugger: 'codex' } })).toEqual({ debugger: { service: 'codex' } })
  })
})

describe('inheriting from the role above', () => {
  const base = { backend: 'claude', model: 'claude-sonnet-5-5' }
  const architect = { service: 'codex', model: 'gpt-6-astra', effort: 'high' }

  it('an agent without a choice of its own takes its manager\'s service, model and level', () => {
    const settings = { ...base, agents: { 'architect-reviewer': architect } }
    expect(resolveAgent('frontend-developer', settings)).toEqual({ ...architect, from: 'architect-reviewer' })
    expect(agentConfig('database-architect', settings)).toEqual(architect)
  })

  it('the manager itself, and agents that report to the boss, are not touched by it', () => {
    const settings = { ...base, agents: { 'architect-reviewer': architect } }
    expect(resolveAgent('architect-reviewer', settings).from).toBe('architect-reviewer')
    expect(resolveAgent('debugger', settings)).toEqual({ service: 'claude', model: 'claude-sonnet-5-5', effort: '', from: 'office' })
  })

  it('an agent with its own service keeps it, with its own model and level and none of its manager\'s', () => {
    const settings = { ...base, agents: { 'architect-reviewer': architect, 'frontend-developer': { service: 'qoder' } } }
    expect(resolveAgent('frontend-developer', settings)).toEqual({ service: 'qoder', model: '', effort: '', from: 'frontend-developer' })
  })

  it('a model or level set without a service applies on top of what is inherited', () => {
    const settings = { ...base, agents: { 'architect-reviewer': architect, 'frontend-developer': { effort: 'low' } } }
    expect(resolveAgent('frontend-developer', settings)).toEqual({ service: 'codex', model: 'gpt-6-astra', effort: 'low', from: 'architect-reviewer' })
  })
})
