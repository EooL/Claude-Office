import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'office-adapter-hints-'))
const oldHome = process.env.AGENT_OFFICE_HOME
process.env.AGENT_OFFICE_HOME = dir
const { runAdapter } = await import('../server/adapters.mjs')
const { classifyFailure } = await import('../server/availability.mjs')
afterAll(() => {
  if (oldHome === undefined) delete process.env.AGENT_OFFICE_HOME
  else process.env.AGENT_OFFICE_HOME = oldHome
  rmSync(dir, { recursive: true, force: true })
})

async function withBin<T>(variable: string, source: string, run: () => Promise<T>): Promise<T> {
  const file = join(dir, `${variable}.mjs`)
  writeFileSync(file, source)
  const previous = process.env[variable]
  process.env[variable] = `"${process.execPath}" "${file}"`
  try { return await run() } finally {
    if (previous === undefined) delete process.env[variable]
    else process.env[variable] = previous
  }
}

describe('Antigravity file-tool instruction', () => {
  const echoArgs = `console.log(JSON.stringify({status:'SUCCESS',response:process.argv[process.argv.indexOf('-p')+1]}))`
  const sentence = 'Use your file read and edit tools. Do not run shell commands.'

  it('is added to an approved write without full access; chat and plan get a read-only version that never invites edits', async () => {
    writeFileSync(join(dir, 'backend.json'), JSON.stringify({}))
    await withBin('AGENT_OFFICE_BIN_AGY', echoArgs, async () => {
      for (const mode of ['chat', 'plan'] as const) {
        const text = (await runAdapter('agy', 'do it', { mode, timeoutMs: 3000 })).text
        expect(text).toContain('Use only your file read, list and search tools. Do not run shell commands and do not edit files.')
        expect(text).not.toContain(sentence)
      }
      expect((await runAdapter('agy', 'do it', { mode: 'write', timeoutMs: 3000 })).text).toContain(sentence)
    })
  })

  it('is left out of write when the service has full access (commands are allowed there)', async () => {
    writeFileSync(join(dir, 'backend.json'), JSON.stringify({ fullAccess: ['agy'] }))
    await withBin('AGENT_OFFICE_BIN_AGY', echoArgs, async () => {
      expect((await runAdapter('agy', 'do it', { mode: 'write', timeoutMs: 3000 })).text).toBe('do it')
    })
  })
})

describe('Qoder usage limit behind a timeout', () => {
  const logs = join(dir, 'qoder-logs')
  const hang = `setTimeout(() => {}, 60000)`

  it('a run killed by its timeout reports the limit its own log names, and the breaker reads it as a limit', async () => {
    process.env.AGENT_OFFICE_QODER_LOGS = logs
    // like the real CLI: it opens its run log after it starts, writes the refusal, then polls forever
    const limited = `import {mkdirSync,writeFileSync} from 'node:fs'; const d=process.env.AGENT_OFFICE_QODER_LOGS+'/run-1'; mkdirSync(d,{recursive:true}); writeFileSync(d+'/qodercli.log','x {"code":"10605","message":"{\\\\"retryAfterSeconds\\\\":45,\\\\"subCode\\\\":\\\\"RESOURCE_LIMIT\\\\"}"}'); ${hang}`
    try {
      const result = await withBin('AGENT_OFFICE_BIN_QODER', limited, () => runAdapter('qoder', 'hi', { mode: 'chat', timeoutMs: 1500 }))
      expect(result.error).toContain('qoder timed out')
      expect(result.error).toContain('RESOURCE_LIMIT')
      const failure = classifyFailure(result)
      expect(failure?.kind).toBe('limit')
      expect(failure?.retryAfterMs).toBe(45_000)
    } finally { delete process.env.AGENT_OFFICE_QODER_LOGS }
  })

  it('without a limit in the log, or with no log at all, the plain timeout stands', async () => {
    mkdirSync(join(logs, 'run-2'), { recursive: true })
    rmSync(join(logs, 'run-1'), { recursive: true, force: true })
    writeFileSync(join(logs, 'run-2', 'qodercli.log'), 'all quiet')
    process.env.AGENT_OFFICE_QODER_LOGS = logs
    try {
      const quiet = await withBin('AGENT_OFFICE_BIN_QODER', hang, () => runAdapter('qoder', 'hi', { mode: 'chat', timeoutMs: 700 }))
      expect(quiet.error).toBe('qoder timed out')
      process.env.AGENT_OFFICE_QODER_LOGS = join(dir, 'does-not-exist')
      const none = await withBin('AGENT_OFFICE_BIN_QODER', hang, () => runAdapter('qoder', 'hi', { mode: 'chat', timeoutMs: 700 }))
      expect(none.error).toBe('qoder timed out')
    } finally { delete process.env.AGENT_OFFICE_QODER_LOGS }
  })

  it('ignores a limit logged before this run started', async () => {
    mkdirSync(join(logs, 'old'), { recursive: true })
    const log = join(logs, 'old', 'qodercli.log')
    writeFileSync(log, 'RESOURCE_LIMIT')
    const past = new Date(Date.now() - 3_600_000)
    const { utimesSync } = await import('node:fs')
    utimesSync(join(logs, 'old'), past, past)
    rmSync(join(logs, 'run-2'), { recursive: true, force: true })
    process.env.AGENT_OFFICE_QODER_LOGS = logs
    try {
      const result = await withBin('AGENT_OFFICE_BIN_QODER', hang, () => runAdapter('qoder', 'hi', { mode: 'chat', timeoutMs: 700 }))
      expect(result.error).toBe('qoder timed out')
    } finally { delete process.env.AGENT_OFFICE_QODER_LOGS }
  })
})
