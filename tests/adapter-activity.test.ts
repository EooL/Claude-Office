// timeoutMs is a soft deadline: a CLI that is still active (output, or the adapter's probe) is let work until maxMs.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'office-adapter-activity-'))
const oldHome = process.env.AGENT_OFFICE_HOME
process.env.AGENT_OFFICE_HOME = join(dir, 'home')
mkdirSync(process.env.AGENT_OFFICE_HOME, { recursive: true })
const { runAdapter, adapters } = await import('../server/adapters.mjs')

afterAll(() => {
  if (oldHome === undefined) delete process.env.AGENT_OFFICE_HOME
  else process.env.AGENT_OFFICE_HOME = oldHome
  for (const n of ['OPENCODE', 'AGY', 'QODER']) delete process.env[`AGENT_OFFICE_BIN_${n}`]
  rmSync(dir, { recursive: true, force: true })
})

// FAKE_MODE: chatty = print every 100 ms for FAKE_MS then end; forever = print until killed; quiet = say nothing for
// FAKE_MS; touch = say nothing but rewrite FAKE_FILE every 100 ms for FAKE_MS. All end with an answer on stdout.
const fake = join(dir, 'fake.mjs')
writeFileSync(fake, `
import { writeFileSync } from 'node:fs'
const { FAKE_MODE: mode, FAKE_MS: ms = '0', FAKE_FILE: file } = process.env
const end = Date.now() + Number(ms)
const tick = setInterval(() => {
  if (mode === 'chatty' || mode === 'forever') process.stdout.write('.')
  if (mode === 'touch') writeFileSync(file, String(Date.now()))
  if (mode !== 'forever' && Date.now() >= end) { clearInterval(tick); console.log('done') }
}, 100)
`)
for (const n of ['OPENCODE', 'AGY', 'QODER']) process.env[`AGENT_OFFICE_BIN_${n}`] = `"${process.execPath}" "${fake}"`

const run = (name: string, env: Record<string, string>, opts: Record<string, number> = {}) =>
  runAdapter(name, 'hi', { timeoutMs: 500, activeWindowMs: 400, maxMs: 4000, env, ...opts })

describe('soft deadline', () => {
  it('lets a CLI that keeps printing go past timeoutMs', async () => {
    const r = await run('opencode', { FAKE_MODE: 'chatty', FAKE_MS: '1500' })
    expect(r.error).toBe('')
    expect(r.code).toBe(0)
    expect(r.durationMs).toBeGreaterThan(1200)
  })

  it('ends a silent CLI at timeoutMs, with the usual error', async () => {
    const r = await run('opencode', { FAKE_MODE: 'quiet', FAKE_MS: '5000' })
    expect(r.error).toContain('opencode timed out')
    expect(r.durationMs).toBeLessThan(2500)
  })

  it('stops a chatty CLI that never ends at maxMs', async () => {
    const r = await run('opencode', { FAKE_MODE: 'forever' }, { maxMs: 1500 })
    expect(r.error).toContain('opencode timed out')
    expect(r.durationMs).toBeGreaterThanOrEqual(1400)
    expect(r.durationMs).toBeLessThan(3500)
  })

  it('treats a probe that throws as no activity', async () => {
    const adapter = adapters.opencode
    adapter.activity = () => { throw new Error('boom') }
    try {
      const r = await run('opencode', { FAKE_MODE: 'quiet', FAKE_MS: '5000' })
      expect(r.error).toContain('opencode timed out')
      expect(r.durationMs).toBeLessThan(2500)
    } finally { delete adapter.activity }
  })
})

describe('probes', () => {
  it('agy: a silent run that keeps touching a conversation .db is not killed; without it, it is', async () => {
    const conv = join(dir, 'conversations')
    mkdirSync(conv, { recursive: true })
    const busy = await run('agy', { FAKE_MODE: 'touch', FAKE_MS: '1500', FAKE_FILE: join(conv, 'a.db'), AGENT_OFFICE_AGY_CONVERSATIONS: conv })
    expect(busy.error).toBe('')
    expect(busy.durationMs).toBeGreaterThan(1200)
    // a file older than the run and a non-db file do not count
    const old = join(conv, 'old.db')
    writeFileSync(old, 'x')
    utimesSync(old, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
    const idle = await run('agy', { FAKE_MODE: 'quiet', FAKE_MS: '5000', AGENT_OFFICE_AGY_CONVERSATIONS: conv })
    expect(idle.error).toContain('agy timed out')
    expect(idle.durationMs).toBeLessThan(2500)
  })

  it('qoder: a silent run that keeps writing qodercli.log is not killed; without it, it is', async () => {
    const runs = join(dir, 'qoder-runs')
    mkdirSync(join(runs, 'r1'), { recursive: true })
    const busy = await run('qoder', { FAKE_MODE: 'touch', FAKE_MS: '1500', FAKE_FILE: join(runs, 'r1', 'qodercli.log'), AGENT_OFFICE_QODER_LOGS: runs })
    expect(busy.error).toBe('')
    expect(busy.durationMs).toBeGreaterThan(1200)
    const empty = join(dir, 'qoder-empty')
    mkdirSync(empty, { recursive: true })
    const idle = await run('qoder', { FAKE_MODE: 'quiet', FAKE_MS: '5000', AGENT_OFFICE_QODER_LOGS: empty })
    expect(idle.error).toContain('qoder timed out')
    expect(idle.durationMs).toBeLessThan(2500)
  })
})
