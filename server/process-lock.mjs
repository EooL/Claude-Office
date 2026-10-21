import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export const RECLAIM_STALE_MS = 30_000
function dead(pid) {
  try { process.kill(pid, 0); return false } catch (error) { return error.code === 'ESRCH' }
}

function reserveReclaim(dir) {
  const record = `${process.pid}-${Date.now()}-${randomUUID()}`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(dir)
      // The filename is the owner record, published atomically. Cleanup only
      // removes the observed record, never a successor's differently named one.
      try { mkdirSync(`${dir}/${record}`) } catch (error) { try { rmdirSync(dir) } catch {}; throw error }
      return () => {
        try { rmdirSync(`${dir}/${record}`) } catch { return }
        try { rmdirSync(dir) } catch {}
      }
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt) return null
      try {
        const records = readdirSync(dir)
        if (!records.length) {
          // A creator may be between mkdir and publishing its owner record.
          if (Date.now() - statSync(dir).mtimeMs <= RECLAIM_STALE_MS) return null
        } else {
          if (records.length !== 1) return null
          const match = /^(\d+)-(\d+)-/.exec(records[0])
          // A recorded live owner is never evicted by age. Only an empty
          // directory uses the grace period for interrupted publication.
          if (!match || !dead(Number(match[1]))) return null
          rmdirSync(`${dir}/${records[0]}`)
        }
        // Atomic mkdir on the next iteration decides which contender wins.
        rmdirSync(dir)
      } catch { return null }
    }
  }
  return null
}

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
      const releaseReclaim = reserveReclaim(reclaim)
      if (!releaseReclaim) return null
      try {
        const current = JSON.parse(readFileSync(file, 'utf8'))
        if (!Number.isSafeInteger(current.pid) || current.pid <= 0 || typeof current.token !== 'string') throw new Error('Invalid reservation')
        try { process.kill(current.pid, 0); return null } catch (error) { if (error.code !== 'ESRCH') return null }
        // Recheck ownership before reclaiming a crashed worker's reservation.
        if (JSON.parse(readFileSync(file, 'utf8')).token === current.token) unlinkSync(file)
      } catch {
        // Another process may still be writing the newly-created reservation.
        try { if (Date.now() - statSync(file).mtimeMs > 10_000) unlinkSync(file) } catch {}
      } finally { releaseReclaim() }
    }
  }
  return null
}
