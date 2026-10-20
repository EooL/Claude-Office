// recommend.mjs — which models suit a job, from everything the installed services can run.
//
//   recommendSteps(need, catalogue, { max }) -> [{ service, model, label, effort, why }]
//
// `need` is { tier, effort }: how capable the job asks the model to be (fast, balanced, strong) and how hard
// it should reason. The result is an ordered chain: the best fit first, then fallbacks, preferring a different
// service for each so that one service running out of its 5-hour window, credits or availability still leaves
// the next step usable. Nothing here knows a model by name: it ranks the catalogue (server/catalogue.mjs).
import { TIERS } from './catalogue.mjs'

export const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max']

/** The level to ask a CLI for: the wanted one if it has it, else the closest one below, else its lowest. */
export function clampEffort(want, efforts) {
  if (!efforts?.length) return ''
  if (efforts.includes(want)) return want
  const wanted = EFFORT_ORDER.indexOf(want)
  const below = efforts.filter((e) => EFFORT_ORDER.indexOf(e) < wanted)
  return below.length ? below[below.length - 1] : efforts[0]
}

/** How well a model fits a need; higher is better. A pay-per-token model ranks below every model the CLIs include in their plans. */
export function fitScore(model, need) {
  const gap = Math.abs(TIERS.indexOf(model.tier) - TIERS.indexOf(need.tier))
  let score = 100 - 35 * gap
  // within a tier: a stronger model for deep work, a quicker one for fast work
  score += need.tier === 'fast' ? (60 - model.strength) / 5 : (model.strength - 50) / 5
  // version numbers only compare inside one line of models (newestPerFamily); across lines they just break ties
  score += Math.min(model.gen, 10) * 0.5
  if (model.deprecated) score -= 15
  if (model.preview) score -= 3
  if (model.confidence < 0.5) score -= 8
  if (model.billing === 'api') score -= 100
  // an id that carries its own reasoning level: prefer the level that was asked for
  if (model.effortInId) score += model.effortInId === need.effort ? 6 : -4
  return score
}

/** Keep the newest model of each line per service (gpt-6.1-sol over gpt-6-sol), and every level variant of it. */
function newestPerFamily(models) {
  const best = new Map()
  for (const m of models) {
    const key = `${m.service}|${m.family}`
    const top = best.get(key)
    if (!top || m.gen > top) best.set(key, m.gen)
  }
  return models.filter((m) => m.gen === best.get(`${m.service}|${m.family}`))
}

const reasonFor = (m, need) => {
  const bits = [`${m.tier} model`]
  if (m.tier !== need.tier) bits.push(`closest to ${need.tier} that ${m.service} has`)
  if (m.billing === 'api') bits.push('pays per token')
  else if (m.billing === 'free') bits.push('free')
  if (m.confidence < 0.5) bits.push('tier is a guess: its name says little')
  return bits.join(', ')
}

export function recommendSteps(need, catalogue, { max = 3 } = {}) {
  const pool = newestPerFamily(catalogue?.models ?? [])
  const ranked = pool.map((m) => ({ m, score: fitScore(m, need) })).sort((a, b) => b.score - a.score)
  const chosen = []
  const perService = new Map()
  // a different service for each step first, then a second model of a service already used, and the models
  // that cost per token only after every plan or free model
  for (const { perServiceLimit, paid } of [{ perServiceLimit: 1, paid: false }, { perServiceLimit: 2, paid: false }, { perServiceLimit: 1, paid: true }]) {
    const used = paid ? new Map() : perService
    for (const { m } of ranked) {
      if (chosen.length >= max) break
      if ((m.billing === 'api') !== paid) continue
      if (chosen.some((c) => c.service === m.service && c.model === m.id)) continue
      if ((used.get(m.service) ?? 0) >= perServiceLimit) continue
      chosen.push({
        service: m.service,
        model: m.id,
        label: m.label,
        effort: m.effortInId ? '' : clampEffort(need.effort, m.efforts),
        why: reasonFor(m, need),
      })
      used.set(m.service, (used.get(m.service) ?? 0) + 1)
    }
  }
  return chosen
}
