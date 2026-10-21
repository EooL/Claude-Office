import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

// Each file gets its own supervised process: Vitest's async timeout cannot
// interrupt execFileSync or a stuck module import.
const env = { ...process.env }
if (process.platform === 'win32') {
  const git = [env.GIT_INSTALL_ROOT, 'C:/Program Files/Git', 'C:/Program Files (x86)/Git'].find(p => p && existsSync(join(p, 'bin/bash.exe')))
  if (!git) throw new Error('Git Bash is required (install Git for Windows or set GIT_INSTALL_ROOT)')
  const key = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH'
  env[key] = [join(git, 'bin'), join(git, 'usr/bin'), env[key]].join(delimiter)
}
const args = process.argv.slice(2)
const filters = args.filter(a => !a.startsWith('-'))
const files = readdirSync('tests').filter(f => f.endsWith('.test.ts')).map(f => `tests/${f}`)
  .filter(f => !filters.length || filters.some(s => f.includes(s)))
if (!files.length) throw new Error('No matching test files')
const failed = []
async function run(file) {
  const sandbox = mkdtempSync(join(tmpdir(), 'office-test-win-'))
  const testEnv = { ...env, HOME: join(sandbox, 'user'), USERPROFILE: join(sandbox, 'user'),
    AGENT_OFFICE_HOME: join(sandbox, 'runtime'), AGENT_OFFICE_ROOT: join(sandbox, 'building') }
  const child = spawn(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', file, '--maxWorkers=1', '--testTimeout=15000', '--hookTimeout=15000'], { env: testEnv, stdio: 'inherit', windowsHide: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    console.error(`FILE TIMEOUT (120s): ${file}`)
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    else child.kill('SIGKILL')
  }, 120_000)
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) }).finally(() => {
    clearTimeout(timer)
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  if (code !== 0 || timedOut) failed.push(file)
}
// Keep every timeout and assertion when Windows commit memory is scarce.
const workers = args.includes('--serial') ? 1 : 4
await Promise.all(Array.from({ length: Math.min(workers, files.length) }, async () => {
  while (files.length) await run(files.shift())
}))
console.log(`test:win: ${failed.length} failed files${failed.length ? '\n' + failed.join('\n') : ''}`)
process.exitCode = failed.length ? 1 : 0
