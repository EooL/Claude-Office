import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Path metadata only: no directory creation, canonicalization, state or listeners. */
export function createOfficeContext({ home, cwd }) {
  if (typeof home !== 'string' || !home || typeof cwd !== 'string' || !cwd) {
    throw new TypeError('Office context requires nonempty home and cwd paths')
  }
  // An opaque deterministic label, not a registry entry or filesystem path.
  const id = `off_${createHash('sha256').update(JSON.stringify([home, cwd])).digest('hex').slice(0, 12)}`
  return Object.freeze({ id, home, cwd, tmp: join(home, 'tmp') })
}

// Capture the existing startup sources once. resolve('.') is Node's lexical
// startup-directory capture; supplied home strings retain their old spelling.
export const defaultOfficeContext = Object.freeze({
  ...createOfficeContext({
    home: process.env.AGENT_OFFICE_HOME || join(homedir(), '.agent-office'),
    cwd: resolve('.'),
  }),
  id: 'default',
})
