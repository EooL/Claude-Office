import { describe, expect, it } from 'vitest'
import { buildBuildingSummary } from '../server/building-summary.mjs'

describe('buildBuildingSummary', () => {
  const baseOffice = { id: 'off_abc123', home: '/home/abc', cwd: '/cwd/abc' }
  const makeLive = (id: string, hasState = true) =>
    hasState ? { id, state: { activeAgents: new Map(), sessions: new Map() } } : { id, state: null }

  it('orders levels by input office array and assigns L1/L2 numbering', () => {
    const offices = [{ id: 'a', home: '/h/a', cwd: '/c/a' }, { id: 'b', home: '/h/b', cwd: '/c/b' }]
    const live = [makeLive('b')]
    const cooldowns = {}
    const result = buildBuildingSummary({ offices, live, cooldowns })
    expect(result.levels[0].level).toBe('L1')
    expect(result.levels[1].level).toBe('L2')
    expect(result.levels[0].id).toBe('a')
    expect(result.levels[1].id).toBe('b')
  })

  it('uses label for name when valid: non-empty trimmed string up to 60 chars after control removal', () => {
    const office = { id: 'x', home: '/h/x', cwd: '/c/x', label: '   My Label  ' }
    const result = buildBuildingSummary({ offices: [office], live: [], cooldowns: {} })
    expect(result.levels[0].name).toBe('My Label')
  })

  it('falls back to id when label is empty string', () => {
    const office = { id: 'empty-label', home: '/h/e', cwd: '/c/e', label: '' }
    const result = buildBuildingSummary({ offices: [office], live: [], cooldowns: {} })
    expect(result.levels[0].name).toBe('empty-label')
  })

  it('falls back to id when label exceeds 60 characters', () => {
    const longLabel = 'a'.repeat(61)
    const office = { id: 'long-label', home: '/h/l', cwd: '/c/l', label: longLabel }
    const result = buildBuildingSummary({ offices: [office], live: [], cooldowns: {} })
    expect(result.levels[0].name).toBe('long-label')
  })

  it('strips control characters then validates label length', () => {
    const office = { id: 'ctrl-label', home: '/h/c', cwd: '/c/c', label: 'Line1\x00Line2\nLine3' }
    const result = buildBuildingSummary({ offices: [office], live: [], cooldowns: {} })
    expect(result.levels[0].name).toBe('Line1Line2Line3')
  })

  it('marks as attached when id exists in live array, else unattached', () => {
    const offices = [{ id: 'on', home: '/h/on', cwd: '/c/on' }, { id: 'off', home: '/h/off', cwd: '/c/off' }]
    const live = [makeLive('on'), makeLive('other')]
    const result = buildBuildingSummary({ offices, live, cooldowns: {} })
    expect(result.levels.find(l => l.id === 'on')?.status).toBe('attached')
    expect(result.levels.find(l => l.id === 'off')?.status).toBe('unattached')
  })

  it('sets activeAgents count from state.activeAgents Map size', () => {
    const map = new Map([['a1', {}], ['a2', {}], ['a3', {}]])
    const office = { id: 'm', home: '/h/m', cwd: '/c/m' }
    const live = [{ id: 'm', state: { activeAgents: map, sessions: new Map() } }]
    const result = buildBuildingSummary({ offices: [office], live, cooldowns: {} })
    expect(result.levels[0].activeAgents).toBe(3)
  })

  it('extracts lastEvent with only kind and at fields', () => {
    const office = { id: 'e', home: '/h/e', cwd: '/c/e' }
    const live = [{ id: 'e', state: { lastEvent: { kind: 'task-started', at: 1234567890, extra: 'ignored' } } }]
    const result = buildBuildingSummary({ offices: [office], live, cooldowns: {} })
    expect(result.levels[0].lastEvent).toEqual({ kind: 'task-started', at: 1234567890 })
  })

  it('drops expired cooldowns (until <= now)', () => {
    const now = 1000
    const cooldowns = { svc: { kind: 'limit', until: now - 100 }, svc2: { kind: 'credits', until: now + 100 } }
    const result = buildBuildingSummary({ offices: [], live: [], cooldowns, now })
    expect(result.g0.cooldowns.length).toBe(1)
    expect(result.g0.cooldowns[0].service).toBe('svc2')
  })

  it('keeps only four fields from cooldowns and sorts by until ascending', () => {
    const now = 1000
    const cooldowns = {
      'service@mode': { kind: 'limit', until: now + 200, message: 'hidden', retries: 5 },
      'service/model': { kind: 'credits', until: now + 100, extraField: 'also hidden' },
    }
    const result = buildBuildingSummary({ offices: [], live: [], cooldowns, now })
    // Only service and model are parsed before '@' or '/'
    expect(result.g0.cooldowns[0]).toEqual({ service: 'service', model: 'model', kind: 'credits', until: now + 100 })
    expect(result.g0.cooldowns[1]).toEqual({ service: 'service', model: null, kind: 'limit', until: now + 200 })
    // Ensure no extra fields leaked
    expect(result.g0.cooldowns[0]).not.toHaveProperty('message')
    expect(result.g0.cooldowns[0]).not.toHaveProperty('retries')
  })

  it('produces clean JSON without hostiles: offices with tokens/prompts and cooldowns with messages stay excluded', () => {
    const hostileOffice = {
      id: 'hostile',
      home: '/h/h',
      cwd: '/c/h',
      token: 'secret-token',
      prompt: 'malicious prompt content',
    }
    const now = 1000
    const hostileCooldowns = {
      svc: { kind: 'limit', until: now + 100, message: 'forbidden error text', details: { command: 'rm -rf /' } },
    }
    const result = buildBuildingSummary({ offices: [hostileOffice], live: [], cooldowns: hostileCooldowns, now })
    const json = JSON.stringify(result)
    expect(json).not.toContain('secret-token')
    expect(json).not.toContain('malicious prompt content')
    expect(json).not.toContain('forbidden error text')
    expect(json).not.toContain('rm -rf')
    expect(json).not.toContain('secret')
  })

  it('does not mutate inputs: deep-freeze them first', () => {
    const offices: any[] = [{ id: 'frozen', home: '/h/f', cwd: '/c/f', label: '  frozen  ' }]
    const live = [makeLive('frozen')]
    const cooldowns = { svc: { kind: 'limit', until: Date.now() + 1000 } }
    Object.freeze(offices)
    Object.freeze(cooldowns)
    if (live[0].state) Object.freeze(live[0].state)

    const result = buildBuildingSummary({ offices, live, cooldowns })
    expect(result.levels[0].name).toBe('frozen')
  })

  it('isolates identical office ids across separate calls: one does not affect the other', () => {
    const sameId = { id: 'dup', home: '/h/dup1', cwd: '/c/dup1' }
    const officesA = [sameId]
    const officesB = [sameId]
    const liveA = [makeLive('dup')]
    const liveB = []
    const cooldowns = {}
    const resultA = buildBuildingSummary({ offices: officesA, live: liveA, cooldowns })
    const resultB = buildBuildingSummary({ offices: officesB, live: liveB, cooldowns })
    expect(resultA.levels[0].status).toBe('attached')
    expect(resultB.levels[0].status).toBe('unattached')
  })
})
