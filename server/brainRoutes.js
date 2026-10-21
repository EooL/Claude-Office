/**
 * brainRoutes.js — Brain Profiles for the Settings screens (server/brains.mjs).
 *
 *   GET    /brains            { brains, agents, effective, recommended, cooldowns, catalogue }   (open)
 *   POST   /brains            { id?, name, auto?, tier?, effort?, steps? } -> the same            (UI token)
 *   DELETE /brains/:id        a brain you made, or a built-in one back to its default             (UI token)
 *   POST   /brains/preview    { tier, effort, max? } -> { steps }  the recommendation, not saved  (open)
 *   POST   /brains/link       { role, brain|null } -> the same   link an agent to a brain         (UI token)
 *   POST   /brains/auto-assign  -> the same + { assigned: { role: brain } }   set every agent without a brain (UI token)
 *   POST   /brains/operation  { operation: 'chat'|'orchestrator', brain|null } -> the same        (UI token)
 *   POST   /brains/cooldowns/clear  { key? }   try a service again now                            (UI token)
 *   POST   /brains/refresh    rebuild the model catalogue now                                    (UI token)
 *   GET    /brains/catalogue  every model the installed services can run, with its classification (open)
 *
 * `operations` says which brain the chat and the agent orchestrator run on (null: the default service);
 * `recommendedOperations` the built-in brain that suits each, with the reason; `unconfigured` the agents
 * that have no brain, own or inherited.
 * Each brain comes with its resolved `steps` (an auto brain's are recommended from the catalogue, so a model
 * that shows up later is picked up) and, for each step, `blocked`: why it is out for now, if it is.
 * `effective[role]` is the brain an agent really uses ({ id, from } or null: the office-wide service) and
 * `recommended[role]` the built-in one that suits its work, with the reason.
 */

import { blockedReason, clearCooldown, readCooldowns } from './availability.mjs'
import { adapters } from './adapters.mjs'
import { OPERATION_PROFILES, allBrains, autoAssignBrains, brainIdFor, brainSteps, deleteBrain, unconfiguredAgents, migrateLegacyAgents, operationSteps, recommendedBrain, saveBrain, setAgentBrain, setOperationBrain } from './brains.mjs'
import { CATALOGUE_TTL_MS, loadCatalogue, refreshCatalogue } from './catalogue.mjs'
import { recommendSteps } from './recommend.mjs'
import { listRoles } from './roles.mjs'
import { readSettings } from './settings.mjs'

let building = null

/** The catalogue on disk; one is built first when there is none, and a stale one is rebuilt in the background. */
async function catalogueNow() {
  const fresh = loadCatalogue()
  if (fresh) return fresh
  const stale = loadCatalogue({ maxAgeMs: Infinity })
  building ??= refreshCatalogue().finally(() => { building = null })
  return stale ?? building
}

/** The set of enabled services changed: its models are the catalogue now, so rebuild it. */
export function refreshCatalogueSoon() {
  building ??= refreshCatalogue().finally(() => { building = null })
  return building
}

export function startCatalogueRefresh() {
  migrateLegacyAgents()
  void catalogueNow()
  const timer = setInterval(() => { building ??= refreshCatalogue().finally(() => { building = null }) }, CATALOGUE_TTL_MS / 12)
  timer.unref?.()
}

async function overview() {
  const catalogue = await catalogueNow()
  const settings = readSettings()
  // what the CLIs printed stays on this machine: the screens only need the kind and when it is over
  const cooldowns = Object.fromEntries(Object.entries(readCooldowns()).map(([k, v]) => [k, { kind: v.state === 'half-open' ? 'probing' : v.kind, until: v.until, ...(v.window ? { window: v.window } : {}), state: v.state ?? 'open', failures: v.failures ?? 1 }]))
  const brains = Object.values(allBrains(settings)).map(b => ({
    ...b,
    steps: brainSteps(b, catalogue).map(s => ({ ...s, blocked: blockedReason(s, cooldowns) ?? blockedReason(s, cooldowns, 'plan') ?? blockedReason(s, cooldowns, 'write') })),
  }))
  const roles = listRoles()
  const effective = Object.fromEntries(roles.map(r => [r.role, brainIdFor(r.role, settings)]))
  const recommended = Object.fromEntries(roles.map(r => [r.role, recommendedBrain(r.role)]))
  const unconfigured = unconfiguredAgents(settings)
  const agents = Object.fromEntries(Object.entries(settings.agents ?? {}).filter(([, a]) => a && typeof a === 'object' && a.brain).map(([r, a]) => [r, a.brain]))
  const models = catalogue?.models ?? []
  // what each operation of the office runs on: the brain chosen for it (null: the default service) and its steps
  const operations = Object.fromEntries([['chat', settings.chatBrain], ['orchestrator', settings.orchestratorBrain]].map(([op, id]) => [op, {
    brain: id && allBrains(settings)[id] ? id : null,
    steps: operationSteps(op, settings, catalogue).map(s => ({ ...s, blocked: blockedReason(s, cooldowns) })),
  }]))
  return {
    operations,
    recommendedOperations: OPERATION_PROFILES,
    unconfigured,
    brains,
    agents,
    effective,
    recommended,
    cooldowns,
    catalogue: { builtAt: catalogue?.builtAt ?? 0, count: models.length, unsure: models.filter(m => m.confidence < 0.5).length },
  }
}

export function mountBrains(app, { requireUi }) {
  app.get('/brains', async (_req, res) => res.json(await overview()))

  app.get('/brains/catalogue', async (_req, res) => {
    const catalogue = await catalogueNow()
    res.json({ builtAt: catalogue?.builtAt ?? 0, models: catalogue?.models ?? [] })
  })

  app.post('/brains/preview', async (req, res) => {
    const tier = ['fast', 'balanced', 'strong'].includes(req.body?.tier) ? req.body.tier : 'balanced'
    const effort = typeof req.body?.effort === 'string' ? req.body.effort.slice(0, 10) : ''
    const max = Math.min(6, Math.max(1, Number(req.body?.max) || 3))
    res.json({ steps: recommendSteps({ tier, effort: effort || 'medium' }, await catalogueNow(), { max }) })
  })

  app.post('/brains', requireUi, async (req, res) => {
    const b = req.body ?? {}
    if (typeof b.name !== 'string' || !b.name.trim()) return res.status(400).json({ error: 'A brain needs a name' })
    if ((!b.auto && !Array.isArray(b.steps)) || (b.steps !== undefined && !Array.isArray(b.steps))) return res.status(400).json({ error: 'A brain needs an array of steps' })
    if (b.id !== undefined && (typeof b.id !== 'string' || !allBrains(readSettings())[b.id])) return res.status(404).json({ error: 'Unknown brain' })
    const steps = (b.steps ?? []).filter(s => s && typeof s.service === 'string')
    if (steps.length !== (b.steps ?? []).length || steps.some(s =>
      !Object.hasOwn(adapters, s.service) ||
      (s.model !== undefined && (typeof s.model !== 'string' || s.model.length > 200 || /[\x00-\x1f]/.test(s.model))) ||
      (s.effort !== undefined && (typeof s.effort !== 'string' || !/^[a-z]{0,10}$/.test(s.effort)))
    )) return res.status(400).json({ error: 'Invalid brain step' })
    saveBrain({ id: b.id, name: b.name.trim(), auto: !!b.auto, tier: b.tier, effort: b.effort, steps })
    res.json(await overview())
  })

  app.delete('/brains/:id', requireUi, async (req, res) => {
    if (!allBrains(readSettings())[req.params.id]) return res.status(404).json({ error: 'Unknown brain' })
    deleteBrain(req.params.id)
    res.json(await overview())
  })

  app.post('/brains/link', requireUi, async (req, res) => {
    const role = typeof req.body?.role === 'string' ? req.body.role : ''
    const brain = req.body?.brain ?? null
    if (!listRoles().some(r => r.role === role)) return res.status(400).json({ error: 'Unknown role' })
    if (brain !== null && !allBrains(readSettings())[brain]) return res.status(400).json({ error: 'Unknown brain' })
    setAgentBrain(role, brain)
    res.json(await overview())
  })

  // Give every agent that has no brain (own or inherited) the built-in one that suits its work
  app.post('/brains/auto-assign', requireUi, async (_req, res) => {
    const assigned = autoAssignBrains()
    res.json({ ...(await overview()), assigned })
  })

  // Choose the brain of an office operation: 'chat' or 'orchestrator' (brain null: the default service)
  app.post('/brains/operation', requireUi, async (req, res) => {
    const operation = req.body?.operation
    const brain = req.body?.brain ?? null
    if (operation !== 'chat' && operation !== 'orchestrator') return res.status(400).json({ error: 'Unknown operation' })
    if (brain !== null && !allBrains(readSettings())[brain]) return res.status(400).json({ error: 'Unknown brain' })
    setOperationBrain(operation, brain)
    res.json(await overview())
  })

  app.post('/brains/cooldowns/clear', requireUi, async (req, res) => {
    clearCooldown(typeof req.body?.key === 'string' ? req.body.key : undefined)
    res.json(await overview())
  })

  app.post('/brains/refresh', requireUi, async (_req, res) => {
    building ??= refreshCatalogue().finally(() => { building = null })
    await building
    res.json(await overview())
  })
}
