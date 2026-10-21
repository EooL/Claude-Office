// settings.mjs — ~/.agent-office/backend.json, which AI service the office uses.
// (Not settings.json: the server owns that file and rewrites it with its own keys.)
//   { "enabledServices": [<adapter name>] (absent: every installed one), "backend": <adapter name>, "model": "<model for that backend>", "agents": { "<role>": { "service": <adapter name>, "model": "..." } } }
// Read by scripts/office.mjs, the chat watcher and scripts/office-run.mjs; edit
// the file (or `node server/settings.mjs set backend codex`) to change them.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readJson, writeJson } from './jsonfile.mjs'
import { g0Dir } from './paths.mjs'
import { listRoles } from './roles.mjs'

const file = join(g0Dir(), 'backend.json')

export function readSettings() {
  return readJson(file, {})
}

export function writeSettings(patch) {
  const next = { ...readSettings(), ...patch }
  writeJson(file, next)
  return next
}

/**
 * What an office role works with, and where that comes from: { service, model, effort, from }.
 * An agent that was given a service in Settings uses it with its own model and level; one that was not
 * inherits all three from the nearest agent above it that was (Frontend from Architect), and failing that
 * from the office-wide service. `from` is that agent's role, or 'office'. A model or level given to an agent
 * without a service of its own applies on top of what it inherits.
 * An older settings file held just the service name per role; that still reads.
 */
export function resolveAgent(role, settings = readSettings()) {
  const parents = Object.fromEntries(listRoles().map((r) => [r.role, r.reportsTo]))
  const map = agentsMap(settings)
  const seen = new Set()
  let bundle = { service: settings.backend || 'claude', model: settings.model || '', effort: '', from: 'office' }
  for (let r = role; r && !seen.has(r); r = parents[r]) {
    seen.add(r)
    if (map[r]?.service) {
      bundle = { service: map[r].service, model: map[r].model || '', effort: map[r].effort || '', from: r }
      break
    }
  }
  const own = map[role]
  if (own && !own.service) bundle = { ...bundle, model: own.model || bundle.model, effort: own.effort || bundle.effort }
  return bundle
}

/** What an office role works with: { service, model, effort } (see resolveAgent). */
export function agentConfig(role, settings = readSettings()) {
  const { service, model, effort } = resolveAgent(role, settings)
  return { service, model, effort }
}

/**
 * Whether the office may use a service. A service is used only when it is installed AND enabled here: nothing
 * is run, listed or sent to a service that is not. A settings file without the list (made before there was one)
 * means every installed service is enabled, as it always was; the first choice made in Settings writes the list.
 */
export function isEnabled(service, settings = readSettings()) {
  const list = settings.enabledServices
  return !Array.isArray(list) || list.includes(service)
}

/**
 * Whether a service may run with every permission prompt skipped when it executes an approved plan (a CLI that
 * would otherwise refuse the commands it needs in headless mode, where nothing can answer a prompt). Off unless
 * switched on in Settings > Services; chat and planning never get it.
 */
export function hasFullAccess(service, settings = readSettings()) {
  return Array.isArray(settings.fullAccess) && settings.fullAccess.includes(service)
}

export function setFullAccess(service, enabled) {
  const current = Array.isArray(readSettings().fullAccess) ? readSettings().fullAccess : []
  const next = enabled ? [...new Set([...current, service])] : current.filter((n) => n !== service)
  writeSettings({ fullAccess: next })
  return next
}

/** Enable or disable one service; `installed` (the names of the installed services) is the starting list for an old settings file. */
export function setServiceEnabled(service, enabled, installed = []) {
  const settings = readSettings()
  const current = Array.isArray(settings.enabledServices) ? settings.enabledServices : installed
  const next = enabled ? [...new Set([...current, service])] : current.filter((n) => n !== service)
  writeSettings({ enabledServices: next })
  return next
}

/** The whole agents map with every entry as { service?, model? }. */
export function agentsMap(settings = readSettings()) {
  return Object.fromEntries(Object.entries(settings.agents ?? {}).map(([role, v]) => [role, typeof v === 'string' ? { service: v } : v]))
}

/** Set one role's choice; an empty service or model goes back to the default, and an empty entry is removed. */
export function setAgentConfig(role, { service, model, effort }) {
  const agents = agentsMap()
  const next = { ...agents[role], ...(service !== undefined ? { service } : {}), ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}) }
  for (const key of Object.keys(next)) if (!next[key]) delete next[key]
  if (Object.keys(next).length) agents[role] = next
  else delete agents[role]
  writeSettings({ agents })
  return agents
}

// CLI: `get <key>` prints the value (nothing when unset), `set <key> <value>`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, key, value] = process.argv.slice(2)
  if (cmd === 'get') process.stdout.write(String(readSettings()[key] ?? ''))
  else if (cmd === 'set' && key && value !== undefined) writeSettings({ [key]: value })
  else { console.error('usage: settings.mjs get <key> | set <key> <value>'); process.exit(2) }
}
