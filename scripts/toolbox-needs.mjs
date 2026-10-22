#!/usr/bin/env node
// toolbox-needs.mjs — `npm run toolbox-needs [-- --home <dir>] [--limit N] [--json]`
// Prints what CLI runs were refused or lacked (<home>/tool-needs.jsonl), grouped, with the toolbox tool that covers
// each, and a task template for the office chat. Read-only: it never adds a tool or changes a permission.
import { readToolNeeds, summariseToolNeeds } from '../server/tool-needs.mjs'

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
let home = opt('--home')
if (!home) home = (await import('../server/paths.mjs')).g0Dir()
const limit = Number(opt('--limit')) || 500
const rows = summariseToolNeeds(readToolNeeds(home, { limit }))

const TASK_TEMPLATE = 'Read docs/office-toolbox.md and this list of refused commands; propose, as a plan only, the smallest read-only tools to add to scripts/office-tools-mcp.mjs, with their jail and secret rules, tests and limits; do not change files.'

if (args.includes('--json')) {
  console.log(JSON.stringify({ home, rows, taskTemplate: TASK_TEMPLATE }, null, 2))
} else if (rows.length === 0) {
  console.log(`No refused commands recorded in ${home}.`)
} else {
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  console.log(['COUNT', 'SERVICE', 'MODE', 'COMMAND / MESSAGE', 'SUGGESTION', 'LAST SEEN'].join('\t'))
  for (const r of rows) console.log([r.count, r.service, r.mode, cut(r.example, 60), r.suggestion, r.lastAt].join('\t'))
  console.log(`\nTASK TEMPLATE (paste into the office chat, with the list above):\n${TASK_TEMPLATE}`)
}
