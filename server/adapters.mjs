// adapters.mjs — the one place that knows how to run each coding-agent CLI once.
//
// THE CONTRACT. Every adapter is run the same way and answers the same way:
//
//   runAdapter(name, prompt, { model, write, timeoutMs, onData }) resolves
//     { text, model, usage, reported, code, durationMs }
//
//   text        the reply ('' when there was none)
//   model       the model the CLI says it used ('' when it does not say)
//   usage       { inputTokens, outputTokens, cachedTokens, reasoningTokens, totalTokens, costUsd }
//               inputTokens counts every input token (cached ones included), cachedTokens is
//               the part served from the cache. A CLI reports what it has; whatever it does
//               not report stays at the neutral value 0.
//   reported    the usage keys the CLI actually reported, so a caller can tell a real 0 from
//               "not reported" (show "-", do not add it to a total)
//   code        the CLI's exit code, durationMs how long the run took
//   error       the tail of what the CLI wrote to stderr ('' when nothing): where a rate limit, an empty
//               account or an unavailable model shows up (server/availability.mjs reads it)
//
// TO ADD A CLI add one entry to `adapters`:
//   bin           executable name on PATH
//   label, install, docs, setup   what the settings screen shows for a CLI that is not installed:
//                 a name, the install command (when one is certain), a docs link and a one-line
//                 first-run step (usually the login)
//   args          (prompt, { model, mode, effort, outFile }) => argv for one non-interactive run that
//                 prints JSON when the CLI can, so usage comes back. mode is 'chat' (a reply,
//                 no tools wanted), 'plan' (may read the project, changes nothing) or 'write'
//                 (may edit files)
//   parse         ({ stdout, file }) => { text?, model?, usage?, error? } with whatever the output holds
//                 (usage keys as above; `error` is the failure the CLI reported inside its output, where a
//                 limit or an unknown model shows up as an event rather than on stderr). Optional: without
//                 it the raw stdout is the reply. It may throw on output it does not understand; the raw
//                 output is used then. When it parses fine but finds no text, the run has no answer.
//   efforts       (optional) the reasoning levels the CLI accepts, lowest first; absent when it has none
//                 (reasoningNote then says why, for Settings)
//   models        async () => [{ id, label, note?, efforts?, billing? }] the models it can run (Settings lists
//                 them); billing is 'plan' (the CLI's subscription, the default), 'free', or 'api' (pay per token)
//   fullAccessArgs  (optional) the flags that make the CLI run without asking permission for any tool; used only
//                 in 'write' mode (an approved plan) and only when Settings > Services turns it on for the service
//   defaultModel  (optional) the model to use when none is chosen
//   promptVia     (optional) 'stdin' to send the prompt on stdin instead of as an argument
//                 (no shell, newline or length limits); default is an argument
//   outFile       (optional) true when args() writes the final answer to `outFile` and stdout is
//                 log or JSON noise; the file is read back and handed to parse as `file`
//   timeoutMs     (optional) a longer limit than the chat's CHAT_AI_TIMEOUT for a slow CLI
//   activity      (optional) ({ since, env }) => epoch ms of the CLI's latest sign of life (0 = none); lets a run that is
//                 quiet on stdout but busy go past timeoutMs (a soft deadline, see runAdapter). Must never throw.
//   refusedCommand (optional) ({ since, env }) => the command a permission refusal was about ('' = unknown); read-only,
//                 best effort, must never throw. runAdapter sets result.refusedCommand from it on a permission failure.
//   timeoutHint   (optional) ({ since }) => text, asked when a run was killed by its timeout: what the CLI's own log
//                 says about why (a limit it never printed). The text joins the error, so classifyFailure sees it.
// Everything else (scripts/office-run.mjs, scripts/chat-backend.mjs, the chat watcher, the
// settings screen) picks the new CLI up by name.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { defaultModelFor, hasFullAccess, isEnabled } from './settings.mjs'
import { classifyFailure } from './availability.mjs'

const AGY_LIMITS = Object.freeze({ maxList: 400, maxFiles: 12, maxFileChars: 40_000, maxTotalChars: 150_000, maxWalk: 5000, maxWalkFileBytes: 1_000_000 })
const WALK_SKIP = /^(node_modules|dist|build|coverage)$/
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tgz|7z|rar|exe|dll|so|dylib|bin|woff2?|ttf|otf|eot|mp[34]|mov|avi|wav|db|sqlite|class|jar|lock)$/i
const SECRET_NAME = /^(\.env.*|.*\.pem|.*\.key|id_rsa.*|id_ed25519.*|auth-token|credentials.*|.*\.p12|.*\.pfx|.*secret.*|\.npmrc)$/i
const NAMED_TOKEN = /[\w@.\-\\/:~]+/g
const NAMED_EXT = /\.(mjs|js|ts|tsx|jsx|json|md|css|html|py|sh)$/i

/** Tracked files from git (the office asks, not the CLI), else a bounded walk. Forward slashes; [] when nothing. */
function agyFileList(cwd, limits) {
  try {
    const out = execFileSync('git', ['ls-files'], { cwd, timeout: 5000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    const files = out.split('\n').map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean)
    if (files.length) return files
  } catch { /* not a git repository, or git is missing */ }
  const files = []
  const walk = (rel) => {
    let entries
    try { entries = readdirSync(join(cwd, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)) } catch { return }
    for (const e of entries) {
      if (files.length >= limits.maxWalk) return
      const path = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !WALK_SKIP.test(e.name)) walk(path)
      } else if (e.isFile() && !BINARY_EXT.test(e.name)) {
        try { if (statSync(join(cwd, path)).size <= limits.maxWalkFileBytes) files.push(path) } catch { /* vanished */ }
      }
    }
  }
  walk('')
  return files
}

/** The text of a file the prompt names, if it is a plain, non-secret file inside cwd; else null. */
function agyNamedFile(cwd, root, token) {
  const full = resolve(cwd, token)
  let real
  try { real = realpathSync(full) } catch { return null }
  const rel = relative(root, real)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  const parts = rel.split(sep)
  if (parts.includes('.git') || parts.some((p) => SECRET_NAME.test(p)) || BINARY_EXT.test(real)) return null
  if (basename(token) && SECRET_NAME.test(basename(token))) return null
  try {
    if (!statSync(real).isFile() || statSync(real).size > 5_000_000) return null
    const text = readFileSync(real, 'utf8')
    return text.includes('\0') ? null : { rel: parts.join('/'), text }
  } catch { return null }
}

/**
 * The project context for Antigravity in chat and plan: headless it has no search or list tool and its shell commands
 * are refused, so the office hands it the tracked file list and the files the prompt names. '' when there is nothing.
 * Pure: the folder is a parameter. Never throws.
 */
export function agyContext({ prompt, cwd, limits } = {}) {
  try {
    const lim = { ...AGY_LIMITS, ...limits }
    if (!cwd) return ''
    const root = realpathSync(cwd)
    const files = agyFileList(cwd, lim)
    const named = []
    let total = 0
    const seen = new Set()
    for (const raw of String(prompt ?? '').match(NAMED_TOKEN) ?? []) {
      if (named.length >= lim.maxFiles || total >= lim.maxTotalChars) break
      const token = raw.replace(/[.:,;]+$/, '')
      if (!(/[\\/]/.test(token) || NAMED_EXT.test(token))) continue
      const f = agyNamedFile(cwd, root, token)
      if (!f || seen.has(f.rel)) continue
      seen.add(f.rel)
      const lines = f.text.split('\n')
      let body = f.text
      let cut = false
      const room = Math.min(lim.maxFileChars, lim.maxTotalChars - total)
      if (body.length > room) { body = body.slice(0, room); cut = true }
      total += body.length
      const numbered = body.split('\n').map((l, i) => `${String(i + 1).padStart(4)}| ${l.replace(/\r$/, '')}`).join('\n')
      named.push(`--- FILE: ${f.rel} (${lines.length} lines) ---\n${numbered}${cut ? `\n[truncated: only the first ${body.length} of ${f.text.length} characters are shown]` : ''}`)
    }
    if (!files.length && !named.length) return ''
    const shown = files.slice(0, lim.maxList)
    const left = files.length - shown.length
    return [
      'PROJECT CONTEXT. The project files below are provided so that no tool or command is needed. Do not run shell commands. If you need more than this, ask the boss for it in your answer.',
      shown.length ? `PROJECT FILE LIST (${files.length} files${left ? `, ${left} more not listed` : ''}):\n${shown.join('\n')}` : '',
      ...named,
    ].filter(Boolean).join('\n\n')
  } catch { return '' }
}

const opt = (flag, value) => (value ? [flag, value] : [])
const stripAnsiText = (text) => String(text).split(String.fromCharCode(27)).map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, ''))).join('')

const NEUTRAL_USAGE = Object.freeze({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, totalTokens: 0, costUsd: 0 })

const qoderRunsRoot = (env = process.env) => env.AGENT_OFFICE_QODER_LOGS || join(homedir(), '.qoder', 'logs', 'runs')

function terminateTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.on('error', () => child.kill())
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }
}

/** An error message the way CLIs nest it: '{"error":{"message":"..."}}' as a string inside an event. */
const errorMessage = (raw) => {
  try {
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw
    return String(d?.error?.message ?? d?.message ?? raw)
  } catch { return String(raw) }
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
const parseJson = (text) => JSON.parse(text)
const jsonLines = (text) => text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).flatMap((l) => {
  try { return [JSON.parse(l)] } catch { return [] }
})

/** Fill every field of the contract: what the CLI gave, else the neutral value. */
function normalise(partial = {}) {
  const usage = { ...NEUTRAL_USAGE }
  const reported = []
  for (const key of Object.keys(NEUTRAL_USAGE)) {
    const v = num(partial.usage?.[key])
    if (v !== undefined) { usage[key] = v; reported.push(key) }
  }
  if (!reported.includes('totalTokens') && (reported.includes('inputTokens') || reported.includes('outputTokens'))) {
    usage.totalTokens = usage.inputTokens + usage.outputTokens
    reported.push('totalTokens')
  }
  return {
    text: typeof partial.text === 'string' ? partial.text.trim() : '',
    model: typeof partial.model === 'string' ? partial.model : '',
    usage,
    reported,
  }
}

// What each CLI really guarantees per mode (see docs/adapter-contract.md); server/agent-profiles.mjs checks job descriptions against it.
export const ACCESS_ENFORCEMENT = Object.freeze({
  claude: Object.freeze({ chat: 'none', plan: 'read-enforced', write: 'edit-enforced' }),
  codex: Object.freeze({ chat: 'read-enforced', plan: 'read-enforced', write: 'edit-enforced' }),
  agy: Object.freeze({ chat: 'soft', plan: 'soft', write: 'edit-enforced' }),
  opencode: Object.freeze({ chat: 'read-enforced', plan: 'read-enforced', write: 'edit-enforced' }),
  qoder: Object.freeze({ chat: 'soft', plan: 'soft', write: 'edit-enforced' }),
})

export const adapters = {
  claude: {
    bin: 'claude',
    label: 'Claude Code',
    install: 'npm install -g @anthropic-ai/claude-code',
    docs: 'https://docs.claude.com/en/docs/claude-code/overview',
    setup: 'Run `claude` once and sign in.',
    defaultModel: 'claude-haiku-5-5',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    // No CLI call lists them: these are the model ids of the current Claude family
    models: async () => [
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    ],
    promptVia: 'stdin',
    // The chat run: one turn, and none of the user's hooks, CLAUDE.md, MCP servers, skills or tools
    // (--safe-mode; --bare would only take an API key, not the OAuth login). --no-session-persistence
    // keeps one-shot calls out of ~/.claude. --name agent-office-bot marks the call as the office's
    // own, so the session registry reader (server/sessions.js BOT_SESSION_NAME) skips it.
    args: (_prompt, { model, mode, effort }) => [
      '-p', '--output-format', 'json', ...opt('--model', model), ...opt('--effort', effort),
      ...({
        write: ['--permission-mode', 'acceptEdits'],
        plan: ['--safe-mode', '--permission-mode', 'plan', '--no-session-persistence', '--name', 'agent-office-bot'],
        chat: ['--max-turns', '1', '--safe-mode', '--strict-mcp-config', '--tools', '', '--no-session-persistence', '--name', 'agent-office-bot'],
      })[mode],
    ],
    parse: ({ stdout }) => {
      const d = parseJson(stdout)
      if (d.is_error) return { error: String(d.result ?? 'error') }
      const u = d.usage ?? {}
      const cached = num(u.cache_read_input_tokens)
      return {
        text: d.result,
        model: Object.keys(d.modelUsage ?? {})[0],
        usage: {
          inputTokens: (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (cached ?? 0),
          cachedTokens: cached,
          outputTokens: num(u.output_tokens),
          reasoningTokens: num(u.output_tokens_details?.thinking_tokens),
          costUsd: num(d.total_cost_usd),
        },
      }
    },
  },
  codex: {
    bin: 'codex',
    label: 'OpenAI Codex',
    install: 'npm install -g @openai/codex',
    docs: 'https://github.com/openai/codex',
    setup: 'Run `codex login` once.',
    promptVia: 'stdin',
    outFile: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    models: async () => parseCodexModels(readFileSync(join(homedir(), '.codex', 'models_cache.json'), 'utf8')),
    args: (_prompt, { model, mode, effort, outFile }) => [
      'exec', '--skip-git-repo-check', '-s', mode === 'write' ? 'workspace-write' : 'read-only',
      ...(mode === 'write' ? [] : ['--ephemeral']), '--json', ...opt('-m', model),
      ...(effort ? ['-c', `model_reasoning_effort=${effort}`] : []), '-o', outFile, '-',
    ],
    parse: ({ stdout, file }) => {
      const events = jsonLines(stdout)
      const u = events.filter((e) => e.type === 'turn.completed').pop()?.usage ?? {}
      const failed = events.filter((e) => e.type === 'error' || e.type === 'turn.failed').map((e) => errorMessage(e.message ?? e.error?.message))
      return {
        error: failed.join('\n'),
        text: file,
        usage: {
          inputTokens: num(u.input_tokens),
          cachedTokens: num(u.cached_input_tokens),
          outputTokens: num(u.output_tokens),
          reasoningTokens: num(u.reasoning_output_tokens),
        },
      }
    },
  },
  agy: {
    bin: 'agy',
    label: 'Antigravity',
    docs: 'https://antigravity.google',
    setup: 'Install the Antigravity CLI from its site, make sure `agy` is on your PATH, then sign in.',
    // no separate reasoning level: a model id there already carries it (-low / -medium / -high)
    reasoningNote: 'The level is part of the model name (-low, -medium, -high).',
    // headless it cannot ask, so a command it has no allow-rule for is refused; this lets an approved plan run them
    fullAccessArgs: ['--dangerously-skip-permissions'],
    // A prompt too long for the command line: no attach flag, so its folder joins the workspace and it reads the file.
    promptFile: {
      instruction: (file) => `The whole task is in the file ${file}. Read it with your file read tool and carry it out exactly as written. Do not run shell commands.`,
      args: (args, _file, dir) => ['--add-dir', dir, ...args],
    },
    // Headless it prints nothing until the end; its conversation database is written to while it works. Measured
    // 2026-10-22: rewritten every few seconds during tool use, but quiet for 26 to 52 s while the model thinks.
    activeWindowMs: 120_000,
    activity: ({ since, env }) => {
      try {
        const root = env?.AGENT_OFFICE_AGY_CONVERSATIONS || join(homedir(), '.gemini', 'antigravity-cli', 'conversations')
        return Math.max(0, ...readdirSync(root).filter((n) => n.endsWith('.db')).map((n) => statSync(join(root, n)).mtimeMs).filter((t) => t >= since))
      } catch { return 0 }
    },
    // The command a permission refusal was about: the last "CommandLine":"..." string of the newest conversation
    // written since the run began. Read as latin1 (the file is binary); nothing else is taken from it.
    refusedCommand: ({ since, env }) => {
      try {
        const root = env?.AGENT_OFFICE_AGY_CONVERSATIONS || join(homedir(), '.gemini', 'antigravity-cli', 'conversations')
        const newest = readdirSync(root).filter((n) => n.endsWith('.db')).map((n) => ({ p: join(root, n), t: statSync(join(root, n)).mtimeMs }))
          .filter((f) => f.t >= since).sort((a, b) => b.t - a.t)[0]
        if (!newest) return ''
        let last = ''
        for (const m of readFileSync(newest.p, 'latin1').matchAll(/"CommandLine":"((?:[^"\\]|\\.)*)"/g)) last = m[1]
        return last.replace(/\\(["\\])/g, '$1').slice(0, 200)
      } catch { return '' }
    },
    models: async () => parseAgyModels(await cliOutput('agy', ['models'])),
    // Chat and plan: the project file list and the files the prompt names go into the prompt itself (so also into the
    // prompt file of a long one), because its shell commands are refused. AGENT_OFFICE_AGY_CONTEXT=0 turns it off.
    preparePrompt: (prompt, { mode, cwd }) => {
      if (mode === 'write' || process.env.AGENT_OFFICE_AGY_CONTEXT === '0') return prompt
      const block = agyContext({ prompt, cwd })
      return block ? `${prompt}\n\n${block}` : prompt
    },
    args: (prompt, { model, mode }) => [
      // Headless it cannot ask, so a shell command is refused and the run reports "blocked". Its file tools work
      // without the bypass; say so for an approved write unless the service has full access (commands allowed).
      // Never for plan or chat: it would invite file edits there, and plan mode is not a hard read-only boundary.
      // In chat and plan it still tries a shell command to read files; the refusal ends the run with no output.
      '-p', mode !== 'write' ? `${prompt}\n\nUse only your file read, list and search tools. Do not run shell commands and do not edit files.`
        : !hasFullAccess('agy') ? `${prompt}\n\nUse your file read and edit tools. Do not run shell commands.` : prompt,
      '--output-format', 'json', ...opt('--model', model),
      // The CLI's default mode can edit files without asking in headless runs.
      // Unapproved chat must use the same enforced read-only mode as planning.
      ...({ write: ['--mode', 'accept-edits'], plan: ['--mode', 'plan'], chat: ['--mode', 'plan'] })[mode],
    ],
    parse: ({ stdout }) => {
      const d = parseJson(stdout)
      if (d.status && d.status !== 'SUCCESS') return { error: `${d.status}: ${d.response ?? d.error ?? ''}` }
      const u = d.usage ?? {}
      return {
        text: d.response,
        usage: {
          inputTokens: num(u.input_tokens),
          cachedTokens: num(u.cache_read_tokens),
          outputTokens: num(u.output_tokens),
          reasoningTokens: num(u.thinking_tokens),
          totalTokens: num(u.total_tokens),
        },
      }
    },
  },
  opencode: {
    bin: 'opencode',
    label: 'OpenCode',
    install: 'npm install -g opencode-ai',
    docs: 'https://opencode.ai/docs',
    setup: 'Run `opencode auth login` (or point it at a local model) once.',
    // shortcut: its configured default may be a local model that answers with tool-call JSON, so chat uses
    // a hosted free one unless a model is set; upgrade by letting the settings screen choose the model
    defaultModel: 'opencode/big-pickle',
    // A prompt too long for the command line is attached as a file (its content reaches the model without any tool,
    // so this works in the deny-all chat mode too). `-f` takes several values: it must not be last before the message.
    promptFile: {
      instruction: () => 'The whole task is in the attached file prompt.md. Carry it out exactly as written and answer as it asks.',
      args: (args, file) => [args[0], '-f', file, ...args.slice(1)],
    },
    // Chat and planning only read files; never inherit a user's permissive tool defaults for an invocation that has no
    // execution approval. Chat cannot be tool-free: with every tool denied and a model named, the free tier answers
    // "can only be used from within OpenCode" (checked 2026-10-21), so it gets the same read-only set as plan.
    env: ({ mode }) => mode === 'write' ? {} : {
      OPENCODE_PERMISSION: JSON.stringify({ '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow' }),
    },
    models: async () => {
      // only the providers it can actually use: its own free ones, a local ollama, and those it has credentials for
      const [all, auth] = await Promise.all([cliOutput('opencode', ['models']), cliOutput('opencode', ['auth', 'list']).catch(() => '')])
      return filterOpencodeModels(parseOpencodeModels(all), parseOpencodeProviders(auth))
    },
    args: (prompt, { model, mode, cwd }) => ['run', '--format', 'json', ...opt('-m', model), ...opt('--dir', cwd), ...(mode === 'plan' ? ['--agent', 'plan'] : []), prompt],
    parse: ({ stdout }) => {
      const events = jsonLines(stdout)
      const failed = events.filter((e) => e.type === 'error').map((e) => errorMessage(e.error?.data?.message ?? e.error?.message ?? e.error ?? e.message))
      const finishes = events.filter((e) => e.type === 'step_finish').map((e) => e.part ?? {})
      const sum = (pick) => {
        const values = finishes.map(pick).filter((v) => num(v) !== undefined)
        return values.length ? values.reduce((a, b) => a + b, 0) : undefined
      }
      const cacheRead = sum((p) => p.tokens?.cache?.read)
      const cacheWrite = sum((p) => p.tokens?.cache?.write)
      const input = sum((p) => p.tokens?.input)
      return {
        error: failed.join('\n'),
        text: events.filter((e) => e.type === 'text').map((e) => e.part?.text ?? '').join(''),
        usage: {
          inputTokens: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
          cachedTokens: cacheRead,
          outputTokens: sum((p) => p.tokens?.output),
          reasoningTokens: sum((p) => p.tokens?.reasoning),
          totalTokens: sum((p) => p.tokens?.total),
          costUsd: sum((p) => p.cost),
        },
      }
    },
  },
  qoder: {
    bin: 'qodercli',
    label: 'Qoder',
    // free to use, and as fast as its other models in the live check; without a model the CLI picks its own (Auto)
    defaultModel: 'Qwen3.8-Flash',
    docs: 'https://docs.qoder.com/cli/quick-start',
    setup: 'Install the Qoder CLI, make sure `qodercli` is on your PATH, then run `qodercli` once to sign in.',
    timeoutMs: 150_000, // a chat-sized reply takes over a minute
    // A prompt too long for the command line is attached as a file (its content reaches the model without any tool).
    promptFile: {
      instruction: () => 'The whole task is in the attached file prompt.md. Carry it out exactly as written and answer as it asks.',
      args: (args, file) => ['--attachment', file, ...args],
    },
    // Over its usage limit it prints nothing and polls the queue until killed; the limit shows only in its own run log.
    // Newest write to a run log of this run: quiet on stdout does not mean idle.
    activity: ({ since, env }) => {
      try {
        const root = qoderRunsRoot(env)
        return Math.max(0, ...readdirSync(root).map((n) => statSync(join(root, n, 'qodercli.log'), { throwIfNoEntry: false })?.mtimeMs ?? 0).filter((t) => t >= since))
      } catch { return 0 }
    },
    timeoutHint: ({ since }) => {
      try {
        const root = qoderRunsRoot()
        const runs = readdirSync(root).map((n) => ({ n, t: statSync(join(root, n)).mtimeMs })).filter((r) => r.t >= since).sort((a, b) => b.t - a.t).slice(0, 3)
        for (const run of runs) {
          const log = readFileSync(join(root, run.n, 'qodercli.log'), 'utf8').slice(-40_000)
          if (log.includes('RESOURCE_LIMIT')) return `Qoder usage limit reached (RESOURCE_LIMIT), retry after ${/retryAfterSeconds\W{1,4}(\d+)/.exec(log)?.[1] ?? 30} seconds`
        }
      } catch { /* no readable log: the plain timeout stands */ }
      return ''
    },
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'], // it also takes auto, none and ultracode
    models: async () => parseQoderModels(await cliOutput('qoder', ['--list-models'])),
    args: (prompt, { model, mode, effort }) => [
      // chat and plan never ask, so nothing is changed (`--tools ""` hangs the CLI)
      '-p', '-o', 'json', ...opt('-m', model), ...opt('--reasoning-effort', effort), '--permission-mode', mode === 'write' ? 'accept_edits' : 'dont_ask', prompt,
    ],
    parse: ({ stdout }) => {
      const d = parseJson(stdout)
      if (d.is_error) return { error: String(d.result ?? 'error') }
      const u = d.usage ?? {}
      const cached = num(u.cache_read_input_tokens)
      const usage = {
        inputTokens: (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (cached ?? 0),
        cachedTokens: cached,
        outputTokens: num(u.output_tokens),
        costUsd: num(d.total_cost_usd),
      }
      // It sends zeros for everything today, which is "not measured" and not "free"
      const measured = Object.values(usage).some((v) => v > 0)
      return { text: d.result, usage: measured ? usage : {} }
    },
  },
}

export const adapterNames = Object.keys(adapters)

// What each CLI prints when asked for its models, as { id, label, note?, efforts? }
const lines = (text) => String(text).split('\n').map((l) => l.trim()).filter(Boolean)
export const parseAgyModels = (out) => lines(out).filter((l) => l.includes('\t')).map((l) => {
  const [id, label] = l.split('\t')
  return { id: id.trim(), label: (label || id).trim() }
})
export const parseQoderModels = (out) => lines(out).filter((l) => l !== 'MODEL').map((l) => ({ id: l, label: l }))
export const parseOpencodeModels = (out) => lines(out).filter((l) => l.includes('/')).map((l) => ({ id: l, label: l }))
/** `opencode auth list` names the providers it has credentials for ("●  Anthropic api"). */
export const parseOpencodeProviders = (out) => lines(stripAnsiText(out)).filter((l) => l.startsWith('●')).map((l) => l.replace('●', '').trim().split(/\s+/)[0].toLowerCase())
const OPENCODE_FREE = new Set(['opencode', 'ollama'])
/** Keep the models of providers it can use, and mark which ones cost money per token. */
export function filterOpencodeModels(models, credentialed) {
  const usable = new Set([...OPENCODE_FREE, ...credentialed])
  return models
    .filter((m) => usable.has(m.id.split('/')[0]))
    .map((m) => ({ ...m, billing: OPENCODE_FREE.has(m.id.split('/')[0]) ? 'free' : 'api' }))
}
/** Codex keeps its model catalogue in ~/.codex/models_cache.json; only the ones it lists, best first. */
export function parseCodexModels(jsonText) {
  const models = JSON.parse(jsonText).models ?? []
  return models
    .filter((m) => m.visibility === 'list')
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .map((m) => ({
      id: m.slug,
      label: m.display_name || m.slug,
      note: m.description,
      efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort).filter(Boolean),
    }))
}

const MODELS_TTL_MS = 5 * 60_000
const modelCache = new Map()

/** The models a service can run, cached for a few minutes (some CLIs take seconds to answer); [] when it cannot say. */
export async function listModels(name, { strict = false } = {}) {
  const adapter = adapters[name]
  if (!adapter?.models || !isEnabled(name)) return []
  const hit = modelCache.get(name)
  if (hit && Date.now() - hit.at < MODELS_TTL_MS) return hit.models
  let models
  // a failure is never cached (a retry must ask the CLI again); strict lets the catalogue see it
  try { models = await adapter.models() } catch (e) { if (strict) throw e; return [] }
  modelCache.set(name, { at: Date.now(), models })
  return models
}

/**
 * The executable of a service can be given by hand: AGENT_OFFICE_BIN_<SERVICE> (AGENT_OFFICE_BIN_CODEX, ...) is a
 * command line (double quotes keep a path with spaces together) that replaces the CLI the office would find on PATH. For an install in an odd
 * place, a wrapper script, or a test that stands in for the real CLI.
 */
/** A command line as its words: spaces separate them, double quotes keep a path with spaces together. */
export const splitCommand = (line) => [...String(line).matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])
const overrideOf = (name) => {
  const line = process.env[`AGENT_OFFICE_BIN_${name.toUpperCase()}`]?.trim()
  return line ? splitCommand(line) : null
}

const PATH_CACHE_MS = 10_000
const pathCache = new Map()
/** Whether `bin` is on PATH. `where` / `which` take tens of milliseconds each, so the answer is kept for a few seconds. */
const onPath = (bin) => {
  const hit = pathCache.get(bin)
  if (hit && Date.now() - hit.at < PATH_CACHE_MS) return hit.found
  const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0
  pathCache.set(bin, { found, at: Date.now() })
  return found
}

/** Every service the office knows, each with `available` (its CLI is on PATH) and `enabled` (Settings allows it). */
export function services() {
  return Object.entries(adapters)
    .map(([name, a]) => ({ name, label: a.label, bin: a.bin, install: a.install, docs: a.docs, setup: a.setup, available: overrideOf(name) !== null || onPath(a.bin), enabled: isEnabled(name), fullAccessSupported: Boolean(a.fullAccessArgs), fullAccess: hasFullAccess(name), defaultModel: defaultModelFor(name), adapterDefaultModel: a.defaultModel ?? '' }))
}

/** The one place a model is chosen: the step's own, else the service's default (Settings), else the adapter's, else '' (the CLI's own). */
export function resolveModel(name, explicit, settings) {
  return explicit || defaultModelFor(name, settings) || adapters[name]?.defaultModel || ''
}

/** The lines that tell a user how to get a service that is not installed. */
export function setupHelp(s) {
  return [
    `${s.label} (\`${s.bin}\`) was not found on your PATH.`,
    ...(s.install ? [`  Install: ${s.install}`] : []),
    `  Docs:    ${s.docs}`,
    `  Then:    ${s.setup}`,
    '  After that, run this command again.',
  ]
}

const ESC = String.fromCharCode(27)
const stripAnsi = (text) => text.split(ESC).map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, ''))).join('')
/**
 * What an npm shim (.cmd) forwards to: { exe } for a native executable, { script } for a node script, else null.
 * (The shim itself would need cmd.exe, which re-parses the prompt: a quote in it ends the argument and what follows
 * runs as a command. The office never gives cmd.exe a prompt, so it runs the target directly.)
 */
export function shimTarget(text, dir) {
  const exe = text.match(/"%dp0%\\([^"]+\.exe)"/i)?.[1]
  if (exe) return { exe: join(dir, exe) }
  const script = text.match(/"%_prog%"\s+"%dp0%\\([^"]+\.(?:c|m)?js)"/i)?.[1]
  if (script) return { script: join(dir, script) }
  return null
}

/**
 * The file to run for a service and the arguments that go before its own: AGENT_OFFICE_BIN_<SERVICE> when set, else
 * what PATH resolves to. Throws when the only thing found is a shim that cannot be run without cmd.exe.
 */
function launcherFor(name, adapter) {
  const given = overrideOf(name)
  if (given) return { file: given[0], prefix: given.slice(1) }
  if (process.platform !== 'win32') return { file: adapter.bin, prefix: [] }
  const lines = spawnSync('where', [adapter.bin], { encoding: 'utf8' }).stdout?.split('\n').map((l) => l.trim()).filter(Boolean) ?? []
  const exe = lines.find((p) => p.toLowerCase().endsWith('.exe'))
  if (exe) return { file: exe, prefix: [] }
  const shim = lines.find((p) => /\.(cmd|bat)$/i.test(p))
  if (!shim) return { file: adapter.bin, prefix: [] }
  const target = shimTarget(readFileSync(shim, 'utf8'), dirname(shim))
  if (target?.exe) return { file: target.exe, prefix: [] }
  if (target?.script) return { file: process.execPath, prefix: [target.script] }
  throw new Error(`${adapter.bin} is only installed as a .cmd shim, which the office will not run through cmd.exe; install its native build or set AGENT_OFFICE_BIN_${name.toUpperCase()}`)
}

/** The stdout of a service's CLI run with fixed arguments (its model list); rejects after timeoutMs. */
function cliOutput(name, args, timeoutMs = 30_000) {
  const { file, prefix } = launcherFor(name, adapters[name])
  return new Promise((resolve, reject) => {
    let out = ''
    const child = spawn(file, [...prefix, ...args], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, AGENT_OFFICE_RUN: '1' } })
    const timer = setTimeout(() => { terminateTree(child); reject(new Error(`${name} timed out`)) }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', () => { clearTimeout(timer); resolve(out) })
  })
}

/**
 * Run one prompt through a CLI and answer with the contract above, always
 * complete: a CLI that reports nothing gives its raw output as `text` and
 * neutral usage. `onData` sees stdout as it arrives; the run is killed after
 * timeoutMs (0 = never). `mode` is 'chat' | 'plan' | 'write' (`write: true` is 'write').
 * `cwd` is the folder the CLI works in (the office's project; default: the folder this process runs in) and `env`
 * extra variables for it. The same prompt gives the same kind of answer from every CLI: one that cannot take it
 * (a prompt longer than a command line allows) answers with an `error`, it never throws or rejects.
 */
export function runAdapter(name, prompt, { model, effort, mode = 'chat', write = false, timeoutMs = 0, activeWindowMs, maxMs = Math.max(timeoutMs * 5, 30 * 60_000), onData, cwd, env } = {}) {
  const adapter = adapters[name]
  if (!adapter) throw new Error(`unknown adapter '${name}' (${adapterNames.join(', ')})`)
  const dir = adapter.outFile ? mkdtempSync(join(tmpdir(), 'office-')) : null
  const outFile = dir && join(dir, 'reply.txt')
  const useStdin = adapter.promptVia === 'stdin'
  const runMode = write ? 'write' : mode
  try { prompt = adapter.preparePrompt?.(prompt, { mode: runMode, cwd }) ?? prompt } catch { /* the plain prompt */ }
  // a level this CLI does not know (an old setting, another service's) is left out, not passed on
  const level = adapter.efforts?.includes(effort) ? effort : undefined
  const build = (text) => {
    const built = adapter.args(text, { model: resolveModel(name, model), mode: runMode, effort: level, outFile, cwd })
    // only an approved plan (write mode) on a service switched to full access: chat and planning stay restricted
    if (runMode === 'write' && adapter.fullAccessArgs && hasFullAccess(name)) built.push(...adapter.fullAccessArgs)
    return built
  }

  let launcher
  try { launcher = launcherFor(name, adapter) } catch (err) {
    if (dir) rmSync(dir, { recursive: true, force: true })
    return Promise.resolve({ ...normalise({}), error: err.message, code: 1, durationMs: 0 })
  }
  const bin = launcher.file
  let argv = [...launcher.prefix, ...build(prompt)]
  // A prompt given as a command-line argument must fit the OS: about 32,000 characters in all on Windows, 128 KiB per
  // argument on Linux (over that spawn throws). Then the prompt goes into a file in a folder of its own and the CLI is
  // told to read it (its attach flag, or its file tool): the same task, whatever its size, as for the CLIs that read stdin.
  const argLimit = process.platform === 'win32' ? 30_000 : 120_000
  const length = (list) => list.reduce((total, arg) => total + String(arg).length + 1, 0)
  let promptDir = null
  const dropFiles = () => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    if (promptDir) rmSync(promptDir, { recursive: true, force: true })
  }
  if (!useStdin && length(argv) > argLimit) {
    try {
      if (!adapter.promptFile) throw new Error('this CLI cannot read the prompt from a file')
      promptDir = mkdtempSync(join(tmpdir(), 'office-prompt-'))
      const file = join(promptDir, 'prompt.md')
      writeFileSync(file, String(prompt), { mode: 0o600 })
      argv = [...launcher.prefix, ...adapter.promptFile.args(build(adapter.promptFile.instruction(file)), file, promptDir)]
      if (length(argv) > argLimit) throw new Error('still too long')
    } catch {
      dropFiles()
      return Promise.resolve({ ...normalise({}), error: `${name} takes the prompt as a command-line argument and this prompt is ${String(prompt).length} characters; the limit here is about ${argLimit} and the prompt could not be passed as a file. Shorten it, or use a service that reads the prompt from stdin.`, code: 1, durationMs: 0 })
    }
  }
  if (process.env.CHAT_AI_DEBUG) console.error(`[adapter] ${name} -> ${bin} ${JSON.stringify(argv.slice(0, 6)).slice(0, 200)}`)

  const started = Date.now()
  return new Promise((resolve) => {
    let out = ''
    let stderr = ''
    let finished = false
    let child
    try {
      child = spawn(bin, argv, { stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32', ...(cwd ? { cwd } : {}), env: { ...process.env, ...adapter.env?.({ mode: runMode }), ...env, AGENT_OFFICE_RUN: '1' } })
    } catch (err) {
      // spawn can throw instead of emitting 'error' (a path or argument the OS refuses): still an answer, not a rejection
      dropFiles()
      return resolve({ ...normalise({}), error: `${name}: ${err.message}`, code: 1, durationMs: Date.now() - started })
    }
    if (useStdin) {
      // A CLI may exit before reading its prompt (for example, an invalid option).
      child.stdin.on('error', () => {})
      child.stdin.end(prompt)
    }
    let timedOut = false
    let lastData = 0
    // timeoutMs is a soft deadline: a CLI that showed a sign of life in the last activeWindowMs gets another window,
    // up to maxMs in all; one that showed none (or whose probe fails) is ended at timeoutMs, as before
    const windowMs = Math.min(activeWindowMs ?? adapter.activeWindowMs ?? 45_000, timeoutMs) // never longer than the deadline itself
    const check = () => {
      const now = Date.now()
      let probed = 0
      try { probed = Number(adapter.activity?.({ since: started, env: { ...process.env, ...env } })) || 0 } catch { /* a failing probe is no activity */ }
      if (now - Math.max(lastData, probed) < windowMs && now - started < maxMs) {
        timer = setTimeout(check, Math.max(1, Math.min(windowMs, started + maxMs - now)))
        return
      }
      timedOut = true
      terminateTree(child)
    }
    let timer = timeoutMs && setTimeout(check, timeoutMs)
    child.stdout.on('data', (d) => { lastData = Date.now(); out += d; onData?.(d) })
    child.stderr.on('data', (d) => { lastData = Date.now(); stderr = (stderr + d).slice(-4000); if (process.env.CHAT_AI_DEBUG) process.stderr.write(d) })
    const done = (code, err) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      let file = ''
      if (outFile) { try { file = readFileSync(outFile, 'utf8') } catch { /* no answer file */ } }
      dropFiles()
      if (err) console.error(`[adapter] ${name}: ${err.message}`)
      const stdout = stripAnsi(out)
      let parsed = {}
      let understood = Boolean(adapter.parse)
      try { parsed = adapter.parse?.({ stdout, file }) ?? {} } catch { understood = false }
      const result = normalise(parsed)
      // output no parser read is plain text and is the reply; output a parser read and found no answer in is a failed run
      if (!result.text && !understood) result.text = (file || stdout).trim()
      const hint = timedOut ? adapter.timeoutHint?.({ since: started }) : ''
      const error = [timedOut ? `${name} timed out` : err?.message, hint, stripAnsi(stderr).trim(), typeof parsed.error === 'string' ? parsed.error.trim() : ''].filter(Boolean).join('\n')
      // best effort: which command a permission refusal was about (only adapters with the hook; never throws)
      let refusedCommand = ''
      try { if (adapter.refusedCommand && !result.text && classifyFailure({ text: '', error }).kind === 'permission') refusedCommand = adapter.refusedCommand({ since: started, env: { ...process.env, ...env } }) || '' } catch { /* no command */ }
      resolve({ ...result, error, code: code ?? 1, durationMs: Date.now() - started, ...(refusedCommand ? { refusedCommand } : {}) })
    }
    child.on('error', (err) => done(1, err))
    child.on('close', (code) => done(code))
  })
}
