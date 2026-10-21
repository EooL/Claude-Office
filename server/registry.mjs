import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { defaultOfficeContext } from './office-context.mjs'
import { canonicalCwd, isNested } from './canonicalCwd.mjs'
import { acquireProcessLock } from './process-lock.mjs'

export function buildingRoot() {
  return process.env.AGENT_OFFICE_ROOT || join(homedir(), '.claude-office')
}

export function validOfficeId(id) {
  return typeof id === 'string' && id === id.trim() && /^(?:default|off_[a-z0-9]{6,12})$/.test(id)
}

function validate(building) {
  if (!building || building.schemaVersion !== 1) throw new Error('Unsupported building schemaVersion')
  if (!Array.isArray(building.offices) || building.offices.length > 16) throw new Error('Invalid building offices (maximum 16)')
  const ids = new Set()
  for (const office of building.offices) {
    if (!office || !validOfficeId(office.id)) throw new Error('Invalid office id')
    if (ids.has(office.id)) throw new Error('Duplicate office id')
    ids.add(office.id)
    if (typeof office.home !== 'string' || !office.home || typeof office.cwd !== 'string' || !office.cwd) throw new Error('Office requires home and cwd')
  }
  if (building.g0Home !== undefined && (typeof building.g0Home !== 'string' || !building.g0Home)) throw new Error('Invalid G0 home')
  return building
}

// BUILDING: parsed registry per file, keyed by what the file is on disk. Every g0Dir()/officeHome() lookup comes
// through readBuilding(), so re-reading and parsing the file each time cost ~0.5 ms (and an exception when absent).
// Every write is a rename of a new file, so inode, mtime and size together change with it.
const cache = new Map()

/** Missing registry is an in-memory compatibility view, never an initialization. */
export function readBuilding() {
  const file = join(buildingRoot(), 'building.json')
  const stat = statSync(file, { bigint: true, throwIfNoEntry: false })
  if (!stat) {
    cache.delete(file)
    return { schemaVersion: 1, offices: [{ id: 'default', home: defaultOfficeContext.home, cwd: defaultOfficeContext.cwd }] }
  }
  const key = `${stat.ino}:${stat.mtimeNs}:${stat.size}`
  const hit = cache.get(file)
  if (hit?.key === key) return structuredClone(hit.value) // a copy: no caller can change what the next one reads
  try {
    const value = validate(JSON.parse(readFileSync(file, 'utf8')))
    cache.set(file, { key, value })
    return structuredClone(value)
  } catch (error) {
    cache.delete(file)
    // Every path lookup (g0Dir, officeHome) goes through here, so a bad file stops the app: say which file and how to recover.
    // The file can also vanish between the stat and the read: that is the normal single-office view, not an error.
    if (error.code === 'ENOENT') return { schemaVersion: 1, offices: [{ id: 'default', home: defaultOfficeContext.home, cwd: defaultOfficeContext.cwd }] }
    throw new Error(`${error.message}. ${file} cannot be used; fix it, or delete it to return to the single-office view (it holds nothing else).`, { cause: error })
  }
}

export function listOffices() { return readBuilding().offices }

function overlap(a, b) {
  return canonicalCwd(a) === canonicalCwd(b) || isNested(a, b) || isNested(b, a)
}

function writeBuilding(building) {
  const file = join(buildingRoot(), 'building.json')
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(validate(building), null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    // Windows readers/virus scanners can briefly prevent replacement. Keep the
    // old revision intact and retry the atomic rename while holding the lock.
    const deadline = Date.now() + 5000 // a loaded machine (4 test workers, a polling reader) outlasted 1 s
    for (;;) {
      try { renameSync(temporary, file); break } catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || Date.now() >= deadline) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      }
    }
  } finally { rmSync(temporary, { force: true }) }
}

// shortcut: addOffice/removeOffice are synchronous. Waiting for the building lock (up to 5 s) and for a Windows
// rename (up to 5 s) blocks the calling thread, so they are for a CLI or a short-lived child process, never for a
// request handler of the running server (it would freeze every office). Upgrade: make them async with timers
// when a UI action has to call them. tests/server-state-guard.test.ts fails if a server module imports them.
function mutate(operation) {
  // Refuse unsupported schemas before even creating the mutation lock directory.
  readBuilding()
  const deadline = Date.now() + 5000
  let release
  do {
    release = acquireProcessLock(join(buildingRoot(), 'building.lock'))
    if (!release) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
  } while (!release && Date.now() < deadline)
  if (!release) throw new Error('Building registry is busy')
  try { return operation(readBuilding()) } finally { release() }
}

export function addOffice(office) {
  if (!office || !validOfficeId(office.id)) throw new Error('Invalid office id')
  if (typeof office.home !== 'string' || !office.home || typeof office.cwd !== 'string' || !office.cwd) throw new Error('Office requires home and cwd')
  return mutate(building => {
    if (building.offices.some(entry => entry.id === office.id)) throw new Error('Duplicate office id')
    if (building.offices.length >= 16) throw new Error('Maximum 16 offices')
    if (building.offices.some(entry => overlap(entry.cwd, office.cwd))) throw new Error('Office cwd duplicates or overlaps another office')
    if (overlap(office.cwd, buildingRoot()) || overlap(office.cwd, join(homedir(), '.claude-office'))) throw new Error('Office cwd overlaps the building root')
    // Homes hold the database and the token: two offices must never share or nest them, and a home may not sit in
    // (or around) any project folder, where a sandboxed worker could write into it. Under <root>/levels is fine.
    const g0Home = building.g0Home ?? defaultOfficeContext.home
    if ([g0Home, ...building.offices.map(entry => entry.home)].some(home => overlap(home, office.home))) throw new Error('Office home duplicates or overlaps another home or G0 state')
    if (overlap(office.home, office.cwd) || building.offices.some(entry => overlap(office.home, entry.cwd))) throw new Error('Office home overlaps a project folder')
    if (building.offices.some(entry => overlap(entry.home, office.cwd))) throw new Error('Office cwd overlaps another office home')
    if (canonicalCwd(office.home) === canonicalCwd(buildingRoot()) || isNested(office.home, buildingRoot())) throw new Error('Office home equals or contains the building root')
    const entry = { ...office }
    const next = { ...building, g0Home: building.g0Home ?? defaultOfficeContext.home, offices: [...building.offices, entry] }
    writeBuilding(next)
    return entry
  })
}

export function removeOffice(id) {
  if (!validOfficeId(id)) throw new Error('Invalid office id')
  return mutate(building => {
    const office = building.offices.find(entry => entry.id === id)
    if (!office) throw new Error('Unknown office id')
    const g0Home = building.g0Home ?? defaultOfficeContext.home
    if (overlap(office.home, g0Home)) throw new Error('Cannot archive the legacy office while its home contains G0 state')
    if (building.offices.some(entry => overlap(office.home, entry.cwd))) throw new Error('Cannot archive a home overlapping a project folder')
    if (building.offices.some(entry => entry.id !== id && overlap(office.home, entry.home))) throw new Error('Cannot archive overlapping office homes')
    if (canonicalCwd(office.home) === canonicalCwd(buildingRoot()) || isNested(office.home, buildingRoot())) throw new Error('Cannot archive a home containing the building root')
    if (canonicalCwd(office.home) === canonicalCwd(join(buildingRoot(), 'archive')) || isNested(office.home, join(buildingRoot(), 'archive'))) throw new Error('Cannot archive a home containing the archive directory')
    const archive = join(buildingRoot(), 'archive', `${id}-${Date.now()}-${randomUUID()}`)
    const present = existsSync(office.home)
    if (present) { mkdirSync(dirname(archive), { recursive: true }); renameSync(office.home, archive) }
    try {
      writeBuilding({ ...building, g0Home, offices: building.offices.filter(entry => entry.id !== id) })
    } catch (error) {
      if (present) renameSync(archive, office.home)
      throw error
    }
    return { ...office, archive: present ? archive : null }
  })
}
