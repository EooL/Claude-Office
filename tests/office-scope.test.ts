import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

it('characterizes receiver-safe forwarding across asynchronous scopes', async () => {
  const scope = new AsyncLocalStorage<Map<string, string>>()
  const proxy = new Proxy(new Map<string, string>(), {
    get(_target, key) {
      const current = scope.getStore()!
      const value = Reflect.get(current, key, current)
      return typeof value === 'function' ? value.bind(current) : value
    },
  })
  const a = new Map([['same', 'a']]); const b = new Map([['same', 'b']])
  await Promise.all([a, b].map(map => scope.run(map, async () => {
    await new Promise(resolve => setTimeout(resolve, 1))
    expect(proxy.size).toBe(1)
    expect([...proxy]).toEqual([...map])
    expect(proxy.get('same')).toBe(map.get('same'))
  })))
})

it('forwards office collections, objects and scalars and fails closed without a multi-office scope', async () => {
  const root = mkdtempSync(join(tmpdir(), 'office-scope-'))
  vi.stubEnv('AGENT_OFFICE_HOME', join(root, 'default'))
  vi.stubEnv('AGENT_OFFICE_ROOT', join(root, 'building'))
  vi.resetModules()
  let a: any; let b: any; let runtime: any
  try {
    const { createOffice } = await import('../server/office.mjs')
    const { defaultOffice } = await import('../server/default-office.mjs')
    a = defaultOffice
    const scope = await import('../server/office-scope.mjs')
    runtime = await import('../server/building-runtime.mjs')
    const agents = scope.scopedState('activeAgents')
    expect(agents.size).toBe(0)
    b = createOffice({ home: join(root, 'b'), cwd: join(root, 'project-b') })
    mkdirSync(join(root, 'building'), { recursive: true })
    writeFileSync(join(root, 'building', 'building.json'), JSON.stringify({ schemaVersion: 1, offices: [
      { id: 'default', home: a.context.home, cwd: a.context.cwd },
      { id: 'off_abcdef', home: b.context.home, cwd: b.context.cwd },
    ] }))
    runtime.attachOffice('off_abcdef', b)
    expect(() => agents.size).toThrow('Office scope required')
    const ring = scope.scopedState('signalRing')
    const settings = scope.scopedState('settings')
    const weak = scope.scopedState('waitCalls')
    const trusted = scope.scopedState('trustedClients')
    const state = scope.scopedObject(() => scope.currentOffice().state, a.state)
    expect(Array.isArray(ring)).toBe(true)
    const key = {}
    await Promise.all([a, b].map((office, index) => scope.runInOffice(office, async () => {
      agents.set('same-agent', index)
      weak.set(key, index); trusted.add(key)
      ring.push(index)
      settings.eventMode = String(index)
      state.signalSeq = index + 1
      state.videoPaused = index === 1
      state.videoPausedSince = index + 100
      await Promise.resolve()
      await new Promise(resolve => setTimeout(resolve, 1))
      expect(scope.currentOffice()).toBe(office)
      expect(agents.get('same-agent')).toBe(index)
      expect([...agents]).toEqual([['same-agent', index]])
      expect(weak.get(key)).toBe(index)
      expect(trusted.has(key)).toBe(true)
      expect([...ring]).toEqual([index])
      expect(ring.length).toBe(1)
      expect(Object.keys(settings)).toEqual(Object.keys(office.state.settings))
      expect({ ...settings }).toEqual(office.state.settings)
      expect(state.signalSeq).toBe(index + 1)
      expect(state.videoPaused).toBe(index === 1)
      expect(state.videoPausedSince).toBe(index + 100)
      expect(Object.getOwnPropertyDescriptor(ring, 'length')?.value).toBe(1)
      expect(JSON.stringify(ring)).toBe(JSON.stringify([index]))
      Object.defineProperty(settings, 'temporary', { configurable: true, enumerable: true, value: true })
      expect(settings.temporary).toBe(true)
      delete settings.temporary
      expect('temporary' in settings).toBe(false)
    })))
    let resume!: () => void
    const barrier = new Promise<void>(resolve => { resume = resolve })
    const detachedWork = scope.runInOffice(b, async () => {
      await barrier
      expect(() => agents.size).toThrow('Office is not live')
    })
    runtime.detachOffice('off_abcdef')
    resume()
    await detachedWork
    expect(() => scope.runInOffice(b, () => null)).toThrow('Office is not live')
    expect(scope.currentOffice()).toBe(a)
  } finally {
    runtime?.detachOffice('off_abcdef')
    a?.close(); b?.close()
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  }
})
