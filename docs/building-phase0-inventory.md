# Phase 0 Inventory: Building, G0 and Levels

This document provides the exhaustive "Phase 0" characterization and inventory required by the [Building, G0 and Levels plan](file:///D:/work/Claude-Office/docs/building-and-levels.md) (specifically sections 4, 6, and 13) and [HANDOFF.md](file:///D:/work/Claude-Office/docs/e2e-review-2026-10-21/HANDOFF.md). All file citations have been verified against the current codebase.

---

## 1. Module-Level Mutable State in `server/`

This section catalogues every module-level mutable container (`Map`, `Set`, `Array`, object), counter, `let` variable, cached value, and `setInterval`/`setTimeout` handle created or started at import time across all files in [`server/`](file:///D:/work/Claude-Office/server/).

### Classification Legend
- **G0**: Machine-wide or account-wide state shared across all offices (e.g. system binary presence, global model catalogue, machine boot time, provider rate limits/circuits).
- **OFFICE**: Project-specific state belonging strictly to one office/level (e.g. active agents, chat history, interactive sessions, project tokens, delegation state).
- **unsure**: Requires architectural decision or hybrid isolation handling.

### 1.1 Module-Level Mutable State & Timers

| Name | File:Line | What it holds | Classification | Reason |
|---|---|---|---|---|
| `modelCache` | [`server/adapters.mjs:324`](file:///D:/work/Claude-Office/server/adapters.mjs#L324) | `Map<string, { at: number, models: Array }>` caching CLI model list per service | **G0** | External CLI model capabilities are machine-wide account features, not project-specific. |
| `pathCache` | [`server/adapters.mjs:351`](file:///D:/work/Claude-Office/server/adapters.mjs#L351) | `Map<string, { found: boolean, at: number }>` caching binary presence on system PATH | **G0** | System executable availability on PATH is machine-wide OS state. |
| `building` | [`server/brainRoutes.js:32`](file:///D:/work/Claude-Office/server/brainRoutes.js#L32) | `Promise<Catalogue> | null` deduplicating concurrent catalogue rebuild jobs | **G0** | Catalogue rebuild invokes heavy external CLIs and is machine-wide work. |
| `db` | [`server/chat-db.js:35`](file:///D:/work/Claude-Office/server/chat-db.js#L35) | SQLite `Database` instance opened at module import time against `chat.db` | **OFFICE** | Chat history and message logs belong strictly to a single project/office. |
| `bootTimeS` | [`server/sessions.js:132`](file:///D:/work/Claude-Office/server/sessions.js#L132) | Cached Linux boot timestamp (seconds) parsed from `/proc/stat` | **G0** | OS machine boot timestamp is constant across the entire machine. |
| `activeAgents` | [`server/index.js:452`](file:///D:/work/Claude-Office/server/index.js#L452) | `Map<string, AgentRecord>` holding live and completed agent visual/operational state | **OFFICE** | Agent cards, roles, and visual office sprites belong to a specific office workspace. |
| `subagentAliases` | [`server/index.js:460`](file:///D:/work/Claude-Office/server/index.js#L460) | `Map<string, string>` mapping subagent name aliases to internal agent IDs | **OFFICE** | Subagent dispatch and naming bindings are scoped to the project session. |
| `pendingStarts` | [`server/index.js:470`](file:///D:/work/Claude-Office/server/index.js#L470) | `Map<string, PendingStartRecord>` awaiting tool execution binding to an agent | **OFFICE** | Tool execution lifecycle is specific to an office's active session. |
| `activity` | [`server/index.js:510`](file:///D:/work/Claude-Office/server/index.js#L510) | `Map<string, Array<ActivityItem>>` activity history buffer keyed by agent ID | **OFFICE** | Activity feed represents work performed within a specific office. |
| `sessions` | [`server/index.js:583`](file:///D:/work/Claude-Office/server/index.js#L583) | `Map<string, SessionRecord>` tracking active Claude Code and agent sessions | **OFFICE** | Interactive sessions, working directories, and project names are per-office. |
| `sessionTimers` | [`server/index.js:594`](file:///D:/work/Claude-Office/server/index.js#L594) | `Map<string, Timeout>` timers cleaning up ended sessions after grace period | **OFFICE** | Session lifecycle management is scoped to a single office. |
| `pendingNeedsYou` | [`server/index.js:661`](file:///D:/work/Claude-Office/server/index.js#L661) | `Map<string, PendingNeedsYou>` debounce records for user attention prompts | **OFFICE** | Attention debouncing operates on prompts from an office's sessions. |
| `needsYouTimers` | [`server/index.js:663`](file:///D:/work/Claude-Office/server/index.js#L663) | `Map<string, Timeout>` timers automatically lowering unanswered attention hands | **OFFICE** | Manages unanswered attention state for a specific office. |
| `waitCalls` | [`server/index.js:672`](file:///D:/work/Claude-Office/server/index.js#L672) | `WeakMap<object, object>` associating wait objects with caller metadata | **OFFICE** | Ephemeral metadata for in-flight wait/decision objects of office sessions. |
| `settings` | [`server/index.js:1336`](file:///D:/work/Claude-Office/server/index.js#L1336) | In-memory settings object `{ logPrompts, answerPermissions, eventMode }` mutated at runtime | **OFFICE** | `answerPermissions` is per-office (Lx); defaults cascade from G0. |
| `signalRing` | [`server/index.js:1472`](file:///D:/work/Claude-Office/server/index.js#L1472) | `Array<SignalRecord>` circular buffer of recent dev/CI signals (capacity 100) | **OFFICE** | Build, test, and deploy signals belong to the office repository/workspace. |
| `sessionSignals` | [`server/index.js:1474`](file:///D:/work/Claude-Office/server/index.js#L1474) | `Map<string, Array<SignalRecord>>` mapping session ID to recent signals | **OFFICE** | Signals partitioned per session belong to a specific office. |
| `signalSeq` | [`server/index.js:1475`](file:///D:/work/Claude-Office/server/index.js#L1475) | `number` sequence counter incremented on each emitted signal | **OFFICE** | Polling cursor for `GET /signals?since=...` within that office. |
| `status` | [`server/index.js:1616`](file:///D:/work/Claude-Office/server/index.js#L1616) | `StatusStore` instance created at import time via `mountStatus` | **OFFICE** | Tracks token burn, cost, and session status records for that office. |
| `permissions` | [`server/index.js:1642`](file:///D:/work/Claude-Office/server/index.js#L1642) | `PermissionStore` instance created at import time via `mountPermissions` | **OFFICE** | Tool permission dialogs and approval decisions belong to an office. |
| `health` | [`server/index.js:1668`](file:///D:/work/Claude-Office/server/index.js#L1668) | Health tracker created at import time via `mountHealth` | **unsure** | Tracks Building-wide server uptime alongside per-office session/agent counts. |
| `registry` | [`server/index.js:1674`](file:///D:/work/Claude-Office/server/index.js#L1674) | Session registry tracker created at import time via `mountRegistry` | **G0** | Ingests global `~/.claude/sessions` and routes sessions to offices by cwd. |
| `tasks` | [`server/index.js:1707`](file:///D:/work/Claude-Office/server/index.js#L1707) | Task board manager created at import time via `mountTasks` | **OFFICE** | Tracks task files in `~/.claude/tasks/<sessionId>` for an office's sessions. |
| `videoPaused` | [`server/index.js:2068`](file:///D:/work/Claude-Office/server/index.js#L2068) | `boolean` flag indicating whether simulation/animation loop is paused | **OFFICE** | Office UI rendering toggle; recommended per-office (§12 open decision 5). |
| `videoPausedSince` | [`server/index.js:2069`](file:///D:/work/Claude-Office/server/index.js#L2069) | `number` timestamp (ms) when video was paused | **OFFICE** | Paused duration tracking for that office. |
| `a2aPairLog` | [`server/index.js:2109`](file:///D:/work/Claude-Office/server/index.js#L2109) | `Map<string, Array<number>>` rate limit timestamps for agent-to-agent message pairs | **OFFICE** | Agent-to-agent communication occurs between agents within an office. |
| `sweepStale timer` | [`server/index.js:3384`](file:///D:/work/Claude-Office/server/index.js#L3384) | Background interval timer (`setInterval(() => sweepStale(), 5 * 60_000).unref()`) | **G0** | Driver timer; must iterate across all registered office contexts instead of global state. |
| `trustedClients` | [`server/index.js:3536`](file:///D:/work/Claude-Office/server/index.js#L3536) | `WeakSet<WebSocket>` tracking authenticated WebSocket client connections | **OFFICE** | Client socket authorization is strictly scoped to an office context. |
| `httpServer` | [`server/index.js:3538`](file:///D:/work/Claude-Office/server/index.js#L3538) | Node `http.Server` instance created at import time | **G0** | The single machine-wide Building HTTP server on loopback port 3334. |
| `wss` | [`server/index.js:3540`](file:///D:/work/Claude-Office/server/index.js#L3540) | `WebSocketServer` instance created at import time attached to `httpServer` | **G0** | The single machine-wide WebSocket server on loopback port 3334. |
| `statusTimer` | [`server/status.js:504`](file:///D:/work/Claude-Office/server/status.js#L504) | Interval timer (`setInterval`, 60s) started during import by `mountStatus` | **G0** | Driver timer; must iterate across office status stores rather than closed store. |

### 1.2 Module-Level Constant Lookup Sets & Maps (Immutable Configuration)

For completeness and to prevent false positives in state audits, the following module-level `Set` and `Map` instances are static, immutable lookups initialized at import time and never mutated:

| Name | File:Line | Contents / Purpose | Classification | Reason |
|---|---|---|---|---|
| `OPENCODE_FREE` | [`server/adapters.mjs:301`](file:///D:/work/Claude-Office/server/adapters.mjs#L301) | `Set(['opencode', 'ollama'])` free providers needing no credentials | **G0** | Immutable adapter capabilities classification. |
| `TEXT` | [`server/artifacts.js:7`](file:///D:/work/Claude-Office/server/artifacts.js#L7) | `Set(['.md', '.txt', ...])` text file extension whitelist | **G0** | Static MIME-type classification set. |
| `SPEED_WORDS` | [`server/catalogue.mjs:19`](file:///D:/work/Claude-Office/server/catalogue.mjs#L19) | `Set(['flash', 'fast', ...])` keywords identifying fast/mini tier models | **G0** | Static model classification vocabulary. |
| `DEPTH_WORDS` | [`server/catalogue.mjs:20`](file:///D:/work/Claude-Office/server/catalogue.mjs#L20) | `Set(['ultra', 'opus', ...])` keywords identifying deep tier models | **G0** | Static model classification vocabulary. |
| `BALANCED_WORDS` | [`server/catalogue.mjs:21`](file:///D:/work/Claude-Office/server/catalogue.mjs#L21) | `Set(['sonnet', 'standard', ...])` keywords identifying balanced tier | **G0** | Static model classification vocabulary. |
| `existingCols` | [`server/chat-db.js:65`](file:///D:/work/Claude-Office/server/chat-db.js#L65) | `Set<string>` table column names during startup schema migration check | **OFFICE** | One-off read-only migration probe result. |
| `LOOPBACK_BIND_HOSTS` | [`server/config.js:37`](file:///D:/work/Claude-Office/server/config.js#L37) | `Set(['127.0.0.1', 'localhost'])` valid bind hostnames | **G0** | Static loopback network interface filter. |
| `IPV6_LOOPBACK` | [`server/config.js:40`](file:///D:/work/Claude-Office/server/config.js#L40) | `Set(['::1', '0:0:0:0:0:0:0:1'])` valid IPv6 loopback addresses | **G0** | Static network address filter. |
| `YES` | [`server/delegation.mjs:79`](file:///D:/work/Claude-Office/server/delegation.mjs#L79) | `Set(['yes', 'y', 'ok', ...])` user confirmation vocabulary | **G0** | Static natural language parsing keywords. |
| `NO` | [`server/delegation.mjs:80`](file:///D:/work/Claude-Office/server/delegation.mjs#L80) | `Set(['no', 'n', 'cancel', ...])` user rejection vocabulary | **G0** | Static natural language parsing keywords. |
| `LOOPBACK_HOSTS` | [`server/index.js:307`](file:///D:/work/Claude-Office/server/index.js#L307) | `Set(['localhost', '127.0.0.1', '[::1]'])` allowed HTTP Host header values | **G0** | Static DNS rebinding protection whitelist. |
| `ALLOWED_ORIGIN_PORTS` | [`server/index.js:308`](file:///D:/work/Claude-Office/server/index.js#L308) | `Set([UI_DEV_PORT, '3333', PORT])` allowed WebSocket origin ports | **G0** | Static CORS/WebSocket origin port whitelist. |
| `MAIN_STATES` | [`server/index.js:627`](file:///D:/work/Claude-Office/server/index.js#L627) | `Set(['working', 'waiting', 'idle', 'needs-you', 'error', 'compacting'])` | **G0** | Static session state enumeration. |
| `NEEDS_YOU_KINDS` | [`server/index.js:628`](file:///D:/work/Claude-Office/server/index.js#L628) | `Set(['permission', 'idle', 'quota', 'agent-input'])` | **G0** | Static attention type enumeration. |
| `KNOWN_EVENT_TYPES` | [`server/index.js:1274`](file:///D:/work/Claude-Office/server/index.js#L1274) | `Set(['agent_spawned', ...])` valid incoming hook event types | **G0** | Static protocol event schema whitelist. |
| `LOG_PROMPTS_LEVELS` | [`server/index.js:1335`](file:///D:/work/Claude-Office/server/index.js#L1335) | `Map([['off', 0], ['summary', 200], ['full', MAX_TEXT_LEN]])` | **G0** | Static configuration option mapping. |
| `SIGNAL_KINDS` | [`server/index.js:1461`](file:///D:/work/Claude-Office/server/index.js#L1461) | `Set(['deploy_start', 'build_ok', ...])` dev signal event categories | **G0** | Static event categorization vocabulary. |
| `PRIVILEGED_COMMANDS` | [`server/index.js:1986`](file:///D:/work/Claude-Office/server/index.js#L1986) | `Set(['/clear'])` chat slash commands requiring authentication | **G0** | Static command authorization whitelist. |
| `A2A_TYPES` | [`server/index.js:2102`](file:///D:/work/Claude-Office/server/index.js#L2102) | `Set(['message', 'question', 'review_request', 'task_handoff'])` | **G0** | Static agent-to-agent protocol message types. |
| `TRANSCRIPT_MSG_TYPES` | [`server/index.js:3474`](file:///D:/work/Claude-Office/server/index.js#L3474) | `Set(['prompt', 'reply'])` transcript entry filters | **G0** | Static transcript parsing type filter. |
| `PERMISSION_STATUSES` | [`server/permissions.js:81`](file:///D:/work/Claude-Office/server/permissions.js#L81) | `Set(['pending', 'allowed', 'denied', 'resolved_elsewhere', 'expired'])` | **G0** | Static permission lifecycle enum. |
| `DECISIONS` | [`server/permissions.js:82`](file:///D:/work/Claude-Office/server/permissions.js#L82) | `Set(['allow', 'allow-remember', 'deny'])` valid decision choices | **G0** | Static decision enum. |
| `STATUS_TYPES` | [`server/status.js:71`](file:///D:/work/Claude-Office/server/status.js#L71) | `Set(['session_status', 'agent_status'])` status report event types | **G0** | Static status type enumeration. |
| `STATUS_SET` | [`server/tasks.js:64`](file:///D:/work/Claude-Office/server/tasks.js#L64) | `Set(TASK_STATUSES)` valid task states (`pending`, `in_progress`, `completed`) | **G0** | Static task status enum. |

---

## 2. Every `mount*(app, {...})` Call in `server/index.js`

In [`server/index.js:1616-1726`](file:///D:/work/Claude-Office/server/index.js#L1616-L1726), 9 modular sub-routers/services are mounted on the global Express `app`. Because they are mounted once at import time, they capture dependencies by closure. In Phase 2, each mount function must either receive the office sub-router (`app.use('/o/:officeId', resolveOffice, officeRouter)`) or resolve its dependencies per request via `req.office`.

### 2.1 Mount Summary Table

| Mount Function | Call Site | Captured Dependencies in Closure | Required Per-Request Lookups (`req.office.*`) | G0 / Shared Handling |
|---|---|---|---|---|
| [`mountStatus`](file:///D:/work/Claude-Office/server/status.js#L464) | [`index.js:1616`](file:///D:/work/Claude-Office/server/index.js#L1616) | `requireToken`, `broadcast`, `sessions`, `staleMs` | `req.office.statusStore`, `req.office.sessions`, `req.office.broadcast` | Sweep timer becomes G0 interval iterating all registered office stores. |
| [`mountPermissions`](file:///D:/work/Claude-Office/server/permissions.js#L323) | [`index.js:1642`](file:///D:/work/Claude-Office/server/index.js#L1642) | `requireToken`, `requireUi`, `broadcast`, `onDecided`, `proof` | `req.office.permissionsStore`, `req.office.token`, `req.office.broadcast` | `proof` HMAC must use `req.office.token`; `onDecided` resolves office session. |
| [`mountHealth`](file:///D:/work/Claude-Office/server/health.js#L147) | [`index.js:1668`](file:///D:/work/Claude-Office/server/index.js#L1668) | `broadcast`, `uiAvailable`, `prove`, `counts` | `req.office.agents`, `req.office.sessions`, `req.office.sockets` | Exposed both per-office (`/o/<id>/health`) and at Building level (`/building/health`). |
| [`mountRegistry`](file:///D:/work/Claude-Office/server/sessions.js#L367) | [`index.js:1674`](file:///D:/work/Claude-Office/server/index.js#L1674) | `sessions`, `broadcast`, `registryDir`, `toEvent`, `endSession`, `forgetSession` | `targetOffice.sessions`, `targetOffice.broadcast` | Registry scan is G0; routes session by canonical `cwd` to target office or Unassigned. |
| [`mountTasks`](file:///D:/work/Claude-Office/server/tasks.js#L237) | [`index.js:1707`](file:///D:/work/Claude-Office/server/index.js#L1707) | `sessions`, `broadcast`, `tasksDir`, `hasToken` | `req.office.sessions`, `req.office.broadcast` | Watched sessions scoped per office; task broadcasts only reach office sockets. |
| [`mountBackends`](file:///D:/work/Claude-Office/server/backends.js#L33) | [`index.js:1723`](file:///D:/work/Claude-Office/server/index.js#L1723) | `requireUi`, `onServicesChanged` | `req.office.settings` (overrides), `req.office.uiToken` | Service definitions & PATH checks are G0; role agent selections are per-office. |
| [`mountBrains`](file:///D:/work/Claude-Office/server/brainRoutes.js#L63) | [`index.js:1724`](file:///D:/work/Claude-Office/server/index.js#L1724) | `requireUi` | `req.office.settings` (brain-to-agent links) | Brain definitions and model catalogue are G0; office overrides role mappings. |
| [`mountArtifacts`](file:///D:/work/Claude-Office/server/artifacts.js#L11) | [`index.js:1725`](file:///D:/work/Claude-Office/server/index.js#L1725) | `requireUi`, `getMessage` (`db`), `workspace` (`cwd`), `temp` | `req.office.chatDb`, `req.office.cwd`, `req.office.tmp`, `req.office.uiToken` | File reader roots strictly restricted to `[realpath(office.cwd), realpath(office.tmp)]`. |
| [`mountChatActions`](file:///D:/work/Claude-Office/server/chat-actions.mjs#L23) | [`index.js:1726`](file:///D:/work/Claude-Office/server/index.js#L1726) | `db`, `requireUi`, `readState`, `paused`, `enqueue`, `log` | `req.office.chatDb`, `req.office.home`, `req.office.broadcast`, `req.office.uiToken` | All chat queries, approvals, delegation files, and poll states are strictly per-office. |

### 2.2 Deep Dive on Captured Closures

1. **`mountStatus(app, { requireToken, broadcast, staleMs, sessions })`** ([`index.js:1616`](file:///D:/work/Claude-Office/server/index.js#L1616)):
   - *Closure captures:* Global `broadcast` function (sends to all sockets on `wss`), global `sessions` Map, and global `AUTH_TOKEN` verification.
   - *Internal side effects:* Sets `app.locals.status = store` (overwrites on shared app); creates `store` and starts a 60-second `setInterval` timer ([`status.js:504`](file:///D:/work/Claude-Office/server/status.js#L504)).
   - *Phase 2 requirement:* `store` must be instantiated per office context (`ctx.statusStore`). Route handlers for `POST /status`, `POST /usage`, and `GET /status` must look up `req.office.statusStore`. The background sweep must be driven by a single G0 timer iterating all office stores.

2. **`mountPermissions(app, { requireToken, requireUi, broadcast, onDecided, canSeeDetail, proof })`** ([`index.js:1642`](file:///D:/work/Claude-Office/server/index.js#L1642)):
   - *Closure captures:* Global `AUTH_TOKEN` inside `proof` HMAC callback ([`index.js:1651`](file:///D:/work/Claude-Office/server/index.js#L1651)); `onOfficeDecision` captures global `sessions`, `pendingNeedsYou`, and `broadcast`.
   - *Phase 2 requirement:* `PermissionStore` must live on `ctx.permissionStore`. The HMAC proof challenge must sign using `req.office.token`. Hook polling at `GET /permission/:id` and UI responses at `POST /permission/:id` must authenticate against that office's token.

3. **`mountHealth(app, { broadcast, uiAvailable, prove, counts })`** ([`index.js:1668`](file:///D:/work/Claude-Office/server/index.js#L1668)):
   - *Closure captures:* Global `officeProof(AUTH_TOKEN, challenge)`; `counts()` closure calculates counts over global `activeAgents.size`, `wss.clients.size`, and `sessions.values()`.
   - *Phase 2 requirement:* Health becomes two-tiered: Building health at `/building/health` (overall server status and office count) and Level health at `/o/<officeId>/health` (reporting `counts` for that office's agents, sessions, and connected sockets, with HMAC proof signed by that office's token).

4. **`mountRegistry(app, { sessions, broadcast, registryDir, toEvent, endSession, forgetSession, onStatusChange })`** ([`index.js:1674`](file:///D:/work/Claude-Office/server/index.js#L1674)):
   - *Closure captures:* Global `sessions` Map and `broadcast`; `registryStatusChanged` captures global `releasePermissions` and `lowerPermissionHand`.
   - *Phase 2 requirement:* Registry file reading is machine-wide (G0, `~/.claude/sessions`). When an entry is detected, its `cwd` must be matched against registered offices via `canonicalCwd()`. If matched, session state is written to `office.sessions` and broadcast via `office.broadcast`. If unmatched, it goes to the G0 "Unassigned" bucket.

5. **`mountTasks(app, { sessions, broadcast, tasksDir, hasToken })`** ([`index.js:1707`](file:///D:/work/Claude-Office/server/index.js#L1707)):
   - *Closure captures:* Global `sessions` Map; global `broadcast`; `hasToken` validates against global `AUTH_TOKEN`.
   - *Internal side effects:* `watched = new Map()` and polling timer ([`tasks.js:252, 397`](file:///D:/work/Claude-Office/server/tasks.js#L252)).
   - *Phase 2 requirement:* Tasks directory (`~/.claude/tasks/<sessionId>`) contains sessions partitioned by office. Watched task sets and diffs must be tracked per office, broadcasting `task_board` events only to that office's client sockets.

6. **`mountBackends(app, { requireUi, onServicesChanged })`** ([`index.js:1723`](file:///D:/work/Claude-Office/server/index.js#L1723)):
   - *Closure captures:* Global `requireUi` middleware; reads/writes `backend.json` directly via `server/settings.mjs`.
   - *Phase 2 requirement:* Service availability (PATH) and catalogue listing are G0; agent role assignments (`POST /backends/agent`) must write per-office overrides to `levels/<officeId>/backend.json`.

7. **`mountBrains(app, { requireUi })`** ([`index.js:1724`](file:///D:/work/Claude-Office/server/index.js#L1724)):
   - *Closure captures:* Global `requireUi` middleware; reads global brains and catalogue.
   - *Phase 2 requirement:* Brain definitions and model catalogue are defined in G0 (`global/backend.json`, `global/catalogue.json`). Office routes manage which brain an office role uses (`levels/<officeId>/backend.json` override).

8. **`mountArtifacts(app, { requireUi, getMessage })`** ([`index.js:1725`](file:///D:/work/Claude-Office/server/index.js#L1725)):
   - *Closure captures:* Global `db` via `getMessage: id => db.prepare(...)`; defaults `workspace = process.cwd()` and `temp = tmpdir()` ([`artifacts.js:11`](file:///D:/work/Claude-Office/server/artifacts.js#L11)).
   - *Phase 2 requirement:* Must query `req.office.chatDb` for message lookups. The allowed file read roots must be dynamically passed as `[realpath(req.office.cwd), realpath(req.office.tmp)]` to enforce isolation and prevent cross-office directory traversal.

9. **`mountChatActions(app, { db, requireUi, readState, paused, enqueue, log })`** ([`index.js:1726`](file:///D:/work/Claude-Office/server/index.js#L1726)):
   - *Closure captures:* Global SQLite connection `db`; `readState` reads global `join(RUNTIME_DIR, 'delegation.json')`; `paused` reads global `join(RUNTIME_DIR, 'chat-poll-state')`; `enqueue` and `log` insert messages into global `db` and call global `broadcast`.
   - *Phase 2 requirement:* All captured operations must be redirected to `req.office.chatDb`, `req.office.home/delegation.json`, `req.office.home/chat-poll-state`, and `req.office.broadcast`.

---

## 3. Path & Directory Identifiers Inventory

Exhaustive inventory of every occurrence of `homeDir`, `RUNTIME_DIR`, `AGENT_OFFICE_HOME`, `process.cwd()`, `homedir()`, and `tmpdir()` across `server/`, `scripts/`, `hooks/`, and `electron/` (110 total instances).

| Identifier | File:Line | Code Context | Classification | Reason / Notes |
|---|---|---|---|---|
| `homedir()` | [server/adapters.mjs:158](file:///D:/work/Claude-Office/server/adapters.mjs#L158) | `models: async () => parseCodexModels(readFileSync(join(homedir(), '.codex',` | **G0** | Global user Codex models cache (~/.codex/models_cache.json) |
| `tmpdir()` | [server/adapters.mjs:434](file:///D:/work/Claude-Office/server/adapters.mjs#L434) | `const dir = adapter.outFile ? mkdtempSync(join(tmpdir(), 'office-')) : null` | **OFFICE** | Temporary directory for adapter output; must become office.tmp |
| `process.cwd(), tmpdir()` | [server/artifacts.js:11](file:///D:/work/Claude-Office/server/artifacts.js#L11) | `export function mountArtifacts(app, { requireUi, getMessage, workspace = pr` | **OFFICE** | Artifact file reader workspace and temp roots; must become office.cwd and office.tmp |
| `homeDir` | [server/availability.mjs:12](file:///D:/work/Claude-Office/server/availability.mjs#L12) | `import { homeDir } from './settings.mjs'` | **G0** | Provider cooldowns and circuit locks are machine/account-wide in G0 |
| `AGENT_OFFICE_HOME` | [server/availability.mjs:102](file:///D:/work/Claude-Office/server/availability.mjs#L102) | `// --- the cooldowns: what is being left alone until when, kept across proc` | **G0** | Provider cooldowns and circuit locks are machine/account-wide in G0 |
| `homeDir` | [server/availability.mjs:104](file:///D:/work/Claude-Office/server/availability.mjs#L104) | `const file = () => join(homeDir, 'cooldowns.json')` | **G0** | Provider cooldowns and circuit locks are machine/account-wide in G0 |
| `homeDir` | [server/availability.mjs:111](file:///D:/work/Claude-Office/server/availability.mjs#L111) | `release = acquireProcessLock(join(homeDir, 'circuits-state.lock'))` | **G0** | Provider cooldowns and circuit locks are machine/account-wide in G0 |
| `homeDir` | [server/availability.mjs:172](file:///D:/work/Claude-Office/server/availability.mjs#L172) | `const unlock = acquireProcessLock(join(homeDir, 'circuit-probes', `${hash}.` | **G0** | Provider cooldowns and circuit locks are machine/account-wide in G0 |
| `homeDir` | [server/brains.mjs:28](file:///D:/work/Claude-Office/server/brains.mjs#L28) | `import { homeDir, isEnabled, readSettings, resolveAgent, writeSettings } fr` | **G0** | Brain profiles and brain-last selection are G0 account-wide settings |
| `AGENT_OFFICE_HOME` | [server/brains.mjs:129](file:///D:/work/Claude-Office/server/brains.mjs#L129) | `// --- storing brains and links ($AGENT_OFFICE_HOME/backend.json, with the ` | **G0** | Brain profiles and brain-last selection are G0 account-wide settings |
| `homeDir` | [server/brains.mjs:295](file:///D:/work/Claude-Office/server/brains.mjs#L295) | `const lastFile = () => join(homeDir, 'brain-last.json')` | **G0** | Brain profiles and brain-last selection are G0 account-wide settings |
| `AGENT_OFFICE_HOME` | [server/catalogue.mjs:13](file:///D:/work/Claude-Office/server/catalogue.mjs#L13) | `//   loadCatalogue()    the last one built, kept in $AGENT_OFFICE_HOME/cata` | **G0** | Model catalogue is shared machine-wide in G0 ($AGENT_OFFICE_HOME/catalogue.json) |
| `homeDir` | [server/catalogue.mjs:17](file:///D:/work/Claude-Office/server/catalogue.mjs#L17) | `import { homeDir, isEnabled } from './settings.mjs'` | **G0** | Model catalogue is shared machine-wide in G0 ($AGENT_OFFICE_HOME/catalogue.json) |
| `homeDir` | [server/catalogue.mjs:93](file:///D:/work/Claude-Office/server/catalogue.mjs#L93) | `const file = () => join(homeDir, 'catalogue.json')` | **G0** | Model catalogue is shared machine-wide in G0 ($AGENT_OFFICE_HOME/catalogue.json) |
| `AGENT_OFFICE_HOME` | [server/chat-db.js:4](file:///D:/work/Claude-Office/server/chat-db.js#L4) | `* DB location: ~/.agent-office/chat.db (or $AGENT_OFFICE_HOME/chat.db)` | **OFFICE** | Chat SQLite database and WAL files; must move to levels/<officeId>/chat.db |
| `RUNTIME_DIR, AGENT_OFFICE_HOME, homedir()` | [server/chat-db.js:17](file:///D:/work/Claude-Office/server/chat-db.js#L17) | `const RUNTIME_DIR = process.env.AGENT_OFFICE_HOME \|\| join(homedir(), '.ag` | **OFFICE** | Chat SQLite database and WAL files; must move to levels/<officeId>/chat.db |
| `RUNTIME_DIR` | [server/chat-db.js:18](file:///D:/work/Claude-Office/server/chat-db.js#L18) | `try { mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 }) } catch {}` | **OFFICE** | Chat SQLite database and WAL files; must move to levels/<officeId>/chat.db |
| `RUNTIME_DIR` | [server/chat-db.js:21](file:///D:/work/Claude-Office/server/chat-db.js#L21) | `try { chmodSync(RUNTIME_DIR, 0o700) } catch {}` | **OFFICE** | Chat SQLite database and WAL files; must move to levels/<officeId>/chat.db |
| `RUNTIME_DIR` | [server/chat-db.js:26](file:///D:/work/Claude-Office/server/chat-db.js#L26) | `const DB_PATH = join(RUNTIME_DIR, 'chat.db')` | **OFFICE** | Chat SQLite database and WAL files; must move to levels/<officeId>/chat.db |
| `RUNTIME_DIR` | [server/chat-db.js:45](file:///D:/work/Claude-Office/server/chat-db.js#L45) | `const file = join(RUNTIME_DIR, name)` | **OFFICE** | Chat SQLite database and WAL files; must move to levels/<officeId>/chat.db |
| `AGENT_OFFICE_HOME` | [server/index.js:64](file:///D:/work/Claude-Office/server/index.js#L64) | `// lives in ~/.agent-office, or AGENT_OFFICE_HOME when set (tests point it ` | **OFFICE (conflated)** | Runtime directory definition; currently conflates G0 Building home with Office home |
| `RUNTIME_DIR` | [server/index.js:67](file:///D:/work/Claude-Office/server/index.js#L67) | `// effects outside RUNTIME_DIR and a second instance that loses the port ra` | **OFFICE (conflated)** | Runtime directory definition; currently conflates G0 Building home with Office home |
| `RUNTIME_DIR, AGENT_OFFICE_HOME, homedir()` | [server/index.js:115](file:///D:/work/Claude-Office/server/index.js#L115) | `const RUNTIME_DIR = process.env.AGENT_OFFICE_HOME \|\| join(homedir(), '.ag` | **OFFICE (conflated)** | Runtime directory definition; currently conflates G0 Building home with Office home |
| `RUNTIME_DIR` | [server/index.js:116](file:///D:/work/Claude-Office/server/index.js#L116) | `try { mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 }) } catch {}` | **OFFICE (conflated)** | Runtime directory definition; currently conflates G0 Building home with Office home |
| `RUNTIME_DIR` | [server/index.js:121](file:///D:/work/Claude-Office/server/index.js#L121) | `try { chmodSync(RUNTIME_DIR, 0o700) } catch {}` | **OFFICE (conflated)** | Runtime directory definition; currently conflates G0 Building home with Office home |
| `RUNTIME_DIR` | [server/index.js:122](file:///D:/work/Claude-Office/server/index.js#L122) | `const TOKEN_FILE = join(RUNTIME_DIR, 'auth-token')` | **OFFICE** | Per-office state file (token, agents, settings, delegation, inbox, marker) |
| `RUNTIME_DIR` | [server/index.js:174](file:///D:/work/Claude-Office/server/index.js#L174) | `try { chmodSync(RUNTIME_DIR, 0o700) } catch {}` | **OFFICE (conflated)** | Runtime directory definition; currently conflates G0 Building home with Office home |
| `RUNTIME_DIR` | [server/index.js:176](file:///D:/work/Claude-Office/server/index.js#L176) | `const file = join(RUNTIME_DIR, name)` | **OFFICE (conflated)** | Runtime directory definition; currently conflates G0 Building home with Office home |
| `homedir()` | [server/index.js:425](file:///D:/work/Claude-Office/server/index.js#L425) | `join(homedir(), '.claude', 'settings.json'),` | **G0** | Global user Claude configuration directory (~/.claude, settings.json) |
| `homedir()` | [server/index.js:426](file:///D:/work/Claude-Office/server/index.js#L426) | `join(homedir(), '.claude.json'),` | **G0** | Global user Claude configuration directory (~/.claude, settings.json) |
| `process.cwd()` | [server/index.js:427](file:///D:/work/Claude-Office/server/index.js#L427) | `join(process.cwd(), '.claude.json'),` | **OFFICE** | Project-local .claude.json config; must resolve from office.cwd |
| `homedir()` | [server/index.js:587](file:///D:/work/Claude-Office/server/index.js#L587) | `const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR \|\| join(homedir(), '.cla` | **G0** | Global user Claude configuration directory (~/.claude, settings.json) |
| `RUNTIME_DIR` | [server/index.js:1204](file:///D:/work/Claude-Office/server/index.js#L1204) | `const AGENTS_FILE = join(RUNTIME_DIR, 'agents.json')` | **OFFICE** | Per-office state file (token, agents, settings, delegation, inbox, marker) |
| `AGENT_OFFICE_HOME` | [server/index.js:1315](file:///D:/work/Claude-Office/server/index.js#L1315) | `// Settings — $AGENT_OFFICE_HOME/settings.json` | **OFFICE (conflated)** | Runtime directory definition; currently conflates G0 Building home with Office home |
| `AGENT_OFFICE_HOME` | [server/index.js:1328](file:///D:/work/Claude-Office/server/index.js#L1328) | `// server mirrors it as a marker file: $AGENT_OFFICE_HOME/answer-permission` | **OFFICE (conflated)** | Runtime directory definition; currently conflates G0 Building home with Office home |
| `RUNTIME_DIR` | [server/index.js:1333](file:///D:/work/Claude-Office/server/index.js#L1333) | `const SETTINGS_FILE = join(RUNTIME_DIR, 'settings.json')` | **OFFICE** | Per-office state file (token, agents, settings, delegation, inbox, marker) |
| `RUNTIME_DIR` | [server/index.js:1334](file:///D:/work/Claude-Office/server/index.js#L1334) | `const ANSWER_MARKER_FILE = join(RUNTIME_DIR, 'answer-permissions')` | **OFFICE** | Per-office state file (token, agents, settings, delegation, inbox, marker) |
| `RUNTIME_DIR` | [server/index.js:1728](file:///D:/work/Claude-Office/server/index.js#L1728) | `readState: () => { try { return JSON.parse(readFileSync(join(RUNTIME_DIR, '` | **OFFICE** | Per-office state file (token, agents, settings, delegation, inbox, marker) |
| `RUNTIME_DIR` | [server/index.js:1729](file:///D:/work/Claude-Office/server/index.js#L1729) | `paused: () => { try { return JSON.parse(readFileSync(join(RUNTIME_DIR, 'cha` | **OFFICE** | Per-office state file (token, agents, settings, delegation, inbox, marker) |
| `RUNTIME_DIR` | [server/index.js:2055](file:///D:/work/Claude-Office/server/index.js#L2055) | `writePrivate(join(RUNTIME_DIR, 'last-chat'), JSON.stringify(msg))` | **OFFICE** | Per-office state file (token, agents, settings, delegation, inbox, marker) |
| `RUNTIME_DIR` | [server/index.js:2199](file:///D:/work/Claude-Office/server/index.js#L2199) | `const inboxDir = join(RUNTIME_DIR, 'inbox')` | **OFFICE** | Per-office state file (token, agents, settings, delegation, inbox, marker) |
| `RUNTIME_DIR` | [server/index.js:2683](file:///D:/work/Claude-Office/server/index.js#L2683) | `const cronStatePath = join(RUNTIME_DIR, 'chat-poll-state')` | **OFFICE** | Per-office state file (token, agents, settings, delegation, inbox, marker) |
| `RUNTIME_DIR` | [server/index.js:3764](file:///D:/work/Claude-Office/server/index.js#L3764) | `RUNTIME_DIR,` | **OFFICE (conflated)** | Runtime directory definition; currently conflates G0 Building home with Office home |
| `AGENT_OFFICE_HOME` | [server/jsonfile.mjs:3](file:///D:/work/Claude-Office/server/jsonfile.mjs#L3) | `// file, and the file is private to the user (0600) like the rest of $AGENT` | **unsure** | Requires further review during phase 1 |
| `homeDir, AGENT_OFFICE_HOME, homedir()` | [server/settings.mjs:12](file:///D:/work/Claude-Office/server/settings.mjs#L12) | `export const homeDir = process.env.AGENT_OFFICE_HOME ?? join(homedir(), '.a` | **G0 / OFFICE (conflated)** | homeDir export used for both G0 (catalogue, circuits) and Office files |
| `homeDir` | [server/settings.mjs:13](file:///D:/work/Claude-Office/server/settings.mjs#L13) | `const file = join(homeDir, 'backend.json')` | **G0 (with Lx override)** | backend.json defines G0 defaults with per-office Lx overrides |
| `AGENT_OFFICE_HOME` | [scripts/agent-message.py:21](file:///D:/work/Claude-Office/scripts/agent-message.py#L21) | `TOKEN_FILE = os.path.join(os.environ.get("AGENT_OFFICE_HOME") or os.path.ex` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME` | [scripts/chat-ai-watcher.sh:13](file:///D:/work/Claude-Office/scripts/chat-ai-watcher.sh#L13) | `#   AGENT_OFFICE_HOME            state dir            (default ~/.agent-off` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME` | [scripts/chat-ai-watcher.sh:45](file:///D:/work/Claude-Office/scripts/chat-ai-watcher.sh#L45) | `STATE_DIR="${AGENT_OFFICE_HOME:-$HOME/.agent-office}"` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `homeDir` | [scripts/chat-backend.mjs:15](file:///D:/work/Claude-Office/scripts/chat-backend.mjs#L15) | `import { homeDir } from '../server/settings.mjs'` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `homeDir` | [scripts/chat-backend.mjs:38](file:///D:/work/Claude-Office/scripts/chat-backend.mjs#L38) | `if (role && result.text) result.text = guardChatReply(result.text, readJson` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME` | [scripts/chat-bridge.sh:10](file:///D:/work/Claude-Office/scripts/chat-bridge.sh#L10) | `STATE_DIR="${AGENT_OFFICE_HOME:-$HOME/.agent-office}"` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME` | [scripts/chat-poll.py:5](file:///D:/work/Claude-Office/scripts/chat-poll.py#L5) | `STATE_DIR = os.environ.get("AGENT_OFFICE_HOME") or os.path.expanduser("~/.a` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME` | [scripts/chat-post.py:15](file:///D:/work/Claude-Office/scripts/chat-post.py#L15) | `TOKEN_FILE = os.path.join(os.environ.get("AGENT_OFFICE_HOME") or os.path.ex` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME` | [scripts/chat-reply.py:5](file:///D:/work/Claude-Office/scripts/chat-reply.py#L5) | `STATE_DIR = os.environ.get("AGENT_OFFICE_HOME") or os.path.expanduser("~/.a` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME` | [scripts/chat-watcher.sh:18](file:///D:/work/Claude-Office/scripts/chat-watcher.sh#L18) | `STATE_DIR="${AGENT_OFFICE_HOME:-$HOME/.agent-office}"` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `process.cwd()` | [scripts/check-assets.mjs:100](file:///D:/work/Claude-Office/scripts/check-assets.mjs#L100) | `const root = resolve(process.argv[2] ?? process.cwd())` | **other (build)** | Build/dev tool resolving repo assets or build output |
| `homeDir` | [scripts/delegate.mjs:19](file:///D:/work/Claude-Office/scripts/delegate.mjs#L19) | `import { homeDir } from '../server/settings.mjs'` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `homeDir` | [scripts/delegate.mjs:24](file:///D:/work/Claude-Office/scripts/delegate.mjs#L24) | `const stateFile = join(homeDir, 'delegation.json')` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `process.cwd()` | [scripts/delegate.mjs:28](file:///D:/work/Claude-Office/scripts/delegate.mjs#L28) | `cwd: process.cwd(),` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `homeDir` | [scripts/delegate.mjs:59](file:///D:/work/Claude-Office/scripts/delegate.mjs#L59) | `mkdirSync(homeDir, { recursive: true })` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `homeDir` | [scripts/delegate.mjs:60](file:///D:/work/Claude-Office/scripts/delegate.mjs#L60) | `const log = openSync(join(homeDir, 'delegation.log'), 'a', 0o600)` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `homeDir` | [scripts/delegate.mjs:94](file:///D:/work/Claude-Office/scripts/delegate.mjs#L94) | `const release = acquireProcessLock(join(homeDir, 'delegation.lock'))` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME` | [scripts/doctor.mjs:25](file:///D:/work/Claude-Office/scripts/doctor.mjs#L25) | `*   token        $AGENT_OFFICE_HOME/auth-token exists and is mode 0600` | **G0 / OFFICE** | Doctor inspects both building-wide and office-specific files |
| `AGENT_OFFICE_HOME` | [scripts/doctor.mjs:408](file:///D:/work/Claude-Office/scripts/doctor.mjs#L408) | `? result(FAIL, `token: ${file} is missing although the server is up — hooks` | **G0 / OFFICE** | Doctor inspects both building-wide and office-specific files |
| `homedir()` | [scripts/doctor.mjs:442](file:///D:/work/Claude-Office/scripts/doctor.mjs#L442) | `const home = opts.home ?? env.HOME ?? homedir()` | **G0 / OFFICE** | Doctor inspects both building-wide and office-specific files |
| `AGENT_OFFICE_HOME` | [scripts/doctor.mjs:445](file:///D:/work/Claude-Office/scripts/doctor.mjs#L445) | `const officeHome = opts.officeHome ?? env.AGENT_OFFICE_HOME ?? join(home, '` | **G0 / OFFICE** | Doctor inspects both building-wide and office-specific files |
| `AGENT_OFFICE_HOME` | [scripts/doctor.mjs:508](file:///D:/work/Claude-Office/scripts/doctor.mjs#L508) | `lines.push(c('dim', '  honours AGENT_OFFICE_PORT, AGENT_OFFICE_HOME, CLAUDE` | **G0 / OFFICE** | Doctor inspects both building-wide and office-specific files |
| `process.cwd()` | [scripts/generate-office-bg.mjs:32](file:///D:/work/Claude-Office/scripts/generate-office-bg.mjs#L32) | `const outPath = join(process.cwd(), 'public', filename)` | **other (build)** | Build/dev tool resolving repo assets or build output |
| `process.cwd()` | [scripts/generate-sprites.mjs:9](file:///D:/work/Claude-Office/scripts/generate-sprites.mjs#L9) | `const SPRITES_DIR = join(process.cwd(), 'public', 'sprites')` | **other (build)** | Build/dev tool resolving repo assets or build output |
| `process.cwd()` | [scripts/generate-walks.mjs:9](file:///D:/work/Claude-Office/scripts/generate-walks.mjs#L9) | `const SPRITES_DIR = join(process.cwd(), 'public', 'sprites')` | **other (build)** | Build/dev tool resolving repo assets or build output |
| `homeDir` | [scripts/office-client.mjs:5](file:///D:/work/Claude-Office/scripts/office-client.mjs#L5) | `import { homeDir } from '../server/settings.mjs'` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `homeDir` | [scripts/office-client.mjs:8](file:///D:/work/Claude-Office/scripts/office-client.mjs#L8) | `const token = () => readFileSync(join(homeDir, 'auth-token'), 'utf8').trim(` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME, homedir()` | [scripts/office-run.mjs:40](file:///D:/work/Claude-Office/scripts/office-run.mjs#L40) | `const home = process.env.AGENT_OFFICE_HOME ?? join(homedir(), '.agent-offic` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `process.cwd()` | [scripts/office-run.mjs:44](file:///D:/work/Claude-Office/scripts/office-run.mjs#L44) | `const base = { sessionId, project: basename(process.cwd()), cwd: process.cw` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME` | [scripts/open-office.mjs:25](file:///D:/work/Claude-Office/scripts/open-office.mjs#L25) | `* 3333) and AGENT_OFFICE_HOME (default ~/.agent-office).` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `homeDir` | [scripts/report-usage.mjs:7](file:///D:/work/Claude-Office/scripts/report-usage.mjs#L7) | `import { homeDir } from '../server/settings.mjs'` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `homeDir` | [scripts/report-usage.mjs:11](file:///D:/work/Claude-Office/scripts/report-usage.mjs#L11) | `const token = readFileSync(join(homeDir, 'auth-token'), 'utf8').trim()` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME` | [scripts/rotate-token.mjs:5](file:///D:/work/Claude-Office/scripts/rotate-token.mjs#L5) | `* The server reuses the token in $AGENT_OFFICE_HOME/auth-token across` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME` | [scripts/start-office.sh:14](file:///D:/work/Claude-Office/scripts/start-office.sh#L14) | `# browser gets a redirect page in $AGENT_OFFICE_HOME rather than the tokene` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `AGENT_OFFICE_HOME` | [scripts/start-office.sh:18](file:///D:/work/Claude-Office/scripts/start-office.sh#L18) | `# under $AGENT_OFFICE_HOME (~/.agent-office): server.pid, vite.pid and` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `AGENT_OFFICE_HOME` | [scripts/start-office.sh:23](file:///D:/work/Claude-Office/scripts/start-office.sh#L23) | `#   AGENT_OFFICE_HOME      state dir (default ~/.agent-office)` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `RUNTIME_DIR, AGENT_OFFICE_HOME` | [scripts/start-office.sh:33](file:///D:/work/Claude-Office/scripts/start-office.sh#L33) | `RUNTIME_DIR="${AGENT_OFFICE_HOME:-$HOME/.agent-office}"` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `RUNTIME_DIR` | [scripts/start-office.sh:39](file:///D:/work/Claude-Office/scripts/start-office.sh#L39) | `SERVER_PID_FILE="$RUNTIME_DIR/server.pid"` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `RUNTIME_DIR` | [scripts/start-office.sh:40](file:///D:/work/Claude-Office/scripts/start-office.sh#L40) | `VITE_PID_FILE="$RUNTIME_DIR/vite.pid"` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `RUNTIME_DIR` | [scripts/start-office.sh:41](file:///D:/work/Claude-Office/scripts/start-office.sh#L41) | `WATCHER_PID_FILE="$RUNTIME_DIR/chat-watcher.pid"` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `RUNTIME_DIR` | [scripts/start-office.sh:42](file:///D:/work/Claude-Office/scripts/start-office.sh#L42) | `CHAT_AI_LOG="$RUNTIME_DIR/chat-ai.log"` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `RUNTIME_DIR` | [scripts/start-office.sh:51](file:///D:/work/Claude-Office/scripts/start-office.sh#L51) | `mkdir -p "$RUNTIME_DIR"` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `AGENT_OFFICE_HOME` | [scripts/stop-office.sh:5](file:///D:/work/Claude-Office/scripts/stop-office.sh#L5) | `# Reads the pid files written under $AGENT_OFFICE_HOME (~/.agent-office):` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `AGENT_OFFICE_HOME` | [scripts/stop-office.sh:21](file:///D:/work/Claude-Office/scripts/stop-office.sh#L21) | `#   AGENT_OFFICE_HOME      state dir (default ~/.agent-office)` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `RUNTIME_DIR, AGENT_OFFICE_HOME` | [scripts/stop-office.sh:28](file:///D:/work/Claude-Office/scripts/stop-office.sh#L28) | `RUNTIME_DIR="${AGENT_OFFICE_HOME:-$HOME/.agent-office}"` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `AGENT_OFFICE_HOME` | [scripts/stop-office.sh:44](file:///D:/work/Claude-Office/scripts/stop-office.sh#L44) | `echo "  Stops the processes recorded in \$AGENT_OFFICE_HOME/{chat-watcher,s` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `RUNTIME_DIR` | [scripts/stop-office.sh:140](file:///D:/work/Claude-Office/scripts/stop-office.sh#L140) | `stop_pidfile "Chat watcher" "$RUNTIME_DIR/chat-watcher.pid" 'chat-(ai-)?wat` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `RUNTIME_DIR` | [scripts/stop-office.sh:143](file:///D:/work/Claude-Office/scripts/stop-office.sh#L143) | `stop_pidfile "Server" "$RUNTIME_DIR/server.pid" '(^\|/\| )node( \|$)\|serve` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `RUNTIME_DIR` | [scripts/stop-office.sh:146](file:///D:/work/Claude-Office/scripts/stop-office.sh#L146) | `stop_pidfile "Vite dev server" "$RUNTIME_DIR/vite.pid" 'vite\|(^\|/\| )node` | **G0 / OFFICE** | Process lifecycle manages Building server port and Office workers |
| `homeDir` | [scripts/watcher-run.mjs:7](file:///D:/work/Claude-Office/scripts/watcher-run.mjs#L7) | `import { homeDir } from '../server/settings.mjs'` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `homeDir` | [scripts/watcher-run.mjs:10](file:///D:/work/Claude-Office/scripts/watcher-run.mjs#L10) | `const release = acquireProcessLock(join(homeDir, 'watcher-supervisor.lock')` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `homeDir` | [scripts/watcher-run.mjs:17](file:///D:/work/Claude-Office/scripts/watcher-run.mjs#L17) | `const pid = readFileSync(join(homeDir, 'chat-watcher.pid'), 'utf8').trim()` | **OFFICE** | Script targets specific office state, tokens, or project cwd |
| `AGENT_OFFICE_HOME` | [hooks/agent-tracker.py:243](file:///D:/work/Claude-Office/hooks/agent-tracker.py#L243) | `ANSWER_MARKER = os.path.join(os.environ.get('AGENT_OFFICE_HOME') or os.path` | **OFFICE** | Hook token/marker lookup; must resolve office from session cwd |
| `AGENT_OFFICE_HOME` | [hooks/agent-tracker.sh:52](file:///D:/work/Claude-Office/hooks/agent-tracker.sh#L52) | `# answer (the marker file $AGENT_OFFICE_HOME/answer-permissions exists — th` | **OFFICE** | Comment referencing answer-permissions marker |
| `AGENT_OFFICE_HOME` | [hooks/agent-tracker.sh:101](file:///D:/work/Claude-Office/hooks/agent-tracker.sh#L101) | `TOKEN_FILE="${AGENT_OFFICE_HOME:-$HOME/.agent-office}/auth-token"` | **OFFICE** | Hook token/marker lookup; must resolve office from session cwd |
| `AGENT_OFFICE_HOME` | [hooks/install-hooks.sh:43](file:///D:/work/Claude-Office/hooks/install-hooks.sh#L43) | `# chained (saved in $AGENT_OFFICE_HOME/statusline-prev and` | **G0** | Global hook installer configuring machine-wide ~/.claude settings |
| `AGENT_OFFICE_HOME` | [hooks/install-hooks.sh:102](file:///D:/work/Claude-Office/hooks/install-hooks.sh#L102) | `OFFICE_HOME="${AGENT_OFFICE_HOME:-$HOME/.agent-office}"` | **G0** | Global hook installer configuring machine-wide ~/.claude settings |
| `AGENT_OFFICE_HOME` | [hooks/status-line.sh:24](file:///D:/work/Claude-Office/hooks/status-line.sh#L24) | `#             $AGENT_OFFICE_HOME/statusline-prev); the default line is prin` | **OFFICE** | Hook token/marker lookup; must resolve office from session cwd |
| `AGENT_OFFICE_HOME` | [hooks/status-line.sh:33](file:///D:/work/Claude-Office/hooks/status-line.sh#L33) | `# command's rows, saved in $AGENT_OFFICE_HOME/subagent-statusline-prev).` | **OFFICE** | Hook token/marker lookup; must resolve office from session cwd |
| `AGENT_OFFICE_HOME` | [hooks/status-line.sh:44](file:///D:/work/Claude-Office/hooks/status-line.sh#L44) | `OFFICE_HOME="${AGENT_OFFICE_HOME:-$HOME/.agent-office}"` | **OFFICE** | Hook token/marker lookup; must resolve office from session cwd |
| `process.cwd()` | [electron/after-pack.cjs:37](file:///D:/work/Claude-Office/electron/after-pack.cjs#L37) | `console.log(`  • after-pack  fetching ${MODULE} prebuilt for electron@${ele` | **other (build)** | Build/dev tool resolving repo assets or build output |
| `AGENT_OFFICE_HOME` | [electron/helpers.cjs:224](file:///D:/work/Claude-Office/electron/helpers.cjs#L224) | `/** The runtime dir, as the server resolves it: AGENT_OFFICE_HOME, else ~/.` | **G0 / OFFICE** | Electron resolves runtimeDir for Building window and office webviews |
| `homedir()` | [electron/helpers.cjs:225](file:///D:/work/Claude-Office/electron/helpers.cjs#L225) | `function runtimeDirFromEnv(env = process.env, home = os.homedir()) {` | **G0 / OFFICE** | Electron resolves runtimeDir for Building window and office webviews |
| `AGENT_OFFICE_HOME` | [electron/helpers.cjs:226](file:///D:/work/Claude-Office/electron/helpers.cjs#L226) | `const dir = env && env.AGENT_OFFICE_HOME` | **G0 / OFFICE** | Electron resolves runtimeDir for Building window and office webviews |


---

## 4. Scripts and Hooks Single-Tenant Assumptions

This section reviews every script and hook in [`hooks/`](file:///D:/work/Claude-Office/hooks/) and [`scripts/`](file:///D:/work/Claude-Office/scripts/) that assumes a single home directory (`~/.agent-office`), fixed port (3334), or a single token file (`auth-token`).

### 4.1 Script & Hook Inventory Table

| Script / Hook | Assumed Port | Assumed State Directory / Files | Token Discovery & Authentication Mechanism | Migration Requirement for Multi-Office |
|---|---|---|---|---|
| [`hooks/agent-tracker.py`](file:///D:/work/Claude-Office/hooks/agent-tracker.py) | `3334` (or `OFFICE_POST_URL`) | `$AGENT_OFFICE_HOME/answer-permissions` | Reads `OFFICE_TOKEN` from env; signs event payload with HMAC-SHA256(token). | Send session `cwd`; server maps `cwd` to `officeId` and verifies HMAC using that office's token. |
| [`hooks/agent-tracker.sh`](file:///D:/work/Claude-Office/hooks/agent-tracker.sh) | `3334` (`AGENT_OFFICE_PORT`) | `$AGENT_OFFICE_HOME/auth-token` | Reads file `${AGENT_OFFICE_HOME:-~/.agent-office}/auth-token` into `TOKEN`, passes to Python. | Resolve office token from office registry lookup matching current working directory. |
| [`hooks/install-hooks.sh`](file:///D:/work/Claude-Office/hooks/install-hooks.sh) | `3334` (`AGENT_OFFICE_PORT`) | `$AGENT_OFFICE_HOME/{statusline-prev,subagent-statusline-prev}` | Checks server health at `http://127.0.0.1:3334/health`; no auth token needed for install. | Stays G0 machine-wide installer for Claude Code global configuration (`~/.claude`). |
| [`hooks/status-line.sh`](file:///D:/work/Claude-Office/hooks/status-line.sh) | `3334` (`AGENT_OFFICE_PORT`) | `$AGENT_OFFICE_HOME/auth-token` | Reads `${AGENT_OFFICE_HOME:-~/.agent-office}/auth-token`; sends `Authorization: Bearer $TOKEN`. | Resolve office from current session `cwd` and send to `/o/<id>/status`. |
| [`scripts/agent-message.py`](file:///D:/work/Claude-Office/scripts/agent-message.py) | `3334` (`AGENT_OFFICE_PORT`) | `$AGENT_OFFICE_HOME/auth-token` | Reads `TOKEN_FILE = join(AGENT_OFFICE_HOME, 'auth-token')`; sends `Bearer $TOKEN` to `/chat/reply`. | Must accept `OFFICE_ID` via env/CLI; target `/o/<id>/chat/reply`. |
| [`scripts/chat-ai-watcher.sh`](file:///D:/work/Claude-Office/scripts/chat-ai-watcher.sh) | `3334` (`AGENT_OFFICE_PORT`) | `$AGENT_OFFICE_HOME/chat-ai-watcher.pid` | Invokes `chat-backend.mjs` and curl; no direct token reading. | Must be spawned per-office with `OFFICE_ID` and office `cwd` in environment. |
| [`scripts/chat-backend.mjs`](file:///D:/work/Claude-Office/scripts/chat-backend.mjs) | N/A | `homeDir/delegation.json` | Reads delegation state via filesystem; no HTTP token. | Import path resolver `officeHome(id)` instead of global `homeDir`. |
| [`scripts/chat-bridge.sh`](file:///D:/work/Claude-Office/scripts/chat-bridge.sh) | `3334` (`AGENT_OFFICE_PORT`) | `$AGENT_OFFICE_HOME/chat.db` | Directly queries SQLite DB file; delegates replies to `chat-reply.py`. | Direct to office-specific DB in `levels/<id>/chat.db`. |
| [`scripts/chat-poll.py`](file:///D:/work/Claude-Office/scripts/chat-poll.py) | `3334` (`AGENT_OFFICE_PORT`) | `$AGENT_OFFICE_HOME/{chat.db,chat-poll-state}` | Queries SQLite DB file directly; no HTTP token. | Point SQLite query to `levels/<officeId>/chat.db`. |
| [`scripts/chat-post.py`](file:///D:/work/Claude-Office/scripts/chat-post.py) | `3334` (`AGENT_OFFICE_PORT`) | `$AGENT_OFFICE_HOME/auth-token` | Reads `join(STATE_DIR, 'auth-token')`; sends `Bearer $TOKEN` to `/event`. | Take `OFFICE_ID`; read token from `levels/<id>/token` and post to `/o/<id>/event`. |
| [`scripts/chat-reply.py`](file:///D:/work/Claude-Office/scripts/chat-reply.py) | `3334` (`AGENT_OFFICE_PORT`) | `$AGENT_OFFICE_HOME/auth-token` | Reads `join(STATE_DIR, 'auth-token')`; sends `Bearer $TOKEN` to `/chat/reply`. | Take `OFFICE_ID`; read token from `levels/<id>/token` and post to `/o/<id>/chat/reply`. |
| [`scripts/chat-watcher.sh`](file:///D:/work/Claude-Office/scripts/chat-watcher.sh) | `3334` (`AGENT_OFFICE_PORT`) | `$AGENT_OFFICE_HOME/chat-watcher.pid` | Invokes `chat-poll.py` and `chat-reply.py`. | Must run as a distinct process per office with `OFFICE_ID` in env. |
| [`scripts/delegate.mjs`](file:///D:/work/Claude-Office/scripts/delegate.mjs) | N/A | `homeDir/{delegation.json,delegation.log,delegation.lock}` | Local lock and filesystem state; uses `process.cwd()`. | Must resolve office from `OFFICE_ID` or `cwd`; use `officeHome(id)`. |
| [`scripts/doctor.mjs`](file:///D:/work/Claude-Office/scripts/doctor.mjs) | `3334` (`AGENT_OFFICE_PORT`) | `$AGENT_OFFICE_HOME/auth-token` | Reads `$officeHome/auth-token`; tests HMAC challenge against `GET /health`. | Must inspect Building status (G0) plus iterate registered levels in `building.json`. |
| [`scripts/gather-context.sh`](file:///D:/work/Claude-Office/scripts/gather-context.sh) | `3334` (`AGENT_OFFICE_PORT`) | N/A | Hits `GET /agents` and `POST /chat/inbox/read`; no token today. | Target `/o/<id>/agents` and `/o/<id>/chat/inbox/read` with office token. |
| [`scripts/office-client.mjs`](file:///D:/work/Claude-Office/scripts/office-client.mjs) | `3334` (`AGENT_OFFICE_PORT`) | `homeDir/auth-token` | Reads `join(homeDir, 'auth-token')` into `token()`. | Take `OFFICE_ID`; resolve token from office path; prefix requests with `/o/<id>`. |
| [`scripts/office-run.mjs`](file:///D:/work/Claude-Office/scripts/office-run.mjs) | `3334` (`AGENT_OFFICE_PORT`) | `$AGENT_OFFICE_HOME/auth-token` | Reads `join(home, 'auth-token')`; signs requests with HMAC signature. | Worker runner; pass `OFFICE_ID` and `cwd` in env; sign with office token. |
| [`scripts/office.mjs`](file:///D:/work/Claude-Office/scripts/office.mjs) | `3334` (`AGENT_OFFICE_PORT`) | N/A | CLI wrapper hitting `/health`, `/backends`, `/brains`. | Upgrade to Building/Level CLI (e.g. `office level list`, `office level add`, `office run`). |
| [`scripts/open-office.mjs`](file:///D:/work/Claude-Office/scripts/open-office.mjs) | `3334` (`AGENT_OFFICE_PORT`) | `$RUNTIME_DIR/auth-token` | Reads token from disk; validates server health; opens `/#token=<token>`. | Must support opening Building (`/building/`) or specific office (`/o/<id>/#token=<token>`). |
| [`scripts/report-usage.mjs`](file:///D:/work/Claude-Office/scripts/report-usage.mjs) | `3334` (`AGENT_OFFICE_PORT`) | `homeDir/auth-token` | Reads `join(homeDir, 'auth-token')`; sends `Bearer $token` to `POST /usage`. | Take `OFFICE_ID`; post usage to `/o/<id>/usage`. |
| [`scripts/rotate-token.mjs`](file:///D:/work/Claude-Office/scripts/rotate-token.mjs) | `3334` (`AGENT_OFFICE_PORT`) | `$RUNTIME_DIR/auth-token` | Deletes single `auth-token` file to force regeneration. | Support rotating specific office token (`rotate-token <officeId>`) or G0 admin token. |
| [`scripts/start-office.sh`](file:///D:/work/Claude-Office/scripts/start-office.sh) | `3334` (`AGENT_OFFICE_PORT`) | `$RUNTIME_DIR/{server.pid,vite.pid}` | Starts server & Vite; delegates browser open to `open-office.mjs`. | Stays Building server launcher; starts single server on port 3334. |
| [`scripts/stop-office.sh`](file:///D:/work/Claude-Office/scripts/stop-office.sh) | `3334` (`AGENT_OFFICE_PORT`) | `$RUNTIME_DIR/{server.pid,vite.pid,chat-watcher.pid}` | Kills PIDs recorded in single runtime dir or kills port 3334/3333. | Stops Building server and all office workers. |
| [`scripts/watcher-run.mjs`](file:///D:/work/Claude-Office/scripts/watcher-run.mjs) | N/A | `homeDir/{watcher-supervisor.lock,chat-watcher.pid}` | File-based process lock and PID supervisor. | Supervise chat watcher processes per office using `levels/<id>/` paths. |

---

## 5. Risks and Surprises

This section details technical hurdles and architectural traps that would make Phases 1-2 harder than stated in the approved plan.

### 5.1 Import-Time Execution Side Effects
Importing [`server/index.js`](file:///D:/work/Claude-Office/server/index.js) triggers significant runtime side effects before any function is called:
1. **Background timers start on import:**
   - `server/index.js:3384` runs `setInterval(() => sweepStale(), 5 * 60_000).unref()`.
   - `server/index.js:1616` calls `mountStatus`, which immediately runs `setInterval(...) sweepMs` at [`server/status.js:504`](file:///D:/work/Claude-Office/server/status.js#L504).
   - In unit tests, any test invoking `await import('../server/index.js')` leaves active background interval timers in the Node process.
2. **Filesystem creation & permission modification on import:**
   - [`server/index.js:116-121`](file:///D:/work/Claude-Office/server/index.js#L116-L121) calls `mkdirSync(RUNTIME_DIR)` and `chmodSync(RUNTIME_DIR, 0o700)`.
   - [`server/chat-db.js:18-21, 37`](file:///D:/work/Claude-Office/server/chat-db.js#L18-L37) creates `RUNTIME_DIR`, tightens permissions, and **immediately opens the SQLite database file** `new Database(DB_PATH)` with WAL mode.
   - If `server/chat-db.js` is imported anywhere, a lock and SQLite handle are created against `$AGENT_OFFICE_HOME/chat.db` immediately.
3. **HTTP and WebSocket servers instantiated on import:**
   - [`server/index.js:3538-3540`](file:///D:/work/Claude-Office/server/index.js#L3538-L3540) calls `createServer(app)` and `new WebSocketServer({ server: httpServer, path: '/ws' })`. The server is created and bound to the app at import time, not in `start()`.

### 5.2 Heavy Test Suite Coupling to Import-Time Environment
The Vitest test suite relies heavily on dynamic re-importing via `vi.resetModules()`:
- [`tests/helpers.ts:37-58`](file:///D:/work/Claude-Office/tests/helpers.ts#L37-L58) defines `loadOffice()`:
  ```typescript
  process.env.AGENT_OFFICE_HOME = dir
  vi.resetModules()
  const server = await import('../server/index.js')
  ```
- Over **30 test files** call `loadOffice()` and directly inspect or mutate module-level exports:
  `office.server.activeAgents`, `office.server.sessions`, `office.server.AUTH_TOKEN`, `office.server.broadcast`, `office.server.activity`, `office.server.processEvent`.
- **14 test files** explicitly set or inspect `process.env.AGENT_OFFICE_HOME` before importing modules:
  `tests/adapter-permissions.test.ts`, `tests/brain-routes.test.ts`, `tests/brains.test.ts`, `tests/circuit-breaker.test.ts`, `tests/delegation-runtime.test.ts`, `tests/doctor.test.ts`, `tests/helpers.ts`, `tests/hook-script.test.ts`, `tests/install-hooks.test.ts`, `tests/office-launcher.test.ts`, `tests/open-office.test.ts`, `tests/plugin.test.ts`, `tests/scripts.test.ts`, `tests/status-line.test.ts`.
- *Risk:* If `server/index.js` removes these exports in Phase 2 in favor of `ctx = createOfficeContext()`, the entire test suite will fail to compile and run.
- *Mitigation strategy:* During Phase 1-2, `server/index.js` must maintain a **compatibility façade / default context**. Module-level exports (`activeAgents`, `sessions`, `AUTH_TOKEN`) must proxy to the default office context (`defaultContext.activeAgents`, etc.) so existing unit tests remain green while multi-office tests run against explicit contexts.

### 5.3 Additional Callers of `homeDir` Missed in Early Plan Notes
Section 4 rule 3 of `docs/building-and-levels.md` stated:
> "Seven modules use it today: availability.mjs, catalogue.mjs, brains.mjs, scripts/delegate.mjs, chat-backend.mjs, office-client.mjs, settings.mjs."

The code scan revealed **two additional active script callers**:
- [`scripts/report-usage.mjs:7, 11`](file:///D:/work/Claude-Office/scripts/report-usage.mjs#L7-L11): imports `homeDir` from `settings.mjs` to locate `auth-token`.
- [`scripts/watcher-run.mjs:7, 10, 17`](file:///D:/work/Claude-Office/scripts/watcher-run.mjs#L7-L17): imports `homeDir` from `settings.mjs` to locate `watcher-supervisor.lock` and `chat-watcher.pid`.

Both must be included in the Phase 1 path migration.

### 5.4 Cross-Office Broadcast Bleed (`broadcast` Closure)
- In the existing codebase, `broadcast` is called in approximately 40 locations across `server/index.js`, `server/status.js`, and `server/permissions.js`.
- Currently, `broadcast` simply iterates `wss.clients` and transmits messages to every connected WebSocket on the server:
  ```javascript
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload)
  }
  ```
- If a single call site uses the global `broadcast` instead of `ctx.broadcast`, sensitive chat messages, permission requests, or task boards will leak to all browser windows across all offices.
- *Mitigation requirement:* Remove the global `broadcast` function entirely; every route and event handler must strictly receive `req.office.broadcast` or `ctx.broadcast`.

### 5.5 Multi-Process Lock & File Contention
- `availability.mjs` relies on `acquireProcessLock(join(homeDir, 'circuits-state.lock'))` and `join(homeDir, 'circuit-probes', ...)`. Because multiple worker processes and the server write to cooldowns, moving these to G0 (`global/cooldowns.json`, `global/circuits-state.lock`) is essential, but file locking semantics on Windows (especially with `openSync` with `O_EXCL`) must be verified to ensure cross-process probe synchronization doesn't fail under load.
- `notifications.json` has a single writer rule (the server), which simplifies concurrency, but means workers needing to raise notifications must post to the HTTP API rather than writing to disk.

### 5.6 Windows Path Canonicalization Nuances
- On Windows, the Claude Code hook in `hooks/agent-tracker.py` receives `cwd` in various formats depending on whether Claude Code was invoked from PowerShell, Command Prompt, Git Bash, or WSL:
  - `C:\Users\name\proj`
  - `c:\users\name\proj` (lowercase drive letter)
  - `/c/Users/name/proj` (Git Bash POSIX style)
  - `C:/Users/name/proj` (mixed forward slashes)
  - 8.3 short paths (e.g. `C:\Users\NAME~1\proj`)
  - Directory junctions / symlinks
- The registry lookup mapping `cwd -> officeId` must use a robust `canonicalCwd()` with `fs.realpathSync` and case-insensitive normalization on `process.platform === 'win32'`, covered by dedicated unit tests before hook routing is switched on.
