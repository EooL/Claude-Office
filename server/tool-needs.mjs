// tool-needs.mjs — a small log of what a CLI run was refused or lacked, and a summary a person can act on.
//
// A permission refusal ("a tool required the 'command' permission that headless mode cannot prompt for") used to
// leave no trace of WHICH command was wanted. Each one is now a line in <home>/tool-needs.jsonl; summariseToolNeeds
// maps the commands to the Office toolbox (scripts/office-tools-mcp.mjs). Nothing here adds a tool or a permission:
// a person reads the report and decides. Pure functions: the office home is always a parameter.
import { appendFileSync, chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MAX_BYTES = 1024 * 1024
const file = (home) => join(home, 'tool-needs.jsonl')

const SECRET = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi,
  /\b(?:sk|pk|ghp|gho|xox[bp]|AKIA)[-_]?[A-Za-z0-9_-]{8,}/g,
  /\b(api[_-]?key|token|passw(?:or)?d|secret|credential)\s*[:=]\s*\S+/gi,
]
/** User paths become `~`, secret-looking strings become [redacted], then the text is cut to `max`. */
function clean(text, max) {
  let t = String(text ?? '').replace(/\s+/g, ' ').trim()
  t = t.replace(/(?:[A-Za-z]:)?[\\/](?:Users|home)[\\/][^\\/\s"']+/gi, '~')
  for (const re of SECRET) t = t.replace(re, (m, key) => (typeof key === 'string' ? `${key}=[redacted]` : '[redacted]'))
  return t.slice(0, max)
}

/** Append one need. Never throws; false when it could not be written. */
export function recordToolNeed(home, { service, mode, kind, message, command, task } = {}) {
  try {
    if (!home || !service) return false
    const path = file(home)
    const line = JSON.stringify({
      at: new Date().toISOString(), service: clean(service, 40), mode: clean(mode || 'chat', 20), kind: clean(kind || 'permission', 20),
      message: clean(message, 240), command: clean(command, 200), task: clean(task, 120),
    }) + '\n'
    appendFileSync(path, line, { flag: 'a', mode: 0o600 })
    try { chmodSync(path, 0o600) } catch { /* not supported on every platform */ }
    // shortcut: the size is read after the append, so the file may briefly pass 1 MB; fine for a log
    const raw = readFileSync(path, 'utf8')
    if (Buffer.byteLength(raw) > MAX_BYTES) {
      const lines = raw.split('\n').filter(Boolean)
      writeFileSync(path, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n', { mode: 0o600 })
    }
    return true
  } catch { return false }
}

/** The newest `limit` entries, oldest first; corrupt lines are skipped. */
export function readToolNeeds(home, { limit = 500 } = {}) {
  try {
    const out = []
    for (const l of readFileSync(file(home), 'utf8').split('\n')) {
      try { const e = JSON.parse(l); if (e && typeof e === 'object' && e.service) out.push(e) } catch { /* corrupt line */ }
    }
    return out.slice(-limit)
  } catch { return [] }
}

const NONE = 'no toolbox tool covers this yet: a candidate for a new tool'
const SUGGEST = [
  [/^(git\s+grep|grep|rg|select-string|findstr)$/, 'search_text covers this'],
  [/^(get-childitem|gci|ls|dir|find)$/, 'list_files covers this'],
  [/^(cat|type|get-content|gc|head|tail)$/, 'read_file_range covers this'],
  [/^git\s+log$/, 'git_log covers this'],
  [/^git\s+show$/, 'git_show covers this'],
  [/^git\s+diff$/, 'git_diff covers this'],
  [/^git\s+status$/, 'git status is not covered (git_diff shows changes only): a candidate for a new tool'],
]
/** First word of a command (two for git), lowercased. */
const headOf = (command) => {
  const w = String(command).trim().toLowerCase().split(/\s+/)
  return w[0] === 'git' && w[1] ? `git ${w[1]}` : (w[0] ?? '')
}
export function suggestionFor(command) {
  const head = headOf(command)
  if (!head) return 'command not captured: read the message'
  return SUGGEST.find(([re]) => re.test(head))?.[1] ?? NONE
}

/** Group by service + mode + command head (or the message with digits and paths removed). Most frequent first. */
export function summariseToolNeeds(entries) {
  const groups = new Map()
  for (const e of entries ?? []) {
    const head = e.command ? headOf(e.command) : `msg:${String(e.message ?? '').toLowerCase().replace(/[\d~/\\.]+/g, '#').slice(0, 60)}`
    const key = `${e.service}|${e.mode}|${head}`
    const g = groups.get(key) ?? { service: e.service, mode: e.mode, kind: e.kind, count: 0, firstAt: e.at, lastAt: e.at, example: e.command || e.message || '', commands: [], suggestion: suggestionFor(e.command) }
    g.count++
    if (e.at < g.firstAt) g.firstAt = e.at
    if (e.at >= g.lastAt) { g.lastAt = e.at; g.example = e.command || e.message || g.example }
    if (e.command && !g.commands.includes(e.command) && g.commands.length < 5) g.commands.push(e.command)
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : -1))
}
