// jsonfile.mjs — small JSON state files shared by several processes (the server, the chat watcher, the scripts it
// starts). A write goes to a temporary file that is then renamed over the real one, so a reader never sees half a
// file, and the file is private to the user (0600) like the rest of $AGENT_OFFICE_HOME.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The parsed file, or `fallback` when it is missing or does not parse. */
export function readJson(file, fallback) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
  } catch {
    return fallback
  }
}

/** Write `value` as JSON, atomically and privately. Returns true when it was written. */
export function writeJson(file, value, { pretty = true } = {}) {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, JSON.stringify(value, null, pretty ? 2 : 0) + '\n', { mode: 0o600 })
    renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}
