// report-usage.mjs — tell the office what one adapter run cost, so it lands in the
// PAYROLL / ELECTRICITY meters (POST /usage, see server/status.js). Best effort:
// an office that is down or has no token file just does not hear about the run.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { adapters } from '../server/adapters.mjs'
import { homeDir } from '../server/settings.mjs'

export async function reportUsage(service, result) {
  try {
    const token = readFileSync(join(homeDir, 'auth-token'), 'utf8').trim()
    const port = process.env.AGENT_OFFICE_PORT ?? 3334
    await fetch(`http://127.0.0.1:${port}/usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        service,
        label: adapters[service]?.label,
        model: result.model,
        durationMs: result.durationMs,
        usage: result.usage,
        reported: result.reported,
      }),
      signal: AbortSignal.timeout(2000),
    })
  } catch { /* the meters just miss this run */ }
}
