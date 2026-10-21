import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'office-circuits-'))
process.env.AGENT_OFFICE_HOME = home
const a = await import('../server/availability.mjs')
const { resolveSteps, runWithBrain } = await import('../server/brains.mjs')
beforeEach(() => a.clearCooldown())
afterAll(() => rmSync(home, { recursive: true, force: true }))
const step = { service: 'agy', model: 'model-a' }
const down = { kind: 'unavailable', retryAfterMs: 1000, message: 'network unavailable' }
const result = { text: 'pong', code: 0, usage: {}, reported: [] }

describe('persistent circuit breakers', () => {
  it('opens on a real CLI limit, skips it for the next role, and recovers through a half-open probe', async () => {
    const { runAdapter } = await import('../server/adapters.mjs')
    const { startPlan } = await import('../server/delegation.mjs')
    const cli = join(home, 'limit-cli.mjs')
    const callsFile = join(home, 'limit-calls.jsonl')
    const readyFile = join(home, 'limit-recovered')
    writeFileSync(join(home, 'backend.json'), JSON.stringify({
      enabledServices: ['agy', 'codex'],
      agents: Object.fromEntries(['code-reviewer', 'debugger', 'frontend-developer'].map(role => [role, { brain: 'limit-fixture' }])),
      brains: { 'limit-fixture': { name: 'Limit fixture', steps: [{ service: 'agy' }, { service: 'codex' }, { service: 'claude' }] } },
    }))
    writeFileSync(cli, `
      import {appendFileSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
      const args=process.argv.slice(2), agy=args[0]==='-p';
      let circuits={};try{circuits=JSON.parse(readFileSync(${JSON.stringify(join(home, 'cooldowns.json'))},'utf8'))}catch{}
      appendFileSync(${JSON.stringify(callsFile)},JSON.stringify({service:agy?'agy':'codex',state:circuits.agy?.state})+'\\n');
      if(agy&&!existsSync(${JSON.stringify(readyFile)})){
        console.log(JSON.stringify({status:'ERROR',error:'Usage limit reached; retry after 3 seconds'}));process.exit(1)
      }
      const text='- Read the fixture\\nGOAL: check the fixture';
      if(agy)console.log(JSON.stringify({status:'SUCCESS',response:text}));
      else {for await(const chunk of process.stdin){};writeFileSync(args[args.indexOf('-o')+1],text);console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}))}
    `)
    const saved = Object.fromEntries(['AGY', 'CODEX'].map(s => [s, process.env[`AGENT_OFFICE_BIN_${s}`]]))
    const command = `"${process.execPath}" "${cli}"`
    process.env.AGENT_OFFICE_BIN_AGY = command
    process.env.AGENT_OFFICE_BIN_CODEX = command
    let state: any = {}
    const deps = {
      now: Date.now, pid: process.pid, cwd: home, read: () => state,
      write: (patch: any) => { state = { ...state, ...patch } },
      agent: () => ({ service: 'agy' }),
      run: (role: string, prompt: string, opts: any) => runWithBrain({
        steps: resolveSteps(role), prompt,
        opts: { ...opts, timeoutMs: 3000 }, run: runAdapter,
      }),
      say: async () => {}, hire: async () => {}, working: async () => {}, finish: async () => {},
    }
    const calls = () => readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse)
    try {
      expect(resolveSteps('debugger').map(s => s.service)).toEqual(['agy', 'codex'])
      await startPlan(deps, { name: 'Reviewer', role: 'code-reviewer', task: 'check fixture' })
      expect(state.plan.service).toBe('codex')
      const opened = a.readCooldowns().agy
      expect(opened).toMatchObject({ state: 'open', kind: 'limit', failures: 1 })
      await startPlan(deps, { name: 'Debugger', role: 'debugger', task: 'check fixture' })
      expect(state.plan.service).toBe('codex')
      expect(calls().map(c => c.service)).toEqual(['agy', 'codex', 'codex'])
      writeFileSync(readyFile, '')
      await new Promise(resolve => setTimeout(resolve, Math.max(0, opened.until - Date.now()) + 20))
      await startPlan(deps, { name: 'Frontend', role: 'frontend-developer', task: 'check fixture' })
      expect(state.plan.service).toBe('agy')
      expect(calls().at(-1)).toMatchObject({ service: 'agy', state: 'half-open' })
      const closed = JSON.parse(readFileSync(join(home, 'cooldowns.json'), 'utf8')).agy
      expect(closed).toMatchObject({ state: 'closed', failures: 0 })
      console.log('Phase 4A limit fixture:', JSON.stringify({ opened: { state: opened.state, kind: opened.kind }, calls: calls(), closed: { state: closed.state, failures: closed.failures } }))
    } finally {
      for (const [service, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[`AGENT_OFFICE_BIN_${service}`]
        else process.env[`AGENT_OFFICE_BIN_${service}`] = value
      }
    }
  })

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
