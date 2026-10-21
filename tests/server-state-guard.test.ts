// Guards for the Building/Levels plan (docs/building-and-levels.md section 4, rules 1, 3 and 4): server state
// that every office would share must not grow unnoticed. Static scan, no server is started.
// shortcut: a line scan of top-level declarations and known state-owner constructors — it misses a mutable object
// literal such as `const settings = {…}`; upgrade to a parser if the miss ever matters.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const serverDir = join(__dirname, '..', 'server')
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'server-state.json'), 'utf8'))
const files = readdirSync(serverDir).filter(f => /\.(js|mjs)$/.test(f)).sort()
const text = (f: string) => readFileSync(join(serverDir, f), 'utf8')

function scanState(): string[] {
  const found = new Set<string>()
  for (const f of files) {
    for (const line of text(f).split(/\r?\n/)) {
      const m = /^(?:const|let|var)\s+(\w+)\s*=\s*new\s+(?:Map|Set|WeakMap|WeakSet|AsyncLocalStorage)\b/.exec(line)
        ?? /^(?:const|let|var)\s+(\w+)\s*=\s*\[\s*\]/.exec(line)
        ?? /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:createOffice|createOfficeState|openChatDb|mountStatus|mountPermissions|mountHealth|mountRegistry|mountTasks)\(/.exec(line)
        ?? /^(?:const|let|var)\s+(\w+)\s*=\s*runInOffice\(.*\bmountStatus\(/.exec(line)
        ?? /^(?:const|let|var)\s+(\w+)\s*=\s*(?:express\(|express\.Router\(|createServer\(|new WebSocketServer\()/.exec(line)
        ?? /^let\s+(\w+)/.exec(line)
      if (m) found.add(`${f}:${m[1]}`)
      else if (/^(?:(?:const|let)\s+(\w+)\s*=\s*)?setInterval\(/.test(line)) found.add(`${f}:${/^(?:const|let)\s+(\w+)/.exec(line)?.[1] ?? 'setInterval'}`)
    }
  }
  return [...found].sort()
}

describe('server module-level state (Building plan, phase 0)', () => {
  it('no server, script, frontend or Electron module imports the removed homeDir export', () => {
    const offenders: string[] = []
    for (const dir of ['server', 'scripts', 'src', 'electron']) {
      const base = join(serverDir, '..', dir)
      for (const file of readdirSync(base, { recursive: true, withFileTypes: true })) {
        if (!file.isFile() || !/\.(?:[cm]?js|tsx?)$/.test(file.name)) continue
        const path = join(file.parentPath, file.name)
        if (/\b(?:import|export)\s*\{[^}]*\bhomeDir\b[^}]*\}\s*from\s*['"]/.test(readFileSync(path, 'utf8'))) offenders.push(path)
      }
    }
    expect(offenders, 'use g0Dir() or officeHome() instead').toEqual([])
  })
  it('no running-server module imports the blocking registry writes addOffice/removeOffice (they are CLI-only)', () => {
    const offenders = files.filter(f => f !== 'registry.mjs' && /\b(?:addOffice|removeOffice)\b/.test(text(f)))
    expect(offenders, 'registry writes block the event loop (see the shortcut note in server/registry.mjs)').toEqual([])
  })
  it('every module-level collection, state owner, `let` and interval is tagged G0 or OFFICE in tests/fixtures/server-state.json', () => {
    const tagged = Object.keys(fixture.state).sort()
    const found = scanState()
    expect(found.filter(k => !tagged.includes(k)), 'new module-level state: tag it G0 or OFFICE in tests/fixtures/server-state.json').toEqual([])
    expect(tagged.filter(k => !found.includes(k)), 'tagged state that no longer exists: remove it from the fixture').toEqual([])
    for (const [key, scope] of Object.entries(fixture.state)) expect(['G0', 'OFFICE'], key).toContain(scope)
  })

  it('process.cwd() and homeDir in server/ can only go down (rules 3 and 4): no new user, no new call', () => {
    const cwd = Object.fromEntries(files.map(f => [f, (text(f).match(/process\.cwd\(\)/g) ?? []).length]).filter(([, n]) => n))
    for (const [f, n] of Object.entries(cwd)) expect(n, `process.cwd() in server/${f}: pass the office cwd instead`).toBeLessThanOrEqual(fixture.ceilings.processCwd[f] ?? 0)
    const homeUsers = files.filter(f => /\bhomeDir\b/.test(text(f)))
    expect(homeUsers.filter(f => !fixture.ceilings.homeDirUsers.includes(f)), 'new homeDir user: use g0Dir() or officeHome() instead').toEqual([])
  })
})
