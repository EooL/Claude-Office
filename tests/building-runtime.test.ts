import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let root: string
let opened: Array<{ close(): void }>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'office-runtime-'))
  opened = []
  vi.stubEnv('AGENT_OFFICE_HOME', join(root, 'legacy'))
  vi.stubEnv('AGENT_OFFICE_ROOT', join(root, 'building'))
  vi.stubEnv('OFFICE_ID', 'default')
  vi.resetModules()
})

afterEach(() => {
  for (const office of opened) office.close()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

it('characterizes the one eager default office without initializing a registry', async () => {
  const { defaultOffice } = await import('../server/default-office.mjs')
  opened.push(defaultOffice)
  expect((await import('../server/default-office.mjs')).defaultOffice).toBe(defaultOffice)
  expect(defaultOffice.context.id).toBe('default')
  expect(defaultOffice.chat.db.name).toBe(join(root, 'legacy', 'chat.db'))
  expect(readdirSync(root)).toEqual(['legacy'])
})

it('boots exactly one default attachment and returns an isolated list snapshot', async () => {
  const runtime = await import('../server/building-runtime.mjs')
  const { defaultOffice } = await import('../server/default-office.mjs')
  opened.push(defaultOffice)
  expect(runtime.getOffice('default')).toBe(defaultOffice)
  const snapshot = runtime.liveOffices()
  expect(snapshot).toEqual([defaultOffice])
  snapshot.length = 0
  expect(runtime.liveOffices()).toEqual([defaultOffice])
  for (const id of ['..', 'off_ABCDEF', 'off_abcde', 'off_abcdefghijklm', 'off_abcdef/child', ' default', 'off_%2fabc']) expect(runtime.getOffice(id)).toBeUndefined()
  expect(runtime.getOffice('off_abcdef')).toBeUndefined()
  expect(readdirSync(root)).toEqual(['legacy'])
  expect(() => runtime.detachOffice('default')).toThrow('Cannot detach')
  expect(() => runtime.attachOffice('default', defaultOffice)).toThrow('already live')
})

it('attaches only registered matching instances and detaches without closing them', async () => {
  const runtime = await import('../server/building-runtime.mjs')
  opened.push(runtime.getOffice('default')!)
  const { createOffice } = await import('../server/office.mjs')
  const { addOffice } = await import('../server/registry.mjs')
  const entry = { id: 'off_abcdef', home: join(root, 'second'), cwd: join(root, 'project') }
  const office = createOffice(entry)
  opened.push(office)
  expect(() => runtime.attachOffice('../bad', office)).toThrow('Invalid office id')
  expect(() => runtime.attachOffice(entry.id, office)).toThrow('not registered')
  addOffice(entry)
  expect(() => runtime.attachOffice(entry.id, { ...office, context: { ...office.context, home: join(root, 'wrong') } })).toThrow('does not match')
  expect(runtime.attachOffice(entry.id, office)).toBe(office)
  expect(runtime.getOffice(entry.id)).toBe(office)
  expect(runtime.liveOffices()).toHaveLength(2)
  expect(() => runtime.attachOffice(entry.id, office)).toThrow('already live')
  expect(() => runtime.attachOffice('off_ghijkl', office)).toThrow('instance is already live')
  expect(runtime.detachOffice(entry.id)).toBe(office)
  expect(office.chat.db.open).toBe(true)
  expect(runtime.getOffice(entry.id)).toBeUndefined()
  expect(runtime.detachOffice(entry.id)).toBeUndefined()
  expect(runtime.liveOffices()).toHaveLength(1)
})
