import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM module
import * as P from '../server/agent-profiles.mjs'
// @ts-expect-error plain ESM module
import { listRoles } from '../server/roles.mjs'

const roles: { role: string; name: string }[] = listRoles()
let home = ''
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'agent-profiles-')) })
afterEach(() => { rmSync(home, { recursive: true, force: true }) })

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const errorsOf = (p: any, role?: string) => P.validateProfile(p, { roles: listRoles(), role }).errors.map((e: any) => e.field ?? e.message)
const text = (role: string) => P.serializeProfile(P.defaultProfile(role))
const lineOf = (fn: () => unknown) => { try { fn() } catch (e: any) { return e.errors[0].line } return -1 }

describe('parseProfile', () => {
  it('parses every supported construct', () => {
    const { frontmatter: f, body } = P.parseProfile([
      '---', '# a comment', 'a: plain text # trailing', 'b: "quoted: \\"x\\""', "c: 'it''s'", 'd: 42', 'e: true', 'f: false', 'g: null', 'h: -1.5',
      'i: [x, "y, z", 3]', 'j:', '  - one', '  - two', 'k:', '  sub: value', '  list: [a, b]', '  map: { chat: read, plan: read }', 'empty:', '---', '', '# Title', 'text', ''].join('\n'))
    expect(f).toEqual({ a: 'plain text', b: 'quoted: "x"', c: "it's", d: 42, e: true, f: false, g: null, h: -1.5, i: ['x', 'y, z', 3], j: ['one', 'two'], k: { sub: 'value', list: ['a', 'b'], map: { chat: 'read', plan: 'read' } }, empty: null })
    expect(body).toBe('# Title\ntext')
  })
  it('tolerates CRLF and a hash inside a word', () => {
    expect(P.parseProfile('---\r\na: c#sharp\r\nb: [x]\r\n---\r\nbody\r\n')).toEqual({ frontmatter: { a: 'c#sharp', b: ['x'] }, body: 'body' })
  })
  it('refuses bad input with line numbers', () => {
    expect(lineOf(() => P.parseProfile('no frontmatter'))).toBe(1)
    expect(lineOf(() => P.parseProfile('---\na: 1\n'))).toBe(1)
    expect(lineOf(() => P.parseProfile('---\na: 1\na: 2\n---\n'))).toBe(3)
    expect(lineOf(() => P.parseProfile('---\na: 1\n\tb: 2\n---\n'))).toBe(3)
    expect(lineOf(() => P.parseProfile('---\na: 1\n    deep: 2\n---\n'))).toBe(3)
    expect(lineOf(() => P.parseProfile('---\nk:\n  s: 1\n  s: 2\n---\n'))).toBe(4)
    expect(lineOf(() => P.parseProfile('---\nk:\n  s: 1\n  - x\n---\n'))).toBe(4)
    expect(lineOf(() => P.parseProfile('---\nk:\n  s:\n    t: 1\n---\n'))).toBe(3)
    expect(lineOf(() => P.parseProfile('---\na: |\n  text\n---\n'))).toBe(2)
    expect(lineOf(() => P.parseProfile('---\na: &x 1\n---\n'))).toBe(2)
    expect(lineOf(() => P.parseProfile('---\njust words\n---\n'))).toBe(2)
    expect(lineOf(() => P.parseProfile('---\na: [x, y\n---\n'))).toBe(2)
    expect(lineOf(() => P.parseProfile('---\na: "open\n---\n'))).toBe(2)
    expect(() => P.parseProfile('---\n__proto__: 1\n---\n')).toThrow(P.ProfileError)
  })
})

describe('serializeProfile', () => {
  it('round-trips every default profile and awkward strings', () => {
    for (const { role } of roles) { const p = P.defaultProfile(role); expect(P.parseProfile(P.serializeProfile(p))).toEqual(p) }
    const odd = { frontmatter: { name: 'x', description: 'a, b: c # d "q" \'s\'', tools: [], model: 'true', effort: '12', office: { displayName: '', routes: ['a,b', ' x'], access: { chat: 'none' }, reportsTo: null, locked: true } }, body: 'b' }
    expect(P.parseProfile(P.serializeProfile(odd))).toEqual(odd)
  })
  it('is canonical: stable key order and LF', () => {
    const s = P.serializeProfile({ frontmatter: { effort: 'low', name: 'x' }, body: 'b' })
    expect(s).toBe('---\nname: x\neffort: low\n---\nb\n')
  })
})

describe('validateProfile', () => {
  it('accepts a default profile', () => expect(P.validateProfile(P.defaultProfile('debugger'), { roles })).toEqual({ ok: true, errors: [] }))
  const base = () => clone(P.defaultProfile('debugger'))
  const cases: [string, (p: any) => void, string][] = [
    ['name not kebab', (p) => { p.frontmatter.name = 'Bad_Name' }, 'name'],
    ['name too long', (p) => { p.frontmatter.name = 'a'.repeat(65) }, 'name'],
    ['name unknown role', (p) => { p.frontmatter.name = 'nobody' }, 'name'],
    ['description short', (p) => { p.frontmatter.description = 'too short' }, 'description'],
    ['description long', (p) => { p.frontmatter.description = 'x'.repeat(501) }, 'description'],
    ['tool outside vocabulary', (p) => { p.frontmatter.tools = ['Read', 'Sudo'] }, 'tools'],
    ['disallowedTools not a list', (p) => { p.frontmatter.disallowedTools = 'Write' }, 'disallowedTools'],
    ['bad model', (p) => { p.frontmatter.model = 'gpt' }, 'model'],
    ['bad effort', (p) => { p.frontmatter.effort = 'extreme' }, 'effort'],
    ['unknown top field', (p) => { p.frontmatter.color = 'red' }, 'color'],
    ['no office', (p) => { delete p.frontmatter.office }, 'office'],
    ['empty displayName', (p) => { p.frontmatter.office.displayName = '' }, 'office.displayName'],
    ['unknown reportsTo', (p) => { p.frontmatter.office.reportsTo = 'ghost' }, 'office.reportsTo'],
    ['routes not strings', (p) => { p.frontmatter.office.routes = [1] }, 'office.routes'],
    ['bad chat', (p) => { p.frontmatter.office.access.chat = 'write' }, 'office.access.chat'],
    ['bad plan', (p) => { p.frontmatter.office.access.plan = 'write' }, 'office.access.plan'],
    ['bad write', (p) => { p.frontmatter.office.access.write = 'anything' }, 'office.access.write'],
    ['unknown delegate', (p) => { p.frontmatter.office.mayDelegateTo = ['ghost'] }, 'office.mayDelegateTo'],
    ['bad escalatesTo', (p) => { p.frontmatter.office.escalatesTo = 'ceo' }, 'office.escalatesTo'],
    ['bad status', (p) => { p.frontmatter.office.status = 'live' }, 'office.status'],
    ['locked not boolean', (p) => { p.frontmatter.office.locked = 'yes' }, 'office.locked'],
    ['tool both allowed and disallowed', (p) => { p.frontmatter.disallowedTools = ['Write'] }, 'tools'],
    ['Write without write access', (p) => { delete p.frontmatter.office.access.write }, 'tools'],
    ['missing section', (p) => { p.body = p.body.replace('# Definition of done', '# Done') }, 'body'],
    ['sections out of order', (p) => { const [rest, done] = p.body.split('# Definition of done'); p.body = '# Definition of done' + done + '\n' + rest }, 'body'],
    ['empty section', (p) => { p.body = p.body.replace(/# Ask the boss first when\n[\s\S]*?# Definition/, '# Ask the boss first when\n# Definition') }, 'body'],
    ['file over 20 KB', (p) => { p.body += '\n' + 'x'.repeat(21000) }, 'file'],
  ]
  it.each(cases)('rejects: %s', (_n, mutate, field) => {
    const p = base(); mutate(p)
    expect(errorsOf(p)).toContain(field)
  })
  it.each(cases)('reports the exact source line: %s', (name, mutate, field) => {
    const p = base(); mutate(p)
    const parsed = P.parseProfile(P.serializeProfile(p))
    const lines: Record<string, number> = {
      name: 2, description: 3, tools: 4, disallowedTools: 5, model: 6, effort: 7, color: 17,
      office: 1, 'office.displayName': 9, 'office.reportsTo': 10, 'office.routes': 11,
      'office.access.chat': 12, 'office.access.plan': 12, 'office.access.write': 12,
      'office.mayDelegateTo': 13, 'office.escalatesTo': 14, 'office.status': 15, 'office.locked': 16,
      file: 1,
    }
    const bodyLines: Record<string, number> = { 'missing section': 42, 'sections out of order': 18, 'empty section': 39 }
    expect(P.validateProfile(parsed, { roles }).errors.find((e: any) => e.field === field)?.line).toBe(field === 'body' ? bodyLines[name] : lines[field])
  })
  it('pins block-list items and nested/unknown keys to their actual lines, including CRLF', () => {
    const source = text('debugger').replace('tools: [Read, Grep, Glob, Bash, Write, Edit]', 'tools:\n  - Read\n  - Sudo')
      .replace('  locked: false', '  locked: false\n  mystery: true').replace('effort: high', 'effort: nope')
    const errors = P.validateProfile(P.parseProfile(source.replaceAll('\n', '\r\n')), { roles }).errors
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'tools', line: 6 }),
      expect.objectContaining({ field: 'effort', line: 9 }),
      expect.objectContaining({ field: 'office.mystery', line: 19 }),
    ]))
  })
  it('gives lines to missing frontmatter, office access, unknown access and mismatched name', () => {
    expect(P.validateProfile({ body: '' }).errors).toEqual([{ message: 'missing frontmatter', line: 1 }])
    const p = base(); p.frontmatter.office.access = 'bad'
    expect(P.validateProfile(P.parseProfile(P.serializeProfile(p))).errors).toContainEqual({ field: 'office.access', message: 'must be a map with chat, plan and (optionally) write', line: 12 })
    p.frontmatter.office.access = { chat: 'read', plan: 'read', other: true, write: 'edit-after-approval' }
    expect(P.validateProfile(P.parseProfile(P.serializeProfile(p))).errors).toContainEqual({ field: 'office.access.other', message: 'unknown field', line: 12 })
    expect(P.validateProfile(P.parseProfile(text('debugger')), { role: 'assistant' }).errors[0].line).toBe(2)
  })
  it('records every inline list item, nested key and body heading without changing the parsed data shape', () => {
    const p = P.parseProfile(text('debugger'))
    expect(p.sourceLines.fields['office.access.write']).toBe(12)
    expect(p.sourceLines.items['office.routes']).toEqual(Array(10).fill(11))
    expect(p.sourceLines.headings).toEqual([
      { title: 'Who you are', line: 18 }, { title: 'Mission and responsibilities', line: 20 },
      { title: 'What you receive and what you hand back', line: 27 }, { title: 'What you must not do', line: 30 },
      { title: 'Ask the boss first when', line: 39 }, { title: 'Definition of done', line: 42 },
    ])
    expect(Object.keys(p)).toEqual(['frontmatter', 'body'])
  })
  it('requires the name to equal the given role', () => expect(errorsOf(base(), 'architect-reviewer')).toContain('name'))
  it('ignores a heading inside a code fence', () => {
    const p = base(); p.body = p.body.replace('# Definition of done', '```\n# Definition of done\n```\n# Other')
    expect(errorsOf(p)).toContain('body')
  })
})

describe('defaultProfile and the shipped files', () => {
  it('covers 13 roles that all validate, with distinct descriptions', () => {
    expect(roles).toHaveLength(13)
    const seen = new Set<string>()
    for (const { role } of roles) {
      const p = P.defaultProfile(role)
      expect(P.validateProfile(p, { roles, role }), role).toEqual({ ok: true, errors: [] })
      seen.add(p.frontmatter.description)
    }
    expect(seen.size).toBe(13)
  })
  it('reviewers and the auditor are read-only; mayDelegateTo inverts the chart', () => {
    for (const r of ['code-reviewer', 'architect-reviewer', 'security-auditor']) {
      const f = P.defaultProfile(r).frontmatter
      expect(f.tools).not.toContain('Write'); expect(f.disallowedTools).toEqual(['Write', 'Edit']); expect(f.office.access.write).toBeUndefined()
    }
    expect(P.defaultProfile('frontend-developer').frontmatter.office.access.write).toBe('edit-after-approval')
    expect(P.defaultProfile('code-reviewer').frontmatter.office.mayDelegateTo.sort()).toEqual(['debugger', 'security-auditor', 'test-engineer'])
    expect(P.defaultProfile('assistant').frontmatter.office.access.chat).toBe('none')
  })
  it('the shipped files equal the generator output byte for byte (run scripts/gen-agent-profiles.mjs)', () => {
    const dir = join(__dirname, '..', 'server', 'agent-profiles')
    expect(readdirSync(dir).sort()).toEqual(roles.map((r) => `${r.role}.md`).sort())
    for (const { role } of roles) {
      const file = readFileSync(join(dir, `${role}.md`), 'utf8')
      expect(file, role).toBe(text(role))
      expect(file).not.toContain('\r')
      expect(P.validateProfile(P.parseProfile(file), { roles, role }).ok).toBe(true)
    }
  })
})

describe('loadProfile precedence', () => {
  const put = (role: string, content: string) => { mkdirSync(join(home, 'agent-profiles'), { recursive: true }); writeFileSync(join(home, 'agent-profiles', `${role}.md`), content) }
  it('uses the shipped file when there is no override', () => {
    const r = P.loadProfile('debugger', { home })
    expect(r.source).toBe('shipped'); expect(r.warnings).toEqual([]); expect(r.hash).toMatch(/^[0-9a-f]{12}$/)
  })
  it('prefers a valid override', () => {
    const p = clone(P.defaultProfile('debugger')); p.frontmatter.description = 'My own description of the debugger role.'
    put('debugger', P.serializeProfile(p))
    const r = P.loadProfile('debugger', { home })
    expect(r.source).toBe('override'); expect(r.profile.frontmatter.description).toBe('My own description of the debugger role.')
  })
  it('ignores an invalid override with a warning', () => {
    put('debugger', '---\nname: debugger\n---\nbroken')
    const r = P.loadProfile('debugger', { home })
    expect(r.source).toBe('shipped'); expect(r.warnings[0]).toMatch(/override profile ignored/)
    put('debugger', 'not even frontmatter')
    expect(P.loadProfile('debugger', { home }).warnings).toHaveLength(1)
  })
  it('ignores an override whose name is another role', () => {
    put('debugger', text('code-reviewer'))
    expect(P.loadProfile('debugger', { home }).warnings).toHaveLength(1)
  })
  it('listProfiles returns one entry per role', () => expect(P.listProfiles({ home }).map((x: any) => x.role)).toEqual(roles.map((r) => r.role)))
  it.each(['../x', '..\\x', 'nobody', 'Debugger', 'debugger/../assistant', '', 'a'.repeat(80)])('refuses role id %j', (id) => {
    expect(() => P.loadProfile(id, { home })).toThrow(P.ProfileError)
    expect(() => P.saveProfile(id, text('debugger'), { home })).toThrow(P.ProfileError)
    expect(() => P.resetProfile(id, { home })).toThrow(P.ProfileError)
    expect(existsSync(join(home, 'agent-profiles'))).toBe(false)
  })
})

describe('saveProfile and resetProfile', () => {
  const file = () => join(home, 'agent-profiles', 'debugger.md')
  it('writes atomically, applies status and leaves no temp file', () => {
    const r = P.saveProfile('debugger', text('debugger'), { home, status: 'approved' })
    expect(r.source).toBe('override'); expect(r.profile.frontmatter.office.status).toBe('approved')
    expect(readdirSync(join(home, 'agent-profiles'))).toEqual(['debugger.md'])
    expect(P.parseProfile(readFileSync(file(), 'utf8')).frontmatter.office.status).toBe('approved')
  })
  it('writes nothing when invalid', () => {
    const p = clone(P.defaultProfile('debugger')); p.frontmatter.model = 'gpt'
    expect(() => P.saveProfile('debugger', P.serializeProfile(p), { home })).toThrow(P.ProfileError)
    expect(() => P.saveProfile('debugger', 'garbage', { home })).toThrow(P.ProfileError)
    expect(() => P.saveProfile('debugger', text('debugger'), { home, status: 'live' })).toThrow(P.ProfileError)
    expect(existsSync(file())).toBe(false)
  })
  it('refuses to overwrite a locked profile unless the content is identical', () => {
    const locked = clone(P.defaultProfile('debugger')); locked.frontmatter.office.locked = true
    P.saveProfile('debugger', P.serializeProfile(locked), { home })
    const edited = clone(locked); edited.frontmatter.description = 'Another description that is long enough.'
    expect(() => P.saveProfile('debugger', P.serializeProfile(edited), { home })).toThrow(/locked/)
    expect(P.saveProfile('debugger', P.serializeProfile(locked), { home }).source).toBe('override')
    const unlocked = clone(edited); unlocked.frontmatter.office.locked = false
    expect(() => P.saveProfile('debugger', P.serializeProfile(unlocked), { home })).toThrow(/locked/)
  })
  it('reset removes the override', () => {
    P.saveProfile('debugger', text('debugger'), { home })
    expect(P.resetProfile('debugger', { home })).toBe(true)
    expect(P.resetProfile('debugger', { home })).toBe(false)
    expect(P.loadProfile('debugger', { home }).source).toBe('shipped')
  })
})

describe('derived artifacts', () => {
  const dbg = () => P.defaultProfile('debugger')
  it('profileSystemPrompt is deterministic, has the must-not section and no frontmatter', () => {
    const a = P.profileSystemPrompt(dbg(), { cwd: 'C:\\proj' })
    expect(a).toBe(P.profileSystemPrompt(dbg(), { cwd: 'C:\\proj' }))
    expect(a.startsWith('You are Debugger, the office debugger. You report to code-reviewer. Project folder: C:\\proj.\n')).toBe(true)
    expect(a).toContain('# What you must not do'); expect(a).not.toContain('---'); expect(a).not.toContain('tools:')
    expect(P.profileSystemPrompt(P.defaultProfile('assistant'), { cwd: 'x' })).toContain('You report to the boss.')
  })
  it('agentCard has the A2A fields and one skill per responsibility bullet', () => {
    const p = dbg()
    const card = P.agentCard(p, { url: 'http://localhost:1/a2a/debugger' })
    expect(card).toMatchObject({ name: 'Debugger', version: '1', protocolVersion: '0.3.0', url: 'http://localhost:1/a2a/debugger', preferredTransport: 'JSONRPC',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false }, defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }, security: [{ bearer: [] }] })
    const bullets = p.body.split('# What you receive')[0].split('\n').filter((l: string) => l.startsWith('- '))
    expect(card.skills).toHaveLength(bullets.length)
    expect(card.skills[0]).toMatchObject({ id: 'debugger-1', name: 'Reproduce the failure and write down', description: bullets[0].slice(2), tags: p.frontmatter.office.routes })
    expect(card.skills[0].examples).toHaveLength(2)
    expect(P.agentCard(P.defaultProfile('assistant'), { url: 'u' }).skills[0].examples).toEqual([])
  })
  it('claudeAgentFile frontmatter is exact', () => {
    const head = (r: string) => P.claudeAgentFile(P.defaultProfile(r)).split('\n---\n')[0]
    expect(head('debugger')).toBe([
      '---', 'name: debugger', 'description: "Finds the root cause of a bug, crash or failing test and proposes the smallest fix. Use for errors, stack traces and \\"it broke after...\\"."',
      'tools: Read, Grep, Glob, Bash, Write, Edit', 'model: opus', 'effort: high'].join('\n'))
    const reviewer = P.claudeAgentFile(P.defaultProfile('code-reviewer'))
    expect(reviewer).toContain('tools: Read, Grep, Glob, Bash(read-only)\ndisallowedTools: Write, Edit\nmodel: opus\neffort: high\n---\n# Who you are')
    expect(P.claudeAgentFile(P.defaultProfile('assistant'))).toContain('model: haiku')
    expect(P.claudeAgentFile(P.defaultProfile('frontend-developer'))).toContain('model: sonnet')
    expect(reviewer).not.toContain('displayName')
  })
  it('checkAccess flags a boundary the CLI cannot guarantee', () => {
    const p = dbg()
    expect(P.checkAccess(p, 'agy').map((v: any) => v.mode)).toEqual(['chat', 'plan'])
    expect(P.checkAccess(p, 'agy')[1]).toMatchObject({ mode: 'plan', wanted: 'read-enforced', guaranteed: 'soft' })
    expect(P.checkAccess(p, 'codex')).toEqual([])
    expect(P.checkAccess(p, 'claude')).toEqual([])
    expect(P.checkAccess(p, 'opencode')).toEqual([])
    expect(P.checkAccess(p, 'qoder').map((v: any) => v.mode)).toEqual(['chat', 'plan'])
    // a write wish is never the violation, on every service
    for (const s of ['claude', 'codex', 'agy', 'opencode', 'qoder']) expect(P.checkAccess(p, s).map((v: any) => v.mode)).not.toContain('write')
    // a chat-without-tools assistant needs more than Codex's read-only chat
    expect(P.checkAccess(P.defaultProfile('assistant'), 'codex').map((v: any) => v.mode)).toEqual(['chat'])
  })
  it('summarizes grouped service issues with their labels and no redundant service sentences', () => {
    expect(P.summarizeAccess(dbg(), ['agy', 'qoder', 'codex'])).toEqual({
      count: 4,
      byService: ['agy', 'qoder'].map((service, i) => ({ service, label: ['Antigravity', 'Qoder'][i], issues: [
        { mode: 'chat', wanted: 'read-enforced', guaranteed: 'soft' }, { mode: 'plan', wanted: 'read-enforced', guaranteed: 'soft' },
      ] })),
      text: 'Antigravity and Qoder cannot guarantee read-only in chat mode. Antigravity and Qoder cannot guarantee read-only in plan mode.',
    })
    expect(P.summarizeAccess(dbg(), [])).toEqual({ count: 0, byService: [], text: '' })
    expect(P.summarizeAccess(dbg(), ['codex', 'claude', 'opencode'])).toEqual({ count: 0, byService: [], text: '' })
  })
})
