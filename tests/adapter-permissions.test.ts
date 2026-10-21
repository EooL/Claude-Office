import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'office-adapter-permissions-'))
const oldHome = process.env.AGENT_OFFICE_HOME
process.env.AGENT_OFFICE_HOME = dir
const { runAdapter } = await import('../server/adapters.mjs')
const cli = join(dir, 'cli.mjs')
writeFileSync(cli, `console.log(JSON.stringify({type:'text',part:{text:process.env.OPENCODE_PERMISSION || '{}'}}))`)
afterAll(() => {
  if (oldHome === undefined) delete process.env.AGENT_OFFICE_HOME
  else process.env.AGENT_OFFICE_HOME = oldHome
  rmSync(dir, { recursive: true, force: true })
})

describe('Antigravity invocation permissions', () => {
  it('prevents chat and plan edits even with full access configured; only approved write can create a file', async () => {
    const fake = join(dir, 'agy.mjs')
    const file = join(dir, 'agy-boundary.txt')
    writeFileSync(join(dir, 'backend.json'), JSON.stringify({ fullAccess: ['agy'] }))
    writeFileSync(fake, `
      import {writeFileSync} from 'node:fs';
      const args=process.argv.slice(2), mode=args[args.indexOf('--mode')+1];
      if(mode!=='plan')writeFileSync(${JSON.stringify(file)},'OFFICE_P4_OK');
      console.log(JSON.stringify({status:'SUCCESS',response:JSON.stringify(args)}));
    `)
    const previous = process.env.AGENT_OFFICE_BIN_AGY
    process.env.AGENT_OFFICE_BIN_AGY = `"${process.execPath}" "${fake}"`
    try {
      for (const mode of ['chat', 'plan'] as const) {
        const result = await runAdapter('agy', 'Create the boundary file', { mode, timeoutMs: 3000 })
        expect(result.code).toBe(0)
        const args = JSON.parse(result.text)
        expect(args[args.indexOf('--mode') + 1]).toBe('plan')
        expect(args).not.toContain('--dangerously-skip-permissions')
        expect(existsSync(file)).toBe(false)
      }
      const result = await runAdapter('agy', 'Create the approved file', { mode: 'write', timeoutMs: 3000 })
      expect(JSON.parse(result.text)).toContain('--dangerously-skip-permissions')
      expect(readFileSync(file).equals(Buffer.from('OFFICE_P4_OK'))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.AGENT_OFFICE_BIN_AGY
      else process.env.AGENT_OFFICE_BIN_AGY = previous
    }
  })
})

describe('OpenCode invocation permissions', () => {
  it('restricts unapproved calls even when the parent environment allows tools, without changing write permissions', async () => {
    const oldBin = process.env.AGENT_OFFICE_BIN_OPENCODE
    const oldPermission = process.env.OPENCODE_PERMISSION
    process.env.AGENT_OFFICE_BIN_OPENCODE = `"${process.execPath}" "${cli}"`
    process.env.OPENCODE_PERMISSION = '{"*":"allow"}'
    try {
      const run = async (mode: 'chat' | 'plan' | 'write') => {
        const result = await runAdapter('opencode', 'fixture', { mode, timeoutMs: 3000 })
        expect(result.code).toBe(0)
        return JSON.parse(result.text)
      }
      const readOnly = { '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow' }
      expect(await run('chat')).toEqual(readOnly)
      expect(await run('plan')).toEqual(readOnly)
      expect(await run('write')).toEqual({ '*': 'allow' })
      expect(process.env.OPENCODE_PERMISSION).toBe('{"*":"allow"}')
    } finally {
      if (oldBin === undefined) delete process.env.AGENT_OFFICE_BIN_OPENCODE
      else process.env.AGENT_OFFICE_BIN_OPENCODE = oldBin
      if (oldPermission === undefined) delete process.env.OPENCODE_PERMISSION
      else process.env.OPENCODE_PERMISSION = oldPermission
    }
  })
})
