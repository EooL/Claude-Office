#!/usr/bin/env node
// Office toolbox: a small read-only MCP server (stdio, newline-delimited JSON-RPC 2.0).
// stdout carries only protocol messages; diagnostics go to stderr.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'

const SELF = fileURLToPath(import.meta.url)
const VERSION = '1.0.0'
const NAME = 'claude-office-tools'
const MAX_TEXT = 60_000
const MAX_FILE = 1024 * 1024
const MAX_READ_FILE = 2 * 1024 * 1024
const SEARCH_MS = 3000
const WALK_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage'])
const SECRET_NAME = /^(\.env.*|.*\.(pem|key|p12|pfx)|id_rsa.*|id_ed25519.*|auth-token|credentials.*|\.npmrc)$/i
const SECRET_DIRS = new Set(['.ssh', '.gnupg', '.aws'])

class ToolError extends Error {}

const slash = p => p.replaceAll('\\', '/')
const isSecret = rel => slash(rel).split('/').some(s => SECRET_DIRS.has(s) || SECRET_NAME.test(s) || s.toLowerCase().includes('secret'))
const isBlocked = rel => slash(rel).split('/').some(s => s === '.git' || s === 'node_modules')
const isBinary = buf => buf.subarray(0, 8000).includes(0)
const num = (v, def, min, max) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : def)
const cap = text => (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + `\n[truncated: output exceeded ${MAX_TEXT} characters]` : text)

// ---- worker side: the regex search runs here so a catastrophic pattern can be killed ----
if (!isMainThread) {
  const { files, source, flags, max, context, deadline } = workerData
  const re = new RegExp(source, flags)
  const out = []
  let skipped = 0, scanned = 0, stopped = false
  outer: for (const f of files) {
    if (Date.now() > deadline) { stopped = true; break }
    let buf
    try {
      if (statSync(f.abs).size > MAX_FILE) { skipped++; continue }
      buf = readFileSync(f.abs)
    } catch { skipped++; continue }
    if (isBinary(buf)) { skipped++; continue }
    scanned++
    const lines = buf.toString('utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue
      for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
        out.push(`${f.rel}${j === i ? ':' : '-'}${j + 1}${j === i ? ':' : '-'} ${lines[j].slice(0, 300)}`)
      }
      if (out.length >= max) { stopped = 'max'; break outer }
    }
  }
  parentPort.postMessage({ out, skipped, scanned, stopped })
}

// ---- main side ----
const argv = process.argv.slice(2)
const flagVal = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const ROOT_ARG = resolve(flagVal('--root') || process.env.OFFICE_TOOLS_ROOT || process.cwd())
let ROOT = ROOT_ARG
try { ROOT = realpathSync(ROOT_ARG) } catch { /* reported by tools */ }

function jail(p, { missing = false } = {}) {
  if (p !== undefined && typeof p !== 'string') throw new ToolError('path must be a string')
  const abs = resolve(ROOT, p || '.')
  let real
  try { real = realpathSync(abs) } catch (e) {
    if (!missing || e.code !== 'ENOENT') throw new ToolError(`not found: ${p}`)
    real = abs
  }
  const rel = relative(ROOT, real)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new ToolError(`refused: path is outside the project root: ${p}`)
  const lexical = relative(ROOT, abs)
  for (const r of [rel, lexical]) {
    if (isBlocked(r)) throw new ToolError(`refused: .git and node_modules are not available: ${p}`)
    if (isSecret(r)) throw new ToolError(`refused: secret-looking path: ${p}`)
  }
  return { abs: real, rel: slash(rel) || '.' }
}

function git(args) {
  try {
    return execFileSync('git', ['--no-pager', '-c', 'core.fsmonitor=false', ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 10_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
    })
  } catch (e) {
    if (e.code === 'ENOENT') throw new ToolError('git is not installed or not on PATH')
    const msg = String(e.stderr || e.message).trim().split('\n')[0]
    throw new ToolError(`git failed: ${msg}`)
  }
}

function gitFiles() {
  try {
    const out = execFileSync('git', ['-c', 'core.fsmonitor=false', 'ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: ROOT, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return out.split('\0').filter(Boolean)
  } catch { return null }
}

// Every file under baseRel (forward-slash, root-relative), minus .git/node_modules. Walk skips dot-folders, build dirs and files over 1 MB.
function walk(baseAbs, baseRel, maxDepth, out, dirs) {
  const go = (abs, rel, level) => {
    let entries
    try { entries = readdirSync(abs, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        if (WALK_SKIP.has(e.name) || e.name.startsWith('.')) continue
        dirs.push(r)
        if (level < maxDepth) go(resolve(abs, e.name), r, level + 1)
      } else if (e.isFile()) {
        try { if (statSync(resolve(abs, e.name)).size > MAX_FILE) continue } catch { continue }
        out.push(r)
      }
    }
  }
  go(baseAbs, baseRel === '.' ? '' : baseRel, 1)
}

function collect(base, maxDepth = 50) {
  const prefix = base.rel === '.' ? '' : base.rel + '/'
  const tracked = gitFiles()
  if (tracked) return { files: tracked.filter(f => f.startsWith(prefix) && !isBlocked(f)).sort(), dirs: [], git: true }
  const files = [], dirs = []
  walk(base.abs, base.rel, maxDepth, files, dirs)
  return { files: files.sort(), dirs, git: false }
}

const tools = {
  list_files: {
    description: 'List project files (tracked + untracked-not-ignored via git, else a bounded walk). Directories end with a slash. Secret-looking files are never listed.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'number', description: 'default 2, max 6' }, limit: { type: 'number', description: 'default 300, max 1000' } } },
    run(a) {
      const base = jail(a.path)
      if (!statSync(base.abs).isDirectory()) throw new ToolError('path is not a directory')
      const depth = num(a.depth, 2, 1, 6), limit = num(a.limit, 300, 1, 1000)
      const prefix = base.rel === '.' ? '' : base.rel + '/'
      const c = collect(base, depth)
      const set = new Set()
      for (const f of c.files) {
        if (isSecret(f)) continue
        const segs = f.slice(prefix.length).split('/')
        set.add(segs.length <= depth ? f : prefix + segs.slice(0, depth).join('/') + '/')
      }
      for (const d of c.dirs) if (!isSecret(d)) set.add(d + '/')
      const all = [...set].sort()
      const shown = all.slice(0, limit)
      return shown.join('\n') + (all.length > limit ? `\n[truncated: ${all.length - limit} more entries, raise limit or narrow path]` : '') + (shown.length ? '' : '(no files)')
    },
  },
  search_text: {
    description: 'Search allowed text files with a JS regex (or a literal). Skips binary, large (>1 MB), secret-looking files; stops after 3 seconds.',
    inputSchema: { type: 'object', required: ['pattern'], properties: { pattern: { type: 'string', description: 'max 200 chars' }, literal: { type: 'boolean' }, path: { type: 'string' }, glob: { type: 'string' }, max_results: { type: 'number', description: 'default 100, max 500' }, ignore_case: { type: 'boolean' }, context: { type: 'number', description: '0-3' } } },
    async run(a) {
      if (typeof a.pattern !== 'string' || !a.pattern) throw new ToolError('pattern is required')
      if (a.pattern.length > 200) throw new ToolError('pattern too long (max 200 characters)')
      const source = a.literal ? a.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : a.pattern
      const flags = a.ignore_case ? 'i' : ''
      try { new RegExp(source, flags) } catch (e) { throw new ToolError(`invalid pattern: ${e.message}`) }
      const base = jail(a.path)
      let files, secretSkipped = 0
      if (statSync(base.abs).isFile()) files = [base.rel]
      else files = collect(base).files
      if (a.glob !== undefined) {
        if (typeof a.glob !== 'string' || a.glob.length > 200) throw new ToolError('invalid glob')
        const g = new RegExp('^' + a.glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*') + '$')
        files = files.filter(f => g.test(f) || (!a.glob.includes('/') && g.test(basename(f))))
      }
      files = files.filter(f => (isSecret(f) ? (secretSkipped++, false) : true)).slice(0, 20_000)
      const max = num(a.max_results, 100, 1, 500)
      const res = await new Promise(done => {
        const w = new Worker(SELF, { workerData: { files: files.map(f => ({ rel: f, abs: resolve(ROOT, f) })), source, flags, max, context: num(a.context, 0, 0, 3), deadline: Date.now() + SEARCH_MS } })
        const timer = setTimeout(() => { w.terminate(); done({ out: [], skipped: 0, scanned: 0, stopped: 'killed' }) }, SEARCH_MS + 500)
        w.once('message', m => { clearTimeout(timer); done(m) })
        w.once('error', e => { clearTimeout(timer); done({ out: [], skipped: 0, scanned: 0, stopped: 'error: ' + e.message }) })
      })
      const notes = [`${res.scanned} files searched, ${secretSkipped} secret-looking and ${res.skipped} binary/large/unreadable files skipped`]
      if (res.stopped === 'max') notes.push(`stopped at max_results (${max})`)
      else if (res.stopped === 'killed') notes.push(`stopped early: the pattern did not finish within ${SEARCH_MS / 1000}s (possibly catastrophic); no results`)
      else if (res.stopped === true) notes.push(`stopped early: ${SEARCH_MS / 1000}s time limit reached, results are partial`)
      else if (res.stopped) notes.push(`stopped early: ${res.stopped}`)
      return (res.out.join('\n') || '(no matches)') + '\n[' + notes.join('; ') + ']'
    },
  },
  read_file_range: {
    description: 'Read numbered lines of a text file (max 800 lines per call, files up to 2 MB).',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' } } },
    run(a) {
      if (typeof a.path !== 'string') throw new ToolError('path is required')
      const f = jail(a.path)
      const st = statSync(f.abs)
      if (!st.isFile()) throw new ToolError('not a file')
      if (st.size > MAX_READ_FILE) throw new ToolError('file is larger than 2 MB')
      const buf = readFileSync(f.abs)
      if (isBinary(buf)) throw new ToolError('binary file refused')
      const lines = buf.toString('utf8').split(/\r?\n/)
      if (lines.at(-1) === '') lines.pop()
      const start = num(a.start_line, 1, 1, Number.MAX_SAFE_INTEGER)
      let end = num(a.end_line, start + 199, start, Number.MAX_SAFE_INTEGER)
      let note = ''
      if (end - start + 1 > 800) { end = start + 799; note = '\n[range capped at 800 lines]' }
      end = Math.min(end, lines.length)
      const width = String(end).length
      const body = lines.slice(start - 1, end).map((l, i) => `${String(start + i).padStart(width + 1)}| ${l}`).join('\n')
      return `${f.rel} (lines ${start}-${Math.max(end, start - 1)} of ${lines.length})\n${body}${note}`
    },
  },
  git_log: {
    description: 'Short git log (hash, date, author, subject), optionally for one path or author.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, max_count: { type: 'number', description: 'default 20, max 100' }, author: { type: 'string' } } },
    run(a) {
      const args = ['log', '--no-color', '--date=short', '--pretty=format:%h %ad %an  %s', '-n', String(num(a.max_count, 20, 1, 100))]
      if (a.author !== undefined) {
        if (typeof a.author !== 'string' || !a.author || a.author.length > 100 || /[\x00-\x1f]/.test(a.author)) throw new ToolError('invalid author')
        args.push('--author=' + a.author)
      }
      args.push('--', ...(a.path ? [jail(a.path, { missing: true }).rel] : []))
      return git(args) || '(no commits)'
    },
  },
  git_show: {
    description: 'git show --stat --patch for a revision (output capped at 60,000 characters).',
    inputSchema: { type: 'object', required: ['rev'], properties: { rev: { type: 'string' }, path: { type: 'string' } } },
    run(a) {
      return git(['show', '--no-color', '--no-ext-diff', '--no-textconv', '--stat', '--patch', rev(a.rev), '--', ...pathspec(a.path)])
    },
  },
  git_diff: {
    description: 'git diff; default is working tree vs HEAD. base/head are revisions.',
    inputSchema: { type: 'object', properties: { base: { type: 'string' }, head: { type: 'string' }, path: { type: 'string' }, stat_only: { type: 'boolean' } } },
    run(a) {
      const revs = a.head !== undefined ? [rev(a.base ?? 'HEAD'), rev(a.head)] : [rev(a.base ?? 'HEAD')]
      return git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', a.stat_only ? '--stat' : '--patch', ...revs, '--', ...pathspec(a.path)]) || '(no differences)'
    },
  },
}

function rev(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9._\/~^@{}-]{1,100}$/.test(v) || v.startsWith('-')) throw new ToolError('invalid revision')
  return v
}
// Optional jailed path plus excludes so history/diff output never shows secret-looking files.
function pathspec(p) {
  const ex = ['.env*', '*.pem', '*.key', '*.p12', '*.pfx', 'id_rsa*', 'id_ed25519*', 'auth-token', 'credentials*', '.npmrc', '*secret*', '.ssh/**', '.gnupg/**', '.aws/**'].map(x => `:(exclude,glob)**/${x}`)
  return [...(p ? [jail(p, { missing: true }).rel] : ['.']), ...ex]
}

function audit(tool, ok, ms, args) {
  const file = process.env.OFFICE_TOOLS_LOG
  if (!file) return
  const summary = {}
  for (const k of ['path', 'pattern', 'rev', 'base', 'head']) if (typeof args?.[k] === 'string') summary[k] = args[k].slice(0, 200)
  try { appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), tool, ok, ms, args: summary }) + '\n') } catch (e) { console.error('audit log failed:', e.message) }
}

async function callTool(params) {
  const name = params?.name, args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}
  const t0 = Date.now()
  let ok = true, text
  try {
    const tool = Object.hasOwn(tools, name) ? tools[name] : null
    if (!tool) throw new ToolError(`unknown tool: ${name}`)
    text = String(await tool.run(args))
  } catch (e) {
    ok = false
    text = e instanceof ToolError ? e.message : `error: ${e.message}`
  }
  audit(String(name), ok, Date.now() - t0, args)
  return { content: [{ type: 'text', text: cap(text) }], ...(ok ? {} : { isError: true }) }
}

async function handle(msg) {
  switch (msg.method) {
    case 'initialize': return { protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: NAME, version: VERSION } }
    case 'ping': return {}
    case 'tools/list': return { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) }
    case 'tools/call': return callTool(msg.params)
    default: throw Object.assign(new Error(`method not found: ${msg.method}`), { rpc: -32601 })
  }
}

const send = o => process.stdout.write(JSON.stringify(o) + '\n')

function printConfig(cli) {
  const script = slash(SELF), root = slash(ROOT_ARG)
  const args = [script, '--root', root]
  const json = o => JSON.stringify(o, null, 2)
  const entry = { command: 'node', args }
  const head = `# Snippet for a human to add by hand. Nothing was written. Replace the --root value with the project the CLI will inspect.`
  const rule = `Headless runs also need a narrow permission rule for this MCP server (allow only the server "${NAME}", not every MCP server). Add it by hand; this script never edits any CLI setting.`
  const snippets = {
    codex: ['~/.codex/config.toml (format UNVERIFIED: written from general knowledge of Codex, not checked against docs or a local file)',
      `[mcp_servers.${NAME}]\ncommand = "node"\nargs = [${args.map(x => JSON.stringify(x)).join(', ')}]`,
      'Rule (UNVERIFIED): Codex approval/sandbox policy decides whether MCP tool calls run unattended; check its docs for a per-server allow setting.'],
    claude: ['.mcp.json in the project, or `claude mcp add` (format UNVERIFIED here; Claude Code is the best known of these)',
      json({ mcpServers: { [NAME]: { type: 'stdio', ...entry } } }),
      `Rule: add "mcp__${NAME}" to permissions.allow in settings.json so headless runs can call the tools. ${rule}`],
    agy: ['Antigravity CLI MCP config (file location and format UNVERIFIED; docs/hooks-other-clis-research.md only covers hooks)',
      json({ mcpServers: { [NAME]: entry } }),
      `Rule (UNVERIFIED syntax): a permission rule that allows only MCP tools of the server "${NAME}", e.g. of the form mcp(${NAME}). ${rule}`],
    opencode: ['opencode.json, project or ~/.config/opencode/ (format UNVERIFIED: from memory of opencode docs)',
      json({ mcp: { [NAME]: { type: 'local', command: ['node', ...args], enabled: true } } }),
      `Rule (UNVERIFIED): opencode "permission" settings may need to allow the "${NAME}_*" tools for opencode run. ${rule}`],
    qoder: ['~/.qoder/settings.json (a top-level `mcp` key exists there per the research doc; its inner shape is UNVERIFIED)',
      json({ mcp: { [NAME]: entry } }),
      `Rule (UNVERIFIED): allow only this server's tools in the "permissions" section of the same file. ${rule}`],
  }
  const s = snippets[cli]
  if (!s) { console.error(`usage: --print-config <${Object.keys(snippets).join('|')}>`); process.exit(2) }
  console.log(`${head}\n# Target: ${s[0]}\n\n${s[1]}\n\n# ${s[2]}`)
}

if (isMainThread) {
  if (argv.includes('--print-config')) {
    printConfig(flagVal('--print-config'))
  } else {
    let chain = Promise.resolve()
    createInterface({ input: process.stdin }).on('line', line => {
      if (!line.trim()) return
      chain = chain.then(async () => {
        let msg
        try { msg = JSON.parse(line) } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
          return send({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'invalid request' } })
        }
        const hasId = msg.id !== undefined && msg.id !== null
        try {
          const result = await handle(msg)
          if (hasId) send({ jsonrpc: '2.0', id: msg.id, result })
        } catch (e) {
          console.error('request failed:', e.message)
          if (hasId) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.rpc ?? -32603, message: e.message } })
        }
      }).catch(e => console.error('fatal in handler:', e))
    })
  }
}
