import { realpathSync } from 'node:fs'
import { posix, sep, win32 } from 'node:path'

/** Canonical comparison key; this never creates or changes a directory. */
export function canonicalCwd(input) {
  if (typeof input !== 'string' || input.length === 0) throw new TypeError('cwd must be a non-empty string')
  // Git-Bash `/c/..`, win32 rules and case folding are Windows-only. Elsewhere
  // `C:\x` or a UNC path is just an ordinary (relative) POSIX path, case-sensitive.
  const windows = process.platform === 'win32'
  const implementation = windows ? win32 : posix
  let path = input
  if (windows) {
    path = input.replace(/\\/g, '/')
    path = path.replace(/^\/([a-z])(?:\/|$)/i, (_, drive) => `${drive}:/`)
    path = path.replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\//, '')
  }
  path = implementation.resolve(path)
  // Resolve the longest existing ancestor too: a not-yet-created workspace
  // beneath a junction must compare equal to its eventual physical spelling.
  // Skipped when the platform is overridden (tests): the host fs can't resolve it.
  let ancestor = path
  const suffix = []
  for (; sep === (windows ? '\\' : '/');) {
    try {
      path = implementation.join(realpathSync.native(ancestor), ...suffix)
      break
    } catch {
      const parent = implementation.dirname(ancestor)
      if (parent === ancestor) break
      suffix.unshift(implementation.basename(ancestor))
      ancestor = parent
    }
  }
  path = path.replace(/\\/g, '/')
  const root = implementation.parse(path).root.replace(/\\/g, '/')
  while (path.endsWith('/') && path.length > root.length) path = path.slice(0, -1)
  return windows ? path.toLowerCase() : path
}

/** Strict containment: equality and siblings with a shared prefix are false. */
export function isNested(parent, child) {
  const a = canonicalCwd(parent)
  const b = canonicalCwd(child)
  return b !== a && b.startsWith(a.endsWith('/') ? a : `${a}/`)
}
