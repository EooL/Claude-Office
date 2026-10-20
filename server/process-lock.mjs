import { closeSync, mkdirSync, openSync, readFileSync, rmdirSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Cross-process reservation. A crashed owner is reclaimed; a live owner is never replaced by a timeout. */
export function acquireProcessLock(file) {
  mkdirSync(dirname(file), { recursive: true })
  const owner = { pid: process.pid, token: randomUUID() }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx', 0o600)
      try { writeSync(fd, JSON.stringify(owner)) } finally { closeSync(fd) }
      return () => {
        try {
          if (JSON.parse(readFileSync(file, 'utf8')).token === owner.token) unlinkSync(file)
        } catch { /* already released */ }
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const reclaim = `${file}.reclaim`
      try { mkdirSync(reclaim) } catch { return null }
      try {
        const current = JSON.parse(readFileSync(file, 'utf8'))
        if (!Number.isSafeInteger(current.pid) || current.pid <= 0 || typeof current.token !== 'string') throw new Error('Invalid reservation')
        try { process.kill(current.pid, 0); return null } catch (error) { if (error.code !== 'ESRCH') return null }
        // Recheck ownership before reclaiming a crashed worker's reservation.
        if (JSON.parse(readFileSync(file, 'utf8')).token === current.token) unlinkSync(file)
      } catch {
        // Another process may still be writing the newly-created reservation.
        try { if (Date.now() - statSync(file).mtimeMs > 10_000) unlinkSync(file) } catch {}
      } finally { try { rmdirSync(reclaim) } catch {} }
    }
  }
  return null
}
