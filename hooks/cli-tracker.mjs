#!/usr/bin/env node
// Terminal-only telemetry. No permission answering, transcript reading or tool arguments.
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac } from 'node:crypto'
import { readRegularFile } from '../server/project-files.mjs'

const short = (v, n = 200) => typeof v === 'string' ? v.slice(0, n) : undefined

export function normalizeEvent(cli, event, payload) {
  if (!['codex', 'agy', 'opencode', 'qoder'].includes(cli) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const p = payload
  // OpenCode properties/info/sessionID/parentID are SDK-inferred, not captured payloads.
  const props = cli === 'opencode' ? p.properties ?? {} : {}
  const info = props.info ?? {}
  const rawId = cli === 'agy' ? p.conversationId : cli === 'opencode' ? p.sessionID ?? props.sessionID ?? info.sessionID ?? info.id : p.session_id
  if (typeof rawId !== 'string' || !rawId) return null
  const cwd = short(cli === 'agy' ? p.workspacePaths?.[0] : p.cwd ?? info.directory, 400)
  const base = { cli, sessionId: `${cli}:${rawId}`.slice(0, 200), cwd, project: cwd ? win32.basename(cwd.replace(/\/$/, '')) : undefined,
    transcriptPath: short(p.transcript_path ?? p.transcriptPath, 400), model: short(p.model ?? p.modelName ?? info.modelID),
    ...(typeof p.agent_id === 'string' && p.agent_id ? { agentId: `${cli}:${p.agent_id}`.slice(0, 200) } : {}) }
  const tool = short(p.tool_name ?? p.toolCall?.name ?? p.tool)
  const out = (type, fields = {}) => ({ ...base, type, ...fields })
  switch (event) {
    case 'SessionStart': case 'session.created':
      if (cli === 'opencode' && info.parentID) return out('agent_spawned', { sessionId: `opencode:${info.parentID}`.slice(0, 200), agent: { id: `${cli}:${info.id}`, name: 'OpenCode agent', role: 'general-purpose' } })
      return out('session_started', { source: short(p.source) || 'startup' })
    case 'SessionEnd': case 'session.deleted': return out('session_ended', { reason: short(p.reason) || 'other' })
    case 'UserPromptSubmit': return out('session_prompt', { text: short(p.prompt, 2000) })
    case 'message.updated':
      // Message metadata is not prompt text. Do not guess from transcript files.
      return info.role === 'user' ? out('session_prompt') : null
    case 'PreToolUse': case 'tool.execute.before': return out('agent_working', { status: tool || 'Working', toolName: tool })
    case 'PostToolUse': case 'tool.execute.after': return out('session_tool_done', { toolName: tool })
    case 'PermissionRequest': case 'PermissionDenied': case 'permission.asked': return out('session_needs_you', { kind: 'permission', toolName: tool, summary: 'Permission requested in terminal', answerable: false })
    case 'Notification': return out('session_needs_you', { kind: 'idle', summary: 'Terminal needs attention' })
    case 'Stop': case 'session.idle': case 'PostInvocation':
      return p.error ? out('session_error', { error: 'cli_error', detail: 'Terminal reported an error' }) : out('session_turn_end', { text: short(p.last_assistant_message, 2000) })
    case 'StopFailure': case 'PostToolUseFailure': case 'session.error': return out('session_error', { error: 'cli_error', detail: 'Terminal reported an error' })
    case 'PreInvocation': return out('agent_working', { status: 'Thinking' })
    case 'PreCompact': case 'PostCompact': case 'session.compacted': return out('session_compact', { phase: event === 'PreCompact' ? 'pre' : 'post' })
    case 'CwdChanged': return out('session_cwd')
    case 'Interrupt': return out('session_turn_end')
    case 'SubagentStart': case 'SubagentStop': {
      if (!p.agent_id) return null
      const id = `${cli}:${short(p.agent_id, 100)}`
      return event === 'SubagentStart' ? out('agent_spawned', { agent: { id, name: short(p.agent_type) || 'Agent', role: short(p.agent_type) || 'general-purpose' } }) : out('agent_completed', { agentId: id })
    }
    default: return null
  }
}

export async function sendEvent(event, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!event || env.AGENT_OFFICE_RUN === '1') return
  let url
  try {
    url = new URL(env.AGENT_OFFICE_EVENT_URL || `http://127.0.0.1:${env.AGENT_OFFICE_PORT || 3334}/event`)
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/event' || url.search || url.hash) return
  } catch { return }
  const home = env.AGENT_OFFICE_HOME || join(env.HOME || homedir(), '.agent-office')
  let token
  try { token = readRegularFile(join(home, 'auth-token'), 4096).toString('utf8').trim() } catch { return }
  if (!token) return
  // Same logging levels as the server. Read only; never log prompt/reply text.
  let level = 'summary'
  try { level = JSON.parse(readRegularFile(join(home, 'settings.json'), 1024 * 1024).toString('utf8')).logPrompts ?? level } catch {}
  const body = JSON.stringify({ ...event, ...(event.text !== undefined ? { text: level === 'off' ? undefined : event.text.slice(0, level === 'full' ? 2000 : 200) } : {}) })
  const timestamp = String(Date.now())
  const signature = createHmac('sha256', token).update(`POST\n${url.pathname}${url.search}\n${timestamp}\n${body}`).digest('hex')
  try { await fetchImpl(url, { method: 'POST', body, redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Office-Timestamp': timestamp, 'X-Office-Signature': signature }, signal: AbortSignal.timeout(1800) }) } catch {}
}

async function main() {
  if (process.env.AGENT_OFFICE_RUN === '1') return
  const [cli, event] = process.argv.slice(2)
  // agy hooks get a neutral reply even on invalid input or a down server. Never a decision: the tracker must not approve tools.
  if (cli === 'agy' && ['PreToolUse', 'PostToolUse', 'Stop'].includes(event)) process.stdout.write('{}')
  let timer = setTimeout(() => process.exit(0), 500) // stdin cap; the send below gets its own 2 s
  try {
    let input = '', payload
    // Stop at the first complete JSON object: a stdin that never closes must not delay the tool call.
    for await (const chunk of process.stdin) {
      input += chunk
      if (Buffer.byteLength(input) > 256 * 1024) return
      try { payload = JSON.parse(input); break } catch {}
    }
    if (payload === undefined) return
    clearTimeout(timer); timer = setTimeout(() => process.exit(0), 2000)
    await sendEvent(normalizeEvent(cli, event, payload))
  } catch {} finally { clearTimeout(timer) }
}

let mainModule = false
try { mainModule = !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch {}
if (mainModule) {
  process.on('uncaughtException', () => process.exit(0))
  process.on('unhandledRejection', () => process.exit(0))
  await main()
  process.exit(0)
}
