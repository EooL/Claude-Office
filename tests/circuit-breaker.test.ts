import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'office-circuits-'))
process.env.AGENT_OFFICE_HOME = home
const a = await import('../server/availability.mjs')
const { runWithBrain } = await import('../server/brains.mjs')
beforeEach(() => a.clearCooldown())
afterAll(() => rmSync(home, { recursive: true, force: true }))
const step = { service: 'agy', model: 'model-a' }
const down = { kind: 'unavailable', retryAfterMs: 1000, message: 'network unavailable' }
const result = { text: 'pong', code: 0, usage: {}, reported: [] }

describe('persistent circuit breakers', () => {
  it('reclaims a half-open probe after its worker has exited', () => {
    a.setCooldown('agy', down, Date.now() - 2000)
    const moduleUrl = new URL('../server/availability.mjs', import.meta.url).href
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {beginCircuit} from ${JSON.stringify(moduleUrl)}; beginCircuit(${JSON.stringify(step)});`], { env: { ...process.env, AGENT_OFFICE_HOME: home }, encoding: 'utf8' })
    expect(child.status, child.stderr).toBe(0)
    const probe = a.beginCircuit(step)
    expect(probe.blocked).toBeUndefined()
    a.finishCircuit(probe, step, null)
  })
  it('skips a failed service on the next request and runs the fallback directly', async () => {
    const calls: string[] = []
    const run = async (service: string) => {
      calls.push(service)
      return service === 'agy' ? { ...result, text: '', error: 'ECONNREFUSED' } : result
    }
    const options = { steps: [step, { service: 'codex', model: '' }], prompt: 'hello', run }
    expect((await runWithBrain(options)).step!.service).toBe('codex')
    expect((await runWithBrain(options)).step!.service).toBe('codex')
    expect(calls).toEqual(['agy', 'codex', 'codex'])
  })

  it('allows only one recovery probe across processes and closes after success', () => {
    a.setCooldown('agy', down, Date.now() - 2000)
    const probe = a.beginCircuit(step)
    expect(probe.blocked).toBeUndefined()
    try {
      const moduleUrl = new URL('../server/availability.mjs', import.meta.url).href
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {beginCircuit} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(beginCircuit(${JSON.stringify(step)})));`], { env: { ...process.env, AGENT_OFFICE_HOME: home }, encoding: 'utf8' })
      expect(child.status, child.stderr).toBe(0)
      expect(JSON.parse(child.stdout).blocked).toMatchObject({ state: 'half-open', kind: 'probing' })
      a.finishCircuit(probe, step, null)
      expect(a.readCooldowns().agy).toBeUndefined()
      expect(JSON.parse(readFileSync(join(home, 'cooldowns.json'), 'utf8')).agy).toMatchObject({ state: 'closed', failures: 0 })
    } finally { probe.release?.() }
  })

  it('reopens a failed probe with bounded exponential backoff and honors explicit retry hints', () => {
    const now = Date.now()
    a.setCooldown('agy', down, now - 2000)
    const probe = a.beginCircuit(step, { now })
    a.finishCircuit(probe, step, down, { now })
    expect(a.readCooldowns(now).agy).toMatchObject({ state: 'open', failures: 2, until: now + 2000 })
    a.setCooldown('agy', { ...down, hinted: true, retryAfterMs: 5000 }, now)
    expect(a.readCooldowns(now).agy.until).toBe(now + 5000)
  })

  it('keeps permission failures per mode and missing models per model', () => {
    const now = Date.now()
    a.setCooldown(a.cooldownKey('agy', step.model, 'permission', 'plan'), { ...down, kind: 'permission' }, now)
    const chat = a.beginCircuit(step, { mode: 'chat', now })
    expect(chat.blocked).toBeUndefined()
    chat.release?.()
    expect(a.beginCircuit(step, { mode: 'plan', now }).blocked?.kind).toBe('permission')
    a.setCooldown(a.cooldownKey('agy', step.model, 'model'), { ...down, kind: 'model' }, now)
    expect(a.beginCircuit(step, { now }).blocked?.kind).toBe('model')
    const other = a.beginCircuit({ ...step, model: 'another' }, { now })
    expect(other.blocked).toBeUndefined()
    other.release?.()
  })

  it('continues to the fallback when an adapter throws', async () => {
    const r = await runWithBrain({ steps: [step, { service: 'codex', model: '' }], prompt: 'hi', run: async service => {
      if (service === 'agy') throw new Error('network unavailable')
      return result
    } })
    expect(r.step!.service).toBe('codex')
    expect(r.attempts).toMatchObject([{ failed: 'unavailable' }])
  })
})
