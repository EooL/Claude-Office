import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'office-needs-'))
process.env.AGENT_OFFICE_HOME = home
const t = await import('../server/tool-needs.mjs')
const a = await import('../server/availability.mjs')
const { adapters } = await import('../server/adapters.mjs')
afterAll(() => rmSync(home, { recursive: true, force: true }))
const dir = (n: string) => mkdtempSync(join(home, n))
const base = { service: 'agy', mode: 'plan', kind: 'permission', message: 'a tool required the command permission' }

describe('tool needs log', () => {
  it('hardening: redaction work is bounded for huge hostile key-like strings', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import {cleanToolText} from './server/tool-needs.mjs'; console.log(cleanToolText('a-'.repeat(50000), 200).length)"], { encoding: 'utf8', windowsHide: true, timeout: 2500 })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('200')
  })
  it('hardening: quoted secrets, case variants and terminal controls are redacted on write and read', () => {
    const h = dir('hostile-log')
    const command = 'token="two words" SK-ABCDEFGHIJK password=abc\u001b[31m'
    t.recordToolNeed(h, { ...base, command })
    expect(readFileSync(join(h, 'tool-needs.jsonl'), 'utf8')).not.toMatch(/two words|ABCDEFGHIJK|password=abc|\\u001b/)
    appendFileSync(join(h, 'tool-needs.jsonl'), JSON.stringify({ ...base, command }) + '\n')
    expect(JSON.stringify(t.readToolNeeds(h))).not.toMatch(/two words|ABCDEFGHIJK|password=abc|\\u001b/)
  })

  it('hardening: refuses oversized existing logs without loading them', () => {
    const h = dir('oversized-log')
    writeFileSync(join(h, 'tool-needs.jsonl'), 'x'.repeat(t.MAX_BYTES * 3))
    expect(t.recordToolNeed(h, base)).toBe(false)
    expect(t.readToolNeeds(h)).toEqual([])
    expect(statSync(join(h, 'tool-needs.jsonl')).size).toBe(t.MAX_BYTES * 3)
  })

  it('hardening: refuses log symlinks and conversation junction escapes', () => {
    const h = dir('log-link'), outside = dir('log-target'), file = join(outside, 'data')
    writeFileSync(file, 'owner bytes')
    try { symlinkSync(file, join(h, 'tool-needs.jsonl'), 'file') } catch (e: any) {
      if (['EPERM', 'EACCES'].includes(e.code)) return
      throw e
    }
    expect(t.recordToolNeed(h, base)).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('owner bytes')
    writeFileSync(file, '"CommandLine":"OUTSIDE_MARKER"')
    symlinkSync(file, join(h, 'conversation.db'), 'file')
    expect((adapters as any).agy.refusedCommand({ since: 0, env: { AGENT_OFFICE_AGY_CONVERSATIONS: h } })).toBe('')
  })
  it('round-trips, creates the file 0600 and skips corrupt lines', () => {
    const h = dir('rt')
    expect(t.recordToolNeed(h, { ...base, command: 'git grep "GOAL:"', task: 'x' })).toBe(true)
    appendFileSync(join(h, 'tool-needs.jsonl'), 'not json\n')
    t.recordToolNeed(h, base)
    const rows = t.readToolNeeds(h)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ service: 'agy', mode: 'plan', command: 'git grep "GOAL:"' })
    if (process.platform !== 'win32') expect(statSync(join(h, 'tool-needs.jsonl')).mode & 0o777).toBe(0o600)
    expect(t.readToolNeeds(h, { limit: 1 })).toHaveLength(1)
  })

  it('drops the oldest half past 1 MB', () => {
    const h = dir('cap')
    const line = JSON.stringify({ at: 'old', service: 'agy', mode: 'plan', kind: 'permission', message: 'x'.repeat(900) }) + '\n'
    writeFileSync(join(h, 'tool-needs.jsonl'), line.repeat(1200))
    t.recordToolNeed(h, { ...base, message: 'newest' })
    const rows = t.readToolNeeds(h, { limit: 5000 })
    expect(rows.length).toBeLessThan(700)
    expect(rows.at(-1).message).toBe('newest')
  })

  it('trims and redacts', () => {
    const h = dir('red')
    t.recordToolNeed(h, { ...base, message: 'm'.repeat(500) + ' C:\\Users\\bob\\proj sk-abcdef123456789 Bearer abcdef.ghijkl', command: `type C:\\Users\\bob\\.env token=hunter2 ${'c'.repeat(400)}`, task: 't'.repeat(300) })
    const [e] = t.readToolNeeds(h)
    expect(e.message).toHaveLength(240)
    expect(e.command.length).toBeLessThanOrEqual(200)
    expect(e.task).toHaveLength(120)
    const t2 = t.recordToolNeed(h, { ...base, message: 'C:\\Users\\bob\\proj sk-abcdef123456789 Bearer abcdef.ghijkl', command: 'type C:\\Users\\bob\\.env token=hunter2' })
    expect(t2).toBe(true)
    const e2 = t.readToolNeeds(h)[1]
    expect(e2.message).toBe('~\\proj [redacted] [redacted]')
    expect(e2.command).toBe('type ~\\.env token=[redacted]')
  })

  it('never throws on an unwritable home', () => {
    const f = join(home, 'afile'); writeFileSync(f, '')
    expect(t.recordToolNeed(join(f, 'sub'), base)).toBe(false)
    expect(t.recordToolNeed(undefined, base)).toBe(false)
    expect(t.readToolNeeds(join(f, 'sub'))).toEqual([])
  })

  it('summarises and maps commands to toolbox tools', () => {
    const at = (n: number) => `2026-10-22T10:00:0${n}Z`
    const rows = t.summariseToolNeeds([
      { at: at(1), ...base, command: 'git grep "GOAL:"' },
      { at: at(2), ...base, command: 'git grep "TODO"' },
      { at: at(3), ...base, command: 'Get-ChildItem -Path server -Recurse | Select-Object FullName' },
      { at: at(4), ...base, command: 'git status' },
      { at: at(5), ...base, command: 'docker ps' },
      { at: at(6), ...base, command: 'git log --oneline' },
      { at: at(7), ...base, command: 'git show HEAD' },
      { at: at(8), ...base, command: 'git diff' },
      { at: at(9), ...base, command: 'Get-Content a.txt' },
      { at: at(9), ...base, message: 'something odd 12' },
    ])
    expect(rows[0]).toMatchObject({ count: 2, service: 'agy', mode: 'plan', firstAt: at(1), lastAt: at(2) })
    expect(rows[0].commands).toHaveLength(2)
    const sug = (c: string) => rows.find((r: any) => r.commands.some((x: string) => x.startsWith(c))).suggestion
    expect(sug('git grep')).toMatch(/search_text/)
    expect(sug('Get-ChildItem')).toMatch(/list_files/)
    expect(sug('git status')).toMatch(/not covered/)
    expect(sug('docker')).toMatch(/candidate for a new tool/)
    expect(sug('git log')).toMatch(/git_log/)
    expect(sug('git show')).toMatch(/git_show/)
    expect(sug('git diff')).toMatch(/git_diff/)
    expect(sug('Get-Content')).toMatch(/read_file_range/)
  })
})

describe('agy refusedCommand hook', () => {
  const hook = (adapters as any).agy.refusedCommand
  it('hardening: bounds conversation reads and refuses symlinked databases', () => {
    const c = dir('bounded-conv'), outside = dir('outside-conv')
    writeFileSync(join(c, 'huge.db'), '"CommandLine":"PRIVATE_MARKER"' + 'x'.repeat(9 * 1024 * 1024))
    expect(hook({ since: 0, env: { AGENT_OFFICE_AGY_CONVERSATIONS: c } })).toBe('')
    rmSync(join(c, 'huge.db'))
    writeFileSync(join(outside, 'data'), '"CommandLine":"OUTSIDE_MARKER"')
    try { symlinkSync(join(outside, 'data'), join(c, 'link.db'), 'file') } catch (e: any) {
      if (['EPERM', 'EACCES'].includes(e.code)) { console.warn('SKIPPED database symlink:', e.code); return }
      throw e
    }
    expect(hook({ since: 0, env: { AGENT_OFFICE_AGY_CONVERSATIONS: c } })).toBe('')
  })
  it('takes the last CommandLine of the newest conversation, unescaped and capped', () => {
    const c = dir('conv')
    writeFileSync(join(c, 'old.db'), Buffer.from('"CommandLine":"old"'))
    utimesSync(join(c, 'old.db'), new Date(1000), new Date(1000))
    writeFileSync(join(c, 'new.db'), Buffer.concat([Buffer.from([0, 255, 1]), Buffer.from('"CommandLine":"first" xx "CommandLine":"git grep \\"GOAL:\\" C:\\\\x"'), Buffer.from([0, 2])]))
    expect(hook({ since: 5000, env: { AGENT_OFFICE_AGY_CONVERSATIONS: c } })).toBe('git grep "GOAL:" C:\\x')
    expect(hook({ since: Date.now() + 100000, env: { AGENT_OFFICE_AGY_CONVERSATIONS: c } })).toBe('')
    writeFileSync(join(c, 'new.db'), `"CommandLine":"${'z'.repeat(500)}"`)
    expect(hook({ since: 5000, env: { AGENT_OFFICE_AGY_CONVERSATIONS: c } })).toHaveLength(200)
  })
  it('redacts a credential value that crosses the 200-character cut instead of leaving a fragment of it', () => {
    const c = dir('conv-secret')
    // `token="..."` whose value runs past character 200: cutting before redaction used to leave the tail behind
    const command = `echo ${'a'.repeat(150)} token="SECRET_VALUE_THAT_CROSSES_THE_CUT trailing words" && done`
    writeFileSync(join(c, 'x.db'), `"CommandLine":"${command.replace(/"/g, '\\"')}"`)
    const out = hook({ since: 0, env: { AGENT_OFFICE_AGY_CONVERSATIONS: c } })
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out).not.toMatch(/SECRET_VALUE|CROSSES|trailing|SECRET/)
    expect(out).toContain('[redacted]')
  })
  it('gives an empty string for a missing folder', () => {
    expect(hook({ since: 0, env: { AGENT_OFFICE_AGY_CONVERSATIONS: join(home, 'nope') } })).toBe('')
  })
})

describe('permission failure through the circuit', () => {
  it('records exactly one need and leaves the circuit as it would be without it', () => {
    a.clearCooldown()
    const step = { service: 'agy', model: 'm' }
    const now = Date.now()
    const failure = { kind: 'permission', retryAfterMs: 120000, hinted: false, message: 'headless mode cannot prompt', command: 'git grep "GOAL:"' }
    const before = t.readToolNeeds(home).length
    const lease = a.beginCircuit(step, { mode: 'plan', now })
    a.finishCircuit(lease, step, failure, { mode: 'plan', now })
    expect(a.readCooldowns(now)['agy@plan']).toMatchObject({ state: 'open', failures: 1, kind: 'permission', until: now + 120000 })
    const rows = t.readToolNeeds(home)
    expect(rows).toHaveLength(before + 1)
    expect(rows.at(-1)).toMatchObject({ service: 'agy', mode: 'plan', command: 'git grep "GOAL:"' })
    // other kinds record nothing
    const l2 = a.beginCircuit({ service: 'codex' }, { now })
    a.finishCircuit(l2, { service: 'codex' }, { kind: 'unavailable', retryAfterMs: 1000, message: 'down' }, { now })
    expect(t.readToolNeeds(home)).toHaveLength(before + 1)
    a.clearCooldown()
  })
})

describe('npm run toolbox-needs', () => {
  it('prints the table and the task template for a temp home, and json', () => {
    const h = dir('script')
    t.recordToolNeed(h, { ...base, command: 'git grep "GOAL:"' })
    t.recordToolNeed(h, { ...base, command: 'git grep "x"' })
    const script = resolve('scripts/toolbox-needs.mjs')
    const out = spawnSync(process.execPath, [script, '--home', h], { encoding: 'utf8' }).stdout
    expect(out).toMatch(/^COUNT/)
    expect(out).toMatch(/2\tagy\tplan\tgit grep.*search_text covers this/)
    expect(out).toMatch(/TASK TEMPLATE[\s\S]*Read docs\/office-toolbox\.md[\s\S]*do not change files\./)
    const json = JSON.parse(spawnSync(process.execPath, [script, '--home', h, '--json'], { encoding: 'utf8' }).stdout)
    expect(json.rows[0].count).toBe(2)
    expect(spawnSync(process.execPath, [script, '--home', join(h, 'none')], { encoding: 'utf8' }).stdout).toMatch(/No refused commands/)
  })
})
