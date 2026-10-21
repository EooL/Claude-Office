/**
 * backends.js — which AI service answers the office chat and runs
 * `npm run office-run`, picked on the page's start screen.
 *
 *   GET  /backends         { services: [{ name, label, bin, available, install?, docs, setup }],
 *                            selected, confirmed }          (open: names and install hints)
 *   POST /backends/full-access  { name, enabled } -> { ok, services }   run an approved plan with every permission\n *                            prompt skipped, for a service that has such a mode (agy); off by default (UI token)\n *   POST /backends/enable  { name, enabled } -> { ok, services }   allow or forbid a service (UI token)
 *   POST /backends/select  { name }  -> { ok: true, selected }   (UI token or office token:
 *                            it chooses which local CLI the chat watcher runs)
 *   GET  /backends/models?service=      { models: [{ id, label, note? }], efforts, note }
 *   POST /backends/agent   { role, name?, model?, effort? } -> { ok: true, agents }   what one office role
 *                            works with (the agents the chat delegates jobs to): its service
 *                            (name null: the office-wide one), model and reasoning level; GET /backends lists
 *                            `roles` (with who each reports to), the `agents` chosen in Settings and `effective`, what every role
 *                            really uses once it inherits from the role above it
 *
 * The catalogue and the PATH check live in server/adapters.mjs; the choice is
 * saved in ~/.agent-office/backend.json (server/settings.mjs), which the chat
 * watcher re-reads on every reply, so a pick takes effect without a restart.
 * `confirmed` is true once a choice is saved and its CLI is still installed:
 * the page shows its start screen only until then, and the gear button reopens it.
 */

import { adapters, listModels, services } from './adapters.mjs'
import { listRoles } from './roles.mjs'
import { agentsMap, isEnabled, readSettings, resolveAgent, setAgentConfig, setFullAccess, setServiceEnabled, writeSettings } from './settings.mjs'

/** Every role with what it really works with (its own choice, else its manager's, else the office's). */
function effectiveAgents() {
  return Object.fromEntries(listRoles().map(r => [r.role, resolveAgent(r.role)]))
}

export function mountBackends(app, { requireUi, onServicesChanged }) {
  // First run only: asked until a choice is saved, and again if the saved
  // service is no longer installed
  app.get('/backends', (_req, res) => {
    const list = services()
    const selected = readSettings().backend
    const confirmed = list.some(s => s.name === selected && s.available && s.enabled)
    res.json({ services: list, selected: selected ?? 'claude', confirmed, roles: listRoles(), agents: agentsMap(), effective: effectiveAgents() })
  })

  // The models a service can run and the reasoning levels it takes (a CLI call, cached for a few minutes)
  app.get('/backends/models', async (req, res) => {
    const name = String(req.query.service ?? '')
    const adapter = adapters[name]
    if (!adapter) return res.status(400).json({ error: 'Unknown service' })
    res.json({ models: await listModels(name), efforts: adapter.efforts ?? [], note: adapter.reasoningNote ?? '' })
  })

  // What one office role works with: its service (name null: the office-wide one again) and/or its model
  app.post('/backends/agent', requireUi, (req, res) => {
    const role = typeof req.body?.role === 'string' ? req.body.role : ''
    if (!listRoles().some(r => r.role === role)) return res.status(400).json({ error: 'Unknown role' })
    const patch = {}
    if (req.body?.name !== undefined) {
      const name = req.body.name
      if (name !== null) {
        const service = services().find(s => s.name === name)
        if (!service) return res.status(400).json({ error: 'Unknown service' })
        if (!service.available) return res.status(409).json({ error: `${service.label} is not installed` })
      }
      patch.service = name ?? ''
    }
    if (req.body?.model !== undefined) {
      const model = req.body.model
      if (typeof model !== 'string' || model.length > 100 || [...model].some(c => c.charCodeAt(0) < 32)) return res.status(400).json({ error: 'Invalid model' })
      patch.model = model.trim()
    }
    if (req.body?.effort !== undefined) {
      const effort = req.body.effort
      if (typeof effort !== 'string' || !/^[a-z]{0,10}$/.test(effort)) return res.status(400).json({ error: 'Invalid reasoning level' })
      patch.effort = effort
    }
    res.json({ ok: true, agents: setAgentConfig(role, patch), effective: effectiveAgents() })
  })

  // Allow or forbid the office to use a service: only services that are installed and enabled are run,
  // listed (models) or offered anywhere in Settings
  app.post('/backends/enable', requireUi, async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name : ''
    const list = services()
    const service = list.find(s => s.name === name)
    if (!service) return res.status(400).json({ error: 'Unknown service' })
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' })
    setServiceEnabled(name, req.body.enabled, list.filter(s => s.available).map(s => s.name))
    // the models the other screens offer come from the enabled services: wait until the list is rebuilt
    await onServicesChanged?.()
    res.json({ ok: true, services: services() })
  })

  // Let a service run with every permission prompt skipped when it executes an approved plan (off by default)
  app.post('/backends/full-access', requireUi, (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name : ''
    const service = services().find(s => s.name === name)
    if (!service) return res.status(400).json({ error: 'Unknown service' })
    if (!service.fullAccessSupported) return res.status(400).json({ error: `${service.label} has no full-access mode` })
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' })
    setFullAccess(name, req.body.enabled)
    res.json({ ok: true, services: services() })
  })

  app.post('/backends/select', requireUi, async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name : ''
    const service = services().find(s => s.name === name)
    if (!service) return res.status(400).json({ error: 'Unknown service' })
    if (!service.available) return res.status(409).json({ error: `${service.label} is not installed` })
    // The first choice ever made also decides which services are allowed: this one. Later it only adds to them.
    const first = readSettings().backend === undefined
    // A model saved for another service would be wrong for this one
    writeSettings({ backend: name, ...(readSettings().backend === name ? {} : { model: '' }) })
    if (first) writeSettings({ enabledServices: [name] })
    else if (!isEnabled(name)) setServiceEnabled(name, true, services().filter(s => s.available).map(s => s.name))
    await onServicesChanged?.()
    res.json({ ok: true, selected: name })
  })
}
