import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { chatTokens, targetKind } from './chat-markup.mjs'

const IMAGES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' }
const TEXT = new Set(['.md', '.txt', '.log', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.json', '.yaml', '.yml', '.toml', '.py', '.php', '.sql', '.sh'])
const inside = (root, path) => { const r = relative(root, path); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)) }
const localPath = (target, base) => resolve(base, target.replace(/^\/([a-z]:[\\/])/i, '$1'))

export function mountArtifacts(app, { requireUi, getMessage, workspace = process.cwd(), temp = tmpdir() }) {
  const roots = [realpathSync(workspace), realpathSync(temp)]
  const permitted = path => {
    const ext = extname(path).toLowerCase()
    if (!TEXT.has(ext) && !IMAGES[ext]) return false
    if (/(?:^|[\\/])\.(?:ssh|codex|claude|gemini|agent-office)(?:[\\/]|$)|(?:^|[\\/])(?:\.env[^\\/]*|auth-token|credentials[^\\/]*|secrets?[^\\/]*)$/i.test(path)) return false
    return inside(roots[0], path) || (inside(roots[1], path) && /^(?:office-|agent-office-)/.test(relative(roots[1], path).split(sep)[0]))
  }
  const linked = (text, base) => chatTokens(text).flatMap(t => {
    if (!t.target || targetKind(t.target) !== 'local') return []
    try { const path = realpathSync(localPath(t.target, base)); return permitted(path) ? [path] : [] } catch { return [] }
  })

  app.get('/chat/artifact', requireUi, (req, res) => {
    const id = Number(req.query.messageId)
    const target = typeof req.query.path === 'string' ? req.query.path : ''
    if (!Number.isSafeInteger(id) || id <= 0 || !target || targetKind(target) !== 'local') return res.status(400).json({ error: 'Invalid artifact link' })
    const message = getMessage(id)
    if (!message || ['prompt', 'reply'].includes(message.msg_type)) return res.status(404).json({ error: 'Artifact message not found' })
    try {
      const path = realpathSync(localPath(target, workspace))
      if (!permitted(path)) return res.status(403).json({ error: 'This file cannot be previewed' })
      const direct = linked(message.text, workspace)
      const allowed = new Set(direct)
      // A linked Markdown document may include its own screenshots and adjacent source references.
      for (const doc of direct.filter(p => extname(p).toLowerCase() === '.md')) {
        if (statSync(doc).size > 1024 * 1024) continue
        for (const nested of linked(readFileSync(doc, 'utf8'), dirname(doc))) if (inside(dirname(doc), nested)) allowed.add(nested)
      }
      if (!allowed.has(path)) return res.status(403).json({ error: 'The file is not linked from this message' })
      const stat = statSync(path)
      const mime = IMAGES[extname(path).toLowerCase()]
      if (!stat.isFile() || stat.size > (mime ? 10 : 2) * 1024 * 1024) return res.status(413).json({ error: 'File is too large to preview' })
      res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'X-Artifact-Name': encodeURIComponent(basename(path)) })
      res.type(mime || 'text/plain; charset=utf-8').send(readFileSync(path))
    } catch { res.status(404).json({ error: 'File is missing or unavailable' }) }
  })
}
