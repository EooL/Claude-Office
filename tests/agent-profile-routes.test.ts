import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { defaultProfile, parseProfile, serializeProfile } from '../server/agent-profiles.mjs'
import { inprocessBuilding } from './helpers/inprocess-building'

let f: Awaited<ReturnType<typeof inprocessBuilding>>
beforeEach(async () => { f = await inprocessBuilding() })
afterEach(async () => { await f.close() })

const ui = () => ({ Authorization: `Bearer ${f.server.AUTH_TOKEN}` })
const file = (role: string) => join(f.root, 'default-home', 'agent-profiles', `${role}.md`)
const debuggerText = () => serializeProfile(defaultProfile('debugger'))
const edited = (patch: (fm: any) => void) => {
  const p = parseProfile(debuggerText())
  patch(p.frontmatter)
  return serializeProfile(p)
}

it('lists the 13 roles and shows one with text, default text, hash and access checks', async () => {
  writeFileSync(join(f.root, 'default-home', 'backend.json'), JSON.stringify({ enabledServices: [] }))
  const list = await f.request('/profiles')
  expect(list.status).toBe(200)
  expect(list.body).toHaveLength(13)
  expect(list.body[0]).toEqual(expect.objectContaining({ role: expect.any(String), displayName: expect.any(String), status: expect.any(String), source: expect.any(String), hash: expect.any(String), access: expect.any(Object) }))
  const one = await f.request('/profiles/debugger')
  expect(one.body).toMatchObject({ role: 'debugger', source: expect.any(String), hash: expect.any(String), frontmatter: { name: 'debugger' } })
  expect(one.body.text).toContain('# What you must not do')
  expect(one.body.defaultText).toBe(debuggerText())
  expect(Object.keys(one.body.accessChecks).length).toBeGreaterThan(0)
  expect(one.body.accessSummary).toEqual({ count: 0, text: '', byService: [] })
})

it('summarizes only Settings-enabled services and preserves the full accessChecks', async () => {
  writeFileSync(join(f.root, 'default-home', 'backend.json'), JSON.stringify({ enabledServices: ['agy', 'qoder'] }))
  const one = await f.request('/profiles/debugger')
  expect(one.body.accessSummary.count).toBe(4)
  expect(one.body.accessSummary.byService.map((s: any) => s.service)).toEqual(['agy', 'qoder'])
  expect(one.body.accessSummary.text).toContain('Antigravity and Qoder cannot guarantee read-only in plan mode.')
  expect(Object.keys(one.body.accessChecks)).toEqual(['claude', 'codex', 'agy', 'opencode', 'qoder'])
  writeFileSync(join(f.root, 'default-home', 'backend.json'), JSON.stringify({ enabledServices: ['codex'] }))
  expect((await f.request('/profiles/debugger')).body.accessSummary).toEqual({ count: 0, text: '', byService: [] })
})

it('answers 404 for unknown and malformed roles without touching the disk', async () => {
  for (const role of ['nobody', '..%2fx', '..%2f..%2fetc', 'Debugger', '..']) {
    expect((await f.request(`/profiles/${role}`)).status).toBe(404)
    expect((await f.request(`/profiles/${role}`, 'PUT', ui(), { text: debuggerText() })).status).toBe(404)
  }
  expect((await f.request('/profiles/nobody')).body).toEqual({ error: 'Unknown role' })
  expect(existsSync(join(f.root, 'default-home', 'agent-profiles'))).toBe(false)
})

it('serves the A2A card and the Claude Code export', async () => {
  const card = await f.request('/profiles/debugger/card')
  expect(card.body).toMatchObject({ protocolVersion: '0.3.0', name: 'Debugger', url: expect.stringContaining('/a2a'), skills: expect.any(Array) })
  const claude = await f.request('/profiles/debugger/claude')
  expect(claude.status).toBe(200)
  expect(claude.text.startsWith('---\nname: debugger\n')).toBe(true)
})

it('claude export is an attachment of type markdown', async () => {
  const res = await fetch(`http://127.0.0.1:${f.port}/profiles/debugger/claude`)
  expect(res.headers.get('content-type')).toMatch(/text\/markdown/)
  expect(res.headers.get('content-disposition')).toBe('attachment; filename="debugger.md"')
})

it('validate reports line numbers and writes nothing', async () => {
  const bad = await f.request('/profiles/debugger/validate', 'POST', {}, { text: '---\nname: debugger\nfoo bar\n---\nbody' })
  expect(bad.body).toMatchObject({ ok: false, errors: [{ line: 3 }] })
  expect((await f.request('/profiles/debugger/validate', 'POST', {}, { text: debuggerText() })).body).toEqual({ ok: true, errors: [] })
  expect((await f.request('/profiles/debugger/validate', 'POST', {}, { text: edited(fm => { fm.effort = 'huge' }) })).body).toMatchObject({ ok: false, errors: [{ field: 'effort', line: 7 }] })
  expect(existsSync(join(f.root, 'default-home', 'agent-profiles'))).toBe(false)
})

it('PUT needs the UI token, saves an override, and refuses invalid text', async () => {
  const text = edited(fm => { fm.description = 'Finds the root cause of a bug, with a changed description for this test.' })
  expect((await f.request('/profiles/debugger', 'PUT', {}, { text })).status).toBe(401)
  expect(existsSync(file('debugger'))).toBe(false)
  const ok = await f.request('/profiles/debugger', 'PUT', ui(), { text, status: 'draft' })
  expect(ok.status).toBe(200)
  expect(ok.body).toMatchObject({ source: 'override', frontmatter: { office: { status: 'draft' } } })
  expect(readFileSync(file('debugger'), 'utf8')).toContain('changed description')
  const before = readFileSync(file('debugger'), 'utf8')
  const invalid = await f.request('/profiles/debugger', 'PUT', ui(), { text: edited(fm => { fm.effort = 'huge' }) })
  expect(invalid.status).toBe(400)
  expect(invalid.body.errors.length).toBeGreaterThan(0)
  expect((await f.request('/profiles/debugger', 'PUT', ui(), { text: '---\nbroken' })).status).toBe(400)
  expect((await f.request('/profiles/debugger', 'PUT', ui(), {})).status).toBe(400)
  expect(readFileSync(file('debugger'), 'utf8')).toBe(before)
})

it('refuses a profile over 20 KB', async () => {
  const text = `${debuggerText()}${'x'.repeat(21 * 1024)}\n`
  expect((await f.request('/profiles/debugger', 'PUT', ui(), { text })).status).toBe(400)
  expect(existsSync(file('debugger'))).toBe(false)
})

it('a locked profile answers 409 to a change; approve sets the status; DELETE resets', async () => {
  const locked = edited(fm => { fm.office.locked = true })
  expect((await f.request('/profiles/debugger', 'PUT', ui(), { text: locked })).status).toBe(200)
  expect((await f.request('/profiles/debugger', 'PUT', ui(), { text: debuggerText() })).status).toBe(409)
  expect((await f.request('/profiles/debugger/approve', 'POST', ui())).status).toBe(409)
  expect((await f.request('/profiles/debugger', 'DELETE', {})).status).toBe(401)
  expect((await f.request('/profiles/debugger', 'DELETE', ui())).body.source).not.toBe('override')
  expect(existsSync(file('debugger'))).toBe(false)

  expect((await f.request('/profiles/debugger/approve', 'POST', {})).status).toBe(401)
  const approved = await f.request('/profiles/debugger/approve', 'POST', ui())
  expect(approved.status).toBe(200)
  expect(approved.body).toMatchObject({ source: 'override', frontmatter: { office: { status: 'approved' } } })
  expect((await f.request('/profiles')).body.find((p: any) => p.role === 'debugger').status).toBe('approved')
  await f.request('/profiles/debugger', 'DELETE', ui())
  expect((await f.request('/profiles')).body.find((p: any) => p.role === 'debugger').status).not.toBe('approved')
})

it('an override of the default office is invisible to a second office, which answers 501', async () => {
  await f.request('/profiles/debugger/approve', 'POST', ui())
  expect(existsSync(file('debugger'))).toBe(true)
  f.attach()
  expect(existsSync(join(f.b.context.home, 'agent-profiles'))).toBe(false)
  for (const [method, path] of [['GET', '/profiles'], ['GET', '/profiles/debugger'], ['PUT', '/profiles/debugger'], ['POST', '/profiles/debugger/approve'], ['DELETE', '/profiles/debugger']]) {
    expect(await f.request(`/o/off_abc123${path}`, method, ui())).toMatchObject({ status: 501, body: { error: 'not scoped yet' } })
  }
  expect(existsSync(join(f.b.context.home, 'agent-profiles'))).toBe(false)
})
