import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { loadOffice } from './helpers'
import { createOfficeState } from '../server/office-state.mjs'

it('allocates independent collections, settings and scalar counters without timers', () => {
  const intervals = vi.spyOn(globalThis, 'setInterval')
  const timeouts = vi.spyOn(globalThis, 'setTimeout')
  try {
    const a = createOfficeState()
    const b = createOfficeState()
    const mapNames = ['activeAgents', 'subagentAliases', 'pendingStarts', 'activity', 'sessions',
      'sessionTimers', 'pendingNeedsYou', 'needsYouTimers', 'sessionSignals', 'a2aPairLog'] as const
    for (const name of mapNames) {
      expect(a[name]).toBeInstanceOf(Map)
      expect(a[name]).not.toBe(b[name])
      a[name].set('shared-id', 'only-A')
      expect(b[name].has('shared-id')).toBe(false)
    }
    const client = {}
    expect(a.waitCalls).toBeInstanceOf(WeakMap)
    expect(a.waitCalls).not.toBe(b.waitCalls)
    a.waitCalls.set(client, 'only-A')
    expect(b.waitCalls.has(client)).toBe(false)
    expect(a.trustedClients).toBeInstanceOf(WeakSet)
    expect(a.trustedClients).not.toBe(b.trustedClients)
    a.trustedClients.add(client)
    expect(b.trustedClients.has(client)).toBe(false)
    expect(a.signalRing).not.toBe(b.signalRing)
    a.signalRing.push({ id: 'only-A' })
    expect(b.signalRing).toEqual([])
    expect(a.settings).not.toBe(b.settings)
    expect(b.settings).toEqual({ logPrompts: 'summary', answerPermissions: true, eventMode: 'real' })
    a.settings.answerPermissions = false
    expect(b.settings.answerPermissions).toBe(true)
    expect([a.signalSeq, a.videoPaused, a.videoPausedSince]).toEqual([0, false, 0])
    a.signalSeq++
    a.videoPaused = true
    a.videoPausedSince = 123
    expect([b.signalSeq, b.videoPaused, b.videoPausedSince]).toEqual([0, false, 0])
    expect(intervals).not.toHaveBeenCalled()
    expect(timeouts).not.toHaveBeenCalled()
  } finally {
    intervals.mockRestore()
    timeouts.mockRestore()
  }
})

it('preserves the default office exported collections, settings and import lifecycle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'office-state-default-'))
  const intervals = vi.spyOn(globalThis, 'setInterval')
  let office: Awaited<ReturnType<typeof loadOffice>> | undefined
  let db: any
  try {
    office = await loadOffice({ dir: join(root, 'home'), env: { AGENT_OFFICE_ROOT: join(root, 'building') } })
    db = (await import('../server/chat-db.js')).default
    const { server } = office
    for (const name of ['activeAgents', 'sessions', 'activity', 'pendingStarts', 'pendingNeedsYou'] as const) {
      expect(server[name]).toBeInstanceOf(Map)
      expect(server[name].size).toBe(0)
      expect((await import('../server/index.js'))[name]).toBe(server[name])
    }
    expect(server.settings).toEqual({ logPrompts: 'summary', answerPermissions: true, eventMode: 'real' })
    expect(server.httpServer.listening).toBe(false)
    expect(intervals.mock.calls.map(([, delay]) => delay)).toEqual([60_000, 300_000])
    expect(intervals.mock.results.every(result => result.type === 'return' && !result.value.hasRef())).toBe(true)
  } finally {
    for (const timer of intervals.mock.results) if (timer.type === 'return') clearInterval(timer.value)
    intervals.mockRestore()
    if (office) await new Promise<void>(resolve => office!.server.wss.close(() => resolve()))
    db?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
