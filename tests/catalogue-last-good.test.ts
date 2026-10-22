import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import React from 'react'
import { renderToString } from 'react-dom/server'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'office-last-good-'))
process.env.AGENT_OFFICE_HOME = home

const catalogue = await import('../server/catalogue.mjs')
const brains = await import('../server/brains.mjs')
const { mountBrains } = await import('../server/brainRoutes.js')
const { default: BrainChain } = await import('../src/components/BrainChain')

const svcs = ['agy', 'codex'].map(name => ({ name, available: true, enabled: true })) as any
const ok = (name: string) => [{ id: `${name}-pro-2`, label: name }]
const old = (service: string) => catalogue.classifyModel({ service, id: `${service}-pro-1`, label: service })
const previous = { builtAt: 1000, models: [old('agy'), old('codex')] }

afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('a failed model listing does not remove a service', () => {
  it('keeps the previous models marked stale and records the error', async () => {
    const list = async (n: string) => { if (n === 'agy') throw new Error('agy timed out'); return ok(n) }
    const built = await catalogue.buildCatalogue({ list, svcs, previous })
    const agy = built.models.filter((m: any) => m.service === 'agy')
    expect(agy.map((m: any) => [m.id, m.stale])).toEqual([['agy-pro-1', true]])
    expect(agy[0].tier).toBe(old('agy').tier) // existing fields unchanged
    expect(built.models.find((m: any) => m.service === 'codex')).toMatchObject({ id: 'codex-pro-2' })
    expect(built.models.find((m: any) => m.service === 'codex').stale).toBeUndefined()
    expect(built.listingErrors.agy.message).toBe('agy timed out')
    expect(built.listingErrors.codex).toBeUndefined()
  })

  it('an empty list counts as a failure; a good one replaces the old models and clears the error', async () => {
    const empty = await catalogue.buildCatalogue({ list: async () => [], svcs, previous })
    expect(empty.models.every((m: any) => m.stale)).toBe(true)
    const stale = await catalogue.buildCatalogue({ list: async (n: string) => { if (n === 'agy') throw new Error('x'); return ok(n) }, svcs, previous })
    const good = await catalogue.buildCatalogue({ list: async (n: string) => ok(n), svcs, previous: stale })
    expect(good.models.map((m: any) => m.id)).toEqual(['agy-pro-2', 'codex-pro-2'])
    expect(good.models.some((m: any) => m.stale)).toBe(false)
    expect(good.listingErrors).toEqual({})
  })

  it('when every listing fails the old catalogue stays (stale, same build time)', async () => {
    const built = await catalogue.buildCatalogue({ list: async () => { throw new Error('boom') }, svcs, previous })
    expect(built.models.map((m: any) => m.id)).toEqual(['agy-pro-1', 'codex-pro-1'])
    expect(built.models.every((m: any) => m.stale)).toBe(true)
    expect(built.builtAt).toBe(1000)
    expect(Object.keys(built.listingErrors).sort()).toEqual(['agy', 'codex'])
  })

  it('a service never listed that fails stays absent, with its error recorded (no user path, at most 200 characters)', async () => {
    const list = async (n: string) => { if (n === 'agy') throw new Error(`spawn C:\\Users\\someone\\bin\\agy.cmd ${'x'.repeat(400)}`); return ok(n) }
    const built = await catalogue.buildCatalogue({ list, svcs, previous: { builtAt: 1, models: [old('codex')] } })
    expect(built.models.map((m: any) => m.service)).toEqual(['codex'])
    expect(built.listingErrors.agy.message.length).toBeLessThanOrEqual(200)
    expect(built.listingErrors.agy.message).not.toContain('someone')
  })

  it('a service that is not enabled any more is dropped', async () => {
    const off = [{ name: 'agy', available: true, enabled: false }, svcs[1]] as any
    const built = await catalogue.buildCatalogue({ list: async () => { throw new Error('x') }, svcs: off, previous })
    expect(built.models.map((m: any) => m.service)).toEqual(['codex'])
    expect(built.listingErrors.agy).toBeUndefined()
  })

  it('retries a failed listing once: fail-then-succeed is fresh, fail twice is stale', async () => {
    const calls: Record<string, number> = {}
    const flaky = (okAt: number) => async (n: string) => { calls[n] = (calls[n] ?? 0) + 1; if (n === 'agy' && calls[n] < okAt) throw new Error('timed out'); return ok(n) }
    const fresh = await catalogue.buildCatalogue({ list: flaky(2), svcs, previous })
    expect(calls.agy).toBe(2)
    expect(fresh.models.find((m: any) => m.service === 'agy')).toMatchObject({ id: 'agy-pro-2' })
    expect(fresh.listingErrors).toEqual({})
    for (const k of Object.keys(calls)) delete calls[k]
    const stale = await catalogue.buildCatalogue({ list: flaky(99), svcs, previous })
    expect(calls.agy).toBe(2) // not more than one retry
    expect(stale.models.find((m: any) => m.service === 'agy').stale).toBe(true)
  })

  it('refreshCatalogue takes the previous models from the saved file', async () => {
    catalogue.saveCatalogue(previous)
    const saved = await catalogue.refreshCatalogue({ list: async (n: string) => { if (n === 'agy') throw new Error('x'); return ok(n) }, svcs })
    expect(saved.models.find((m: any) => m.service === 'agy')).toMatchObject({ id: 'agy-pro-1', stale: true })
    expect(catalogue.loadCatalogue({ maxAgeMs: Infinity })?.listingErrors.agy.message).toBe('x')
  })
})

describe('a stale service stays in the chain', () => {
  it('a brain with agy -> codex still resolves to both after the agy listing failed', async () => {
    const built = await catalogue.buildCatalogue({ list: async (n: string) => { if (n === 'agy') throw new Error('x'); return ok(n) }, svcs, previous })
    const settings = { backend: 'claude', brains: { mine: { name: 'Mine', steps: [{ service: 'agy' }, { service: 'codex' }] } }, agents: { debugger: { brain: 'mine' } } }
    expect(brains.resolveSteps('debugger', settings, built).map((s: any) => s.service)).toEqual(['agy', 'codex'])
  })
})

describe('GET /brains/catalogue and the note', () => {
  let server: Server
  let base = ''
  beforeAll(async () => {
    const app = express()
    mountBrains(app, { requireUi: (_q: any, _r: any, next: () => void) => next() })
    await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
    base = `http://127.0.0.1:${(server.address() as any).port}`
  })
  afterAll(() => { server.close() })

  it('carries stale and listingErrors', async () => {
    writeFileSync(join(home, 'catalogue.json'), JSON.stringify({
      builtAt: Date.now(), models: [{ ...old('agy'), stale: true }, old('codex')], listingErrors: { agy: { at: 5, message: 'agy timed out' } },
    }))
    const body = await (await fetch(`${base}/brains/catalogue`)).json()
    expect(body.listingErrors).toEqual({ agy: { at: 5, message: 'agy timed out' } })
    expect(body.models.find((m: any) => m.service === 'agy').stale).toBe(true)
    const overview = await (await fetch(`${base}/brains`)).json()
    expect(overview.catalogue.outdated).toEqual(['agy'])
  })

  it('the chain shows the note only for an outdated service, escaped', () => {
    const steps = [{ service: 'agy', model: '', effort: '', label: '<b>x</b>', why: '', blocked: null }, { service: 'codex', model: '', effort: '', label: 'c', why: '', blocked: null }] as any
    const html = renderToString(React.createElement(BrainChain, { steps, label: s => s, outdated: ['agy'] }))
    expect(html.match(/model list out of date/g)).toHaveLength(1)
    expect(html).not.toContain('<b>x</b>')
    expect(renderToString(React.createElement(BrainChain, { steps, label: s => s }))).not.toContain('out of date')
  })
})
