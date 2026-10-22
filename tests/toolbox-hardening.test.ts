import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { projectPath, readProjectFile, readRegularFile, validateProjectPath } from '../server/project-files.mjs'

const root = mkdtempSync(join(tmpdir(), 'office-hardening-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

it('Windows ADS cannot be read as an ordinary project file', () => {
  if (process.platform !== 'win32') return
  writeFileSync(join(root, 'public.txt'), 'public')
  writeFileSync(join(root, 'public.txt:private'), 'STREAM_MARKER')
  expect(() => readProjectFile(root, 'public.txt:private', 1000)).toThrow(/Windows/)
})

it('Windows 8.3 secret aliases are refused when the volume provides one', () => {
  if (process.platform !== 'win32') return
  const file = join(root, 'credentials_long_name.json')
  writeFileSync(file, 'PRIVATE_MARKER')
  const short = execFileSync('cmd.exe', ['/d', '/c', `for %I in ("${file}") do @echo %~sI`], { encoding: 'utf8', windowsHide: true }).trim()
  if (!/~\d/.test(short)) { console.warn('SKIPPED native 8.3 alias: volume did not allocate one'); return }
  expect(() => readProjectFile(root, short, 1000)).toThrow()
})

it('bounded regular reads reject directories, oversized files and missing historical junction parents', () => {
  const dir = join(root, 'dir'); mkdirSync(dir)
  writeFileSync(join(root, 'large.txt'), 'x'.repeat(1001))
  expect(() => readRegularFile(dir, 1000)).toThrow()
  expect(() => readProjectFile(root, 'large.txt', 1000)).toThrow()
  expect(() => projectPath(root, '../outside/missing.txt', { missing: true })).toThrow()
})

it('rejects device aliases, short names, ADS, UNC and drive-relative paths', () => {
  for (const path of ['con.txt', 'NUL', 'LPT1', 'COM¹', 'C:foo', 'x:ads', '\\\\?\\C:\\x', '\\\\host\\share', 'CREDEN~1.JSO', 'x. ', 'x\u0000y']) expect(() => validateProjectPath(path), path).toThrow()
})

it('POSIX FIFO reads fail without blocking', () => {
  if (process.platform === 'win32') return
  const file = join(root, 'fifo')
  execFileSync('mkfifo', [file])
  const started = Date.now()
  expect(() => readProjectFile(root, 'fifo', 1000)).toThrow()
  expect(Date.now() - started).toBeLessThan(1000)
})
