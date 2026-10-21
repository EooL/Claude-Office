// office-client.mjs — the running office server, as the scripts talk to it: the bearer token, POSTs, the
// status summary, and an agent speaking in the chat. Best effort: a server that is down is just not heard.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { officeHome } from '../server/paths.mjs'

const port = () => process.env.AGENT_OFFICE_PORT ?? 3334
const token = () => readFileSync(join(officeHome(process.env.OFFICE_ID ?? 'default'), 'auth-token'), 'utf8').trim()

export async function office(path, body) {
  try {
    const res = await fetch(`http://127.0.0.1:${port()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) console.error(`[office] ${path} -> ${res.status}`)
  } catch (err) {
    console.error(`[office] ${path}: ${err.message}`)
  }
}

/** What GET /status says (sessions with their rate limits, totals), or null. */
export async function getStatus() {
  try {
    const res = await fetch(`http://127.0.0.1:${port()}/status`, { signal: AbortSignal.timeout(1500) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/** An agent says something in the chat. */
export const say = (name, role, text) => office('/chat/reply', { sender: name, role, text })
