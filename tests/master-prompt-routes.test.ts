import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { inprocessBuilding } from './helpers/inprocess-building'

let f: Awaited<ReturnType<typeof inprocessBuilding>>
beforeEach(async () => { f = await inprocessBuilding() })
afterEach(async () => { await f.close() })
const ui = () => ({ Authorization: `Bearer ${f.server.AUTH_TOKEN}` })

it('GET returns the exact contract and validation does not write', async () => {
  const response = await f.request('/master-prompt')
  expect(response.status).toBe(200)
  expect(Object.keys(response.body).sort()).toEqual(['text', 'defaultText', 'source', 'status', 'hash', 'warnings'].sort())
  expect(response.body).toMatchObject({ source: 'shipped', status: 'default', warnings: [] })
  expect((await f.request('/master-prompt/validate', 'POST', {}, { text: '' })).body).toMatchObject({ ok: false, errors: [{ line: 1 }] })
  expect((await f.request('/master-prompt/validate', 'POST', {}, { text: 'Custom.' })).body).toMatchObject({ ok: true, errors: [], warnings: expect.any(Array) })
  expect(existsSync(join(f.a.context.home, 'master-prompt.md'))).toBe(false)
})

it('requires UI auth, refuses invalid and oversized writes and completes save/approve/reset round trip', async () => {
  expect((await f.request('/master-prompt', 'PUT', {}, { text: 'Custom.' })).status).toBe(401)
  expect((await f.request('/master-prompt', 'DELETE')).status).toBe(401)
  expect((await f.request('/master-prompt', 'PUT', ui(), {})).status).toBe(400)
  expect((await f.request('/master-prompt', 'PUT', ui(), { text: '' })).body.errors[0].line).toBe(1)
  expect((await f.request('/master-prompt', 'PUT', ui(), { text: 'x'.repeat(8193) })).status).toBe(413)
  expect((await f.request('/master-prompt', 'PUT', ui(), { text: 'Custom.', status: 'wrong' })).status).toBe(400)
  expect(existsSync(join(f.a.context.home, 'master-prompt.md'))).toBe(false)
  expect((await f.request('/master-prompt', 'PUT', ui(), { text: 'Custom.' })).body).toMatchObject({ source: 'override', status: 'draft', text: 'Custom.' })
  expect((await f.request('/master-prompt', 'PUT', ui(), { text: 'Approved.', status: 'approved' })).body).toMatchObject({ source: 'override', status: 'approved', text: 'Approved.' })
  expect((await f.request('/master-prompt')).body.text).toBe('Approved.')
  expect((await f.request('/master-prompt', 'DELETE', ui())).body).toMatchObject({ source: 'shipped', status: 'default' })
  expect(existsSync(join(f.a.context.home, 'master-prompt.md'))).toBe(false)
})

it('fails closed for all four routes in a second live office without writes', async () => {
  f.attach()
  const before = readdirSync(f.b.context.home).sort()
  for (const [method, path] of [['GET', '/master-prompt'], ['POST', '/master-prompt/validate'], ['PUT', '/master-prompt'], ['DELETE', '/master-prompt']]) {
    expect(await f.request(`/o/off_abc123${path}`, method, ui(), { text: 'Custom.' })).toMatchObject({ status: 501, body: { error: 'not scoped yet' } })
  }
  expect(readdirSync(f.b.context.home).sort()).toEqual(before)
  expect(existsSync(join(f.b.context.home, 'master-prompt.md'))).toBe(false)
})
