import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { bashCommand } from '../scripts/runtime-launchers.mjs'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

describe('the office shell launcher', () => {
  it('reuses a supervised watcher when the office is launched twice', async () => {
    const home = mkdtempSync(join(tmpdir(), 'office-watcher-supervisor-'))
    const script = fileURLToPath(new URL('../scripts/watcher-run.mjs', import.meta.url))
    const env = { ...process.env, AGENT_OFFICE_HOME: home, AGENT_OFFICE_PORT: '9', CHAT_AI_POLL_INTERVAL: '0.1' }
    const child = spawn(process.execPath, [script], { env, stdio: 'ignore', windowsHide: true })
    try {
      const deadline = Date.now() + 8000
      while (!existsSync(join(home, 'chat-watcher.pid')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 30))
      expect(existsSync(join(home, 'chat-watcher.pid'))).toBe(true)
      const second = await promisify(execFile)(process.execPath, [script], { env, timeout: 3000 })
      expect(second.stdout).toContain('already supervised')
    } finally {
      if (child.pid && child.exitCode === null) {
        if (process.platform === 'win32') await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F']).catch(() => {})
        else { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)) }
      }
      rmSync(home, { recursive: true, force: true })
    }
  }, 15_000)
  it('uses Git Bash instead of the Windows WSL alias, including a per-user install', () => {
    const system = join('C:/Program Files', 'Git', 'bin', 'bash.exe')
    const user = join('C:/Users/test/AppData/Local', 'Programs', 'Git', 'bin', 'bash.exe')
    const env = { ProgramFiles: 'C:/Program Files', LOCALAPPDATA: 'C:/Users/test/AppData/Local' }
    expect(bashCommand('win32', env, p => p === system)).toBe(system)
    expect(bashCommand('win32', env, p => p === user)).toBe(user)
    expect(bashCommand('linux', env, () => true)).toBe('bash')
    expect(bashCommand('win32', { AGENT_OFFICE_BASH: 'D:/Git/bash.exe' }, () => false)).toBe('D:/Git/bash.exe')
  })
})
