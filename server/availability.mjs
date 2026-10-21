// availability.mjs — why a run of a service did not work, and how long to leave it alone.
//
// A CLI that has used up its 5-hour or weekly window, run out of credits, lost its model or is simply
// down does not say so in a structured way: it exits non-zero or prints an error. classifyFailure reads
// that text; the cooldowns remember it, so the next run goes straight to the next brain step (server/brains.mjs)
// and the service is tried again once the time is up.
//
// These are patterns over error text, not a contract: a CLI whose wording is not covered gives 'other' and
// is retried at the next opportunity after a short pause.
import { join } from 'node:path'
import { readJson, writeJson } from './jsonfile.mjs'
import { g0Dir } from './paths.mjs'
import { acquireProcessLock } from './process-lock.mjs'
import { createHash } from 'node:crypto'

const MIN = 60_000
const HOUR = 60 * MIN

/** kind -> how long a service (or model) is left alone when the text gives no better time. */
export const COOLDOWN_MS = { input: 0, limit: 30 * MIN, weekly: 6 * HOUR, credits: 6 * HOUR, unavailable: 5 * MIN, model: 6 * HOUR, auth: 6 * HOUR, permission: 2 * MIN, other: 2 * MIN }

const PATTERNS = [
  // the caller's prompt does not fit this CLI's way of taking it (a command-line argument): nothing wrong with the service
  ['input', /takes the prompt as a command-line argument/],
  ['permission', /auto-denied|permission.{0,80}(denied|cannot prompt)|headless mode cannot prompt|tool.{0,80}required.{0,40}permission/],
  // what to do about the model comes first: "model not found" often also says "not available"
  ['model', /unrecognized_model|invalid model|unknown model|model.{0,40}(not found|does not exist|not supported|isn.t available|is not available)|no such model/],
  ['credits', /insufficient (credit|fund|balance|quota)|out of credits|no credits|credit balance|billing|payment required|\b402\b|add (more )?credits|purchase (more )?credits|upgrade your plan|plan does not include/],
  ['limit', /rate.?limit|usage limit|limit (has been )?(reached|exceeded)|you.?ve (hit|reached|used)|exceeded (your|the)|too many requests|\b429\b|quota|5.?hour|weekly|window|resets? (in|at|on)|try again (in|after|at)/],
  ['auth', /not logged in|please (log ?in|sign in)|unauthori[sz]ed|\b401\b|\b403\b|invalid api key|authentication|run .{0,20}login/],
  ['unavailable', /overloaded|\b52[0-9]\b|\b50[0-4]\b|service unavailable|unavailable|at capacity|temporarily|try again later|timed out|timeout|econn(refused|reset)|enotfound|network|socket hang up/],
]

/**
 * Which usage window a limit message is about: 'weekly', '5h', or '' when it does not say. A weekly window ends
 * days from now and a 5-hour one within hours, so they are left alone for different times; either one being
 * used up opens the circuit.
 */
export function windowOf(text) {
  const t = String(text).toLowerCase()
  if (/weekly|7.?day|per week|this week|week(ly)? limit/.test(t)) return 'weekly'
  if (/5.?hour|five.?hour|session limit|hourly/.test(t)) return '5h'
  return ''
}

const LIMIT_FIRST = /usage limit|hit your .{0,24}limit|(5.?hour|weekly|rate) limit|limit (has been )?(reached|exceeded)/

/**
 * "try again at 1:48 AM", "resets at 15:30", "available again at 3pm": the milliseconds until the next time the
 * clock shows that (today if it is still ahead, else tomorrow), or 0 when there is no such hint. Local time.
 */
export function parseClockHint(text, now = Date.now()) {
  const m = String(text).toLowerCase().match(/(?:retry|try again|resets?|available again|back)\D{0,12}?\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
  if (!m) return 0
  let hour = Number(m[1])
  const minute = Number(m[2] ?? 0)
  if (m[3]) {
    if (hour < 1 || hour > 12) return 0
    hour = (hour % 12) + (m[3] === 'pm' ? 12 : 0)
  } else if (hour > 23) return 0
  if (minute > 59) return 0
  const target = new Date(now)
  target.setHours(hour, minute, 30, 0) // half a minute past, so it is really over when it is tried again
  if (target.getTime() <= now) target.setDate(target.getDate() + 1)
  return target.getTime() - now
}

const UNIT_MS = (unit) => (unit.startsWith('ms') || unit.startsWith('milli') ? 1 : unit.startsWith('s') ? 1000 : unit.startsWith('m') ? MIN : unit.startsWith('h') ? HOUR : 24 * HOUR)

/**
 * "retry after 90s", "resets in 3 hours", "try again in 20 minutes", "resets in 2 days 4 hours" -> milliseconds, or 0
 * when there is no hint. A run of amounts ("2 days, 4 hours and 10 minutes") adds up.
 */
export function parseRetryHint(text) {
  const run = String(text).toLowerCase().match(/(?:retry(?:ing)?|try again|resets?|available again|wait)\D{0,12}?(?:after|in|for)?\s*((?:\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)\b[\s,]*(?:and\s+)?)+)/)
  if (!run) return 0
  let total = 0
  for (const part of run[1].matchAll(/(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)\b/g)) total += Number(part[1]) * UNIT_MS(part[2])
  return total
}

/**
 * null when the run worked, else { kind, retryAfterMs, message }. A run worked when it produced an answer,
 * whatever its exit code (some CLIs exit 1 after answering). No text, or text that is itself an error report,
 * is a failure, and the error output says which kind.
 */
export function classifyFailure({ text, error }, now = Date.now()) {
  // an answer that itself reports the failure (Claude prints "API Error: 429 ..." as its result) is none
  if (text && !/^(api error|error)\b/i.test(text.trim())) return null
  const haystack = `${error ?? ''}\n${text ?? ''}`.toLowerCase()
  let kind = 'other'
  // "You've hit your usage limit ... purchase more credits or try again at 1:48 AM" is a limit that ends by itself,
  // not an empty account: the credits pattern would take it first, so a stated limit is decided before it
  if (LIMIT_FIRST.test(haystack)) kind = 'limit'
  else for (const [k, re] of PATTERNS) if (re.test(haystack)) { kind = k; break }
  const message = (String(error ?? '').trim() || String(text ?? '').trim()).split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 200)
  const hint = parseRetryHint(haystack) || parseClockHint(haystack, now)
  const window = kind === 'limit' ? windowOf(haystack) : ''
  // without a stated time a weekly window is retried (once, as a probe) after hours, a 5-hour one after half an hour
  const fallback = window === 'weekly' ? COOLDOWN_MS.weekly : COOLDOWN_MS[kind]
  return { kind, ...(window ? { window } : {}), retryAfterMs: hint > 0 ? Math.min(hint, 7 * 24 * HOUR) : fallback, hinted: hint > 0, message }
}

// --- the cooldowns: what is being left alone until when, kept across processes ($AGENT_OFFICE_HOME/cooldowns.json)

const file = () => join(g0Dir(), 'cooldowns.json')
const allCircuits = () => readJson(file(), {})

// Atomic replacement alone cannot protect read/modify/write operations in different workers.
function updateCircuits(change) {
  let release
  for (let n = 0; n < 200 && !release; n++) {
    release = acquireProcessLock(join(g0Dir(), 'circuits-state.lock'))
    if (!release) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
  }
  if (!release) throw new Error('Circuit breaker state is busy')
  try {
    const all = allCircuits()
    const result = change(all)
    if (!writeJson(file(), all)) throw new Error('Could not persist circuit breaker state')
    return result
  } finally { release() }
}

export function readCooldowns(now = Date.now()) {
  try {
    const all = allCircuits()
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v && v.until > now))
  } catch { return {} }
}

/** The key a failure applies to: the model for a model problem, else the whole service. */
export const cooldownKey = (service, model, kind, mode = 'chat') => (kind === 'permission' ? `${service}@${mode}` : kind === 'model' && model ? `${service}/${model}` : service)

export function setCooldown(key, { kind, window = '', retryAfterMs, message, hinted = false }, now = Date.now()) {
  return updateCircuits(all => {
    const failures = all[key]?.kind === kind ? (all[key]?.failures ?? 0) + 1 : 1
    const backoff = !hinted && ['other', 'unavailable', 'permission'].includes(kind) ? Math.min(16, 2 ** (failures - 1)) : 1
    // two windows can be used up at once: the circuit stays open until the later one ends
    const until = Math.max(now + retryAfterMs * backoff, all[key]?.kind === 'limit' && kind === 'limit' ? (all[key].until ?? 0) : 0)
    all[key] = { state: 'open', failures, kind, ...(window ? { window } : {}), until, message, at: now }
    return all[key]
  })
}

export function clearCooldown(key) {
  updateCircuits(all => {
    if (key) {
      delete all[key]
      // A service's Try now also clears its mode-specific permission circuits.
      for (const k of Object.keys(all)) if (k.startsWith(`${key}@`)) delete all[k]
    } else for (const k of Object.keys(all)) delete all[k]
  })
}

/** Why a step cannot be used right now ({ kind, until, message }), or null. */
export function blockedReason(step, cooldowns = readCooldowns(), mode = 'chat') {
  return cooldowns[step.service] ?? (step.model ? cooldowns[`${step.service}/${step.model}`] : undefined) ?? cooldowns[`${step.service}@${mode}`] ?? null
}

/** CLOSED allows calls, OPEN skips, HALF-OPEN grants one live worker the recovery probe. */
export function beginCircuit(step, { mode = 'chat', now = Date.now() } = {}) {
  const keys = [step.service, ...(step.model ? [`${step.service}/${step.model}`] : []), `${step.service}@${mode}`]
  const all = allCircuits()
  const affected = keys.filter(k => all[k] && all[k].state !== 'closed')
  for (const key of affected) {
    const c = all[key]
    if (c.state !== 'half-open' && c.until > now) return { blocked: c }
  }
  const releases = []
  const release = () => { for (const r of releases.reverse()) r() }
  for (const key of affected.sort()) {
    const hash = createHash('sha256').update(key).digest('hex')
    const unlock = acquireProcessLock(join(g0Dir(), 'circuit-probes', `${hash}.lock`))
    if (!unlock) { release(); return { blocked: { ...all[key], state: 'half-open', kind: 'probing' } } }
    releases.push(unlock)
  }
  if (affected.length) {
    let blocked
    try { updateCircuits(current => {
      for (const key of affected) {
        const c = current[key]
        if (c?.state === 'open' && c.until > now) { blocked = c; return }
      }
      for (const key of affected) if (current[key]) current[key] = { ...current[key], state: 'half-open', until: now + 30 * MIN }
    }) } catch (error) { release(); throw error }
    if (blocked) { release(); return { blocked } }
  }
  return { keys: affected, release }
}

export function finishCircuit(lease, step, failure, { mode = 'chat', now = Date.now() } = {}) {
  // An 'input' failure says the prompt did not fit this CLI, not that the service is down: the circuit stays as it was.
  if (failure?.kind === 'input') { lease.release?.(); return }
  try {
    const failureKey = failure && cooldownKey(step.service, step.model, failure.kind, mode)
    // A successful probe closes its circuits. A model/permission refusal does not keep a service outage open.
    if (lease.keys?.length) updateCircuits(all => {
      for (const key of lease.keys) if (key !== failureKey) all[key] = { state: 'closed', failures: 0, until: 0, at: now }
    })
    if (failure) setCooldown(failureKey, failure, now)
  } finally { lease.release?.() }
}
