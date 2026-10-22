#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync, rmSync, realpathSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

export const CLIS = ['codex', 'agy', 'opencode', 'qoder']
export const CODEX_TRUST = 'Open Codex, run /hooks, review and trust the Agent Office command hooks. New or changed hooks are skipped until trusted; restart the session if needed.'
const COMMON = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact']
export function eventsFor(cli) {
  return cli === 'agy' ? ['SessionStart', 'PreToolUse', 'PostToolUse', 'PreInvocation', 'PostInvocation', 'Stop'] : [...COMMON, ...(cli === 'codex' ? ['Interrupt'] : ['PostToolUseFailure', 'PermissionDenied', 'Notification', 'StopFailure', 'CwdChanged'])]
}
export function configPath(cli, home) {
  const paths = { codex: ['.codex', 'hooks.json'], agy: ['.gemini', 'config', 'hooks.json'], qoder: ['.qoder', 'settings.json'], opencode: ['.config', 'opencode', 'plugins', 'claude-office.js'] }
  if (!paths[cli]) throw new Error('Unknown CLI')
  return join(home, ...paths[cli])
}
export function ownsHook(h) {
  const words = [...(typeof h?.command === 'string' ? h.command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [] : []), ...(Array.isArray(h?.args) ? h.args : [])]
  const unquote = w => typeof w === 'string' ? w.replace(/^['"]|['"]$/g, '').replaceAll('\\', '/') : ''
  return words.length === 4 && unquote(words[0]) === 'node' && /(?:^|\/)hooks\/cli-tracker\.mjs$/.test(unquote(words[1])) && CLIS.includes(words[2]) && eventsFor(words[2]).includes(words[3])
}
export function hookHandler(cli, event, tracker) {
  const path = tracker.replaceAll('\\', '/')
  // Qoder's exec form avoids any shell; Codex/agy use quoted forward-slash paths.
  if (/["\x00-\x1f\x7f$`%&^!]/.test(path)) throw new Error('Tracker path contains unsupported shell characters')
  return { type: 'command', ...(cli === 'qoder' ? { command: 'node', args: [path, cli, event] } : { command: `node "${path}" ${cli} ${event}` }), timeout: 2, ...(cli === 'agy' || (cli === 'codex' && event === 'SessionEnd') ? {} : { async: true }) }
}
function object(v) { return !!v && typeof v === 'object' && !Array.isArray(v) }
function mergeHooks(hooks, cli, tracker, uninstall) {
  if (!object(hooks)) throw new Error('hooks must be an object')
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new Error(`hooks.${event} must be an array`)
    hooks[event] = groups.flatMap(group => {
      if (!object(group) || !Array.isArray(group.hooks)) return [group]
      const kept = group.hooks.filter(h => !ownsHook(h))
      return kept.length === group.hooks.length ? [group] : kept.length ? [{ ...group, hooks: kept }] : []
    })
    if (!hooks[event].length && groups.length) delete hooks[event]
  }
  if (!uninstall) for (const event of eventsFor(cli)) (hooks[event] ??= []).push({ hooks: [hookHandler(cli, event, tracker)] })
  return hooks
}
export function pluginSource(tracker) {
  return `// Agent Office CLI hooks: managed by install-cli-hooks.mjs\nimport { spawn } from 'node:child_process'\nconst tracker = ${JSON.stringify(tracker.replaceAll('\\', '/'))}\nexport const ClaudeOffice = async ({ directory }) => {\n  if (process.env.AGENT_OFFICE_RUN === '1') return {}\n  const send = (event, payload) => {\n    try {\n      const child = spawn('node', [tracker, 'opencode', event], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, detached: true })\n      child.on('error', () => {})\n      child.stdin.on('error', () => {})\n      child.stdin.end(JSON.stringify({ ...payload, cwd: directory }))\n      child.unref()\n    } catch {}\n  }\n  return {\n    event: async ({ event }) => { try { send(event.type, { properties: event.properties }) } catch {} },\n    'tool.execute.before': async input => { try { send('tool.execute.before', { tool: input.tool, sessionID: input.sessionID }) } catch {} },\n    'tool.execute.after': async input => { try { send('tool.execute.after', { tool: input.tool, sessionID: input.sessionID }) } catch {} },\n  }\n}\n`
}
export function prepareInstall(cli, { home, tracker = fileURLToPath(new URL('../hooks/cli-tracker.mjs', import.meta.url)), uninstall = false }) {
  const file = configPath(cli, home)
  safeConfigPath(file)
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null
  let after
  if (cli === 'opencode') {
    if (before !== null && !before.startsWith('// Agent Office CLI hooks: managed by install-cli-hooks.mjs\n')) throw new Error(`${file}: refusing an unmanaged plugin`)
    after = uninstall ? null : pluginSource(tracker)
  } else {
    let value
    try { value = before === null ? {} : JSON.parse(before) } catch { throw new Error(`${file}: invalid JSON; nothing written`) }
    if (!object(value)) throw new Error(`${file}: expected an object; nothing written`)
    const original = JSON.stringify(value)
    try {
      if (cli === 'agy') {
        if (value['claude-office'] && !object(value['claude-office'])) throw new Error('claude-office must be an object')
        const own = value['claude-office'] ?? {}
        // Preserve foreign handlers even if someone placed them in our named group.
        for (const [event, entries] of Object.entries(own)) {
          if (event === 'enabled') continue
          if (!Array.isArray(entries)) throw new Error(`${event} must be an array`)
          own[event] = entries.flatMap(entry => {
            if (ownsHook(entry)) return []
            if (!Array.isArray(entry?.hooks)) return [entry]
            const kept = entry.hooks.filter(h => !ownsHook(h))
            return kept.length === entry.hooks.length ? [entry] : kept.length ? [{ ...entry, hooks: kept }] : []
          })
          if (!own[event].length) delete own[event]
        }
        if (!uninstall) for (const event of eventsFor(cli)) {
          const handler = hookHandler(cli, event, tracker)
          ;(own[event] ??= []).push(['PreToolUse', 'PostToolUse'].includes(event) ? { matcher: '', hooks: [handler] } : handler)
        }
        if (Object.keys(own).some(k => k !== 'enabled')) value['claude-office'] = own
        else delete value['claude-office']
      } else if (!uninstall || value.hooks !== undefined) {
        value.hooks = mergeHooks(value.hooks ?? {}, cli, tracker, uninstall)
        if (!Object.keys(value.hooks).length) delete value.hooks
      }
    } catch (err) { throw new Error(`${file}: ${err.message}; nothing written`) }
    // Semantic no-op preserves original bytes, including indentation and CRLF.
    after = JSON.stringify(value) === original ? before : `${JSON.stringify(value, null, 2)}\n`
  }
  return { cli, file, before, after, changed: before !== after }
}
export function applyInstall(plan, { rename = renameSync, pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  if (!plan.changed) return
  const { file, before, after } = plan
  safeConfigPath(file)
  mkdirSync(dirname(file), { recursive: true })
  safeConfigPath(file)
  // Refuse a concurrent edit instead of overwriting its owner's changes.
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null
  if (current !== before) throw new Error(`${file}: changed during installation; retry`)
  const backup = before !== null ? `${file}.backup.${randomUUID()}` : null
  if (backup) writeFileSync(backup, before, { flag: 'wx', mode: 0o600 })
  if (after === null) { safeConfigPath(file); unlinkSync(file); return }
  const tmp = `${file}.tmp.${randomUUID()}`
  try {
    writeFileSync(tmp, after, { flag: 'wx', mode: 0o600 })
    // Windows refuses to replace a file another process has open; retry briefly (same idea as server/registry.mjs).
    for (let attempt = 1; ; attempt++) {
      try { safeConfigPath(file); rename(tmp, file); break } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) {
          if (backup) rmSync(backup, { force: true }) // the target was not changed, so the backup is only noise
          throw new Error(`${file}: could not replace the file (${error.code ?? error.message}); nothing was changed`)
        }
        pause(20 * attempt)
      }
    }
  } finally { rmSync(tmp, { force: true }) }
}
function safeConfigPath(file) {
  let path = resolve(file)
  while (true) {
    try {
      const st = lstatSync(path)
      if (st.isSymbolicLink()) throw new Error(`${path}: link or junction refused`)
      if (path === resolve(file) && (!st.isFile() || st.size > 1024 * 1024)) throw new Error(`${path}: config is not a bounded regular file`)
    } catch (e) { if (e.code !== 'ENOENT') throw e }
    const parent = dirname(path)
    if (parent === path) break
    path = parent
  }
}
export function hooksInstalled(cli, home) {
  try {
    const text = readFileSync(configPath(cli, home), 'utf8')
    if (cli === 'opencode') return text.startsWith('// Agent Office CLI hooks: managed by install-cli-hooks.mjs\n')
    const value = JSON.parse(text)
    const hooks = cli === 'agy' ? value['claude-office'] : value.hooks
    return eventsFor(cli).every(event => Array.isArray(hooks?.[event]) && hooks[event].some(g => ownsHook(g) || g?.hooks?.some(ownsHook)))
  } catch { return false }
}

export function runInstaller(args, print = console.log) {
  const [cli, ...options] = args
  if (![...CLIS, 'all'].includes(cli)) throw new Error('Usage: node scripts/install-cli-hooks.mjs <codex|agy|opencode|qoder|all> [--home <dir>] [--dry-run] [--write] [--uninstall] [--print] (agy also needs --unverified-agy-contract; \`all\` skips agy)')
  let home = homedir(), write = false, dry = false, uninstall = false, unverifiedAgy = false
  for (let i = 0; i < options.length; i++) {
    if (options[i] === '--home' && options[i + 1] && !options[i + 1].startsWith('--')) home = options[++i]
    else if (options[i] === '--write') write = true
    else if (options[i] === '--dry-run') dry = true
    else if (options[i] === '--uninstall') uninstall = true
    else if (options[i] === '--unverified-agy-contract') unverifiedAgy = true
    else if (options[i] !== '--print') throw new Error(`Unknown option: ${options[i]}`)
  }
  // agy's PreToolUse reply contract is unconfirmed, and a hook can approve tools: opt in explicitly, never via `all`.
  if (cli === 'agy' && !uninstall && !unverifiedAgy) throw new Error('agy hooks are not installed by default: its PreToolUse reply contract is unconfirmed and hooks can approve tools. Add --unverified-agy-contract to install anyway.')
  if (cli === 'agy' && !uninstall) print('WARNING: agy PreToolUse reply contract is unconfirmed; hooks can approve tools. The Agent Office tracker replies {} (no decision) but verify this yourself.')
  // Validate every target before any write when installing all.
  const plans = (cli === 'all' ? CLIS.filter(c => c !== 'agy') : [cli]).map(c => prepareInstall(c, { home, uninstall }))
  for (const plan of plans) {
    if (write && !dry) applyInstall(plan)
    print(`${plan.cli}: ${plan.changed ? write && !dry ? uninstall ? 'uninstalled' : 'installed' : uninstall ? 'would uninstall' : 'would install' : 'unchanged'} - ${plan.file}`)
    if (!uninstall) print(`  events: ${plan.cli === 'opencode' ? 'session and tool plugin events' : eventsFor(plan.cli).join(', ')}`)
  }
  if (!uninstall && plans.some(p => p.cli === 'codex')) print(CODEX_TRUST)
  return plans
}
let main = false
try { main = !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch {}
if (main) {
  try { runInstaller(process.argv.slice(2)) } catch (err) { console.error(err.message); process.exitCode = 1 }
}
