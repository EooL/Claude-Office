import type { AddressInfo } from 'node:net'
import express from 'express'
import { expect, it } from 'vitest'
import { inprocessBuilding } from './helpers/inprocess-building'

// Proves the office scope (AsyncLocalStorage) survives express.json for a non-default office.
// resolveOffice answers 501 to non-GET for such offices today, so a test-only equivalent without the gate is used.
async function withApp(run: (ctx: { base: string, fixture: Awaited<ReturnType<typeof inprocessBuilding>>, handled: () => number }) => Promise<void>) {
  const fixture = await inprocessBuilding()
  const { validateOfficePath } = await import('../server/office-routing.mjs')
  const { getOffice } = await import('../server/building-runtime.mjs')
  const { runInOffice, currentOffice } = await import('../server/office-scope.mjs')
  fixture.attach()
  let handled = 0
  const app = express()
  app.use('/o', validateOfficePath)
  app.use('/o/:officeId', (req: any, res, next) => {
    const office = getOffice(req.params.officeId)
    if (!office) return res.status(404).json({ error: 'Unknown office' })
    req.office = office
    return runInOffice(office, next)
  }, express.json({ limit: '1mb' }),
  (req: any, res) => {
    handled++
    const office = currentOffice()
    if (req.path === '/state') {
      office.state.settings.logPrompts = req.body.value
      office.chat.addMessage({ sender: 'body-test', text: req.body.value })
      return res.json({ office: office.context.id, logPrompts: currentOffice().state.settings.logPrompts, texts: currentOffice().chat.getMessages().map((m: any) => m.text) })
    }
    res.json({ office: office.context.id, same: office === req.office, body: req.body })
  })
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: err.type ?? 'error' }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try { await run({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, fixture, handled: () => handled }) } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
    await fixture.close()
  }
}

const post = (url: string, body: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })

it('keeps the non-default office scope after body parsing, for small and multi-chunk bodies', async () => {
  await withApp(async ({ base, fixture }) => {
    const [a, b] = [fixture.a.context.id, fixture.b.context.id]; const urlA = 'default', urlB = 'off_abc123'
    expect(a).not.toBe(b)
    for (const body of [{ hello: 'world' }, { big: 'x'.repeat(200 * 1024) }]) {
      const res = await (await post(`${base}/o/${urlB}/echo`, JSON.stringify(body))).json()
      expect(res).toEqual({ office: b, same: true, body })
    }
    expect((await (await post(`${base}/o/${urlA}/echo`, '{"k":1}')).json()).office).toBe(a)
    const state = await (await post(`${base}/o/${urlB}/state`, '{"value":"full"}')).json()
    expect(state).toEqual({ office: b, logPrompts: 'full', texts: ['full'] })
    expect(fixture.b.state.settings.logPrompts).toBe('full')
    expect(fixture.a.state.settings.logPrompts).not.toBe('full')
    expect(fixture.a.chat.getMessages()).toEqual([])
  })
})

it('keeps 20 interleaved concurrent POSTs in their own offices', async () => {
  await withApp(async ({ base, fixture }) => {
    const ids = ['default', 'off_abc123']; const ctx: Record<string, string> = { default: fixture.a.context.id, off_abc123: fixture.b.context.id }
    const results = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
      const id = ids[i % 2]
      const body = { i, pad: 'y'.repeat(i % 3 ? 100 * 1024 : 10) }
      return { id, res: await (await post(`${base}/o/${id}/echo`, JSON.stringify(body))).json(), i }
    }))
    for (const { id, res, i } of results) expect(res, `request ${i}`).toMatchObject({ office: ctx[id], same: true, body: { i } })
  })
})

it('rejects a body that fails to parse without running the handler or leaking scope', async () => {
  await withApp(async ({ base, fixture, handled }) => {
    const urlB = 'off_abc123'
    const bad = await post(`${base}/o/${urlB}/echo`, '{broken json')
    expect(bad.status).toBe(400)
    expect(handled()).toBe(0)
    const next = await (await post(`${base}/o/default/echo`, '{"ok":true}')).json()
    expect(next).toMatchObject({ office: fixture.a.context.id, same: true })
    expect(handled()).toBe(1)
  })
})
