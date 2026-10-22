import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bashCommand } from './runtime-launchers.mjs'

const run = (bin, args) => spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 })
export function inspectWatcher(record) {
  if (!Number.isSafeInteger(record.pid) || record.pid <= 0) return 'unknown'
  if (record.namespace === 'bash') return probeLegacy(record.home, record.pid, record.birth)
  try { process.kill(record.pid, 0) } catch (error) { return error.code === 'ESRCH' ? 'dead' : 'unknown' }
  if (!record.token || typeof record.home !== 'string') return 'unknown'
  const result = process.platform === 'win32'
    ? run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${record.pid}').CommandLine`])
    : run('ps', ['-p', String(record.pid), '-o', 'args='])
  return result.status === 0 && result.stdout?.includes(`--office-watcher=${record.token}`)
    && result.stdout.includes(`--office-home=${Buffer.from(record.home).toString('base64url')}`) ? 'healthy' : 'unknown'
}

// Read only the script arguments and the home, never emit process environments.
// Arguments are positional parameters, not interpolated shell source.
const legacyIdentity = `
  identity() {
    local arg actual='' owner_home='' matched='' stat rest
    while IFS= read -r -d '' arg; do
      case "$arg" in */chat-ai-watcher.sh|*/chat-watcher.sh) matched=1 ;; esac
    done < "/proc/$1/cmdline" 2>/dev/null
    [ "$matched" = 1 ] || return 1
    while IFS= read -r -d '' arg; do
      case "$arg" in AGENT_OFFICE_HOME=*) actual="${'${arg#AGENT_OFFICE_HOME=}'}" ;; HOME=*) owner_home="${'${arg#HOME=}'}" ;; esac
    done < "/proc/$1/environ" 2>/dev/null
    actual="${'${actual:-$owner_home/.agent-office}'}"
    if command -v cygpath >/dev/null 2>&1; then
      actual=$(cygpath -am "$actual")
      expected=$(cygpath -am "$2")
    else expected="$2"; fi
    [ "$actual" = "$expected" ] || return 1
    stat=$(cat "/proc/$1/stat" 2>/dev/null) || return 1
    rest="${'${stat##*) }'}"
    set -- $rest
    birth="${'${20}'}"
    [ -n "$birth" ]
  }
`
function probeLegacy(home, pid, birth, signal = false) {
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    try { process.kill(pid, 0) } catch (error) { return error.code === 'ESRCH' ? 'dead' : 'unknown' }
    const result = run('ps', ['eww', '-p', String(pid), '-o', 'command='])
    const args = result.stdout ?? ''
    if (result.status !== 0 || !/(?:^|\s)\S*\/chat-(?:ai-)?watcher\.sh(?:\s|$)/.test(args)
      || !args.includes(`AGENT_OFFICE_HOME=${home} `)) return 'unknown'
    if (signal) process.kill(pid, 'SIGTERM')
    return 'healthy'
  }
  const result = run(bashCommand(), ['-c', legacyIdentity + `
    kill -0 "$1" 2>/dev/null || { echo dead; exit; }
    identity "$1" "$2" || { echo unknown; exit; }
    [ -z "$3" ] || [ "$birth" = "$3" ] || { echo unknown; exit; }
    ${signal ? 'kill -TERM "$1" 2>/dev/null || exit 1' : ''}
    echo healthy
  `, 'office-watcher', String(pid), home, birth ?? ''])
  const status = result.stdout?.trim()
  return result.status === 0 && ['dead', 'healthy'].includes(status) ? status : 'unknown'
}

export function legacyWatchers(home, records, { scan = true } = {}) {
  const found = []
  if (scan && (process.platform === 'win32' || process.platform === 'linux')) {
    const result = run(bashCommand(), ['-c', legacyIdentity + `
      hz=$(getconf CLK_TCK 2>/dev/null || echo 1000)
      read -r uptime _ < /proc/uptime
      echo "clock $hz $uptime"
      for dir in /proc/[0-9]*; do
        pid="${'${dir##*/}'}"
        identity "$pid" "$1" || continue
        native=$(cat "$dir/winpid" 2>/dev/null || echo "$pid")
        echo "$pid $native $birth"
      done
    `, 'office-watcher', home])
    if (result.status !== 0) throw new Error('Cannot inventory existing chat watchers; refusing another start.')
    const lines = result.stdout.trim().split(/\r?\n/)
    const [, hz, uptime] = lines.shift().split(' ').map(Number)
    if (!Number.isFinite(hz) || hz <= 0 || !Number.isFinite(uptime)) throw new Error('Invalid watcher inventory clock; refusing another start.')
    for (const line of lines) {
      const [pid, native, birth] = line.split(' ').map(Number)
      if (!pid || !native || !birth) continue
      if (records.some(record => record.pid === native && inspectWatcher(record) === 'healthy')) continue
      found.push({ pid, home, namespace: 'bash', birth: String(birth), started: Date.now() - uptime * 1000 + birth / hz * 1000 })
    }
  }
  let pid
  try { pid = Number(readFileSync(join(home, 'chat-watcher.pid'), 'utf8').trim()) } catch { return found }
  if (!Number.isSafeInteger(pid) || pid <= 0 || found.some(record => record.pid === pid)) return found
  const mapped = process.platform === 'win32'
    ? Number(run(bashCommand(), ['-c', 'cat "/proc/$1/winpid" 2>/dev/null', 'office-watcher', String(pid)]).stdout?.trim())
    : pid
  if (records.some(record => record.pid === mapped && inspectWatcher(record) === 'healthy')) return found
  const record = { pid, home, namespace: 'bash', started: 0 }
  if (probeLegacy(home, pid) !== 'dead') found.push(record)
  return found
}

export async function stopWatcher(record) {
  if (inspectWatcher(record) !== 'healthy') throw new Error('Watcher identity could not be verified; nothing stopped.')
  if (record.namespace === 'bash') {
    if (probeLegacy(record.home, record.pid, record.birth, true) === 'unknown') throw new Error('Could not stop legacy watcher.')
  } else if (process.platform === 'win32') {
    const result = run('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'])
    if (result.status !== 0 && inspectWatcher(record) !== 'dead') throw new Error('Could not stop watcher tree.')
  } else {
    try { process.kill(-record.pid, 'SIGTERM') } catch { process.kill(record.pid, 'SIGTERM') }
  }
  const deadline = Date.now() + 10_000
  while (inspectWatcher(record) !== 'dead') {
    if (Date.now() > deadline) throw new Error('Watcher has not exited; refusing to start another.')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
