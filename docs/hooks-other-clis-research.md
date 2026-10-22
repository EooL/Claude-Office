# Hooks and event streams in the five CLIs: can Claude Office see terminal sessions?

Date: 2026-10-22. Research only; no repository file other than this one was changed. Local versions checked: Claude Code 2.1.296, Codex CLI 0.163.0, agy (Antigravity CLI) 1.4.4, OpenCode 1.18.25, qodercli 1.1.76 (Windows 11).

Legend: "doc" = vendor documentation read online; "local" = read from this machine; "inferred" = my deduction, not verified by running the thing. No AI service was called, so nothing marked doc/local about runtime behaviour was exercised.

## 1. Verdicts

| CLI | Verdict | Mechanism |
| --- | --- | --- |
| Claude Code | supported natively (baseline, already built) | `hooks` in `settings.json`, 20+ events, `hooks/agent-tracker.sh` |
| Codex | supported natively (hooks), plus a weaker legacy `notify` | `~/.codex/hooks.json` or `config.toml` `[[hooks.*]]`, 12 events, trust gate |
| Antigravity (agy) | partly (hooks exist, but only 6 events, no prompt text, no session end, payload docs thin) | `~/.gemini/config/hooks.json` |
| OpenCode | supported natively, but by a JS plugin, not a command hook | `~/.config/opencode/plugins/*.js`, ~30 bus events |
| Qoder | supported natively (Claude-Code-compatible hooks, 23 events) | `~/.qoder/settings.json` `hooks` |

## 2. Comparison table

| | Claude Code | Codex | agy | OpenCode | Qoder |
| --- | --- | --- | --- | --- | --- |
| Mechanism | command/http hooks | command hooks (+ legacy `notify` argv command) | command hooks | in-process JS/TS plugin (Bun) | command/http/prompt/agent hooks |
| User-level config | `~/.claude/settings.json` | `~/.codex/hooks.json` or `~/.codex/config.toml` | `~/.gemini/config/hooks.json` (also `~/.gemini/antigravity-cli/settings.json`) | `~/.config/opencode/plugins/` and `opencode.json` `plugin` array | `~/.qoder/settings.json` |
| Project-level | `.claude/settings*.json` | `<repo>/.codex/hooks.json` (only if project is trusted) | `<repo>/.agents/hooks.json` | `.opencode/plugins/`, `opencode.json` | `.qoder/settings.json`, `.qoder/settings.local.json` |
| Session start | SessionStart (source, model) | SessionStart (source) | SessionStart (once per new conversation) | `session.created` | SessionStart (source, model) |
| Session end | SessionEnd (reason) | SessionEnd (reason, 1 s budget) | none (`Stop` has `fullyIdle`) | `session.deleted` only (no exit event) | SessionEnd (reason) |
| Prompt submit | UserPromptSubmit (`prompt`) | UserPromptSubmit (`prompt`) | none (PreInvocation has counters only) | `message.updated`/`message.part.updated` (role user) | UserPromptSubmit (`prompt`) |
| Turn end | Stop (`last_assistant_message`) | Stop (`last_assistant_message`) | Stop (`terminationReason`, `fullyIdle`) | `session.idle` | Stop (`last_assistant_message`) |
| Tool before/after | PreToolUse/PostToolUse/PostToolUseFailure | PreToolUse/PostToolUse | PreToolUse/PostToolUse (`error` optional) | `tool.execute.before`/`after` | PreToolUse/PostToolUse/PostToolUseFailure |
| Permission request | PermissionRequest, Notification | PermissionRequest | none (PreToolUse `ask` is an output) | `permission.asked`/`permission.replied` | PermissionRequest, PermissionDenied, Notification |
| Subagent start/stop | SubagentStart/Stop | SubagentStart/Stop | none as hook (tools `invoke_subagent`... are visible in PreToolUse) | via `session.created` with `parentID` (inferred) | SubagentStart/Stop |
| Session id field | `session_id` | `session_id` (+ `turn_id`) | `conversationId` | `sessionID` in event properties | `session_id` |
| cwd field | `cwd` | `cwd` | `workspacePaths` (array); no `cwd` | plugin arg `directory` / `worktree` | `cwd` |
| Model | SessionStart `model` | every event `model` | every event `modelName` | in message info (`providerID`/`modelID`) | SessionStart `model` |
| Transcript path | `transcript_path` | `transcript_path` ("unstable") | `transcriptPath` | none (use `opencode export`) | `transcript_path` |
| Windows shell | Git Bash, else PowerShell; `shell` key; exec form `command`+`args` | not documented; `commandWindows` override exists | not documented (local entry uses a plain exe path) | n/a (plugin runs in Bun) | `shell: "powershell"` or `bash`; exec form `args` |
| Default timeout | 600 s (30 s on UserPromptSubmit); SessionEnd 1.5 s | 600 s; SessionEnd/Interrupt 1 s (max 3 s) | 30 s (seconds) | none documented | 600 s |
| Error / hang blocks CLI? | exit != 0/2 non-blocking; timeout cancels, tool not blocked; opt-in `onFailure: "block"` (2.1.295+) | exit != 0/2 logged and skipped; but 600 s default means a hung hook stalls the turn unless `timeout` is set; `async:true` cannot block | not documented (inferred: PreToolUse/Stop hooks can block by output, so a hang is a risk until timeout) | plugin runs in-process: an uncaught throw or an awaited slow call can stall that hook; not documented | exit 2 blocks (UserPromptSubmit, PreToolUse...), other non-zero non-blocking, `async` option |
| Fires in headless run | doc: yes for `-p` | not documented; trust gate applies | not documented | not documented | not documented |

## 3. Per-CLI detail

### 3.1 Claude Code (baseline, confirmed)

- Source: https://code.claude.com/docs/en/hooks (fetched 2026-10-22); local `hooks/hooks.json`, `hooks/agent-tracker.sh`, `hooks/install-hooks.sh`; local version 2.1.296.
- Mechanism: `hooks` in `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR`), or a plugin `hooks/hooks.json`. The repo registers 19 events (see `hooks/hooks.json`) with `bash "<root>/hooks/agent-tracker.sh"`.
- Payload (doc): `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `agent_id`/`agent_type` inside a subagent, plus event fields (`tool_name`, `tool_input`, `tool_use_id`, SessionStart `source`/`model`/`session_title`).
- Windows (doc): shell form runs under Git Bash (fallback PowerShell); exec form `{ "type":"command", "command":"node", "args":["path/to/script.js"] }` works with a real executable. `.cmd`/`.bat` need shell form or `node` + script.
- Failure (doc): exit 1 is a non-blocking error (a "hook error" notice appears in the transcript); timeout cancels the hook without blocking the tool; stdout of an exit-0 hook is not shown (but UserPromptSubmit/SessionStart stdout is injected as context, which is why the tracker never prints).
- Headless (doc, implied): hooks run in `claude -p`. The office already starts Claude Code in `-p` mode, so its own runs reach the tracker today when hooks are installed. The dedupe variable below applies to Claude Code too (the tracker is not changed here; see 5).

### 3.2 Codex CLI

- Sources: https://developers.openai.com/codex/hooks (redirects to https://learn.chatgpt.com/docs/hooks); https://codex.danielvaughan.com/2026/05/25/codex-cli-hooks-after-ga-event-model-trust-verification-production-patterns/ (third party); local `codex --help`, `codex features list` (feature `hooks` is `stable`, enabled; `plugin_hooks` removed), local `~/.codex/hooks.json` (currently `{"hooks": {}}`), local `~/.codex/config.toml` (has a `notify = [...]` entry, see below).
- Config (doc): `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`. JSON shape: `{"hooks": {"<Event>": [{"matcher": "...", "hooks": [{"type":"command","command":"...","timeout":30,"statusMessage":"..."}]}]}}`. Other handler keys: `async`, `commandWindows`/`command_windows`, `additionalContextLimit`. TOML equivalent: `[[hooks.<Event>]]` + `[[hooks.<Event>.hooks]]`. Disable all: `[features] hooks = false` (alias `codex_hooks`).
- Events (doc): SessionStart, SessionEnd, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, SubagentStart, SubagentStop, Stop, Interrupt.
- Payload (doc): common `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model` (+ `permission_mode` on several); `turn_id` on turn events; SessionStart `source`; SessionEnd `reason`; Pre/PostToolUse `tool_name`, `tool_use_id`, `tool_input`, `tool_response`; UserPromptSubmit `prompt`; Stop `last_assistant_message`, `stop_hook_active`; SubagentStart/Stop `agent_id`, `agent_type`.
- Trust gate (doc): a non-managed hook must be reviewed with `/hooks` before it runs; a changed hook is skipped until re-trusted; project hooks need a trusted `.codex/` layer. `--dangerously-bypass-hook-trust` skips the check for one invocation. This is the biggest practical obstacle: an installer cannot silently activate a hook; the user must trust it once (inferred: the trust record is keyed on the hook hash, so editing the command re-prompts).
- Failure (doc): exit 2 blocks where blocking exists; other non-zero is logged and skipped; default timeout 600 s, SessionEnd/Interrupt 1 s (max 3). Always set a short `timeout` (2) and `async: true` on non-decision events.
- Windows: no general statement in the docs; `commandWindows` override exists (doc). Known issue: a GitHub report that user SessionStart hooks show in the Codex Desktop Hooks UI but never execute (https://github.com/openai/codex/issues/35863; Desktop app, Windows not confirmed).
- Legacy `notify` (local + inferred): `~/.codex/config.toml` already has a top-level `notify = ["...codex-computer-use.exe", "turn-ended"]` (written by a bundled plugin). `notify` takes exactly one argv command and receives a JSON argument at the end of each turn (my knowledge of the legacy feature: type `agent-turn-complete`, thread id, cwd, last assistant message; inferred, not re-verified, and the current docs page does not mention it). Do NOT replace it; hooks.json is the right route.
- Headless: `codex exec` and hooks - not stated in any source I found. Unverified. Inferred: exec loads the same config layers, so hooks fire if trusted; with an untrusted hook exec would skip it silently (or need `--dangerously-bypass-hook-trust`).

Snippet (`~/.codex/hooks.json`, merge into the existing `hooks` object):

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "node \"D:/work/Claude-Office/hooks/cli-tracker.mjs\" --cli codex", "timeout": 2, "async": true }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"D:/work/Claude-Office/hooks/cli-tracker.mjs\" --cli codex", "timeout": 2, "async": true }] }],
    "PreToolUse":       [{ "hooks": [{ "type": "command", "command": "node \"D:/work/Claude-Office/hooks/cli-tracker.mjs\" --cli codex", "timeout": 2, "async": true }] }],
    "PostToolUse":      [{ "hooks": [{ "type": "command", "command": "node \"D:/work/Claude-Office/hooks/cli-tracker.mjs\" --cli codex", "timeout": 2, "async": true }] }],
    "PermissionRequest":[{ "hooks": [{ "type": "command", "command": "node \"D:/work/Claude-Office/hooks/cli-tracker.mjs\" --cli codex", "timeout": 2, "async": true }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node \"D:/work/Claude-Office/hooks/cli-tracker.mjs\" --cli codex", "timeout": 2, "async": true }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node \"D:/work/Claude-Office/hooks/cli-tracker.mjs\" --cli codex", "timeout": 2, "async": true }] }]
  }
}
```

(`commandWindows` can hold the same command with backslash paths if forward slashes fail; unverified. Adding SubagentStart/SubagentStop is optional.) The user then has to run `/hooks` once to trust the entries.

### 3.3 Antigravity CLI (agy)

- Sources: official https://antigravity.google/docs/hooks?tab=cli (read); https://docs.claude-mem.ai/antigravity-cli/setup (third party, working installer); https://pushary.com/docs/agents/guides/antigravity-cli (third party); local `~/.gemini/config/hooks.json` (exists; holds another tool's hook, proving the format works on this machine), local `~/.gemini/antigravity-cli/cli.log` line `hooks_manager.go:53 loaded 1 named hooks from 1 hooks.json file(s)`, and strings in the agy binary (`PreInvocation`, `PostInvocation`, `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `.agents/hooks.json` all appear; `SessionEnd` count is probably a different subsystem, see unknowns).
- Config (doc): global `~/.gemini/config/hooks.json` (also inside `~/.gemini/antigravity-cli/settings.json`), workspace `<root>/.agents/hooks.json`, plugin `hooks.json`. Top level maps a hook NAME to events (so the office must own one name, e.g. `claude-office`). `enabled` (default true) per name. Handler: `type` (only "command"), `command`, `timeout` in seconds (default 30). `PreToolUse`/`PostToolUse` use the grouped shape `{matcher, hooks:[...]}`; `SessionStart`, `PreInvocation`, `PostInvocation`, `Stop` use a flat handler list (matcher ignored). `/hooks` in the TUI lists what was loaded; hooks load at session start.
- Events (doc): SessionStart, PreToolUse, PostToolUse, PreInvocation, PostInvocation, Stop. No UserPromptSubmit, no SessionEnd, no permission, no subagent, no notification hook.
- Payload (doc, camelCase): `conversationId`, `workspacePaths`, `transcriptPath`, `artifactDirectoryPath`, `modelName` on all; PreToolUse `toolCall{name,args}`, `stepIdx`; PostToolUse also `error`; Pre/PostInvocation `invocationNum`, `initialNumSteps`; Stop `executionNum`, `terminationReason`, `error`, `fullyIdle`. No `cwd`: take `workspacePaths[0]`. No prompt text; it can only be recovered by reading `transcriptPath` (jsonl; format not documented, inferred feasible, the claude-mem doc says PostInvocation reads a `PLANNER_RESPONSE` node from the transcript).
- Output contract matters: PreToolUse REQUIRES a stdout JSON with `decision` (doc). A silent tracker must print `{"decision":"allow"}` for PreToolUse (claude-mem does exactly this) or the call may be treated as undecided. Stop must not print `decision:"continue"`. PostToolUse expects `{}`. So this one CLI cannot be "totally silent": print `{"decision":"allow"}` / `{}`.
- Windows: not documented. Local evidence: another tool's working entry is a bare `C:\...\tool.exe args` string; so a `node "C:/path/cli-tracker.mjs" --cli agy` string should work (inferred).
- Failure/exit codes/trust: not documented. A Chinese-language article claims `~/.gemini/trusted_hooks.json` gates external commands (https://ithelp.ithome.com.tw/articles/10408349; unconfirmed; the local `~/.gemini` has `trustedFolders.json` but no `trusted_hooks.json`, and another local hook is loaded without one).
- Forum reports of hooks not firing concern the IDE, not the CLI (https://discuss.ai.google.dev/t/stop-and-posttooluse-hooks-in-agents-hooks-json-never-fire-antigravity-ide-1-107-0-windows/178288).
- Headless (`agy -p`): not documented; unverified.

Snippet (`~/.gemini/config/hooks.json`; add a second top-level name next to any existing entry, never edit that one):

```json
{
  "claude-office": {
    "SessionStart":   [{ "type": "command", "command": "node \"D:/work/Claude-Office/hooks/cli-tracker.mjs\" --cli agy", "timeout": 2 }],
    "PreToolUse":     [{ "matcher": "", "hooks": [{ "type": "command", "command": "node \"D:/work/Claude-Office/hooks/cli-tracker.mjs\" --cli agy", "timeout": 2 }] }],
    "PostToolUse":    [{ "matcher": "", "hooks": [{ "type": "command", "command": "node \"D:/work/Claude-Office/hooks/cli-tracker.mjs\" --cli agy", "timeout": 2 }] }],
    "PostInvocation": [{ "type": "command", "command": "node \"D:/work/Claude-Office/hooks/cli-tracker.mjs\" --cli agy", "timeout": 2 }],
    "Stop":           [{ "type": "command", "command": "node \"D:/work/Claude-Office/hooks/cli-tracker.mjs\" --cli agy", "timeout": 2 }]
  }
}
```

### 3.4 OpenCode

- Sources: https://opencode.ai/docs/plugins/ and https://opencode.ai/docs/config/ (read); local `~/.config/opencode/` (exists with `opencode.json`, `node_modules`; this is the global config dir on this Windows machine), `opencode --help`, `opencode run --help`.
- Mechanism (doc): there is no command-hook setting. A plugin is a JS/TS module in `~/.config/opencode/plugins/` (global) or `.opencode/plugins/` (project), or an npm name in the `plugin` array of `opencode.json`. It exports an async function receiving `{ project, directory, worktree, client, $ }` and returns hook handlers. Load order: global config, project config, global plugins dir, project plugins dir; all run in sequence. Plugins run in-process under Bun.
- Events (doc): `session.created/updated/deleted/idle/error/status/compacted/diff`, `message.updated/part.updated/removed`, `permission.asked/replied`, `tool.execute.before/after`, `command.executed`, `file.edited`, `server.connected`, `shell.env`, `tui.*`, etc. Handlers: a generic `event({ event })` plus named hooks `tool.execute.before/after`.
- Payload: the docs page shows no field list. Inferred from the SDK shape: `event.type` + `event.properties` (e.g. `session.idle` has `properties.sessionID`; `session.created` has `properties.info{id, parentID, title, directory}`; `message.updated` has `properties.info{role, sessionID, modelID, providerID}`); `tool.execute.before(input{tool, sessionID, callID}, output{args})`. These must be verified with a probe plugin that logs `JSON.stringify(event)` once.
- Windows: path `~/.config/opencode` is confirmed local. Plugin code is JS so no shell quoting issue; the plugin shells out to `node` itself.
- Failure: not documented. Because the plugin runs inside the OpenCode process, wrap every handler in try/catch and never await the network call (fire-and-forget); a throw at plugin load could break startup (inferred, unverified).
- Headless: `opencode run` spawns a local server in-process and uses the same config, so plugins load there too (inferred). `--pure` (doc, `--help`) runs without external plugins, which is a possible opt-out. Also unverified.
- Alternative without a plugin: `opencode serve` / `opencode attach` expose an HTTP server with an SSE event stream (`GET /event`), but only for a server the office itself started; a plain TUI session opened by a person has no discoverable port unless `--port` is set (the TUI starts a server on a random port; discovery unverified). Not recommended.

Snippet (`~/.config/opencode/plugins/claude-office.js`, a thin shim that pipes normalised JSON to the same Node tracker):

```js
import { spawn } from "node:child_process"
const TRACKER = "D:/work/Claude-Office/hooks/cli-tracker.mjs"
const send = (payload) => {
  try {
    const p = spawn(process.execPath.includes("bun") ? "node" : process.execPath, [TRACKER, "--cli", "opencode"],
      { stdio: ["pipe", "ignore", "ignore"], windowsHide: true, detached: true })
    p.on("error", () => {})
    p.stdin.on("error", () => {})
    p.stdin.end(JSON.stringify(payload)); p.unref()
  } catch {}
}
export const ClaudeOffice = async ({ directory, worktree }) => ({
  event: async ({ event }) => { send({ hook_event_name: event.type, cwd: directory, worktree, properties: event.properties }) },
  "tool.execute.before": async (input) => { send({ hook_event_name: "tool.execute.before", cwd: directory, tool: input.tool, sessionID: input.sessionID, callID: input.callID }) },
  "tool.execute.after":  async (input) => { send({ hook_event_name: "tool.execute.after",  cwd: directory, tool: input.tool, sessionID: input.sessionID, callID: input.callID }) },
})
```

(Never forward `output.args` or message text bodies wholesale; the shim sends only ids and tool names, the tracker takes the prompt text from `message.part.updated` only if the owner opts in.)

### 3.5 Qoder (qodercli)

- Sources: https://docs.qoder.com/cli/hooks (read; the `/en/` and `.md` variants returned 404/other); local `~/.qoder/settings.json` (top-level keys: permissions, security, model, enabledPlugins, mcp; no `hooks` key yet), `qodercli --help`.
- Config (doc): hooks merged from `~/.qoder/settings.json` (user), `<project>/.qoder/settings.json`, `<project>/.qoder/settings.local.json`. Same shape as Claude Code: `{"hooks": {"<Event>": [{"matcher": "...", "hooks": [{"type":"command","command":"...","timeout":600}]}]}}`. Handler keys: `command`, `args` (exec form, no shell), `shell` (`bash`|`powershell`), `env`, `timeout`, `async`, `if`, `once`. Handler types: command, http, prompt, agent. `--config-dir <dir>` moves the user-level root.
- Events (doc, 23): SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied, Stop, StopFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, Notification, InstructionsLoaded, ConfigChange, CwdChanged, FileChanged, WorktreeCreate, WorktreeRemove, Elicitation, ElicitationResult.
- Payload (doc): `session_id`, `transcript_path`, `cwd`, `hook_event_name`, optional `permission_mode`, `agent_id`, `agent_type`; SessionStart `source`, `model`; UserPromptSubmit `prompt`; Pre/PostToolUse `tool_name`, `tool_input`, `tool_use_id`; Stop `last_assistant_message`; Notification `notification_type`, `message`. Env: `QODER_PROJECT_DIR`.
- Windows (doc): `"shell": "powershell"`; exec form cannot run `.bat/.cmd` directly. Exec form `{"command":"node","args":[".../cli-tracker.mjs","--cli","qoder"]}` avoids quoting problems (inferred to work, since `node.exe` is a real exe).
- Failure (doc): exit 0 ok; exit 2 blocks on blocking events; any other code is a non-blocking error (stdout ignored, stderr to diagnostic log). Default timeout 600 s, so set `timeout` 2 and `async: true`.
- Headless (`qodercli -p`): the page does not cover print mode. Unverified. Note from `docs/adapter-contract.md`: Qoder can hang after hitting a limit, so a hook must not wait on anything.

Snippet (`~/.qoder/settings.json`, add a `hooks` key):

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "node", "args": ["D:/work/Claude-Office/hooks/cli-tracker.mjs", "--cli", "qoder"], "timeout": 2, "async": true }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node", "args": ["D:/work/Claude-Office/hooks/cli-tracker.mjs", "--cli", "qoder"], "timeout": 2 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node", "args": ["D:/work/Claude-Office/hooks/cli-tracker.mjs", "--cli", "qoder"], "timeout": 2, "async": true }] }],
    "PreToolUse":       [{ "hooks": [{ "type": "command", "command": "node", "args": ["D:/work/Claude-Office/hooks/cli-tracker.mjs", "--cli", "qoder"], "timeout": 2, "async": true }] }],
    "PostToolUse":      [{ "hooks": [{ "type": "command", "command": "node", "args": ["D:/work/Claude-Office/hooks/cli-tracker.mjs", "--cli", "qoder"], "timeout": 2, "async": true }] }],
    "PermissionRequest":[{ "hooks": [{ "type": "command", "command": "node", "args": ["D:/work/Claude-Office/hooks/cli-tracker.mjs", "--cli", "qoder"], "timeout": 2, "async": true }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node", "args": ["D:/work/Claude-Office/hooks/cli-tracker.mjs", "--cli", "qoder"], "timeout": 2, "async": true }] }]
  }
}
```

## 4. Mapping to POST /event

Existing types and fields: see `server/index.js` lines 1815-1859 (doc block) and `KNOWN_EVENT_TYPES`. Every event carries `sessionId`, `project` (basename of cwd), `cwd`, `transcriptPath`. The server whitelists and clamps known fields; an unknown field such as `cli` rides through `...body` unclamped (inferred from the spread at line 1871), so the proper change is a small server edit to clamp `cli` (out of scope here; listed under proposals).

| Office event | Claude Code | Codex | agy | OpenCode | Qoder |
| --- | --- | --- | --- | --- | --- |
| `session_started` {sessionId, project, cwd, source, model} | SessionStart | SessionStart | SessionStart (no source; use `"startup"`) | `session.created` (skip when `parentID` is set) | SessionStart |
| `session_ended` {sessionId, reason} | SessionEnd | SessionEnd | cannot map (no event); use `Stop` with `fullyIdle:true` as `session_turn_end` and let the server time the session out | cannot map (`session.deleted` only on delete) | SessionEnd |
| `session_prompt` {text} | UserPromptSubmit | UserPromptSubmit | cannot map (no prompt text) | `message.updated` role user (inferred) | UserPromptSubmit |
| `session_turn_end` {text} | Stop | Stop | Stop (no reply text; `terminationReason` as detail) | `session.idle` | Stop |
| `agent_working` {status} | PreToolUse | PreToolUse | PreToolUse (`toolCall.name`) | `tool.execute.before` | PreToolUse |
| `session_tool_done` {toolName} | PostToolUse | PostToolUse | PostToolUse | `tool.execute.after` | PostToolUse |
| `session_needs_you` kind `permission` | PermissionRequest | PermissionRequest | cannot map | `permission.asked` | PermissionRequest / Notification |
| `session_error` | StopFailure | none | `Stop` with `error` | `session.error` | StopFailure / PostToolUseFailure |
| `agent_spawned`/`agent_started`/`agent_completed` (subagents) | SubagentStart/Stop | SubagentStart/Stop | cannot map as events; `invoke_subagent` visible in PreToolUse | `session.created` with `parentID` (inferred) | SubagentStart/Stop |
| `session_cwd`, `session_model`, `session_compact` | yes | PreCompact/PostCompact only; model arrives on every payload | no | `session.compacted`; model from message info | CwdChanged, PreCompact/PostCompact |

Minimum viable set for "show a terminal session in the office": `session_started`, `session_prompt` (where available), `agent_working`, `session_tool_done`, `session_turn_end`, `session_ended`. Everything else is optional polish.

What cannot be mapped (summary): agy has no prompt text, no session end, no permission, no subagent events; OpenCode has no session-exit event and no documented payload; Codex has no Notification/StopFailure; the office's "answer the permission from the office" feature (`/permission/<id>` long poll) is Claude-Code-only and must stay off for the other four (tracker never waits, never prints a decision, except the agy `{"decision":"allow"}` placeholder).

## 5. Headless runs: duplicates and how to avoid them

The office starts the CLIs in `server/adapters.mjs` with `spawn(bin, argv, { ..., env: { ...process.env, ...adapter.env?.({mode}), ...env } })` (line 535), and `runAdapter` already accepts an `env` option. Whether each CLI's headless mode fires the hooks is documented only for Claude Code (yes). For Codex, agy, OpenCode and Qoder it is not documented (see unknowns); assume yes until a run proves otherwise.

Proposed dedupe (a one-line server change, not made here): in `runAdapter`'s spawn env add `AGENT_OFFICE_RUN: '1'` (and optionally `AGENT_OFFICE_RUN_ID=<job id>`). Hooks are child processes of the CLI and inherit its environment (Claude Code doc: hooks inherit the parent environment except `OTEL_*`; for the others inferred), so `hooks/cli-tracker.mjs` starts with `if (process.env.AGENT_OFFICE_RUN) process.exit(0)`. The OpenCode plugin runs in-process: it checks `process.env.AGENT_OFFICE_RUN` at load and returns `{}`. The same one-line guard should be added to `hooks/agent-tracker.sh` (it would then also stop double counting of the office's own Claude Code runs, which today are tracked both by the adapter and by the hook; I did not check how the server de-duplicates them today). Caveat: Codex's sandbox and Qoder's `env` handling might strip unknown variables (unverified); the test plan checks this.

Alternative if the variable is stripped: the tracker compares the payload `cwd`/`session_id` with sessions the office started itself (the server knows its own run ids), done server-side via a new `cli` + `sessionId` match. More code; use only as a fallback.

## 6. Proposed design: `hooks/cli-tracker.mjs` (one cross-platform Node script)

- Invocation: `node hooks/cli-tracker.mjs --cli <claude|codex|agy|opencode|qoder>`; payload JSON on stdin (OpenCode shim sends a simplified object); it never reads argv for payload.
- Steps: (1) exit 0 at once if `AGENT_OFFICE_RUN` is set; (2) read stdin with a 1 s cap and 256 KB limit, parse inside try/catch; (3) a per-CLI normaliser table maps `hook_event_name` (or agy's inferred event) and fields to one of the office events in section 4, always adding `cli` (`"codex"` etc.); (4) POST to `AGENT_OFFICE_EVENT_URL` or `http://127.0.0.1:${AGENT_OFFICE_PORT||3334}/event` with `Content-Type: application/json`, signed like agent-tracker.sh (HMAC-SHA256 of `method\npath\ntimestamp\nbody` with the token read from `${AGENT_OFFICE_HOME||~/.agent-office}/auth-token`, headers `X-Office-Timestamp`, `X-Office-Signature`); Node `crypto` and global `fetch` need no dependencies; (5) `AbortSignal.timeout(2000)` on the request and a `setTimeout(...).unref()` hard exit at 2 s; (6) `process.exit(0)` in every path, including uncaught exceptions (`process.on('uncaughtException', () => process.exit(0))`).
- Silence: writes nothing to stdout/stderr, except the agy PreToolUse (`{"decision":"allow"}`), agy PostToolUse (`{}`) and agy Stop (`{}`) placeholders required by its output contract. A debug file (`$AGENT_OFFICE_HOME/cli-tracker.log`) is off unless `AGENT_OFFICE_HOOK_DEBUG=1`.
- No secrets: the token is never put in argv, logs or the event; tool input/response bodies are NOT forwarded (only `tool_name` plus a short label: the command's first word or the file basename, clamped); prompt and reply text go only in `session_prompt`/`session_turn_end` (as Claude Code's tracker does), clamped by the server; env values are never read except the three AGENT_OFFICE_* names and the token file.
- Project/session derivation: `sessionId` = `${cli}:${session_id|conversationId|sessionID}` (prefixing prevents collisions with Claude ids); `cwd` = `cwd` | `workspacePaths[0]` | plugin `directory`; `project` = basename of cwd.
- Server side (small, proposed): add `cli: clampString(body.cli, 20)` to the sanitiser and show it in the session pill; nothing else changes because the events reuse existing types.
- Do not change `hooks/agent-tracker.sh`; Claude Code stays on the bash tracker (it has permission answering, signals, background tasks).

## 7. Installer proposal: `scripts/install-cli-hooks.mjs`

(New file only; `scripts/*.sh`/`*.py` untouched.) Usage: `node scripts/install-cli-hooks.mjs [--cli codex,agy,opencode,qoder|all] [--dry-run] [--uninstall]`.

- Per CLI: resolve the target file (`~/.codex/hooks.json`; `~/.gemini/config/hooks.json`; `~/.config/opencode/plugins/claude-office.js`; `~/.qoder/settings.json`; honour `CODEX_HOME`, `--config-dir`/`QODER_*` style overrides only if documented), skip if the CLI is not installed (target dir missing) and say so.
- Safety: refuse a file that is not valid JSON (print line/col, change nothing); write a backup `<file>.bak-claude-office-<timestamp>` before the first change; write through a temp file + rename; never print file contents (config files may hold keys, e.g. `~/.qoder/settings.json`, `~/.gemini/settings.json`, `~/.codex/config.toml` - the installer reads only JSON targets it must merge and never logs values).
- Idempotent merge: an entry is "ours" when its command contains `hooks/cli-tracker.mjs`; install replaces ours in place (repoints a moved checkout) and leaves every other entry untouched; agy uses its own top-level name `claude-office`. Uninstall removes only ours (and deletes the OpenCode plugin file, and our agy name), and removes empty containers it created.
- `--dry-run` prints the unified change per file (paths and event names only) and writes nothing.
- Windows: paths are written with forward slashes inside the command; the Node binary is `node` on PATH, with `process.execPath` used if PATH has none (inferred acceptable). Codex: also prints "run /hooks in Codex once to trust the new hooks". Codex `config.toml` is never edited (TOML + existing `notify`), `hooks.json` is used.
- Exit code 0 on success, 1 on a refused file; summary line per CLI: installed / already installed / not installed / skipped.

## 8. Test plan

Unit (Vitest style, like `tests/hook-script.test.ts`): feed verbatim captured payloads for each CLI (fixtures under `tests/fixtures/cli-hooks/`) into the normaliser and assert the event JSON; assert `cli` field, `sessionId` prefix, no tool_input/response text in output, no token anywhere in output; assert exit code 0 for garbage stdin, empty stdin, 10 MB stdin, closed server port, a server that never answers (must exit within ~2.2 s), and with `AGENT_OFFICE_RUN=1` (no request made). Signature test: the header matches what `server/office-auth.mjs` verifies.
Installer tests (temp HOME): fresh install, re-install is a no-op (byte-identical), moved checkout is repointed, foreign hooks (an existing foreign entry in agy, the `notify` in Codex config) untouched, `--dry-run` writes nothing, `--uninstall` restores the original semantic content, invalid JSON refused with backup untouched.
Adapter: a test that `runAdapter` env contains `AGENT_OFFICE_RUN=1` (extend `tests/adapter-contract.test.ts` fixture).
Manual verification matrix (needed because most behaviours are unverified; each needs one short real session by the owner, and a throwaway probe hook that dumps the raw stdin JSON to a temp file first): per CLI, (a) interactive session shows start, prompt, tool, turn end, exit in the office; (b) headless run (`codex exec`, `agy -p`, `opencode run`, `qodercli -p`) with and without `AGENT_OFFICE_RUN`; (c) a hook that sleeps 30 s and a hook that exits 1 do not stall or crash the CLI; (d) Windows paths with spaces; (e) Codex untrusted-hook behaviour in `exec`; (f) the office stopped: CLI unaffected.

## 9. Unknown or not verified

- No hook was executed on this machine (no AI service calls allowed). Everything about runtime behaviour is from docs or inference.
- Codex: whether `codex exec` fires hooks (and whether an untrusted hook is skipped silently there); whether hooks run on Windows desktop/CLI (open GitHub issue 35863 suggests a failure in the Desktop app); how trust is recorded and whether an installer can pre-trust; the exact `notify` payload today (not in the current docs); whether `commandWindows` is needed for forward-slash paths.
- agy: stdin schema is documented only by field names (no captured sample); exit-code and timeout-failure semantics, Windows shell, trust requirement (`trusted_hooks.json` claim unconfirmed), and headless (`-p`) behaviour are all undocumented; `SessionEnd` appears in the binary strings (87 `SessionStart`, 22 `SessionEnd`) but not in the official event list, so a SessionEnd hook might exist in an undocumented form (not tried); conflicting third-party statements about the location (`~/.gemini/settings.json` is NOT read by agy per claude-mem; official docs say `~/.gemini/config/hooks.json`, which also matches another working local install); the PostInvocation timing is described inconsistently between doc pages.
- OpenCode: no documented event payload shapes, no failure semantics for plugins, no Windows notes, whether `opencode run` loads plugins (inferred yes; `--pure` disables external plugins), whether sub-sessions are marked by `parentID`, whether a plugin can detect process exit, how to get the user prompt text reliably. Not checked: the `plugin` entries already present in `~/.config/opencode/opencode.json` (the file may hold provider keys, so it was deliberately not read).
- Qoder: print-mode behaviour, hook failure while the CLI hangs after quota errors, whether `args` exec form works for `node` on Windows (documented as available; not run), and whether hooks inherit the parent environment (needed for `AGENT_OFFICE_RUN`). The docs page lists `QODER_PROJECT_DIR` only. No page on the exact stdin for SessionEnd was read beyond the table.
- Claude Code: SessionEnd payload fields past `reason` were not read (the doc page was truncated in my fetch); the repository tracker already handles it.
- The `AGENT_OFFICE_RUN` inheritance is inferred for Codex, agy, OpenCode and Qoder; Codex sandboxing may filter the environment.
- Not checked: how the server currently de-duplicates the office's own Claude Code runs against the tracker hook; whether `sessions` expire a session that never receives `session_ended` (needed for agy/OpenCode, where only a timeout can end it).
- Version drift: all docs were read 2026-10-22 against CLI versions above; the agy docs have two tabs (app/CLI/IDE) with differences, and I used the CLI tab.

## 10. Sources

- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Codex hooks: https://developers.openai.com/codex/hooks (-> https://learn.chatgpt.com/docs/hooks); https://codex.danielvaughan.com/2026/05/25/codex-cli-hooks-after-ga-event-model-trust-verification-production-patterns/; https://github.com/openai/codex/issues/35863
- Antigravity hooks: https://antigravity.google/docs/hooks?tab=cli ; https://docs.claude-mem.ai/antigravity-cli/setup ; https://pushary.com/docs/agents/guides/antigravity-cli ; https://discuss.ai.google.dev/t/stop-and-posttooluse-hooks-in-agents-hooks-json-never-fire-antigravity-ide-1-107-0-windows/178288
- OpenCode: https://opencode.ai/docs/plugins/ ; https://opencode.ai/docs/config/
- Qoder: https://docs.qoder.com/cli/hooks
- Local: `hooks/hooks.json`, `hooks/agent-tracker.sh`, `hooks/install-hooks.sh`, `docs/adapter-contract.md`, `server/index.js` (1496-1507, 1815-1988), `server/adapters.mjs` (480-535), `~/.codex/hooks.json`, `~/.codex/config.toml` (section names only), `~/.gemini/config/hooks.json`, `~/.gemini/antigravity-cli/cli.log`, `~/.qoder/settings.json` (key names only), `~/.config/opencode/` (listing only), `--help` of each CLI.
