// One office's secrets: its file token, the UI token and the checks built on them. Nothing here is global: every
// office owns its own (server/office.mjs), and server/index.js asks the office in scope.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'

// What the server writes: 32 random bytes as 64 lowercase hex digits
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/

/** ±1 minute: wide enough for clock skew, narrow enough that a leaked signature expires fast. */
export const SIGNATURE_WINDOW_MS = 60_000

/**
 * The token a previous start left in `file`, if it is still safe to keep
 * using: a regular file (a symlink is not followed), owned by this user,
 * with no group or other permission bits, holding a well-formed token.
 * Anything else — missing, malformed, readable by others, someone else's —
 * is null, and the server mints a new token instead. The file is opened
 * once and checked through that descriptor, so it cannot be swapped between
 * the check and the read. Windows has no uid or mode bits to check.
 */
export function readTokenFile(file) {
  let fd
  try {
    fd = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    const st = fstatSync(fd)
    if (!st.isFile()) return null
    // Windows has no O_NOFOLLOW, so the open above may have followed a planted link: the path must still
    // name the very file that was opened (a link has its own identity, and a swap after the open shows up here)
    const named = lstatSync(file, { bigint: true })
    const opened = fstatSync(fd, { bigint: true })
    if (named.isSymbolicLink() || named.dev !== opened.dev || named.ino !== opened.ino) return null
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return null
    if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) return null
    const token = readFileSync(fd, 'utf8').trim()
    return TOKEN_PATTERN.test(token) ? token : null
  } catch {
    return null
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch {}
  }
}

const sameSecret = (supplied, secret) => {
  if (typeof supplied !== 'string' || supplied.length === 0) return false
  const a = Buffer.from(supplied, 'utf8')
  const b = Buffer.from(secret, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Secrets of the office whose token lives in `tokenFile`. Reads the file (never writes it): a token from a previous
 * start is reused when safe, else a new one exists in memory until writeTokenFile() puts it on disk after listen.
 */
export function createOfficeAuth(tokenFile) {
  const reusedToken = readTokenFile(tokenFile)
  const token = reusedToken ?? randomBytes(32).toString('hex')
  // The UI token answers permission dialogs from the page; it lives in memory only and changes on every start.
  const uiToken = randomBytes(24).toString('hex')

  const requestSignature = (method, path, timestamp, rawBody) => {
    const h = createHmac('sha256', token)
    h.update(`${method}\n${path}\n${timestamp}\n`)
    h.update(rawBody && rawBody.length ? rawBody : Buffer.alloc(0))
    return h.digest()
  }

  return Object.freeze({
    tokenFile,
    token,
    uiToken,
    /** The token a previous start left, or null when this start minted a new one. */
    reusedToken,
    /** Constant-time comparison of a supplied token with this office's. */
    tokenMatches: (supplied) => sameSecret(supplied, token),
    uiTokenMatches: (supplied) => sameSecret(supplied, uiToken),
    /** True when the request carries the signature this office's token would produce over the raw body, within the window. */
    signatureValid(req) {
      const ts = req.headers['x-office-timestamp']
      const sig = req.headers['x-office-signature']
      if (typeof ts !== 'string' || typeof sig !== 'string' || !/^[0-9a-f]+$/.test(sig)) return false
      const tnum = Number(ts)
      if (!Number.isFinite(tnum) || Math.abs(Date.now() - tnum) > SIGNATURE_WINDOW_MS) return false
      const given = Buffer.from(sig, 'hex')
      const expected = requestSignature(req.method, req.originalUrl, ts, req.rawBody)
      return given.length === expected.length && timingSafeEqual(given, expected)
    },
    /** HMAC the office answers a permission decision with: only a token holder can make it. */
    proof: (nonce, id, decision) => createHmac('sha256', token).update(`${nonce}${id}${decision}`).digest('hex'),
    /** The answer to an opener's /health challenge: only a token holder can make it. */
    officeProof: (challenge) => createHmac('sha256', token).update(`office-health:${challenge}`).digest('hex'),
    /**
     * Put the token in its file (after listen). A reused token is already there. A new one replaces whatever the
     * file was — unlinked first and then created exclusively, so a symlink or a file owned by someone else is
     * replaced rather than written through.
     */
    writeTokenFile() {
      if (readTokenFile(tokenFile) === token) return
      try {
        try { unlinkSync(tokenFile) } catch (err) { if (err.code !== 'ENOENT') throw err }
        writeFileSync(tokenFile, token, { mode: 0o600, flag: 'wx' })
        try { chmodSync(tokenFile, 0o600) } catch {}
      } catch (err) {
        console.warn('[auth] Could not write token file:', err.message)
      }
    },
  })
}
