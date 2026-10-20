// brains.mjs — Brain Profiles: what an agent thinks with, and what it falls back to.
//
// A brain is an ordered chain of steps, each { service, model, effort }: the first one is used, and when it
// cannot be (its 5-hour or weekly window is used up, no credits left, the model or service is not available)
// the run goes on with the next step, so the agent keeps working. Every agent is linked to a brain; one that
// is not inherits the brain of the agent above it (Frontend from Architect), and failing that the single
// service picked for the whole office.
//
// Two operations of the office each have a brain of their own (Settings > General): the chat, which
// answers what is typed in the chat, and the orchestrator, which decides whether a message is a job for an
// agent and starts it. Agents without a brain of their own (and none inherited) work on the orchestrator's.
// Without a brain chosen, an operation runs on the single default service picked for the office.
//
// A brain is either auto (a tier and a reasoning level: its steps are recommended from the catalogue, so a
// model that appears later is picked up by itself) or fixed (the steps you chose). Three auto brains always
// exist; see DEFAULT_BRAINS.
//
//   runWithBrain({ steps, prompt, opts, run })   runs the steps in order until one works
//   resolveSteps(role)                           the steps an agent runs on right now
//   operationSteps('chat' | 'orchestrator')      the steps an operation of the office runs on
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readJson, writeJson } from './jsonfile.mjs'
import { beginCircuit, classifyFailure, finishCircuit, readCooldowns } from './availability.mjs'
import { loadCatalogue } from './catalogue.mjs'
import { recommendSteps } from './recommend.mjs'
import { PROFILES, listRoles } from './roles.mjs'
import { homeDir, isEnabled, readSettings, resolveAgent, writeSettings } from './settings.mjs'

export const DEFAULT_BRAINS = {
  deep: { name: 'Deep thinker', tier: 'strong', effort: 'high', auto: true },
  balanced: { name: 'Balanced', tier: 'balanced', effort: 'medium', auto: true },
  quick: { name: 'Quick', tier: 'fast', effort: 'low', auto: true },
}
const TIER_BRAIN = { strong: 'deep', balanced: 'balanced', fast: 'quick' }
const MAX_STEPS = 6

/** Every brain by id: the three built-in auto ones, with any the settings changed or added. */
export function allBrains(settings = readSettings()) {
  const stored = settings.brains ?? {}
  const out = {}
  for (const [id, b] of Object.entries(DEFAULT_BRAINS)) out[id] = { id, builtin: true, ...b, ...stored[id] }
  for (const [id, b] of Object.entries(stored)) if (!out[id]) out[id] = { id, builtin: false, ...b }
  return out
}

/** The steps of a brain: recommended from the catalogue when it is auto, else the ones that were chosen. */
export function brainSteps(brain, catalogue) {
  if (brain.auto) return recommendSteps({ tier: brain.tier ?? 'balanced', effort: brain.effort ?? 'medium' }, catalogue, { max: 3 })
  return (brain.steps ?? []).map((s) => ({ service: s.service, model: s.model ?? '', effort: s.effort ?? '', label: s.label ?? s.model ?? s.service, why: s.why ?? '' }))
}

/** The brain an agent uses: its own link, else the nearest agent above it that has one. Null: none, the office-wide service. */
export function brainIdFor(role, settings = readSettings()) {
  const parents = Object.fromEntries(listRoles().map((r) => [r.role, r.reportsTo]))
  const seen = new Set()
  for (let r = role; r && !seen.has(r); r = parents[r]) {
    seen.add(r)
    const own = settings.agents?.[r]
    if (own && typeof own === 'object' && own.brain) return { id: own.brain, from: r }
    // an agent given a service of its own the older way (no brain) stops the search: it is that agent's choice
    if (own && typeof own === 'object' && own.service) return null
  }
  return null
}

/** The brain that suits a role's work, and why: its profile's tier picks one of the three built-in ones. */
export function recommendedBrain(role) {
  const profile = PROFILES[role] ?? { tier: 'balanced', why: 'A balanced brain suits general work.' }
  return { id: TIER_BRAIN[profile.tier] ?? 'balanced', why: profile.why }
}

const OPERATION_KEY = { chat: 'chatBrain', orchestrator: 'orchestratorBrain' }

/** The usable steps of a brain: those on a service that is enabled and installed (an unknown catalogue is trusted). */
function usableSteps(brain, catalogue, settings) {
  const installed = new Set((catalogue?.models ?? []).map((m) => m.service))
  return brainSteps(brain, catalogue).filter((s) => isEnabled(s.service, settings) && (installed.size === 0 || installed.has(s.service)))
}

/** The single default service of the office as one step; when it is not enabled, the first service that is. [] when none is. */
function defaultSteps(settings, catalogue) {
  const wanted = settings.backend || 'claude'
  const enabled = [...new Set((catalogue?.models ?? []).map((m) => m.service))].filter((s) => isEnabled(s, settings))
  const service = isEnabled(wanted, settings) ? wanted : enabled[0]
  if (!service) return []
  return [{ service, model: service === wanted ? settings.model || '' : '', effort: '', label: (service === wanted && settings.model) || service, why: 'the default AI service' }]
}

/**
 * The steps an office operation runs on: 'chat' (replies in the chat) or 'orchestrator' (deciding that a message
 * is a job and starting it). The brain chosen for it in Settings, else the default service.
 */
export function operationSteps(operation, settings = readSettings(), catalogue = loadCatalogue({ maxAgeMs: Infinity })) {
  const id = settings[OPERATION_KEY[operation]]
  const brain = id && allBrains(settings)[id]
  const steps = brain ? usableSteps(brain, catalogue, settings) : []
  return steps.length ? steps : defaultSteps(settings, catalogue)
}

/** Choose the brain of an operation (null: the default service). */
export function setOperationBrain(operation, brainId) {
  writeSettings({ [OPERATION_KEY[operation]]: brainId || undefined })
}

/** The built-in brain that suits each operation of the office, and why. */
export const OPERATION_PROFILES = {
  chat: { id: 'quick', why: 'Chat replies are short and quick: speed matters more than depth.' },
  orchestrator: { id: 'balanced', why: 'Deciding whether a message is a job needs a reliable answer, not the deepest reasoning.' },
}

/**
 * The steps an agent works on right now: its own brain, else the one inherited from the agent above it, else the
 * single service Settings gave it the older way, else the orchestrator's. A brain with no step on an installed
 * service counts as none.
 */
export function resolveSteps(role, settings = readSettings(), catalogue = loadCatalogue({ maxAgeMs: Infinity })) {
  const link = brainIdFor(role, settings)
  const brain = link && allBrains(settings)[link.id]
  if (brain) {
    const steps = usableSteps(brain, catalogue, settings)
    if (steps.length) return steps
  }
  const legacy = resolveAgent(role, settings)
  if (legacy.from !== 'office' && isEnabled(legacy.service, settings)) return [{ service: legacy.service, model: legacy.model, effort: legacy.effort, label: legacy.model || legacy.service, why: 'its own service' }]
  return operationSteps('orchestrator', settings, catalogue)
}

// --- storing brains and links ($AGENT_OFFICE_HOME/backend.json, with the rest of the office settings)

const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'brain'

/** Create or update a brain; returns { id, brains }. A fixed brain keeps its chain, an auto one its tier and level. */
export function saveBrain({ id, name, auto, tier, effort, steps }) {
  const settings = readSettings()
  const brains = { ...settings.brains }
  let key = id
  if (!key) {
    key = slug(name)
    for (let n = 2; allBrains(settings)[key]; n++) key = `${slug(name)}-${n}`
  }
  const clean = { name: String(name).slice(0, 40) || key }
  if (auto) Object.assign(clean, { auto: true, tier: TIER_BRAIN[tier] ? tier : 'balanced', effort: effort || '' })
  else Object.assign(clean, { auto: false, steps: (steps ?? []).slice(0, MAX_STEPS).map((s) => ({ service: s.service, model: s.model ?? '', effort: s.effort ?? '' })) })
  brains[key] = clean
  writeSettings({ brains })
  return { id: key, brains: allBrains(readSettings()) }
}

/** Remove a brain you made, or put a built-in one back to its default; agents linked to it fall back to inheriting. */
export function deleteBrain(id) {
  const settings = readSettings()
  const brains = { ...settings.brains }
  delete brains[id]
  // A built-in brain is only put back to its default: it still exists, so nothing that uses it is unlinked.
  // A brain you made is gone, and the agents and operations that used it go back to inheriting.
  if (DEFAULT_BRAINS[id]) {
    writeSettings({ brains })
    return allBrains(readSettings())
  }
  const agents = Object.fromEntries(Object.entries(settings.agents ?? {}).map(([role, a]) => {
    if (a && typeof a === 'object' && a.brain === id) { const { brain, ...rest } = a; return [role, rest] }
    return [role, a]
  }).filter(([, a]) => typeof a === 'string' || Object.keys(a ?? {}).length))
  writeSettings({
    brains,
    agents,
    ...(settings.chatBrain === id ? { chatBrain: undefined } : {}),
    ...(settings.orchestratorBrain === id ? { orchestratorBrain: undefined } : {}),
  })
  return allBrains(readSettings())
}

/** Link an agent to a brain (null: inherit from the agent above). */
export function setAgentBrain(role, brainId) {
  const settings = readSettings()
  const agents = Object.fromEntries(Object.entries(settings.agents ?? {}).map(([r, a]) => [r, typeof a === 'string' ? { service: a } : { ...a }]))
  const entry = { ...agents[role] }
  if (brainId) entry.brain = brainId
  else delete entry.brain
  if (Object.keys(entry).length) agents[role] = entry
  else delete agents[role]
  writeSettings({ agents })
  return agents
}

/** The agents that have no brain: none of their own and none inherited from an agent above them. */
export function unconfiguredAgents(settings = readSettings()) {
  return listRoles().map((r) => r.role).filter((role) => !brainIdFor(role, settings))
}

/**
 * Give every unconfigured agent the built-in brain that suits its work (recommendedBrain). An agent that has a brain,
 * its own or inherited, is left as it is. Returns { role: brainId } for the agents it set.
 */
export function autoAssignBrains() {
  const assigned = {}
  // decided from the state as it is now, so one agent's new brain does not become another's inherited one
  for (const role of unconfiguredAgents()) assigned[role] = recommendedBrain(role).id
  for (const [role, id] of Object.entries(assigned)) setAgentBrain(role, id)
  return assigned
}

/**
 * Before brains, Settings gave an agent a service of its own (and a model and level). Those choices become a brain
 * each, linked to that agent, so they show in Settings and can be edited; run once at start, and a no-op after.
 * Returns the roles it migrated.
 */
export function migrateLegacyAgents() {
  const settings = readSettings()
  const moved = []
  for (const [role, entry] of Object.entries(settings.agents ?? {})) {
    const legacy = typeof entry === 'string' ? { service: entry } : entry
    if (!legacy?.service || legacy.brain) continue
    const name = `${listRoles().find((r) => r.role === role)?.name ?? role} brain`
    const { id } = saveBrain({ name, steps: [{ service: legacy.service, model: legacy.model ?? '', effort: legacy.effort ?? '' }] })
    setAgentBrain(role, id)
    moved.push(role)
  }
  return moved
}

// --- running a chain

/**
 * Claude reports its own 5-hour and weekly windows (and a spend limit) through the status line, with the moment each
 * one resets. A full window opens the circuit: any one of them is enough, and when several are full it stays open
 * until the latest of them resets. Returns { kind, window, until, message } while one is, else null.
 * `status` is what GET /status returns.
 */
export function claudeWindowBlock(status, now = Date.now()) {
  const full = []
  for (const s of status?.sessions ?? []) {
    const rl = s.rateLimits
    if (!rl) continue
    for (const [pct, resets, window, name] of [
      [rl.fiveHour, rl.fiveHourResetsAt, '5h', '5-hour window'],
      [rl.sevenDay, rl.sevenDayResetsAt, 'weekly', 'weekly window'],
      [rl.spendLimit, rl.spendLimitResetsAt, 'spend', 'spend limit'],
    ]) {
      if (typeof pct === 'number' && pct >= 100 && typeof resets === 'number' && resets * 1000 > now) full.push({ window, name, until: resets * 1000 })
    }
  }
  if (full.length === 0) return null
  const latest = full.reduce((a, b) => (b.until > a.until ? b : a))
  const names = [...new Set(full.map((f) => f.name))]
  return { kind: 'limit', window: latest.window, until: latest.until, message: `Claude's ${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} used up` }
}

const WHY = {
  probing: 'is being checked by another worker',
  limit: 'hit its usage limit',
  credits: 'is out of credits',
  unavailable: 'is not available right now',
  model: 'does not have that model',
  auth: 'needs a login',
  permission: 'needs a tool permission that headless mode cannot request',
  other: 'did not answer',
}
export const describeFailure = (kind) => WHY[kind] ?? WHY.other

/**
 * Run `prompt` on the first step that works. `run(service, prompt, opts)` is the adapter call;
 * `blocked(step)` says why a step is out for now ({ kind, until, message } or null) and `fail(step, failure)`
 * remembers a failure; both default to the cooldown files. Resolves the result of the step that worked,
 * with `step` and `attempts` ([{ step, skipped?, failed? }]); when none did, text is '' and `exhausted` is true.
 */
export async function runWithBrain({ steps, prompt, opts = {}, run, blocked = async () => null, fail }) {
  const attempts = []
  let last = null
  for (const step of steps) {
    const why = await blocked(step)
    if (why) { attempts.push({ step, skipped: why.kind }); continue }
    const lease = fail ? null : beginCircuit(step, { mode: opts.mode ?? 'chat' })
    if (lease?.blocked) { attempts.push({ step, skipped: lease.blocked.kind }); continue }
    let result
    try {
      await opts.onAttempt?.(step)
      result = await run(step.service, prompt, { ...opts, model: step.model || undefined, effort: step.effort || undefined })
    } catch (error) {
      result = { text: '', error: error.message, code: 1, usage: {}, reported: [], durationMs: 0 }
    }
    const failure = classifyFailure(result)
    if (lease) finishCircuit(lease, step, failure, { mode: opts.mode ?? 'chat' })
    if (!failure) return { ...result, step, attempts }
    if (fail) await fail(step, failure)
    attempts.push({ step, failed: failure.kind })
    last = result
  }
  return { ...(last ?? { code: 1, error: 'every step of this brain is unavailable', usage: {}, reported: [], model: '', durationMs: 0 }), text: '', attempts, exhausted: true }
}

// --- noticing a change of step, so the agent says so once

const lastFile = () => join(homeDir, 'brain-last.json')

/** Remember which step a role used; returns the previous one's key ('' the first time). */
export function noteUsed(role, step) {
  const all = readJson(lastFile(), {})
  const key = `${step.service}/${step.model}`
  const previous = all[role] ?? ''
  if (previous !== key) {
    all[role] = key
    writeJson(lastFile(), all) // if it cannot be written the notice may repeat
  }
  return previous
}

/** What the agent says when its brain moves to another step (null: nothing to say). */
export function switchNotice(steps, used, previousKey, attempts) {
  const primary = steps[0]
  const usedKey = `${used.service}/${used.model}`
  if (previousKey === usedKey) return null
  const name = (s) => s.label || s.model || s.service
  if (used === primary || (used.service === primary.service && used.model === primary.model)) {
    return previousKey ? `Back on ${name(primary)}.` : null
  }
  const out = attempts.find((a) => a.step.service === primary.service && a.step.model === primary.model)
  const reason = out ? describeFailure(out.failed ?? out.skipped) : 'is out for now'
  return `Heads-up boss: ${name(primary)} ${reason}, so I am on ${name(used)} for now.`
}

export { readCooldowns }

// CLI: prints service|model|effort of the first step of `chat`, `orchestrator` or `agent <role>`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, role] = process.argv.slice(2)
  const steps = cmd === 'agent' && role ? resolveSteps(role) : cmd === 'chat' || cmd === 'orchestrator' ? operationSteps(cmd) : null
  if (steps) process.stdout.write(steps.length ? `${steps[0].service}|${steps[0].model}|${steps[0].effort}` : '')
  else { console.error('usage: brains.mjs chat | orchestrator | agent <role>'); process.exit(2) }
}
