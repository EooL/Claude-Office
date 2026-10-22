// server/building-summary.mjs — derive a lightweight JSON view of offices from registry, live state and cooldowns.

/**
 * Build a plain object suitable for external consumption. Pure function: no file/network/process access,
 * never mutates inputs. Only extracts fields explicitly allowed in the output schema.
 *
 * @param {object} options
 * @param {import('./registry.mjs').Office[]} options.offices — array from listOffices()
 * @param {Array<{id: string, state?: object}>} options.live — array of { id, state } where state has activeAgents / sessions
 * @param {object} options.cooldowns — object returned by readCooldowns() (key -> { kind, until, ... })
 * @param {number} options.now — timestamp; defaults to Date.now()
 * @returns {{schemaVersion: 1, g0: any, levels: any[]}}
 */
export function buildBuildingSummary({ offices, live = [], cooldowns = {}, now = Date.now() }) {
  const liveIds = new Set(live.map(entry => entry.id))

  function parseServiceAndModel(key) {
    if (!key || typeof key !== 'string') return { service: null, model: null }
    // Keys come from cooldownKey(): 'service', 'service@mode' (permission) or 'service/model' (model ids may contain '/').
    const at = key.indexOf('@'), slash = key.indexOf('/')
    if (at > 0) return { service: key.slice(0, at), model: null }
    if (slash > 0) return { service: key.slice(0, slash), model: key.slice(slash + 1) || null }
    return { service: key || null, model: null }
  }

  /** Validate & normalize label: control chars removed, trim, max 60, fallback to id. */
  function normalizeLabel(id, maybeLabel) {
    if (typeof maybeLabel === 'string') {
      // Remove control characters (U+0000 through U+001F, plus DEL U+007F)
      const cleaned = maybeLabel.replace(/[\x00-\x1f\x7f]/g, '')
      const trimmed = cleaned.trim()
      if (trimmed.length > 0 && trimmed.length <= 60) return trimmed
    }
    return id
  }

  /** Filter cooldowns: only those still active (> now), extract exactly four fields, sort by until asc. */
  function summarizeCooldowns(cooldownsObj) {
    const filtered = []
    for (const [key, value] of Object.entries(cooldownsObj)) {
      if (!value || typeof value.until !== 'number' || value.until <= now) continue
      const { service, model } = parseServiceAndModel(key)
      filtered.push({
        service,
        model,
        kind: value.kind ?? null,
        until: value.until,
      })
    }
    filtered.sort((a, b) => a.until - b.until)
    return filtered
  }

  /** Build level for one office. */
  function buildLevel(office) {
    const { id } = office
    const status = liveIds.has(id) ? 'attached' : 'unattached'

    let activeAgents = null
    let lastEvent = null

    const liveEntry = live.find(entry => entry.id === id)
    if (liveEntry && liveEntry.state) {
      const state = liveEntry.state
      // Extract activeAgents count safely
      if (state.activeAgents instanceof Map) {
        activeAgents = state.activeAgents.size
      } else if (Array.isArray(state.activeAgents)) {
        activeAgents = state.activeAgents.length
      }

      // lastEvent must ONLY have {kind, at}, never text/prompts/paths/raw data
      if (state.lastEvent && typeof state.lastEvent === 'object') {
        const evt = state.lastEvent
        if (typeof evt.kind === 'string' && Number.isFinite(evt.at)) {
          lastEvent = { kind: evt.kind, at: evt.at }
        }
      }
    }

    return {
      id,
      level: `L${offices.indexOf(office) + 1}`,
      name: normalizeLabel(id, office.label),
      status,
      activeAgents,
      cost: { usd: null, complete: false },
      lastEvent,
      href: `/o/${id}/`,
      openable: false,
    }
  }

  const levels = offices.map(buildLevel)

  return {
    schemaVersion: 1,
    g0: {
      cooldowns: summarizeCooldowns(cooldowns),
      cost: { usd: null, period: 'today', complete: false },
    },
    levels,
  }
}
