// gen-agent-profiles.mjs — writes server/agent-profiles/<role>.md for every office role from defaultProfile().
// Idempotent, LF only:  node scripts/gen-agent-profiles.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defaultProfile, serializeProfile } from '../server/agent-profiles.mjs'
import { listRoles } from '../server/roles.mjs'

const dir = fileURLToPath(new URL('../server/agent-profiles/', import.meta.url))
mkdirSync(dir, { recursive: true })
for (const { role } of listRoles()) writeFileSync(`${dir}${role}.md`, serializeProfile(defaultProfile(role)), 'utf8')
console.log(`wrote ${listRoles().length} profiles to ${dir}`)
