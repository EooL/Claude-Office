import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Node's detached spawn supplies the POSIX session. Native Windows Python has
// no os.setsid(), so neither platform needs the shell launcher's Python helper.
export function watcherCommand(platform = process.platform, env = process.env, exists = existsSync) {
  return [bashCommand(platform, env, exists), [fileURLToPath(new URL('./chat-ai-watcher.sh', import.meta.url))]]
}

// Windows' bash.exe may be a WSL launcher with no Linux distribution installed.
// The office's shell scripts run with Git Bash on Windows.
export function bashCommand(platform = process.platform, env = process.env, exists = existsSync) {
  if (env.AGENT_OFFICE_BASH) return env.AGENT_OFFICE_BASH
  if (platform !== 'win32') return 'bash'
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean).map(p => join(p, 'Git'))
  if (env.LOCALAPPDATA) roots.push(join(env.LOCALAPPDATA, 'Programs', 'Git'))
  return roots.map(p => join(p, 'bin', 'bash.exe')).find(exists) ?? 'bash'
}
