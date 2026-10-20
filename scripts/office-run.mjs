#!/usr/bin/env node
// office-run.mjs — run a Codex or agy prompt and show it in the office as a session.
//
//   node scripts/office-run.mjs codex "fix the failing test"
//   node scripts/office-run.mjs agy|opencode|qoder [--model <m>] "summarise src/"
// CLIs are defined in server/adapters.mjs.
//
// Codex and agy have no Claude Code hooks, so this posts the same events the
// hook would (session_started, session_prompt, session_turn_end, session_ended)
// to POST /event around a one-shot run. Shortcut: no tool-by-tool activity,
// only prompt -> reply; upgrade by parsing `codex exec --json` into
// session_tool_done events.
import { adapterNames, runAdapter } from '../server/adapters.mjs'
import { isEnabled, readSettings } from '../server/settings.mjs'
import { reportUsage } from './report-usage.mjs'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

// The service is the first word when it names an adapter, else the one npm run office saved
const argv = process.argv.slice(2)
const explicit = adapterNames.includes(argv[0])
const tool = explicit ? argv[0] : readSettings().backend
const rest = explicit ? argv.slice(1) : argv
let model = explicit ? undefined : readSettings().model || undefined
const mi = rest.indexOf('--model')
if (mi !== -1) model = rest.splice(mi, 2)[1]
const prompt = rest.join(' ')
if (!adapterNames.includes(tool) || !prompt) {
  console.error(`usage: office-run.mjs <${adapterNames.join('|')}> [--model <m>] "<prompt>"`)
  process.exit(2)
}

if (!isEnabled(tool)) {
  console.error(`${tool} is not enabled: turn it on in Settings > General first.`)
  process.exit(2)
}

const home = process.env.AGENT_OFFICE_HOME ?? join(homedir(), '.agent-office')
const server = `http://127.0.0.1:${process.env.AGENT_OFFICE_PORT ?? 3334}`
const token = readFileSync(join(home, 'auth-token'), 'utf8').trim()
const sessionId = `${tool}-${randomUUID()}`
const base = { sessionId, project: basename(process.cwd()), cwd: process.cwd(), model: model ?? tool }

const post = async (event) => {
  try {
    await fetch(`${server}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...base, ...event }),
    })
  } catch (err) {
    console.error(`[office-run] office not reachable: ${err.message}`)
  }
}

await post({ type: 'session_started', source: 'startup', title: `${tool}: ${prompt.slice(0, 60)}` })
await post({ type: 'session_prompt', text: prompt })

const result = await runAdapter(tool, prompt, { model, write: true })
const { code, text } = result
console.log(text)
await reportUsage(tool, result)

await post({ type: 'session_turn_end', text: text.slice(-2000) || `(${tool} exited ${code}, no output)` })
await post({ type: 'session_ended', reason: 'other' })
process.exit(code ?? 1)
