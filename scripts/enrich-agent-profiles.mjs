#!/usr/bin/env node
// enrich-agent-profiles.mjs — ask each agent's brain to write better prose for its job description.
//
//   node scripts/enrich-agent-profiles.mjs --role debugger | --all [--dry-run] [--force]
//
// NOTE: this uses the owner's AI subscription: one chat call per role (13 calls for --all, plus one retry at most
// for an invalid answer). Results are saved as DRAFTS in the office home and stay drafts until the owner approves them.
// --dry-run writes nothing and prints the diff. --force replaces an approved profile with a draft (locked ones are never touched).
import { enrichProfile } from '../server/agent-enrich.mjs'
import { officeHome } from '../server/paths.mjs'
import { listRoles } from '../server/roles.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const roleIdx = args.indexOf('--role')
const one = roleIdx >= 0 ? args[roleIdx + 1] : undefined

if (!flag('--all') && !one) {
  console.error('usage: enrich-agent-profiles.mjs --role <role> | --all [--dry-run] [--force]')
  process.exit(2)
}

const home = process.env.AGENT_OFFICE_HOME ?? officeHome(process.env.OFFICE_ID ?? 'default')
const roles = flag('--all') ? listRoles().map((r) => r.role) : [one]
let failed = 0
for (const role of roles) {
  try {
    const r = await enrichProfile(role, { home, cwd: process.cwd(), dryRun: flag('--dry-run'), force: flag('--force') })
    console.log(`ok ${role} ${r.hash}${flag('--dry-run') ? ' (dry run)' : ''}`)
    if (flag('--dry-run')) console.log(r.diff)
  } catch (e) {
    failed++
    const skipped = /locked|approved/.test(String(e?.message))
    if (skipped) failed--
    console.log(`${skipped ? 'skipped' : 'failed'} ${role} ${e?.message ?? e}`)
  }
}
process.exit(failed ? 1 : 0)
