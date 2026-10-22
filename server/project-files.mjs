// Shared, fail-closed policy for project context and the read-only toolbox.
import { closeSync, constants, fchmodSync, fstatSync, ftruncateSync, lstatSync, openSync, readSync, realpathSync, statSync, writeSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export function secretPath(path) {
  return path.replaceAll('\\', '/').split('/').some(part =>
    /^(?:\.env.*|.*\.(?:pem|key|p12|pfx|kdbx)|id_rsa.*|id_ed25519.*|auth-token|credentials.*|\.npmrc|\.git-credentials|\.netrc|\.pypirc|\.ssh|\.gnupg|\.aws)$/i.test(part) || /secret/i.test(part))
}

export function blockedPath(path) {
  return path.replaceAll('\\', '/').split('/').some(part => /^(?:\.git|node_modules)$/i.test(part))
}

export function validateProjectPath(path) {
  if (typeof path !== 'string' || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)) throw new Error('invalid path')
  // Refuse Windows aliases on every host, including drive-relative, ADS and device syntax.
  if (/^[\\/]{2}|^[A-Za-z]:[^\\/]|[<>"|?*]/.test(path) || /:/.test(path.replace(/^[A-Za-z]:[\\/]/, ''))) throw new Error('ambiguous Windows path refused')
  if (path.replaceAll('\\', '/').split('/').some(p => /[. ]$/.test(p) && p !== '.' && p !== '..' || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p) || /~\d/.test(p))) throw new Error('Windows path alias refused')
}

export function projectPath(root, path = '.', { missing = false } = {}) {
  validateProjectPath(path)
  const abs = resolve(root, path)
  const lexical = relative(root, abs)
  const inside = rel => !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
  if (!inside(lexical)) throw new Error('path is outside the project root')
  if (blockedPath(lexical) || secretPath(lexical)) throw new Error('secret-looking or internal path refused')
  let real
  try { real = realpathSync(abs) } catch (error) {
    if (!missing || error.code !== 'ENOENT') throw error
    // Missing historical paths still require an existing, jailed parent.
    let parent = resolve(abs, '..')
    while (parent !== root) {
      try { const r = relative(root, realpathSync(parent)); if (!inside(r) || blockedPath(r) || secretPath(r)) throw new Error('unsafe parent'); break } catch (e) { if (e.code !== 'ENOENT') throw e }
      parent = resolve(parent, '..')
    }
    real = abs
  }
  const rel = relative(root, real)
  if (!inside(rel)) throw new Error('path is outside the project root')
  if (blockedPath(rel) || secretPath(rel)) throw new Error('secret-looking or internal path refused')
  return { abs: real, rel: rel.replaceAll('\\', '/') || '.' }
}

// Never read by pathname after checking it. Bound allocation and reject non-regular handles.
// Identity checks catch a replaced parent/junction; Node has no portable openat API.
export function readProjectFile(root, path, maxBytes) {
  const f = projectPath(root, path)
  const fd = openSync(f.abs, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
  try {
    const st = fstatSync(fd)
    if (!st.isFile() || st.size > maxBytes) throw new Error('not a regular file or file too large')
    const check = () => {
      const current = projectPath(root, path)
      const now = statSync(current.abs)
      if (now.dev !== st.dev || now.ino !== st.ino || current.abs !== f.abs) throw new Error('file changed during read')
    }
    check()
    const buf = Buffer.alloc(Math.min(st.size + 1, maxBytes + 1))
    let size = 0, n
    while (size < buf.length && (n = readSync(fd, buf, size, buf.length - size, null))) size += n
    if (size > maxBytes || size > st.size) throw new Error('file grew during read')
    check()
    return { ...f, buf: buf.subarray(0, size) }
  } finally { closeSync(fd) }
}

export function readRegularFile(path, maxBytes) {
  if (lstatSync(path).isSymbolicLink()) throw new Error('link refused')
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
  try {
    const st = fstatSync(fd)
    if (!st.isFile() || st.size > maxBytes) throw new Error('not a bounded regular file')
    const buf = Buffer.alloc(st.size + 1)
    let size = 0, n
    while (size < buf.length && (n = readSync(fd, buf, size, buf.length - size, null))) size += n
    if (size > st.size) throw new Error('file grew during read')
    return buf.subarray(0, size)
  } finally { closeSync(fd) }
}

export function appendBoundedLog(path, line, maxBytes = 1024 * 1024) {
  try { if (lstatSync(path).isSymbolicLink()) throw new Error('log link refused') } catch (e) { if (e.code !== 'ENOENT') throw e }
  if (Buffer.byteLength(line) > maxBytes) throw new Error('log entry too large')
  const fd = openSync(path, constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0), 0o600)
  try {
    const st = fstatSync(fd)
    if (!st.isFile() || st.nlink !== 1 || st.size > maxBytes * 2) throw new Error('unsafe or oversized log')
    try { fchmodSync(fd, 0o600) } catch { /* Windows ACLs are inherited. */ }
    if (st.size + Buffer.byteLength(line) > maxBytes) {
      const buf = Buffer.alloc(st.size)
      let size = 0, n
      while (size < buf.length && (n = readSync(fd, buf, size, buf.length - size, size))) size += n
      const lines = buf.toString('utf8').split('\n').filter(Boolean)
      let kept = Buffer.from(lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n')
      if (kept.length + Buffer.byteLength(line) > maxBytes) kept = Buffer.alloc(0)
      ftruncateSync(fd, 0)
      let written = 0
      while (written < kept.length) written += writeSync(fd, kept, written, kept.length - written, written)
    }
    // A separate append handle preserves concurrent appends; Windows append handles cannot truncate.
    const append = openSync(path, constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
    try {
      const now = fstatSync(append)
      if (!now.isFile() || now.dev !== st.dev || now.ino !== st.ino) throw new Error('log changed during append')
      const data = Buffer.from(line)
      let written = 0
      while (written < data.length) written += writeSync(append, data, written, data.length - written)
    } finally { closeSync(append) }
  } finally { closeSync(fd) }
}

export function safeGitEnv(env = process.env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !/^GIT_/i.test(key)))
  return { ...clean, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' }
}

export function safeGitArgs(root) {
  // Never discover a parent repo or follow a project-controlled gitdir redirection.
  if (!lstatSync(resolve(root, '.git')).isDirectory()) throw new Error('linked or redirected git directory refused')
  return ['--no-pager', '--git-dir=' + resolve(root, '.git'), '--work-tree=' + root,
    '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.pager=cat',
    '-c', 'log.showSignature=false', '-c', 'log.mailmap=false', '-c', 'core.attributesFile=', '-c', 'diff.external=']
}
