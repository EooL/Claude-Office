// catalogue.mjs — every model the installed services can run, and what kind of model each one is.
//
// Nothing here names a model. What a model is comes from how it describes itself: its id, its label and
// the note some CLIs give (Codex: "Frontier intelligence for the most demanding work", "Fast and affordable
// model for easier tasks"). The words the industry already uses for tiers (flash, mini, haiku are quick; pro,
// ultra, opus, max are deep; sonnet and "workhorse" are in between), a size like 120b, the version number and
// a note saying "older" are read from that text. So a model that appears tomorrow and follows those
// conventions is placed on its own; one that carries no signal at all is "balanced" with low confidence,
// and the Settings screens say so rather than pretend.
//
//   classifyModel({ service, id, label, note, billing }) -> { tier, strength, gen, family, ... }
//   buildCatalogue()   asks every installed and enabled service for its models and classifies them
//   loadCatalogue()    the last one built, kept in $AGENT_OFFICE_HOME/catalogue.json (the CLIs take seconds)
import { join } from 'node:path'
import { adapters, listModels, services } from './adapters.mjs'
import { readJson, writeJson } from './jsonfile.mjs'
import { isEnabled } from './settings.mjs'
import { g0Dir } from './paths.mjs'

const SPEED_WORDS = new Set(['flash', 'fast', 'mini', 'lite', 'light', 'haiku', 'turbo', 'instant', 'efficient', 'small', 'nano', 'spark', 'swift', 'quick', 'affordable', 'easier', 'cheap', 'tiny', 'air'])
const DEPTH_WORDS = new Set(['ultra', 'ultimate', 'max', 'pro', 'opus', 'frontier', 'demanding', 'reasoning', 'thinking', 'premium', 'heavy', 'smartest', 'deep', 'large', 'xl'])
const BALANCED_WORDS = new Set(['sonnet', 'workhorse', 'everyday', 'balanced', 'standard', 'auto', 'general', 'versatile'])
const OLD_RE = /\b(older|previous generation|legacy|deprecated|superseded)\b/
const PREVIEW_RE = /\b(preview|beta|experimental)\b/
const LEVEL_SUFFIX = /-(low|medium|high)$/

export const TIERS = ['fast', 'balanced', 'strong']

const tokens = (text) => new Set(String(text).toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean))
const count = (set, words) => [...words].filter((w) => set.has(w)).length

/** The first version number in an id: gpt-6.1-sol -> 6.1, claude-opus-5-5 -> 5.5, qwen3.8-max -> 3.8, gemini-4-x -> 4. */
export function generationOf(id) {
  const m = String(id).toLowerCase().replace(/\d+(\.\d+)?b\b/g, '').match(/(\d+)(?:[.-](\d{1,2}))?(?![0-9])/)
  return m ? Number(`${m[1]}.${m[2] ?? 0}`) : 0
}

/** The id without its version and reasoning level, to tell newer and older models of one line apart. */
export function familyOf(id) {
  return String(id).toLowerCase().replace(LEVEL_SUFFIX, '').replace(/\d+([.-]\d+)*/g, '#').replace(/#+/g, '#')
}

/** What kind of model this is, from how it describes itself (see the header). */
export function classifyModel({ service, id, label = '', note = '', billing = 'plan', efforts = [] }) {
  const text = `${id} ${label} ${note}`
  const t = tokens(text)
  const speed = Math.min(2, count(t, SPEED_WORDS))
  const depth = Math.min(2, count(t, DEPTH_WORDS))
  const balanced = count(t, BALANCED_WORDS) > 0
  const size = String(id).toLowerCase().match(/(\d+(?:\.\d+)?)b\b/)
  const billions = size ? Number(size[1]) : 0
  const sizeAdj = billions >= 100 ? 10 : billions > 0 && billions <= 14 ? -12 : 0

  const strength = 50 + 18 * depth - 14 * speed + sizeAdj
  let tier = 'balanced'
  if (depth > 0 && speed === 0) tier = 'strong'
  else if (speed > 0 && depth === 0) tier = 'fast'
  else if (depth === 0 && speed === 0 && sizeAdj !== 0) tier = sizeAdj > 0 ? 'strong' : 'fast'
  else if (depth > 0 && speed > 0) tier = strength >= 62 ? 'strong' : strength <= 40 ? 'fast' : 'balanced'

  const signals = depth + speed + (balanced ? 1 : 0) + (sizeAdj !== 0 ? 1 : 0)
  const lower = text.toLowerCase()
  return {
    service,
    id,
    label: label || id,
    note,
    efforts,
    billing,
    tier,
    strength,
    gen: generationOf(id),
    family: familyOf(id),
    deprecated: OLD_RE.test(lower),
    preview: PREVIEW_RE.test(lower),
    // a level baked into the id (agy: -low / -medium / -high) is the reasoning setting for that entry
    effortInId: id.match(LEVEL_SUFFIX)?.[1] ?? '',
    confidence: signals > 0 ? Math.min(0.95, 0.6 + 0.15 * signals) : 0.3,
  }
}

/** Ask every installed and enabled service for its models and classify them. */
export async function buildCatalogue({ list = listModels, svcs = services() } = {}) {
  const per = await Promise.all(svcs.filter((s) => s.available && s.enabled !== false).map(async (s) => {
    const models = await list(s.name)
    const fallbackEfforts = adapters[s.name]?.efforts ?? []
    return models.map((m) => classifyModel({ service: s.name, ...m, efforts: m.efforts?.length ? m.efforts : fallbackEfforts }))
  }))
  return { builtAt: Date.now(), models: per.flat() }
}

// --- kept on disk: listing takes a few seconds per CLI, and every chat reply is its own process

const file = () => join(g0Dir(), 'catalogue.json')
export const CATALOGUE_TTL_MS = 6 * 60 * 60_000

export function loadCatalogue({ maxAgeMs = CATALOGUE_TTL_MS, now = Date.now() } = {}) {
  try {
    const c = readJson(file(), null)
    // a service switched off since it was built is gone from it at once, without waiting for the rebuild
    return c && now - c.builtAt <= maxAgeMs ? { ...c, models: c.models.filter((m) => isEnabled(m.service)) } : null
  } catch { return null }
}

export function saveCatalogue(catalogue) {
  writeJson(file(), catalogue, { pretty: false }) // if it cannot be written it is rebuilt next time
  return catalogue
}

/** Build and keep a fresh one. */
export async function refreshCatalogue(opts) {
  return saveCatalogue(await buildCatalogue(opts))
}
