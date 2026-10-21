import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeEach, expect, it, vi } from 'vitest'

const base = mkdtempSync(join(tmpdir(), 'building-registry-'))
const saved = { home: process.env.AGENT_OFFICE_HOME, root: process.env.AGENT_OFFICE_ROOT }
let registry: typeof import('../server/registry.mjs')
let root: string
let home: string
let sequence = 0
beforeEach(async () => {
  root = join(base, `root-${++sequence}`)
  home = join(base, `legacy-${sequence}`)
  process.env.AGENT_OFFICE_HOME = home
  process.env.AGENT_OFFICE_ROOT = root
  vi.resetModules()
  registry = await import('../server/registry.mjs')
})
afterAll(() => {
  for (const [key, value] of Object.entries({ AGENT_OFFICE_HOME: saved.home, AGENT_OFFICE_ROOT: saved.root })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(base, { recursive: true, force: true })
})
function entry(id = 'off_abc123', suffix = id) {
  return { id, home: join(base, `home-${sequence}-${suffix}`), cwd: join(base, `project-${sequence}-${suffix}`) }
}
function contents() { return readFileSync(join(root, 'building.json'), 'utf8') }

it('synthesizes the default without creating a root, home, or registry on import/read/list', () => {
  expect(registry.buildingRoot()).toBe(root)
  expect(registry.readBuilding()).toEqual({ schemaVersion: 1, offices: [{ id: 'default', home, cwd: process.cwd() }] })
  expect(registry.listOffices()).toEqual(registry.readBuilding().offices)
  expect(existsSync(root)).toBe(false)
  expect(existsSync(home)).toBe(false)
})

it('adds explicit paths atomically, preserves legacy G0 and leaves no lock/temp files', () => {
  const office = entry()
  expect(registry.addOffice(office)).toEqual(office)
  expect(registry.readBuilding()).toMatchObject({ g0Home: home, offices: [{ id: 'default' }, office] })
  expect(readdirSync(root)).toEqual(['building.json'])
  expect(existsSync(office.home)).toBe(false)
  expect(existsSync(office.cwd)).toBe(false)
})

it.each(['../escape', 'off_UPPER1', 'off_a', 'off_1234567890123', '', 'other', 'off_abc123\n', 'default\n'])('refuses malformed id %s before filesystem effects', id => {
  expect(() => registry.addOffice(entry(id))).toThrow('Invalid office id')
  expect(() => registry.removeOffice(id)).toThrow('Invalid office id')
  expect(existsSync(root)).toBe(false)
})

it('refuses duplicate ids and equal, containing, or nested cwd without rewriting', () => {
  const first = entry()
  registry.addOffice(first)
  const before = contents()
  expect(() => registry.addOffice(entry(first.id, 'other'))).toThrow('Duplicate office id')
  for (const cwd of [first.cwd, join(first.cwd, 'child'), base]) {
    expect(() => registry.addOffice({ ...entry('off_def456'), cwd })).toThrow('overlap')
  }
  expect(contents()).toBe(before)
})

it('refuses an office home that is shared with, nested in or around another home, G0, or a project folder', () => {
  const first = entry()
  registry.addOffice(first)
  const before = contents()
  const second = entry('off_def456')
  const homes = {
    'the same home as another office': first.home,
    'a home inside another office home': join(first.home, 'inner'),
    'a home containing another office home': base,
    'the legacy (G0) home': home,
    'a home inside the G0 home': join(home, 'levels', 'x'),
    'a home inside another office project folder': join(first.cwd, 'state'),
    'a home equal to another office project folder': first.cwd,
    'a home containing the configured building root': base,
    'the building root itself': root,
  }
  for (const [what, candidate] of Object.entries(homes)) {
    expect(() => registry.addOffice({ ...second, home: candidate }), what).toThrow(/home/i)
  }
  // its own cwd may not sit inside its own home or the reverse, and a new cwd may not sit inside another home
  expect(() => registry.addOffice({ ...second, home: join(base, 'self'), cwd: join(base, 'self', 'project') })).toThrow(/home/i)
  expect(() => registry.addOffice({ ...second, cwd: join(first.home, 'project') })).toThrow(/home/i)
  expect(contents()).toBe(before)
  // a home under <root>/levels (the planned layout) is fine
  const levels = { ...second, home: join(root, 'levels', 'off_def456') }
  expect(registry.addOffice(levels)).toEqual(levels)
})

it('rejects alternate cwd spellings and a real junction to the same project', () => {
  const first = entry()
  mkdirSync(first.cwd)
  const alias = join(base, `junction-${sequence}`)
  symlinkSync(first.cwd, alias, process.platform === 'win32' ? 'junction' : 'dir')
  registry.addOffice(first)
  const spellings = [first.cwd.replace(/\\/g, '/') + '/', alias]
  if (process.platform === 'win32') spellings.push(first.cwd.toUpperCase())
  for (const cwd of spellings) expect(() => registry.addOffice({ ...entry('off_def456'), cwd })).toThrow('overlap')
})

it('refuses cwd inside, equal to, or containing the configured root and the user building root', () => {
  for (const cwd of [root, join(root, 'child'), base]) {
    expect(() => registry.addOffice({ ...entry(), cwd })).toThrow('overlap')
  }
  // Compute the real home path only; no reads or writes occur there.
  const realRoot = join(homedir(), '.claude-office')
  for (const cwd of [realRoot, join(realRoot, 'child'), homedir()]) {
    expect(() => registry.addOffice({ ...entry(), cwd })).toThrow('overlap')
  }
})

it('enforces maximum 16 offices including the synthesized legacy office', () => {
  for (let i = 0; i < 15; i++) registry.addOffice(entry(`off_${String(i).padStart(6, '0')}`))
  const before = contents()
  expect(() => registry.addOffice(entry('off_999999'))).toThrow('Maximum 16')
  expect(contents()).toBe(before)
})

it('refuses future and malformed schemas without rewriting', () => {
  mkdirSync(root)
  for (const data of [JSON.stringify({ schemaVersion: 2, offices: [] }), '{bad json', JSON.stringify({ schemaVersion: 1, offices: [{ id: '../bad', home, cwd: base }] })]) {
    writeFileSync(join(root, 'building.json'), data)
    expect(() => registry.readBuilding()).toThrow()
    expect(() => registry.addOffice(entry())).toThrow()
    expect(contents()).toBe(data)
    expect(readdirSync(root)).toEqual(['building.json'])
  }
})

it('caches the parsed registry but never serves a stale or shared copy', () => {
  const first = entry()
  registry.addOffice(first)
  const read = registry.readBuilding()
  // a caller that changes what it got changes nothing for the next reader
  read.offices.push({ id: 'off_zzzzzz', home: 'x', cwd: 'y' })
  read.offices[1].home = 'tampered'
  expect(registry.readBuilding().offices.map(o => o.id)).toEqual(['default', first.id])
  expect(registry.readBuilding().offices[1].home).toBe(first.home)
  // our own write is visible at once, including a same-size change (a same-length id swapped for another)
  const second = entry('off_def456')
  registry.addOffice(second)
  expect(registry.readBuilding().offices.map(o => o.id)).toEqual(['default', first.id, second.id])
  registry.removeOffice(second.id)
  registry.addOffice(entry('off_ghi789'))
  expect(registry.readBuilding().offices.map(o => o.id)).toEqual(['default', first.id, 'off_ghi789'])
  // a write by someone else (another process, a hand edit) is seen too, even with the same size
  const file = join(root, 'building.json')
  const text = readFileSync(file, 'utf8')
  const edited = text.replace('off_ghi789', 'off_jkl012')
  expect(edited.length).toBe(text.length)
  const swap = `${file}.swap`
  writeFileSync(swap, edited)
  renameSync(swap, file)
  expect(registry.readBuilding().offices.map(o => o.id)).toEqual(['default', first.id, 'off_jkl012'])
  // deleting the file returns to the single-office view at once, and a bad file is an error again after it was good
  rmSync(file)
  expect(registry.readBuilding().offices.map(o => o.id)).toEqual(['default'])
  writeFileSync(file, '{bad json')
  expect(() => registry.readBuilding()).toThrow(/cannot be used/)
  rmSync(file)
  expect(registry.readBuilding().offices.map(o => o.id)).toEqual(['default'])
})

it('says which file is unusable and how to go back when the registry is future, malformed or invalid', () => {
  mkdirSync(root)
  const file = join(root, 'building.json')
  for (const data of [JSON.stringify({ schemaVersion: 2, offices: [] }), '{bad json', JSON.stringify({ schemaVersion: 1, offices: [{ id: '../bad', home, cwd: base }] })]) {
    writeFileSync(file, data)
    let message = ''
    try { registry.readBuilding() } catch (error) { message = (error as Error).message }
    expect(message, data).toContain(file)
    expect(message, data).toMatch(/delete it to return to the single-office view/i)
    expect(contents()).toBe(data)
  }
  // a missing file is still the normal single-office view, not an error
  rmSync(file)
  expect(registry.readBuilding().offices.map(o => o.id)).toEqual(['default'])
})

it('archives an office home, preserves project bytes and leaves the legacy office and G0 intact', () => {
  const office = entry()
  mkdirSync(office.home)
  mkdirSync(office.cwd)
  writeFileSync(join(office.home, 'chat.db'), 'state')
  writeFileSync(join(office.cwd, 'project.txt'), 'project')
  registry.addOffice(office)
  const removed = registry.removeOffice(office.id)
  expect(existsSync(office.home)).toBe(false)
  expect(readFileSync(join(removed.archive!, 'chat.db'), 'utf8')).toBe('state')
  expect(readFileSync(join(office.cwd, 'project.txt'), 'utf8')).toBe('project')
  expect(registry.listOffices().map(o => o.id)).toEqual(['default'])
  expect(registry.readBuilding().g0Home).toBe(home)
  expect(() => registry.removeOffice('default')).toThrow('G0')
  expect(() => registry.removeOffice('off_absent')).toThrow('Unknown office')
})

it('refuses archiving homes that could move a project or the registry, even in a hand-edited registry that addOffice would have refused', () => {
  const office = entry()
  const other = entry('off_def456')
  // addOffice refuses these homes, so write the registry directly, as a manual edit could
  const write = (offices: unknown[]) => {
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'building.json'), JSON.stringify({ schemaVersion: 1, g0Home: home, offices: [{ id: 'default', home, cwd: process.cwd() }, ...offices] }))
  }
  write([{ ...office, home: office.cwd }])
  expect(() => registry.removeOffice(office.id)).toThrow('project folder')
  write([{ ...other, home: root }])
  expect(() => registry.removeOffice('off_def456')).toThrow('building root')
})

it('archives an ordinary office home inside the building levels directory', () => {
  const office = { ...entry(), home: join(root, 'levels', 'explicit-home') }
  registry.addOffice(office)
  mkdirSync(office.home, { recursive: true })
  writeFileSync(join(office.home, 'state'), 'saved')
  const removed = registry.removeOffice(office.id)
  expect(readFileSync(join(removed.archive!, 'state'), 'utf8')).toBe('saved')
  expect(existsSync(office.home)).toBe(false)
})

it('serializes two real concurrent process additions into one valid atomic registry', async () => {
  const url = pathToFileURL(join(__dirname, '../server/registry.mjs')).href
  const run = (office: ReturnType<typeof entry>) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import {addOffice} from ${JSON.stringify(url)};addOffice(${JSON.stringify(office)})`], {
      env: { ...process.env, AGENT_OFFICE_HOME: home, AGENT_OFFICE_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr || `Child exit ${code}`)))
  })
  // Keep observing the actual public file while both processes publish: every
  // visible revision must parse and contain complete unique entries.
  registry.addOffice(entry('off_seed01'))
  const observed: unknown[] = []
  let readError: unknown
  const observer = setInterval(() => {
    try {
      const building = JSON.parse(contents())
      expect(building.schemaVersion).toBe(1)
      expect(new Set(building.offices.map((office: { id: string }) => office.id)).size).toBe(building.offices.length)
      observed.push(building)
    } catch (error) { readError = error }
  }, 1)
  try { await Promise.all([run(entry('off_abc123')), run(entry('off_def456'))]) } finally { clearInterval(observer) }
  expect(readError).toBeUndefined()
  expect(observed.length).toBeGreaterThan(0)
  expect(registry.listOffices().map(o => o.id).sort()).toEqual(['default', 'off_abc123', 'off_def456', 'off_seed01'])
  expect(readdirSync(root)).toEqual(['building.json'])
})

it('keeps the prior revision visible while Windows replacement is temporarily denied', async () => {
  if (process.platform !== 'win32') return
  registry.addOffice(entry('off_seed01'))
  const before = contents()
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  let denied = 0
  vi.doMock('node:fs', () => ({ ...fs, renameSync(from: string, to: string) {
    if (to === join(root, 'building.json') && denied++ < 2) {
      expect(fs.readFileSync(to, 'utf8')).toBe(before)
      throw Object.assign(new Error('fixture: Windows reader holds destination'), { code: 'EPERM' })
    }
    return fs.renameSync(from, to)
  } }))
  try {
    vi.resetModules()
    const retrying = await import('../server/registry.mjs')
    retrying.addOffice(entry())
    expect(denied).toBe(3)
    expect(retrying.listOffices().map(office => office.id)).toEqual(['default', 'off_seed01', 'off_abc123'])
    expect(readdirSync(root)).toEqual(['building.json'])
  } finally { vi.doUnmock('node:fs'); vi.resetModules() }
})
