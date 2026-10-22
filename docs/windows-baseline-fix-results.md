# Windows upstream baseline results

Worktree: `D:\work\_wt-pr24`, branch `pr/24-windows-baseline`.
Windows, `core.autocrlf=true`; Git for Windows `bin` and `usr/bin`, and Python 3.13 on process PATH. The initial six target files were measured serially before edits with `npx vitest run tests/<file>.test.ts --maxWorkers=1 --testTimeout=15000` (JSON reporter added for evidence).

## Final result

43 files passed; 963 tests passed, 16 skipped, 0 failed; zero unhandled errors; exit code 0. See the final table for all before/after counts.

## Initial targeted measurements

### tests/install-hooks.test.ts

30 passed, 19 failed, 0 skipped.

- install-hooks.sh repoints every entry that names a checkout that moved, keeps foreign hooks where they were and adds nothing twice
  - First error: `AssertionError: expected '\n\u001b[0;36m╔══════════════════════…' to contain '[skip] PreToolUse already registered'`
- install-hooks.sh leaves an entry that already points at this checkout alone, however it was quoted
  - First error: `AssertionError: expected [ { matcher: '', …(1) }, …(1) ] to deeply equal [ Array(1) ]`
- install-hooks.sh is a no-op on a second run
  - First error: `AssertionError: expected '\n\u001b[0;36m╔══════════════════════…' to contain '[skip] PreToolUse already registered'`
- install-hooks.sh: status line (payroll / electricity / memory) wraps a status line that was already there: saves its command for chaining, keeps its padding/refreshInterval, says so
  - First error: `AssertionError: expected '~/.claude/statusline.sh\r\n' to be '~/.claude/statusline.sh\n' // Object.is equality`
- install-hooks.sh: status line (payroll / electricity / memory) repoints the office status line from a checkout that moved, keeping its options and chained command, and leaves it alone on a second run
  - First error: `AssertionError: expected '\n\u001b[0;36m╔══════════════════════…' to contain '[skip] statusLine already registered'`
- install-hooks.sh: status line (payroll / electricity / memory) recognises the office status line by path, not by spelling: an unquoted command for this checkout is left alone
  - First error: `AssertionError: expected { type: 'command', …(2) } to deeply equal { type: 'command', …(2) }`
- install-hooks.sh --uninstall after an install on a fresh HOME, removes all 19 events and both status lines and leaves {}
  - First error: `AssertionError: expected '{}\r\n' to be '{}\n' // Object.is equality`
- install-hooks.sh --uninstall install then uninstall gives a file with unrelated settings back byte for byte
  - First error: `AssertionError: expected '{\r\n  "permissions": {\r\n    "allow…' to be '{\n  "permissions": {\n    "allow": […' // Object.is equality`
- install-hooks.sh --uninstall puts back a status line the install wrapped (command, padding, refreshInterval) and keeps foreign hooks where they were, byte for byte
  - First error: `AssertionError: expected '{\r\n  "hooks": {\r\n    "PreToolUse"…' to be '{\n  "hooks": {\n    "PreToolUse": [\…' // Object.is equality`
- install-hooks.sh: a settings file that is not valid JSON is refused, never replaced a plain install prints the parse error with its line and column, exits 1, and leaves the file byte for byte with no backup
  - First error: `AssertionError: expected '\u001b[0;31m[error]\u001b[0m /tmp/age…' to contain 'C:\Users\iulia\AppData\Local\Temp\age…'`
- install-hooks.sh: a settings file that is not valid JSON is refused, never replaced --no-status-line prints the parse error with its line and column, exits 1, and leaves the file byte for byte with no backup
  - First error: `AssertionError: expected '\u001b[0;31m[error]\u001b[0m /tmp/age…' to contain 'C:\Users\iulia\AppData\Local\Temp\age…'`
- install-hooks.sh: a settings file that is not valid JSON is refused, never replaced --status-line-only prints the parse error with its line and column, exits 1, and leaves the file byte for byte with no backup
  - First error: `AssertionError: expected '\u001b[0;31m[error]\u001b[0m /tmp/age…' to contain 'C:\Users\iulia\AppData\Local\Temp\age…'`
- install-hooks.sh: a settings file that is not valid JSON is refused, never replaced --uninstall prints the parse error with its line and column, exits 1, and leaves the file byte for byte with no backup
  - First error: `AssertionError: expected '\u001b[0;31m[error]\u001b[0m /tmp/age…' to contain 'C:\Users\iulia\AppData\Local\Temp\age…'`
- install-hooks.sh: only hooks/agent-tracker.sh and hooks/status-line.sh are the office's a status line of your own whose command only contains the name (bash ~/.claude/my-status-line.sh) is chained, not replaced, and put back on uninstall
  - First error: `AssertionError: expected 'bash ~/.claude/my-status-line.sh\r\n' to be 'bash ~/.claude/my-status-line.sh\n' // Object.is equality`
- install-hooks.sh: only hooks/agent-tracker.sh and hooks/status-line.sh are the office's a status line of your own whose command only contains the name (~/.claude/status-line.sh) is chained, not replaced, and put back on uninstall
  - First error: `AssertionError: expected '~/.claude/status-line.sh\r\n' to be '~/.claude/status-line.sh\n' // Object.is equality`
- install-hooks.sh: only hooks/agent-tracker.sh and hooks/status-line.sh are the office's a status line of your own whose command only contains the name (bash /home/me/bin/status-line.sh --compact) is chained, not replaced, and put back on uninstall
  - First error: `AssertionError: expected 'bash /home/me/bin/status-line.sh --co…' to be 'bash /home/me/bin/status-line.sh --co…' // Object.is equality`
- install-hooks.sh: CLAUDE_CONFIG_DIR install and --uninstall both use $CLAUDE_CONFIG_DIR/settings.json, the file Claude Code reads, and never create ~/.claude
  - First error: `AssertionError: expected '\n\u001b[0;36m╔══════════════════════…' to contain 'C:\Users\iulia\AppData\Local\Temp\age…'`
- install-hooks.sh: backups runs in the same second each keep their own backup, and the first one still holds the original
  - First error: `AssertionError: expected [ …(3) ] to deeply equal [ …(3) ]`
- install-hooks.sh: backups never overwrites a backup that is already there under the name it would pick
  - First error: `AssertionError: expected '\n\u001b[0;36m╔══════════════════════…' to contain 'settings.json.backup.20261015_120000.1'`

### tests/sessions-registry.test.ts

32 passed, 1 failed, 1 skipped.

- a permission dialog answered or dismissed in the terminal (the registry leaves "waiting") a leftover file whose pid now belongs to another process is not a session (the reused pid check, in the office)
  - First error: `AssertionError: expected false to be true // Object.is equality`

### tests/turn-events.test.ts

51 passed, 0 failed, 0 skipped.


### tests/hardening.test.ts

35 passed, 3 failed, 0 skipped.

- start() and the token file (C09) writes the token (0600) only once the port is bound
  - First error: `AssertionError: expected 438 to be 384 // Object.is equality`
- chat.db and the runtime dir are private, and repaired on an upgrade (findings 29/32) chat.db, its -wal/-shm and the dir are tightened even when an older build left them world-readable
  - First error: `Error: EPERM, Permission denied: \\?\C:\Users\iulia\AppData\Local\Temp\agent-office-modes-QEholr '\\?\C:\Users\iulia\AppData\Local\Temp\agent-office-modes-QEholr'`
- runtime files are private (C17) inbox, last-chat, agents.json and the chat-monitor state are 0600, the inbox dir 0700
  - First error: `AssertionError: expected 438 to be 420 // Object.is equality`

### tests/scripts.test.ts

10 passed, 11 failed, 0 skipped.

- chat-ai-watcher.sh answers a message a person typed exactly once, as the routed persona, with a cheap model and hooks/MCP off
  - First error: `Error: timed out waiting for the Debugger reply`
- chat-ai-watcher.sh ignores the server's starting:/done: announcements and directed agent-to-agent messages
  - First error: `AssertionError: expected [] to have a length of 1 but got +0`
- chat-ai-watcher.sh never sees the Boss prompt and Claude reply rows the main-thread events persist: GET /chat hides them without the token, and their roles are boss/assistant anyway
  - First error: `AssertionError: expected [] to have a length of 1 but got +0`
- chat-ai-watcher.sh ignores slash commands and system lines
  - First error: `AssertionError: expected [] to have a length of 1 but got +0`
- chat-ai-watcher.sh answers the next human message, then stops at the per-minute reply cap
  - First error: `AssertionError: expected [ [ '-p', …(12) ] ] to have a length of 2 but got 1`
- chat-ai-watcher.sh lock clears a stale lock at startup, and an empty/failed `claude -p` neither posts nor leaves the lock behind
  - First error: `AssertionError: expected true to be false // Object.is equality`
- chat-ai-watcher.sh stopped mid-reply stop-office.sh takes the in-flight `claude -p` down with the watcher (GNU timeout keeps it in the group)
  - First error: `AssertionError: expected false to be true // Object.is equality`
- stop-office.sh stops only the processes named in the pid files and leaves clients and look-alikes alone
  - First error: `AssertionError: expected '\n\u001b[0;36m╔══════════════════════…' to contain 'Chat watcher stopped (pid 60716)'`
- stop-office.sh refuses a pid file that points at a process which is not an office process
  - First error: `AssertionError: expected '\n\u001b[0;36m╔══════════════════════…' to contain 'pid 43448 is not an office process'`
- start-office.sh runs on a Linux box without `open`, reports the URL instead, and tears the watcher down on Ctrl+C
  - First error: `Error: timed out waiting for the running banner`
- start-office.sh opens the office with its token through a redirect page (never the tokened link on a command line)
  - First error: `Error: STACK_TRACE_ERROR`

### tests/plugin.test.ts

19 passed, 21 failed, 0 skipped.

- hooks/hooks.json × agent-tracker.sh PreToolUse: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh PostToolUse: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh PostToolUseFailure: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh SubagentStart: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh SubagentStop: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh SessionStart: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh SessionEnd: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh UserPromptSubmit: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh Stop: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh PermissionRequest: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh Notification: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh StopFailure: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh PreCompact: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh PostCompact: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh PostToolBatch: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh CwdChanged: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh PostModelSwitch: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh TaskCreated: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh TaskCompleted: the tracker exits 0 and is either silent or well-formed
  - First error: `AssertionError: stderr: : expected null to be +0 // Object.is equality`
- hooks/hooks.json × agent-tracker.sh is silent for an event it will never handle, which is what makes registering events ahead of time safe
  - First error: `AssertionError: expected null to be +0 // Object.is equality`
- commands/office.md has frontmatter with a description, so /agent-office:office is listed
  - First error: `AssertionError: expected null not to be null`


## LF-only measurement

Scripts, Python files, test fixture templates and command frontmatter were rematerialized with LF; no product or assertion changes in this measurement.

| File | Failures before | Failures with LF only |
| --- | ---: | ---: |
| tests/install-hooks.test.ts | 19 | 19 |
| tests/sessions-registry.test.ts | 1 | 1 |
| tests/turn-events.test.ts | 0 | 0 |
| tests/hardening.test.ts | 3 | 3 |
| tests/scripts.test.ts | 11 | 6 |
| tests/plugin.test.ts | 21 | 20 |

## Additional files found by the first complete run

Each file below was rerun serially with `--maxWorkers=1 --testTimeout=15000` before changes to that test. These measurements follow the first targeted fixes.

### tests/doctor.test.ts

0 passed, 0 failed, 0 skipped.

- Collection error: `Invalid or unexpected token`

### tests/electron-helpers.test.ts

0 passed, 0 failed, 0 skipped.

- Collection error: `Invalid or unexpected token`

### tests/hook-script.test.ts

7 passed, 76 failed, 0 skipped.

- agent-tracker.sh: Agent tool PreToolUse Agent -> agent_spawned, with the role hinted from the task and background flag
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: Agent tool PreToolUse Agent with an explicit subagent_type keeps that role (Task alias too)
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: Agent tool PostToolUse Agent (background launch) -> agent_linked with the subagent id
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: Agent tool PostToolUse Agent (foreground) -> agent_completed with the result text
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: Agent tool truncates long results to 120 characters
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: inside a subagent PreToolUse Bash with agent_id -> agent_working tagged with the subagent
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: inside a subagent PreToolUse Read on the main thread -> agent_working without an agent id
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: inside a subagent SubagentStop -> agent_completed with the last assistant message
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: inside a subagent PostToolUseFailure with agent_id -> failed agent_working tagged with the subagent
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: inside a subagent nested PreToolUse Agent (a subagent spawning a subagent) -> agent_spawned with parentSubagentId
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: captured 2.1.300 payloads SubagentStart -> agent_started: agent_id is the new subagent, no parent is named
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: captured 2.1.300 payloads PreToolUse Agent (background) -> agent_spawned without parentSubagentId on the main thread
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: captured 2.1.300 payloads PostToolUse Agent (async_launched) -> agent_linked
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: captured 2.1.300 payloads PreToolUse Bash inside the subagent -> agent_working on that subagent
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: captured 2.1.300 payloads SubagentStop of a real worker -> agent_completed with the first 120 chars of its last message
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: captured 2.1.300 payloads phantom SubagentStop (compaction summariser, agent_type "") -> nothing
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: captured 2.1.300 payloads phantom SubagentStop (prompt-suggestion sidechain, agent_type "") -> nothing
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: captured 2.1.300 payloads PostToolUseFailure on the main thread (Bash exit 1) -> failed agent_working without an agent id
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: captured 2.1.300 payloads PostToolUseFailure of an MCP call -> mcp_done, of an Agent launch -> agent_completed
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: sessions SessionStart {source: startup} -> session_started (no model on a bare startup)
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: sessions SessionStart {source: startup, model} -> session_started with the model
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: sessions SessionStart {source: resume} (claude -r) -> session_started with the same session id; token fields are dropped
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: sessions SessionStart {source: compact, model} -> session_started with the model (the server treats it as an update)
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: sessions a named session (session_title) -> title; source defaults to startup
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: sessions SessionEnd {reason: other} (every -p exit) and {reason: prompt_input_exit} (/exit) -> session_ended
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: sessions SessionStart/SessionEnd without a session_id emit nothing
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: sessions every emitted event carries sessionId, project, cwd and transcriptPath
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: sessions project is the last path segment of cwd (trailing slash tolerated; "/" stays "/")
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: sessions payloads without session fields (older hooks, hand-made events) emit the old shapes unchanged
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: MCP tools PreToolUse mcp__github__get_me -> mcp_call
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: MCP tools PostToolUse mcp__github__get_me -> mcp_done with the tool and the callKey (the server lowers the hand that call raised); inside a worker with its agentId
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: MCP tools splits server and tool on the first "__" only
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: every tool call is activity PreToolUse of a tool without a specific status line -> a generic "using <tool>" working status, main thread or worker
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: every tool call is activity PostToolUse of an ordinary tool -> session_tool_done {toolName, callKey} (lowers the permission hand that very call raised); inside a worker with its agentId; without a session, nothing
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: every tool call is activity callKey: the PermissionRequest and the PostToolUse of one call carry the same key; another call of that tool (git status beside git push) another one
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: every tool call is activity PostToolUse Agent (foreground, captured) -> agent_completed with what the agent cost: tokens, durationMs, toolUses, model
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: ignored payloads prints nothing for an empty payload or one with neither a tool_name nor a session
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: ignored payloads prints nothing (and exits 0) for a payload that is not JSON, or JSON that is not an object
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) UserPromptSubmit -> session_prompt with the prompt text and the prompt id
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) a <task-notification> prompt (a background worker reporting back) -> session_prompt {isWakeup, wakeupAgentId}; only the <summary> travels
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) clamps a long prompt to 2000 characters hook-side (the server would refuse an oversize body whole)
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) Stop -> session_turn_end with the reply, the (empty) task list and the cron count
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) Stop with a running background task (synthetic: the entry shape is the one SubagentStop carried) -> backgroundTasks, max 10, descriptions at 120
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) PermissionRequest Write -> session_needs_you {kind: permission, toolName, summary: the file name, callKey}
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) PermissionRequest Bash -> the first 80 characters of the command; other tools -> the tool name; inside a subagent -> agentId
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) Notification permission_prompt (interactive, ~6 s after PermissionRequest) -> session_needs_you {kind: permission, notificationType, message}
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) Notification idle_prompt / quota_auto_resume_* / agent_needs_input -> idle / quota / agent-input; every other type -> nothing
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) StopFailure -> session_error {error, detail} (shape from the hooks reference; never fired locally)
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) PreCompact -> session_compact pre; PostCompact -> post, and the summary text stays behind
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) PostToolBatch on the main thread -> session_tool_done {batch, count}; inside a worker -> the same with its agentId (it answers only that worker's dialog)
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) CwdChanged -> session_cwd with the new cwd and project (the payload's own cwd is still the old one)
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) PostModelSwitch -> session_model {model, fromModel, switchSource} (shape from the schema; never fired locally)
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) Setup and InstructionsLoaded -> nothing, like every other event the office does not listen to
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) TaskCreated / TaskCompleted -> task_created / task_completed {taskId, subject} (the docs' shape; never fired locally), the description left behind
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) TaskCreated / TaskCompleted clamp the subject to one 120-char line, take a numeric id, and need a task id and a session
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the main thread (session_* events) every main-thread event without a session id prints nothing
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: the bash wrapper UserPromptSubmit: nothing on stdout, exit 0, the session_prompt goes to curl as one JSON body on stdin, never argv
  - First error: `AssertionError: expected [] to have a length of 1 but got +0`
- agent-tracker.sh: the bash wrapper a 300 KB tool_response reaches the Python (stdin, not an argument that would fail with E2BIG) and leaves as a 120-char result
  - First error: `AssertionError: expected null to match object { type: 'agent_completed', …(2) }`
- agent-tracker.sh: the bash wrapper TaskCreated: nothing on stdout (which could veto the task), exit 0, the task_created goes to curl in the background
  - First error: `AssertionError: expected [] to have a length of 1 but got +0`
- agent-tracker.sh: the bash wrapper with a token file it SIGNS the request (X-Office-Timestamp/Signature headers) and never puts the token on argv; an ignored event never calls curl
  - First error: `AssertionError: expected undefined to be false // Object.is equality`
- agent-tracker.sh: the bash wrapper posts to AGENT_OFFICE_EVENT_URL when set, else to 127.0.0.1:$AGENT_OFFICE_PORT/event, else to port 3334
  - First error: `AssertionError: expected undefined to be 'http://127.0.0.1:3334/event' // Object.is equality`
- agent-tracker.sh: the bash wrapper a deploy: the signals ride on the one JSON body the call sends, stdout stays empty, exit 0
  - First error: `AssertionError: expected [] to have a length of 1 but got +0`
- agent-tracker.sh: answering a permission from the office the Python: with the marker the event gains answerable, permissionMode, suggestions, detail and a nonce, and a `wait` line follows; without it, the event is as before on one line
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: answering a permission from the office the Python: detail is the Bash command (newlines kept), the file path of a file tool, else the tool input as compact JSON, clamped to 400; suggestions keep their shape, at most 4
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: answering a permission from the office a decided answer with a bad, missing or replayed proof, or server-supplied JSON, prints nothing
  - First error: `AssertionError: expected '\r\n' to be '' // Object.is equality`
- agent-tracker.sh: signals classify_command: the pattern table, chains, stripped prefixes and the false-positive guards
  - First error: `AssertionError: expected [ …(94) ] to deeply equal [ …(94) ]`
- agent-tracker.sh: signals a deploy: PreToolUse -> deploy_start on agent_working, PostToolUse -> deploy_success on session_tool_done, PostToolUseFailure -> deploy_fail with the error
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: signals a failing `vitest run`: test_failed with the first meaningful line, the exit code and "3 failing"
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: signals a chained `npm run build && git push origin main`: both start; both land; a failure is blamed on the segment the output points at
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: signals a failed chain is never pinned on a classified segment when an unclassified one could have failed it
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: signals a masked exit status (`npm test | tail`) is judged by the output: a failure count, a pass line, or nothing
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: signals a worker's PostToolUse carries them on its session_tool_done (with its agentId); where the call sends nothing of its own (no session id) they go out alone as a `signal` event
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: signals a backgrounded run has no outcome on PostToolUse; an Esc is a failure marked interrupted
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: signals a bare `git push` reads the branch from .git/HEAD (a worktree's .git file too); unknown, it has no toDefault
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: signals false positives stay out of the events: `echo deploy && false` fails without signals, and the old shapes are unchanged
  - First error: `Error: spawnSync python3 ENAMETOOLONG`
- agent-tracker.sh: signals at most 8 signals per call, each string clamped; a command shlex cannot split still classifies
  - First error: `Error: spawnSync python3 ENAMETOOLONG`

### tests/open-office.test.ts

0 passed, 0 failed, 0 skipped.

- Collection error: `Invalid or unexpected token`

### tests/permissions.test.ts

20 passed, 1 failed, 0 skipped.

- the answerPermissions setting and its marker file defaults to on, the marker is written 0600 at load, removed when switched off, written again when switched on; POST /settings takes the UI token
  - First error: `AssertionError: expected 438 to be 384 // Object.is equality`

### tests/release.test.ts

9 passed, 1 failed, 0 skipped.

- .github/workflows/release.yml runs on v* tags and by hand, with a token that may create the release, one run per ref at a time
  - First error: `AssertionError: expected 'name: Release\r\n\r\n# Pushing a tag …' to match /^on:\n  push:\n    tags: \['v\*'\]\n…/m`

### tests/runtime-config.test.ts

6 passed, 1 failed, 0 skipped.

- loadRuntimeConfig is null, and changes nothing, when the server is down, answers non-2xx or with the wrong shape
  - First error: `AssertionError: expected { port: 3334, host: '127.0.0.1', …(3) } to be null`

### tests/transcript.test.ts

19 passed, 1 failed, 0 skipped.

- agentTranscriptPath derives a worker file from the session transcript, the session id and the Claude agent id
  - First error: `AssertionError: expected '\root\.claude\projects\-home-me-proj\…' to be '/root/.claude/projects/-home-me-proj/…' // Object.is equality`

### tests/ws-auth.test.ts

17 passed, 11 failed, 1 skipped.

- the token file: reused when it is safe to trust, replaced otherwise generates and writes (0600, after listen) a token when the file is missing
  - First error: `AssertionError: expected 438 to be 384 // Object.is equality`
- the token file: reused when it is safe to trust, replaced otherwise replaces a malformed token file with a new token
  - First error: `AssertionError: expected 438 to be 384 // Object.is equality`
- the token file: reused when it is safe to trust, replaced otherwise replaces a too short token file with a new token
  - First error: `AssertionError: expected 438 to be 384 // Object.is equality`
- the token file: reused when it is safe to trust, replaced otherwise replaces a upper case token file with a new token
  - First error: `AssertionError: expected 438 to be 384 // Object.is equality`
- the token file: reused when it is safe to trust, replaced otherwise replaces a empty token file with a new token
  - First error: `AssertionError: expected 438 to be 384 // Object.is equality`
- the token file: reused when it is safe to trust, replaced otherwise replaces a token file other users could read (mode 640)
  - First error: `AssertionError: expected 'c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec…' not to be 'c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec…' // Object.is equality`
- the token file: reused when it is safe to trust, replaced otherwise replaces a token file other users could read (mode 604)
  - First error: `AssertionError: expected 'c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec…' not to be 'c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec…' // Object.is equality`
- the token file: reused when it is safe to trust, replaced otherwise replaces a token file other users could read (mode 644)
  - First error: `AssertionError: expected 'c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec…' not to be 'c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec…' // Object.is equality`
- the token file: reused when it is safe to trust, replaced otherwise replaces a token file other users could read (mode 660)
  - First error: `AssertionError: expected 'c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec…' not to be 'c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec…' // Object.is equality`
- the token file: reused when it is safe to trust, replaced otherwise replaces a token file owned by someone else (simulated: another uid)
  - First error: `TypeError: process.getuid is not a function`
- the token file: reused when it is safe to trust, replaced otherwise does not follow a symlink: neither reads the token through it nor writes the new one through it
  - First error: `AssertionError: expected 'c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec…' not to be 'c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec…' // Object.is equality`


## Causes and changes

- Checkout: keep Bash/Python scripts, executable Node modules, test source templates, command frontmatter and byte-compared workflow YAML at LF. Files were deleted individually and checked out again; the node_modules junction was left in place. LF alone removed five shell failures and the command-frontmatter failure. LF on shebang-bearing Node modules also fixed the doctor/electron/open collection errors; workflow LF fixed release.
- (a), installer: native Windows Python translates text writes to CRLF and receives MSYS-converted argv paths. Explicit LF writes preserve the existing POSIX bytes; a cygpath-normalized checkout path makes stored hook commands and comparison paths agree. Tests use shell path spellings for shell diagnostics and set fake date via a temporary BASH_ENV after Git Bash imports PATH.
- (a), tracker: reproduced the large-heredoc deadlock with a BogusEvent probe; BASH_COMPAT=5.0 removes it on MSYS/Cygwin. The next error was Windows' 32 KB command-line limit. Only on Windows, execute the parser from a temporary file, explicitly decode UTF-8 input, and emit LF protocol lines. The EXIT trap removes that source file (verified: zero temporary files remain). Bash command directory calculations use posixpath; Windows display names accept native backslashes. The POSIX parser invocation and protocol bytes remain the same. No standalone .py files or scripts/*.sh files were edited.
- (a), token: Windows lacks O_NOFOLLOW. Check the directory entry against the opened descriptor before reading, rejecting symlinks and a replaced file; the symlink test remains active. POSIX still uses the original O_NOFOLLOW path.
- (a), doctor: search Windows executable suffixes from PATHEXT; do not diagnose emulated Windows mode bits as Unix permission leaks. POSIX executable lookup and permission checks are unchanged.
- (a), harness: Windows parser tests use a temporary Python source file instead of an oversized -c argument; fake curl runs first through temporary BASH_ENV, so default-URL assertions record argv without contacting a server. Native path expectations use join/basename. Runtime config's undefined-fetch test mocks global fetch rather than reaching the machine's default server. Watcher waits observe the existing startup/diagnostic events, without retries or longer timeouts. The last open-office fixture explicitly closes its SQLite connection before directory cleanup.
- (b), Windows-only conditions: POSIX modes, uid ownership, pid 1 as init, MSYS/native PID and process-group signal semantics, SIGINT trap exit codes, and direct execution of a POSIX shebang opener fixture. Mixed behavior/mode tests keep their functional assertions; mode-only and integrated POSIX process tests use individual it.skipIf conditions with reason comments. No Linux/macOS assertion is removed or relaxed.
- (c), environment: Git for Windows bin and usr/bin plus Python must be on process PATH. No test is skipped for missing Bash or Python. Subsequent hook smoke runs use AGENT_OFFICE_EVENT_URL=http://127.0.0.1:9/event; protocol integration tests use their own ephemeral fake servers. No AI service is invoked.

Measurement note: the first plugin run overlapped a brief LF rematerialization before the original CRLF checkout was restored. All 20 tracker invocations timed out; the independent LF-only run reproduced all 20 timeouts. Its command-frontmatter source had been read before rematerialization. The first complete run (after the initial targeted fixes) reported 781 passed, 93 failed, 10 skipped, plus three collection failures; these are intermediate results, not the final gate.

## Full-run timing diagnosis

The next complete run reported 962 passed, 1 failed, 16 skipped (979 tests, 43 files). The failure was exactly: chat-ai-watcher.sh / answers a message a person typed exactly once, as the routed persona, with a cheap model and hooks/MCP off; first error: AssertionError: expected 1792675111335 to be greater than or equal to 1792675114447. The required serial rerun passed (16 passed, 5 skipped). Removed 121 worktree-owned processes left by the original blocked tracker probes. Replaced the fixed one-second delay with the existing bounded waitFor observing the reply watermark: duplicate-call assertions now run after the poll actually consumes the bot reply. No test retry or timeout increase was added.

## Runner errors found with the normal reporter

The JSON reporter marked all 43 files successful (963 passed, 16 skipped), but the runner exited 1. Repeating the exact full command with the normal reporter exposed two errors: SyntaxError: Unexpected end of JSON input at tests/status-line.test.ts:110 (latest test: exits 0 on garbage stdin and posts nothing); and Error: [vitest-worker]: Timeout calling "onTaskUpdate".

The required serial status-line measurement also returned 16 passed but exit 1 with the same JSON exception, before its script was edited. Native Python emitted CRLF: the nominally empty event line contained CR and triggered a whitespace-only POST. Set newline=LF in the existing stdout configuration and the signing helper (two lines, identical POSIX bytes). The capture-server assertion remains unchanged.

The full install-hooks file ran synchronously for 67.553 seconds, starving worker RPC despite each individual test passing. On Windows, its existing afterEach now yields one setImmediate after cleanup; no assertion or timeout is changed.

Isolation incident: before the runtime-config fixture was corrected, its undefined-fetch branch made a real GET /config to port 3334 and read the running local server configuration. It issued no write request. The global-fetch mock now preserves that branch without network access. No real AI request or real CLI configuration mutation was made.

## Windows test process cleanup

A complete run after the runner fixes had 961 passed, 2 failed, 16 skipped and no unhandled errors. Failures: hook-script / a decided answer with a bad, missing or replayed proof, or server-supplied JSON, prints nothing (Test timed out in 20000ms); scripts / (in the future) starts from now: a message is answered once, and the file holds a timestamp again (timed out waiting for the reply). Both required serial reruns passed at the original 15000 ms setting (83 and 16 passed respectively).

Found and removed 241 processes descending from 118 shell processes belonging only to this worktree. The serial scripts run then left another 12 watcher shell processes, proving that Proc.stop terminated only the native Git Bash wrapper, leaving its MSYS child and polling loop alive. Windows cleanup now uses taskkill /PID <that test child> /T /F before awaiting its exit. POSIX process-group cleanup is unchanged. No timeout, retry or assertion was changed for these two timing failures.

## Final before/after table

Counts before are the recorded serial measurements above; collection and unhandled errors are explicit rather than counted as passing files.

| File | Failures before | Failures after | Cause class |
| --- | ---: | ---: | --- |
| tests/install-hooks.test.ts | 19 | 0 | (a) Windows paths, Python LF, fixture clock, RPC yield |
| tests/sessions-registry.test.ts | 1 | 0 | (b) POSIX pid 1 |
| tests/turn-events.test.ts | 0 | 0 | None; unchanged control |
| tests/hardening.test.ts | 3 | 0 | (b) POSIX permission bits |
| tests/scripts.test.ts | 11 | 0 | Checkout LF; (a) readiness and Windows process-tree cleanup; (b) signals |
| tests/plugin.test.ts | 21 | 0 | Checkout LF; (a) tracker Windows execution |
| tests/doctor.test.ts | Collection error | 0 | Checkout LF; (a) executable suffixes and fixtures; (b) modes |
| tests/electron-helpers.test.ts | Collection error | 0 | Checkout LF on executable Node modules |
| tests/hook-script.test.ts | 76 | 0 | (a) Windows parser execution, UTF-8, LF, shell fixtures and path names |
| tests/open-office.test.ts | Collection error | 0 | Checkout LF; (a) native paths and SQLite cleanup; (b) modes/shebang fixture |
| tests/permissions.test.ts | 1 | 0 | (b) POSIX permission assertion |
| tests/release.test.ts | 1 | 0 | Checkout LF on byte-compared workflow |
| tests/runtime-config.test.ts | 1 | 0 | (a) isolate the undefined-fetch fixture |
| tests/transcript.test.ts | 1 | 0 | (a) exact native path expectation |
| tests/ws-auth.test.ts | 11 | 0 | (a) Windows symlink rejection; (b) POSIX modes/uid |
| tests/status-line.test.ts | 0 tests; 1 unhandled error | 0 | (a) Windows LF protocol; unchanged test assertions |

Final command: `npx vitest run --maxWorkers=2 --testTimeout=20000` with default and JSON reporters added for evidence, Git/Python on process PATH, and the isolated hook smoke endpoint. Exit code **0**. **43 passed files; 963 passed, 0 failed, 16 skipped (979 tests); 0 unhandled errors.** Duration: 102.58 seconds.

Remaining failures: **none**. The 16 skips comprise 14 added Windows-only POSIX fixture/assertion exclusions and 2 existing upstream platform exclusions. No retries, removed tests, dependency edits or global CLI configuration changes. Bash/Node syntax checks and git diff --check passed.

Cleanup limitation: zero worktree-owned test shell processes remain. Automatic approval rejected both removal of evidence-identified test fixture directories in Windows Temp and removal of D:\work\_wt-pr24\.baseline-tmp, with 'blocked by policy' and no further reason. Those temporary directories remain; .baseline-tmp is excluded from the commit.
