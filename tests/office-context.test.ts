import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, expect, it } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'office-context-'))
const originalHome = process.env.AGENT_OFFICE_HOME
process.env.AGENT_OFFICE_HOME = join(root, 'default-home')
const { createOfficeContext, defaultOfficeContext } = await import('../server/office-context.mjs')

afterAll(() => {
  if (originalHome === undefined) delete process.env.AGENT_OFFICE_HOME
  else process.env.AGENT_OFFICE_HOME = originalHome
  rmSync(root, { recursive: true, force: true })
})

it('creates deterministic path-only descriptors without creating any directories', () => {
  const before = readdirSync(root)
  const home = join(root, 'home'), cwd = join(root, 'project')
  const context = createOfficeContext({ home, cwd })
  expect(Object.keys(context).sort()).toEqual(['cwd', 'home', 'id', 'tmp'])
  expect(context).toMatchObject({ home, cwd, tmp: join(home, 'tmp') })
  expect(createOfficeContext({ home, cwd })).toEqual(context)
  expect(createOfficeContext({ home: join(root, 'other-home'), cwd }).id).not.toBe(context.id)
  expect(Object.isFrozen(context)).toBe(true)
  expect(readdirSync(root)).toEqual(before)
  expect(existsSync(home)).toBe(false)
  expect(existsSync(cwd)).toBe(false)
})

it('captures the default home/cwd once, keeps the default id, and has no import-time filesystem effects', () => {
  const home = join(root, 'default-home')
  expect(defaultOfficeContext).toEqual({ id: 'default', home, cwd: process.cwd(), tmp: join(home, 'tmp') })
  process.env.AGENT_OFFICE_HOME = join(root, 'later-home')
  expect(defaultOfficeContext.home).toBe(home)
  expect(existsSync(home)).toBe(false)
  expect(Object.isFrozen(defaultOfficeContext)).toBe(true)
})

it.each(['absent', 'empty'])('keeps the existing user-home fallback when AGENT_OFFICE_HOME is %s', kind => {
  const userHome = join(root, `user-${kind}`), cwd = join(root, `project-${kind}`)
  mkdirSync(userHome)
  mkdirSync(cwd)
  const env = { ...process.env, HOME: userHome, USERPROFILE: userHome }
  if (kind === 'empty') env.AGENT_OFFICE_HOME = ''
  else delete env.AGENT_OFFICE_HOME
  const moduleUrl = pathToFileURL(join(__dirname, '../server/office-context.mjs')).href
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {defaultOfficeContext as context} from ${JSON.stringify(moduleUrl)};
    import {existsSync} from 'node:fs';
    console.log(JSON.stringify({context, exists:existsSync(context.home)}));
  `], { cwd, env, encoding: 'utf8', timeout: 5000 })
  const result = JSON.parse(output)
  const home = join(userHome, '.agent-office')
  expect(result).toEqual({ context: { id: 'default', home, cwd, tmp: join(home, 'tmp') }, exists: false })
})
