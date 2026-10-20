// Small, shared parser for chat links/images. HTML is always plain text, never executable markup.
export function chatTokens(text) {
  const pattern = /`([^`\n]+)`|(!?)\[([^\]\n]*)\]\((<[^>\n]+>|(?:[^()\n]|\([^()\n]*\))+)\)|https?:\/\/[^\s<>"\]]+/g
  const tokens = []
  let at = 0
  for (const match of String(text).matchAll(pattern)) {
    if (match.index > at) tokens.push({ kind: 'text', label: text.slice(at, match.index) })
    if (match[1] !== undefined) tokens.push({ kind: 'code', label: match[1] })
    else if (match[3] !== undefined) tokens.push({ kind: match[2] ? 'image' : 'link', label: match[3], target: match[4].replace(/^<|>$/g, '').trim() })
    else {
      const target = match[0].replace(/[.,;!?]+$/, '')
      tokens.push({ kind: 'link', label: target, target })
      if (target.length < match[0].length) tokens.push({ kind: 'text', label: match[0].slice(target.length) })
    }
    at = match.index + match[0].length
  }
  if (at < text.length) tokens.push({ kind: 'text', label: text.slice(at) })
  return tokens
}

export function targetKind(target) {
  if (!target || /[\x00-\x1f]/.test(target)) return null
  if (/^https?:\/\//i.test(target)) {
    try { const u = new URL(target); return u.username || u.password ? null : 'web' } catch { return null }
  }
  if (/^[a-z]:[\\/]/i.test(target) || /^\/[a-z]:[\\/]/i.test(target)) return 'local'
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(target)) return null
  return 'local'
}
