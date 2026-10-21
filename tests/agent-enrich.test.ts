import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM module
import { enrichProfile, validateAnswer } from '../server/agent-enrich.mjs'
// @ts-expect-error plain ESM module
import * as P from '../server/agent-profiles.mjs'

let home = ''
let cwd = ''
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'enrich-home-')); cwd = mkdtempSync(join(tmpdir(), 'enrich-cwd-')) })
afterEach(() => { rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }) })

const file = (role: string) => join(home, 'agent-profiles', `${role}.md`)
const good = (over: Record<string, unknown> = {}) => ({
  whoYouAre: 'You are the debugger of this project and you find the cause of a failure from evidence.',
  mission: 'Find the root cause of failures and propose the smallest fix.',
  responsibilities: ['Reproduce the failure first.', 'Trace it to the root cause.', 'Propose the smallest fix.'],
  receive: 'an error message or a failing test.',
  handBack: 'the cause, the fix and a regression test.',
  mustNot: ['Never hide a failure behind a retry.', 'Never skip a failing test.', 'Never guess a cause without evidence.', 'Never leave debug output behind.'],
  askFirst: ['The fix changes visible behaviour.', 'The bug needs real data.'],
  done: ['The cause is named with evidence.', 'A regression test passes.'],
  ...over,
})
const fake = (...answers: unknown[]) => {
  const prompts: string[] = []
  const run = async (_r: string, prompt: string, opts: any) => {
    prompts.push(prompt)
    expect(opts.mode).toBe('chat')
    const a = answers[Math.min(prompts.length - 1, answers.length - 1)]
    return { text: typeof a === 'string' ? a : JSON.stringify(a), code: 0, usage: { input: 1, output: 2 } }
  }
  return { run, prompts }
}

describe('prompt', () => {
  it('carries the facts, caps README at 3000 characters and drops secret-looking lines', async () => {
    writeFileSync(join(cwd, 'AGENTS.md'), 'Use pnpm.\nAPI_KEY=abc123\nmy password: hunter2\nAfter the secret line.\n')
    writeFileSync(join(cwd, 'README.md'), `${'x'.repeat(3000)}TAILMARK`)
    const { run, prompts } = fake(good())
    await enrichProfile('debugger', { home, cwd, run, dryRun: true })
    const p = prompts[0]
    for (const s of ['Role id: debugger', 'Reports to:', 'Routing words:', 'Tools:', 'Disallowed tools:', 'Access:', '## Who you are', 'Use pnpm.', 'After the secret line.']) expect(p).toContain(s)
    expect(p).not.toContain('abc123')
    expect(p).not.toContain('hunter2')
    expect(p).not.toContain('TAILMARK')
    expect(p).toContain('x'.repeat(3000))
  })
})

describe('valid answer', () => {
  it('makes a draft that validates, keeps the baseline first and round-trips', async () => {
    const before = P.loadProfile('debugger', { home })
    const { run } = fake(`\`\`\`json\n${JSON.stringify(good({ mustNot: ['Never skip a failing test.', 'Never commit, push, tag or deploy unless the boss asked for it in this task.', 'Never hide a failure.', 'Never guess.'] }))}\n\`\`\``)
    const r = await enrichProfile('debugger', { home, cwd, run })
    expect(r.status).toBe('draft')
    expect(r.usage).toEqual({ input: 1, output: 2 })
    expect(r.diff).toContain('+ ')
    const p = P.parseProfile(r.text)
    expect(P.validateProfile(p, { role: 'debugger' }).ok).toBe(true)
    const base = P.defaultProfile('debugger').body.split('# What you must not do\n')[1].split('\n# ')[0].split('\n')
    const mine = p.body.split('# What you must not do\n')[1].split('\n# ')[0].split('\n')
    expect(mine.slice(0, base.length)).toEqual(base)
    expect(mine.filter((l: string) => l.includes('commit, push, tag'))).toHaveLength(1)
    expect(mine).toContain('- Never hide a failure.')
    const after = P.loadProfile('debugger', { home })
    expect(after.source).toBe('override')
    expect(after.profile.frontmatter.office.status).toBe('draft')
    expect(after.hash).toBe(r.hash)
    expect(after.hash).not.toBe(before.hash)
  })
  it('dryRun writes nothing', async () => {
    const r = await enrichProfile('debugger', { home, cwd, run: fake(good()).run, dryRun: true })
    expect(r.diff).not.toBe('')
    expect(existsSync(file('debugger'))).toBe(false)
  })
  it('two roles do not interfere', async () => {
    await enrichProfile('debugger', { home, cwd, run: fake(good()).run })
    await enrichProfile('test-engineer', { home, cwd, run: fake(good({ mission: 'Write tests that fail for the right reason.' })).run })
    expect(P.loadProfile('debugger', { home }).profile.body).toContain('Find the root cause')
    expect(P.loadProfile('test-engineer', { home }).profile.body).toContain('Write tests that fail')
    expect(P.loadProfile('test-engineer', { home }).profile.body).not.toContain('Find the root cause')
  })
})

describe('invalid answers', () => {
  const cases: [string, unknown, RegExp][] = [
    ['bad json', 'not json at all', /not valid JSON/],
    ['unknown key', good({ extra: 'x' }), /unknown key "extra"/],
    ['too long', good({ mission: 'm'.repeat(401) }), /limit is 400/],
    ['too few items', good({ responsibilities: ['one', 'two'] }), /3 to 8/],
    ['empty item', good({ done: ['ok', ' '] }), /non-empty/],
    ['tool outside vocabulary', good({ whoYouAre: 'You can use WebSearch and Read to look things up.' }), /WebSearch/],
    ['allows push', good({ mustNot: ['You may push to the main branch when the tests pass.', 'a', 'b', 'c'] }), /loosens/],
    ['allows secrets', good({ responsibilities: ['Feel free to read the .env file.', 'b', 'c'] }), /loosens/],
    ['non-prohibition must-not', good({ mustNot: ['Deploy after every fix.', 'a', 'b', 'c'] }), /not a prohibition/],
    ['html', good({ mission: 'Fix <b>bugs</b>.' }), /HTML/],
    ['heading', good({ mission: 'Fix bugs.\n# Extra heading' }), /heading/],
    ['url', good({ receive: 'see https://example.com' }), /URL/],
  ]
  for (const [name, answer, re] of cases) {
    it(`rejects ${name} and writes nothing`, async () => {
      const { run, prompts } = fake(answer)
      await expect(enrichProfile('debugger', { home, cwd, run })).rejects.toThrow(re)
      expect(prompts).toHaveLength(2)
      expect(existsSync(file('debugger'))).toBe(false)
    })
  }
  it('allows negated mentions of risky actions', () => {
    expect(validateAnswer(JSON.stringify(good({ mustNot: ['You may not push.', 'Never read secrets.', 'Do not deploy.', 'Never leave the project folder.'] }))).errors).toBeUndefined()
  })
})

describe('retry', () => {
  it('sends the errors with the second call, which can succeed', async () => {
    const { run, prompts } = fake(good({ extra: 1 }), good())
    const r = await enrichProfile('debugger', { home, cwd, run })
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('unknown key "extra"')
    expect(prompts[0]).not.toContain('unknown key')
    expect(r.status).toBe('draft')
    expect(existsSync(file('debugger'))).toBe(true)
  })
})

describe('protection', () => {
  const seed = (role: string, status: string, locked = false) => {
    const p = P.defaultProfile(role)
    p.frontmatter.office.locked = locked
    P.saveProfile(role, P.serializeProfile(p), { home, status })
    return P.loadProfile(role, { home }).hash
  }
  it('refuses a locked profile and leaves it untouched', async () => {
    const h = seed('debugger', 'draft', true)
    const { run, prompts } = fake(good())
    await expect(enrichProfile('debugger', { home, cwd, run })).rejects.toThrow(/locked/)
    expect(prompts).toHaveLength(0)
    expect(P.loadProfile('debugger', { home }).hash).toBe(h)
  })
  it('refuses an approved profile unless forced', async () => {
    const h = seed('debugger', 'approved')
    await expect(enrichProfile('debugger', { home, cwd, run: fake(good()).run })).rejects.toThrow(/approved/)
    expect(P.loadProfile('debugger', { home }).hash).toBe(h)
    const r = await enrichProfile('debugger', { home, cwd, run: fake(good()).run, force: true })
    expect(r.status).toBe('draft')
    expect(P.loadProfile('debugger', { home }).profile.frontmatter.office.status).toBe('draft')
  })
})

describe('model failures', () => {
  it('reports a throwing run and an error result, writing nothing', async () => {
    await expect(enrichProfile('debugger', { home, cwd, run: async () => { throw new Error('boom') } })).rejects.toThrow(/boom/)
    await expect(enrichProfile('debugger', { home, cwd, run: async () => ({ text: '', code: 1, error: 'service down' }) })).rejects.toThrow(/service down/)
    expect(existsSync(join(home, 'agent-profiles'))).toBe(false)
    mkdirSync(home, { recursive: true })
  })
})
