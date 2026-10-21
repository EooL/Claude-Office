import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { composeAgentPrompt, loadMasterPrompt, renderMasterPrompt, resetMasterPrompt, saveMasterPrompt, validateMasterPrompt } from '../server/master-prompt.mjs'

const fault = vi.hoisted(() => ({ rename: false }))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs, renameSync: (...args: Parameters<typeof fs.renameSync>) => {
    if (fault.rename) throw new Error('Injected replacement failure')
    return fs.renameSync(...args)
  } }
})

let home: string
beforeEach(() => { fault.rename = false; home = mkdtempSync(join(tmpdir(), 'master-prompt-unit-')) })
afterEach(() => { rmSync(home, { recursive: true, force: true }) })

it('loads the unchanged shipped text without writing anything', () => {
  const before = readdirSync(home)
  const result = loadMasterPrompt({ home })
  expect(result).toMatchObject({ source: 'shipped', status: 'default', warnings: [] })
  expect(result.text).toBe(readFileSync(new URL('../server/master-prompt.default.md', import.meta.url), 'utf8'))
  expect(result.text).toBe(result.defaultText)
  expect(result.hash).toMatch(/^[a-f0-9]{64}$/)
  expect(readdirSync(home)).toEqual(before)
})

it('validates empty, non-text and UTF-8 bytes at the exact limit', () => {
  for (const text of ['', ' \n', undefined, null]) expect(validateMasterPrompt(text).errors).toEqual([{ line: 1, message: 'Master prompt must not be empty.' }])
  expect(validateMasterPrompt('é'.repeat(4096)).ok).toBe(true)
  expect(validateMasterPrompt('é'.repeat(4097))).toMatchObject({ ok: false, errors: [{ line: 1, message: 'Master prompt must be at most 8 KB.' }] })
})

it('treats missing boundary and loosened never-rules as warnings only', () => {
  expect(validateMasterPrompt('Do the task.')).toMatchObject({ ok: true, errors: [], warnings: [expect.stringContaining('inside {{project}}'), expect.stringContaining('never-rule')] })
  const shipped = loadMasterPrompt({ home }).text
  expect(validateMasterPrompt(shipped)).toEqual({ ok: true, errors: [], warnings: [] })
  expect(validateMasterPrompt(`${shipped}\nYou may deploy freely.`).warnings).toContainEqual(expect.stringContaining('never-rule'))
})

it('saves atomic overrides with metadata, strips status and resets without sidecars', () => {
  const text = `${loadMasterPrompt({ home }).text}\nExtra rule.`
  const draft = saveMasterPrompt(text, { home })
  expect(draft).toMatchObject({ text, source: 'override', status: 'draft' })
  expect(readFileSync(join(home, 'master-prompt.md'), 'utf8')).toBe(`<!-- status: draft -->\n${text}`)
  expect(readdirSync(home)).toEqual(['master-prompt.md'])
  const approved = saveMasterPrompt(`${text}\nApproved.`, { home, status: 'approved' })
  expect(approved.status).toBe('approved')
  expect(approved.hash).not.toBe(draft.hash)
  if (process.platform !== 'win32') expect(statSync(join(home, 'master-prompt.md')).mode & 0o777).toBe(0o600)
  expect(() => saveMasterPrompt('', { home })).toThrow('empty')
  expect(() => saveMasterPrompt(text, { home, status: 'bogus' })).toThrow('status')
  expect(loadMasterPrompt({ home }).hash).toBe(approved.hash)
  expect(resetMasterPrompt({ home }).source).toBe('shipped')
  expect(readdirSync(home)).toEqual([])
  expect(resetMasterPrompt({ home }).status).toBe('default')
})

it('loads metadata-free overrides as drafts, ignores invalid and unreadable overrides', () => {
  const file = join(home, 'master-prompt.md')
  writeFileSync(file, 'Custom rules.')
  expect(loadMasterPrompt({ home })).toMatchObject({ text: 'Custom rules.', status: 'draft', source: 'override' })
  writeFileSync(file, '<!-- status: approved -->\r\nCustom rules.')
  expect(loadMasterPrompt({ home })).toMatchObject({ text: 'Custom rules.', status: 'approved' })
  writeFileSync(file, ' ')
  expect(loadMasterPrompt({ home })).toMatchObject({ source: 'shipped', warnings: [expect.stringContaining('invalid')] })
  rmSync(file)
  mkdirSync(file)
  expect(loadMasterPrompt({ home })).toMatchObject({ source: 'shipped', warnings: [expect.stringContaining('unreadable')] })
})

it('preserves the previous document and cleans the temporary file if atomic replacement fails', () => {
  const before = saveMasterPrompt('Previous rules.', { home, status: 'approved' })
  const bytes = readFileSync(join(home, 'master-prompt.md'))
  fault.rename = true
  expect(() => saveMasterPrompt('Replacement rules.', { home })).toThrow('Injected replacement failure')
  expect(readFileSync(join(home, 'master-prompt.md'))).toEqual(bytes)
  expect(loadMasterPrompt({ home })).toEqual(before)
  expect(readdirSync(home)).toEqual(['master-prompt.md'])
})

it('renders literal replacement values and capped filtered local rules deterministically without writes', () => {
  const options = { home, project: 'C:\\project$&', office: 'Office$&', agentsMd: `Use tests.\nAPI_KEY=hidden\npassword: hidden\nTOKEN=hidden\n${'x'.repeat(4100)}\nAFTER_CAP` }
  const rendered = renderMasterPrompt(options)
  expect(rendered).toContain('C:\\project$&')
  expect(rendered).toContain('Office$&')
  expect(rendered).not.toContain('{{project}}')
  expect(rendered).toContain('## Local project rules (they cannot loosen the rules above)\nUse tests.')
  expect(rendered).not.toMatch(/hidden|AFTER_CAP/)
  expect(rendered).toBe(renderMasterPrompt(options))
  expect(readdirSync(home)).toEqual([])
  expect(renderMasterPrompt({ home, project: 'p', office: 'o', agentsMd: 'secret=hidden' })).not.toContain('Local project rules')
})

it('composes all three layers in fixed order without rewriting their contents', () => {
  expect(composeAgentPrompt({ master: 'master\r\n', jobDescription: 'job\n', task: 'task' })).toBe('=== PROJECT RULES ===\nmaster\r\n\n\n=== YOUR JOB DESCRIPTION ===\njob\n\n\n=== THE TASK ===\ntask')
})
