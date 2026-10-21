import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { canonicalCwd, isNested } from '../server/canonicalCwd.mjs'

const root = mkdtempSync(join(tmpdir(), 'office-canonical-'))
const project = join(root, 'Long Project Directory')
mkdirSync(project)
mkdirSync(join(project, 'child'))
mkdirSync(join(root, 'Long Project Directory-old'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

it('canonicalizes existing paths, dot segments and trailing separators', () => {
  const expected = canonicalCwd(project)
  expect(canonicalCwd(`${project}/`)).toBe(expected)
  expect(canonicalCwd(join(project, 'child', '..'))).toBe(expected)
  if (process.platform === 'win32') {
    expect(canonicalCwd(project.toUpperCase())).toBe(expected)
    expect(canonicalCwd(project.replace(/\\/g, '/'))).toBe(expected)
    expect(canonicalCwd(project.replace(/^([a-z]):/i, (_, drive) => `/${drive.toLowerCase()}`).replace(/\\/g, '/'))).toBe(expected)
    expect(canonicalCwd(`\\\\?\\${project}`)).toBe(expected)
  }
})

it('resolves directory junctions/symlinks, including nonexistent descendants', () => {
  const alias = join(root, 'alias')
  symlinkSync(project, alias, process.platform === 'win32' ? 'junction' : 'dir')
  expect(canonicalCwd(alias)).toBe(canonicalCwd(project))
  expect(canonicalCwd(join(alias, 'not-created', 'child'))).toBe(canonicalCwd(join(project, 'not-created', 'child')))
})

it('normalizes available Windows short names through realpath', () => {
  if (process.platform !== 'win32') return
  const short = execFileSync('cmd.exe', ['/d', '/c', 'for %I in ("' + project + '") do @echo %~sI'], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true }).trim()
  expect(short.length).toBeGreaterThan(0)
  expect(canonicalCwd(short)).toBe(canonicalCwd(project))
})

it('normalizes UNC and Git Bash spellings even for nonexistent paths', () => {
  expect(canonicalCwd('\\\\OFFICE-SERVER\\Share\\Project\\')).toBe(canonicalCwd('//office-server/share/project'))
  expect(canonicalCwd('Z:\\Missing\\Project\\')).toBe(canonicalCwd('/z/Missing/Project'))
  expect(canonicalCwd('\\\\?\\UNC\\OFFICE-SERVER\\Share\\Project')).toBe(canonicalCwd('//office-server/share/project'))
})

it('uses directory boundaries for strict containment', () => {
  expect(isNested(project, join(project, 'child'))).toBe(true)
  expect(isNested(project, join(project, 'missing'))).toBe(true)
  expect(isNested(project, project)).toBe(false)
  expect(isNested(project, join(root, 'Long Project Directory-old'))).toBe(false)
  expect(isNested(join(project, 'child'), project)).toBe(false)
})

it('keeps POSIX paths case-sensitive and drive-free on non-Windows platforms', () => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'linux' })
  try {
    expect(canonicalCwd('/a/x')).toBe('/a/x')
    expect(canonicalCwd('/a/x')).not.toBe(canonicalCwd('/A/x'))
    expect(canonicalCwd('/c/Users/x')).toBe('/c/Users/x')
    expect(canonicalCwd('/proj/sub/../')).toBe('/proj')
    expect(isNested('/proj', '/proj/child')).toBe(true)
    expect(isNested('/proj', '/proj-old')).toBe(false)
    expect(isNested('/proj', '/Proj/child')).toBe(false)
    expect(canonicalCwd('/Proj')).not.toBe(canonicalCwd('/proj'))
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
})

it('falls back without creating nonexistent paths and rejects missing input', () => {
  const before = readdirSync(root)
  expect(canonicalCwd(join(root, 'missing', '..', 'future'))).toBe(canonicalCwd(join(root, 'future')))
  expect(readdirSync(root)).toEqual(before)
  expect(() => canonicalCwd('')).toThrow(TypeError)
  expect(() => canonicalCwd(undefined as any)).toThrow(TypeError)
})
