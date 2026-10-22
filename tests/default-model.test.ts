import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Settings live under AGENT_OFFICE_HOME, read when the modules load; the registry root is kept off the real one
const home = mkdtempSync(join(tmpdir(), 'office-defmodel-'))
process.env.AGENT_OFFICE_HOME = home
process.env.AGENT_OFFICE_ROOT = join(home, 'root')

const settings = await import('../server/settings.mjs')
const { resolveModel, adapters } = await import('../server/adapters.mjs')
const { mountBackends } = await import('../server/backends.js')

let server: Server
let base = ''
const authed = { 'Content-Type': 'application/json', Authorization: 'Bearer ui' }
const post = (body: unknown, headers: Record<string, string> = authed) => fetch(`${base}/backends/default-model`, { method: 'POST', headers, body: JSON.stringify(body) })

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  mountBackends(app, { requireUi: (req: any, res: any, next: () => void) => (req.headers.authorization === 'Bearer ui' ? next() : res.status(401).json({ error: 'Unauthorized' })) })
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(() => { server.close(); rmSync(home, { recursive: true, force: true }) })

describe('model precedence', () => {
  const withDefault = (m?: string) => ({ defaultModels: m ? { codex: m } : {} })
  it('a brain step model beats the service default, which beats the adapter default, which beats the CLI', () => {
    expect(resolveModel('claude', 'step-model', withDefault())).toBe('step-model')
    expect(resolveModel('codex', 'step-model', withDefault('svc-model'))).toBe('step-model')
    expect(resolveModel('codex', '', withDefault('svc-model'))).toBe('svc-model')
    expect(resolveModel('claude', undefined, withDefault())).toBe((adapters as any).claude.defaultModel)
    const bare = Object.entries(adapters).find(([, a]: any) => !a.defaultModel)
    if (bare) expect(resolveModel(bare[0], '', withDefault())).toBe('')
  })
})

describe('the setting', () => {
  it('is stored per service, trimmed, and an empty id removes it', () => {
    settings.setDefaultModel('codex', '  gpt-x ')
    expect(settings.defaultModelFor('codex')).toBe('gpt-x')
    settings.setDefaultModel('codex', '')
    expect(settings.defaultModelFor('codex')).toBe('')
    expect(settings.readSettings().defaultModels).toEqual({})
  })
  it('validates the id', () => {
    for (const bad of [5, null, 'a'.repeat(201), 'a\nb', 'a\u0000b', 'a\u007fb']) expect(settings.validModelId(bad)).toBe(false)
    for (const ok of ['', 'a'.repeat(200), 'opencode/big-pickle']) expect(settings.validModelId(ok)).toBe(true)
  })
  it('belongs to one office home', () => {
    settings.setDefaultModel('codex', 'mine')
    const other = mkdtempSync(join(tmpdir(), 'office-defmodel-other-'))
    const url = pathToFileURL(join(process.cwd(), 'server/settings.mjs')).href
    const script = `const s = await import(${JSON.stringify(url)}); process.stdout.write(JSON.stringify(s.defaultModelFor('codex')))`
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, AGENT_OFFICE_HOME: other, AGENT_OFFICE_ROOT: join(other, 'root') }, encoding: 'utf8' })
    rmSync(other, { recursive: true, force: true })
    expect(run.stdout).toBe('""')
    expect(settings.defaultModelFor('codex')).toBe('mine')
    settings.setDefaultModel('codex', '')
  })
})

describe('POST /backends/default-model', () => {
  it('needs the UI token', async () => {
    expect((await post({ name: 'codex', model: 'x' }, { 'Content-Type': 'application/json' })).status).toBe(401)
  })
  it('rejects an unknown service and a bad id', async () => {
    expect((await post({ name: 'nope', model: 'x' })).status).toBe(400)
    expect((await post({ name: 'codex', model: 'a'.repeat(201) })).status).toBe(400)
    expect((await post({ name: 'codex', model: 'a\nb' })).status).toBe(400)
    expect((await post({ name: 'codex' })).status).toBe(400)
  })
  it('saves, lists and clears', async () => {
    const set = await (await post({ name: 'codex', model: 'gpt-x' })).json()
    expect(set.services.find((s: any) => s.name === 'codex').defaultModel).toBe('gpt-x')
    const got = await (await fetch(`${base}/backends`)).json()
    expect(got.services.find((s: any) => s.name === 'codex').defaultModel).toBe('gpt-x')
    expect(got.services.find((s: any) => s.name === 'claude').defaultModel).toBe('')
    const cleared = await (await post({ name: 'codex', model: '' })).json()
    expect(cleared.services.find((s: any) => s.name === 'codex').defaultModel).toBe('')
  })
})
