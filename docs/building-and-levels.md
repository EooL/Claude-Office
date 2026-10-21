# Building, G0 and Levels — plan (v2, reviewed)

Status: plan, nothing implemented. Reviewed against the code with `ponytail-review`; every must-fix is folded in below.
Assumed load: one person, one machine, 2–5 offices. The risks are leaks between offices and crash blast radius, not throughput.

## 1. Model

- **Building** — the one Claude-Office installation on the machine: one server, one port.
- **G0 (Ground)** — the Claude-Office layer. Global settings, shared context, provider limits, the registry, the notification feed. It does not run a working office.
- **Lx (Level)** — one isolated office: one project folder (`cwd`), its own chat, agents, delegation, inbox, artifacts, tokens.
- Isolation is **logical**, by `officeId`, inside one process. It is not process isolation. A bug in scoping is a leak, so leak tests are acceptance criteria (section 9).
- IDs: a stable short id (`off_ab12cd`) is used in URLs and on disk. `L1`, `L2` … and the project name are display labels that can change. The id is only ever a **registry key**: it must match `^off_[a-z0-9]{6,12}$` and exist in `building.json` before any filesystem call, and paths come from the registry entry (`home`), never from joining the id into a path.

### 1.1 Threat model (what isolation does and does not give)

- **Protects against:** content or a bug in one office reaching another office through the API, WebSocket, browser storage, temp files, file reader, notifications or hooks; a token from one office working on another.
- **Does not protect against:** a local process that runs as the same OS user. Workers are started with the user's rights (some with `--yolo`), so they can read other offices' files and token files on disk. A sandboxed worker (`workspace-write`) cannot *write* outside its `cwd`, but can still read. This is the same trust level as today and must be stated in the docs. Real OS-level isolation (separate users, containers) is out of scope.
- **Shared-origin consequence of path routing.** All offices share one browser origin, so browser storage is shared: a script running in any office page could read tokens of every office stored in `localStorage`. Isolation in the browser therefore rests on **preventing script injection**, not on origin boundaries. Controls: (1) tokens stored per office under `agent-office.token.<officeId>` (today one key, `src/officeToken.ts`), never the admin token; (2) a Content-Security-Policy on the app shell (`script-src 'self'`, no inline script, `object-src 'none'`, `base-uri 'none'`) — today only artifacts have one (`server/artifacts.js:44`); (3) chat and agent text stay rendered as escaped text (no `dangerouslySetInnerHTML` anywhere in `src/` today, kept by a grep test); (4) artifacts keep `default-src 'none'` and `nosniff`; (5) cookies are **not** used for auth (a cookie scoped to `/o/<id>` is still sent on same-origin requests from another office’s page).
- Therefore: tokens are stored **hashed** server-side, workers get only their own office's token in env, `levels/` and `global/` are never inside any office `cwd`, and the registry **rejects** an office whose `cwd` contains, or is inside, `~/.claude-office` or another office's `cwd` (a nested project would let one office's sandboxed worker write into another's).

## 2. What lives where

| Layer | Contents | Why |
|---|---|---|
| **G0** | `backend.json` (enabled services, default brain, `eventMode`), `catalogue.json`, brains and roles, `brain-last.json`, **`cooldowns.json`, `circuits-state.lock`, `circuit-probes/`**, `building.json` (registry), `notifications.json`, `shared-context/`, theme | Provider limits are per **account**. If L1 hits a limit, L2 must know at once. |
| **Lx** | `chat.db`, `agents.json`, `delegation.json/.log/.lock`, `inbox/`, `last-chat`, `chat-poll-state`, `answer-permissions`, `tmp/`, token hashes, the `cwd` | Nothing here may be visible from another office. |
| **Lx override** | partial `backend.json` | Cascade like `resolveAgent`: Lx value wins, else G0. |

```
~/.claude-office/
  global/   backend.json catalogue.json cooldowns.json circuits-state.lock circuit-probes/ notifications.json shared-context/
  building.json
  levels/<officeId>/   chat.db agents.json delegation.* inbox/ tmp/ token …
```

Phase 1 implementation decision (paths and registry only): the tree above is a
future layout, not a migration instruction. An absent `building.json` is
synthesized in memory as schema version 1 with the single `default` office,
using the startup `AGENT_OFFICE_HOME` (otherwise `~/.agent-office`) and cwd.
Reads, imports and server/script startup do not create the registry or its
root. Only explicit `addOffice` / `removeOffice` operations publish it.
`AGENT_OFFICE_ROOT` overrides the registry root (default `~/.claude-office`);
it does not relocate runtime state.

Legacy G0 and the first office share the existing home. Explicit mutations
record `g0Home` so adding another office still cannot move shared files.
Office homes are explicit registry paths. Deleting `building.json` restores
the synthesized single-office view. The legacy office cannot be archived
while its home also holds G0; separating that shared home requires a later,
explicit migration decision. Other office homes are moved into the registry
root's `archive/` on removal, with project folders protected.

## 3. Addressing (path routing)

- One port (default 3334 server, 3333 UI), unchanged. **One origin**, `http://127.0.0.1:<port>`.
- Every office lives under `/o/<officeId>/…`: API, WebSocket (`/o/<id>/ws`), artifacts, the UI (`/o/<id>/`). G0 (Building screen, admin, registry) lives under `/building/…`.
- Implementation: the existing routes are mounted on one **sub-router**, `app.use(/o/:officeId, resolveOffice, officeRouter)`. `resolveOffice` validates the id against the registry and attaches `req.office`; nothing else runs before it. The WebSocket upgrade handler resolves the office from the same path.
- **Why this is simpler:** `isAllowedHost` (`index.js:346`), the WebSocket Host check (`index.js:3543`) and `isAllowedOrigin` (`index.js:309-318`) stay exactly as they are, so the DNS-rebinding protection is untouched. No `*.localhost` resolution to verify in Electron or browsers, no Vite `allowedHosts`.
- **Client:** `officeHttpBase()` (`src/serverUrl`) is the single place that builds API URLs, so it gets the `/o/<id>` prefix; the WebSocket URL likewise. The UI routes by pathname (not hash) because the token handoff already uses the URL fragment (`#token=`).
- **Server static UI:** serve `index.html` for `/o/*` and `/building/*` (SPA fallback); Vite `base` is `/` so assets resolve from any depth. The Vite dev proxy forwards `/o` and `/building` to 3334.
- **Electron** (`electron/helpers.cjs` `serverUrls`, `runtimeDirFromEnv`: one home, one port today) loads `127.0.0.1:<port>/o/<id>/` for the selected office and `/building/` for the Building screen, reading that office’s token file.
- **Legacy unprefixed paths** (`/event`, `/chat`, … used by hooks and ~20 scripts): hook ingest resolves the office by `cwd` (section 6). Other scripts must pass `OFFICE_ID` and use `/o/<id>/…`; without it they work only while the building has exactly one office, otherwise they get a clear 400 “OFFICE_ID required”. Nothing silently falls into the first office.

## 4. OfficeContext (the core change)

`server/index.js` holds ~15 module-level variables (`activeAgents`, `sessions`, `activity`, `pendingNeedsYou`, `signalRing`, `signalSeq`, `videoPaused`, …) and `chat-db.js` opens one SQLite file at import. All of it moves into:

```
ctx = { id, home, cwd, tmp, chatDb, agents, sessions, delegation, inbox, settings (cascaded),
        broadcast, tokenHash, uiToken, sockets }
```

Rules that make forgetting impossible:
1. **State inventory first.** A grep lists every module-level `Map`, `Set`, `let` and counter in `server/`. Each is tagged G0 or office. A test fails when a new untagged one appears.
2. **No global `broadcast`.** Only `ctx.broadcast`, which reaches only that office's sockets. A forgotten call does not compile instead of leaking (≈40 call sites today).
3. **`homeDir` is removed.** Replaced by `g0Dir` and `officeHome(id)`. A build check fails if the old constant is imported. Seven modules use it today: `availability.mjs`, `catalogue.mjs`, `brains.mjs`, `scripts/delegate.mjs`, `chat-backend.mjs`, `office-client.mjs`, `settings.mjs`. The cooldown and circuit files go to `g0Dir`, **not** the office home.
4. **No `process.cwd()` in `server/`** (`index.js:427`, `delegate.mjs:28`, `artifacts.js:11`). `cwd` is passed from the context. Enforced by a grep test.
5. `chat-db.js` becomes a factory `openChatDb(home)`.
6. Scripts (`brain-run`, `delegate`, `report-*`, `office-run`) take the office from `OFFICE_ID` in env and resolve their home through the same `paths` module.
7. **The `mount*` pattern is the real shape of phase 2.** `server/index.js:1616-1726` mounts `mountStatus`, `mountPermissions`, `mountHealth`, `mountRegistry`, `mountTasks`, `mountBackends`, `mountBrains`, `mountArtifacts`, `mountChatActions` **once**, each capturing `broadcast`, `sessions`, `db`, `AUTH_TOKEN` in a closure. They are mounted once on the shared `app`, so every captured dependency must become a lookup on the request (`req.office`). List each mount and its captured dependencies in phase 0; refactor mount by mount, each with its two-office test. With path routing each `mount*` receives the office sub-router instead of `app`, and its captured dependencies become `req.office.*` lookups.
8. **Timers and heavy work.** `sessions.js:512`, `status.js:504`, `tasks.js:397` run intervals per mount; they run once and iterate offices (or one timer per context), never N unrelated timers. `brainRoutes.js:52` refreshes the catalogue (the CLIs take seconds): that is **G0 work, done once**, not per office.
9. **Writers.** Scripts and workers raise attention and cooldowns by calling the server, except `cooldowns.json` and the circuit files, which several processes write today and stay under `acquireProcessLock`. `notifications.json` has a **single writer: the server**.
10. Every log line carries `[officeId]`; `/health` reports per office and for the building, and its proof (`officeProof`) uses that office's token so `open-office` still verifies it reached the right office.
11. **Compatibility facade (found by the phase-0 inventory, `docs/building-phase0-inventory.md` §5.2).** `tests/helpers.ts` `loadOffice()` does `vi.resetModules()` and imports `server/index.js`; 30+ test files read its module-level exports (`activeAgents`, `sessions`, `AUTH_TOKEN`, `broadcast`, `activity`, `processEvent`). Phase 1-2 keep those exports as a facade proxying to a default office context, and migrate the tests to `createOffice()` gradually; the facade is removed last.
12. **`createOffice()` / `start()` split (inventory §5.1).** Today importing `server/index.js` creates the runtime dir, opens SQLite, starts timers (`index.js:3384`, `status.js:504`) and creates the HTTP and WebSocket servers. Phase 1 moves these into `createOffice({ home, cwd })` (state only, nothing listening) and a building-level `start()` (one HTTP/WS server, timers that iterate offices).
13. **Two more `homeDir` users** than rule 3 lists: `scripts/report-usage.mjs` and `scripts/watcher-run.mjs` (inventory §5.3). Nine modules in total.
14. **Open classification calls** (inventory §1.1): `health` (building-wide uptime plus per-office counts) is split in two; `registry` reads the machine-wide `~/.claude/sessions` and is G0, routing sessions to offices by `cwd`.

## 5. Auth

Phase 2, sub-step 1 implementation boundary: ownership moves before closure
scoping. `createOffice({ home, cwd })` owns pure state and a chat database,
with no listener, timer or token. The default office is constructed once in
`default-office.mjs`; `index.js` keeps aliases of its exact collections and
settings object. The three scalar counters live on that state object.
Existing route/mount/broadcast/helper closures continue using those aliases.
This deliberately retains the compatibility facade and global broadcast
until sub-steps 2 and 3, rather than removing them in this constructor change.

The database factory implementation is in `chat-store.mjs` and re-exported
by `chat-db.js`. This separates explicit construction from the eager default
chat facade, so importing `office.mjs` cannot open an unrelated default
database. The existing chat exports are exact aliases of the default chat
instance. The default context retains its registry id; explicit factory
contexts retain their opaque path-metadata ids until registry attachment.

Still to scope: status, permissions and tasks and all mount captures;
health's building lifecycle/per-office counts; session-registry routing;
HTTP/WS server ownership; broadcasts, tokens and trusted-socket routing;
existing timers/pollers and shutdown. `close()` currently owns only the chat
database; it does not dispose resources still owned by the server.

- **One token per office**, bound to `officeId`, plus an **admin token for G0**. A token from L1 gets 403 on L2.
- UI token (`index.js:369`) becomes per office and lives in the context.
- **Removing an office** deletes its context, closes its sockets and invalidates its tokens. Test: an old token gets 403 afterwards.
- There is **no cross-office token**. An office’s token can never obtain a login for another office. Only the **G0 admin token** can mint a one-time login for an office (section 7). The admin token is kept out of `localStorage` (memory or session storage only), because everything on this origin can read `localStorage`.
- Unauthenticated connections keep today's read-only view (`redactForReadOnly`, `index.js` WS handshake), now per office. They never get the bell feed or any other office's data.
- The legacy `AGENT_OFFICE_HOME`, `AGENT_OFFICE_PORT` and `AGENT_OFFICE_UI_PORT` keep working: when set, the migrated first office uses that home and the building uses that port.

## 6. Hooks and sessions

The hook is installed globally in `~/.claude`, so every Claude Code session on the machine posts to the server (`hooks/agent-tracker.py:49`). There is no office in the event today.

- The registry maps **project folder → officeId** (`realpath`, longest-prefix match).
- The hook sends `cwd`; the server resolves the office, then verifies the HMAC with that office's token. The hook reads the token from that office's token file, found through the same lookup.
- **Path normalisation (Windows is the main platform here).** The same folder arrives as `C:\Users\…`, `C:/Users/…`, `/c/Users/…` (Git Bash), with different case, 8.3 short names, junctions or symlinks. One function `canonicalCwd()` handles drive-letter case, separators, Git Bash form and `realpath`, with case-insensitive compare on Windows. Registry registration and every hook lookup use it. Unit tests cover each spelling of one folder, a nested folder, and a sibling with a shared prefix (`proj` vs `proj-old`).
- **All callers of the single home and port 3334 are inventoried and made office-aware:** `hooks/agent-tracker.py`, `agent-tracker.sh`, `status-line.sh`, `install-hooks.sh`; `scripts/chat-post.py`, `chat-poll.py`, `chat-reply.py`, `chat-bridge.sh`, `chat-watcher.sh`, `chat-ai-watcher.sh`, `agent-message.py`, `gather-context.sh`; `start-office.sh`, `stop-office.sh`, `doctor.mjs`, `open-office.mjs`, `office-client.mjs`, `report-usage.mjs`. Each either takes `OFFICE_ID` / resolves by `cwd`, or is explicitly G0-only. `doctor` reports any caller that still assumes one office.
- A session from a folder with **no office** goes to a visible **Unassigned** bucket in G0 (and raises a bell item "new project — create an office?"). It never falls into L1 by default.
- Workers and the chat watcher are separate processes per office, spawned with `OFFICE_ID`, `cwd` and token in env (crash isolation, correct working folder).

Phase 1 leaves these Python/shell callers on the single-home and unprefixed
HTTP contract for Phase 3 (inventory section 4): `hooks/agent-tracker.py`,
`hooks/agent-tracker.sh`, `hooks/status-line.sh`, `hooks/install-hooks.sh`,
`scripts/chat-post.py`, `scripts/chat-poll.py`, `scripts/chat-reply.py`,
`scripts/chat-bridge.sh`, `scripts/chat-watcher.sh`,
`scripts/chat-ai-watcher.sh`, `scripts/agent-message.py`,
`scripts/gather-context.sh`, `scripts/start-office.sh`, and
`scripts/stop-office.sh`. Their home/token/PID/state resolution remains
`AGENT_OFFICE_HOME` or the legacy home, with `AGENT_OFFICE_PORT` or 3334;
no registry lookup or office route prefix has been added.

## 7. Notifications — the bell

A bell button sits **to the left of Settings** in every office and in G0. It shows attention requests from G0 and from every level, and takes you to the one that needs you from anywhere.

**What it shows**
- Badge: count of unresolved items; colour by highest severity.
- Dropdown grouped by level, G0 first: `officeLabel · kind · short title · age`. Sorted by severity, then recency.
- Click → jump straight to that office (and to the thing: permission prompt, chat thread, incident).

**Sources (reuse what exists)** — `NEEDS_YOU_KINDS` already defines `permission`, `idle`, `quota`, `agent-input` (`index.js:628`). Add: incident declared, worker or delegation failed, circuit open / provider limit hit (G0), watcher down, new Unassigned project, update or doctor warning (G0).

**Mechanics**
- Each context publishes `attention` items to a G0 **aggregator**: `{ id, officeId|'g0', kind, severity, title, createdAt, resolvedAt?, deepLink }`. Persisted in `notifications.json` (lock + ring buffer, e.g. 200 items, TTL).
- **Auto-resolve:** the item clears when its source clears (a raised hand lowered, incident all-clear, circuit closed). **Acknowledge** by the user hides it everywhere (state is in G0, not in one origin).
- **Delivery is through the office’s own route.** Each office exposes `GET /o/<id>/building/attention` (and a message type on its own WebSocket), authorised by *its own* token. The server reads the G0 store in-process and returns the summaries. No extra token, no cross-office call. Items carry a cursor so a reconnect misses nothing. Unauthenticated read-only connections get an empty feed.
- **Navigation (the isolation-sensitive part):** the click is client-side routing to `/o/<officeId>/#item=<id>`. The page uses the target office’s token if this browser already has one (stored per office, §1.1). If it does not, it asks the **Building (G0) session** for a **one-time login code** for that office: single use, ~30 s TTL, bound to that `officeId`, delivered in the URL fragment and exchanged by `POST /o/<id>/auth/exchange`. An **office token can never mint** a code for another office; only the G0 admin token can (test 10). The admin token is **never persisted** in the browser: it comes through the existing handoff (`open-office.mjs` `officeLink`, Electron reads the token file) into memory/session storage only.
- Dedupe: same `(officeId, kind, sourceKey)` updates one item instead of stacking.

**Data minimisation (security rule).** The feed carries **no chat text, no prompts, no file paths**. `title` is a server-built label from a fixed vocabulary plus the office label. Anything user- or agent-supplied is clamped and rendered as text, never HTML. This keeps the bell from becoming a side channel between offices. A test asserts it.

**Nice to have:** sound and OS notification (opt-in, per kind), Electron tray badge, keyboard shortcut (e.g. `Alt+B`) to open the bell and `Enter` to jump to the top item, "snooze 1 h", per-office mute, "mark all read".

## 8. Settings, shared context, cost

- Settings screen has two scopes: **Global (G0)** and **Office**. A field overridden in the office is marked; "reset to global" removes the override.
- Shared context: Markdown files in `global/shared-context/`, read by `planPrompt` / `goalPrompt` (`server/delegation.mjs`) before the office's own context, with a size cap.
- Cost: Payroll per office, plus a Building total in G0. Unknown cost keeps the "not reported / (partial)" rules from the Payroll fix.
- Brains and roles are defined in G0; an office can override which brain a role uses, not the definitions.

## 9. Acceptance tests (the leak suite)

Run on a fixture with **two offices that use the same ids everywhere** (same session id, same message text, same file names). One-office tests prove nothing about isolation.

1. API: every route returns only the calling office's data; wrong-office token → 403.
2. WebSocket: events of L1 never reach an L2 socket (including `health`, `signal`, `task_board`).
3. Disk: no read or write outside `levels/<id>/` and the office `cwd`, except the listed G0 files.
4. Temp and artifacts: the file reader roots are `[realpath(cwd), realpath(office.tmp)]`; a link to another office's temp or project is refused. Adapters create outputs in `office.tmp` (`adapters.mjs:432`), not the shared `tmpdir()`.
5. Hooks: events route by `cwd`; unknown folder → Unassigned; wrong-office HMAC rejected.
6. Cooldowns: a limit hit in L1 is seen by L2.
7. Tokens: removed office → old token 403, sockets closed.
8. Crash: break L1's db or throw in an L1 timer → L1 is marked failed, L2 keeps answering.
9. Workers run in the office `cwd`; prompts name that path.
10. Bell: only summaries cross offices; navigation lands signed in; ack clears everywhere; auto-resolve works; no chat text in the feed.
11. State guard: a new untagged module-level `Map`/`let` in `server/` fails the suite.
12. Browser controls: the app shell sends the CSP above; a grep test fails on `dangerouslySetInnerHTML`/`innerHTML` in `src/`; the token key is per office and the admin token is never in `localStorage`; no auth cookie is set.
13. Routing: `/o/<id>/…` is served only for registered ids; unknown or malformed ids (`..`, uppercase, too long, encoded slashes) get the uniform error and never reach the filesystem; HTTP **and** the WebSocket upgrade (`/o/<id>/ws`) resolve the office the same way; the loopback Host and Origin guards are unchanged and still refuse anything else.
14. Login codes: single use, expire, bound to one office, reusable only once, not accepted from an office token; the fragment code never appears in server logs.
15. Registry: nested `cwd`, `cwd` containing `~/.claude-office`, and the same `cwd` twice are refused; every Windows spelling of a folder resolves to one office.
16. Migration: starting with an existing install, **no byte of the old home moves**, the first office points at it, and an old `AGENT_OFFICE_HOME` still works. Re-running the migration changes nothing.
17. Mounts: for each `mount*` route, two offices with identical ids return different data (guards the closure-capture risk, section 4 rule 7).
18. Concurrency: two simultaneous server starts end with one winner and a clean registry; two offices writing cooldowns at once keep the file valid.

## 10. Crash isolation

One server process means one crash can take every office down. Mitigations: wrap each office's timers and spawn callbacks so an error marks only that office failed and stops it; a process-level `unhandledRejection` handler that logs and keeps serving; a supervisor that restarts the server; per-office rate limits so a noisy office cannot starve the others.

## 11. Phases

**v1 (multi-office, with the bell)**

0. **Characterization and fixtures.** Tests that pin current behaviour. The two-office fixture. The module-state inventory. `createOffice({ home, cwd })` plus a thin test helper, and migrate the 13 test files that rely on `AGENT_OFFICE_HOME` at import time — while there is still only one office.
1. **Paths and registry.** `g0Dir` / `officeHome(id)` / `office.tmp`, remove `homeDir`, `building.json` (with a `schemaVersion`), `canonicalCwd()`, scripts read `OFFICE_ID`. **Migration is in place:** the registry points the first office at the existing `~/.agent-office` (or `$AGENT_OFFICE_HOME`); nothing is moved, so rollback is deleting `building.json`. A building-level lock prevents two servers rewriting the registry. Suite stays green.
2. **Scope the server.** `OfficeContext`, host → office middleware, `ctx.broadcast`, `openChatDb`, per-office tokens, per-office artifacts roots, no `process.cwd()`, the state guard. Leak tests 1–4, 7, 9 and 11.
3. **Hooks and processes.** Routing by `cwd`, the Unassigned bucket, workers and watcher per office. Leak test 5.
4. **Settings cascade and shared limits.** G0 → office cascade; cooldowns and circuit breakers in G0 under lock. Leak test 6.
5. **Crash isolation.** Section 10. Leak test 8.
6. **Bell.** Aggregator and `notifications.json` (single writer: the server), `/o/<id>/building/attention` route, bell UI, in-app jump (login code for offices not yet opened in this browser), ack and auto-resolve. Leak tests 10 and 14.

**v1.1**

7. Building screen (cards: status, active agents, cost, last event), office switcher, `office level add/open/stop/remove` CLI, Electron window handling.
8. Shared context in prompts, Building cost total, bell extras (sound, tray badge, snooze, mute, shortcut).
9. `doctor` for the whole building.

Sequencing rule: do the invisible, risky work (0–5) before the visible work (7–9). Start phase 1 only after the current Windows test-baseline work is merged, because phases 1–2 touch `server/index.js` and most of the same tests.

## 12. Open decisions

1. Tokens per office plus a G0 admin token (recommended) — or one shared token?
2. ~~Subdomains vs paths~~ **Decided: path routing** `/o/<officeId>/…` (subdomains judged too complex). See §3 and the shared-origin controls in §1.1.
3. Stable id plus display label (recommended)?
4. One window with a switcher (recommended; navigation is client-side routing under `/o/<id>`) — or one window per office?
5. `videoPaused` and similar global toggles: G0 or per office? (Recommended: per office, unless it is a machine-wide setting.)
6. Can one `cwd` belong to two offices? (Recommended: no; one office per project folder.)
7. Is "Unassigned" auto-created as an office after a prompt, or only on user action? (Recommended: only on user action.)

Removing an office **archives** `levels/<id>` (moved to `archive/`, restorable) instead of deleting it; permanent deletion is a separate, confirmed action. Never touches the project folder. Limits: at most 16 offices per building, id and label validated.

## 13. Hard-review log (second pass)

| # | Gap found | Folded into |
|---|---|---|
| 1 | Host guard (`isAllowedHost`), WebSocket Host check and `isAllowedOrigin` would refuse new hosts | §3 (path routing: guards stay as they are) |
| 2 | An office token able to mint a login for another office defeats isolation | §5, §7 |
| 3 | Cross-origin bell feed needed CORS and a notify token | §7 (office route reads G0 in-process, no extra token) |
| 4 | `mount*` closures capture `broadcast`/`sessions`/`db`/token once | §4 rules 7–8, test 16 |
| 5 | Catalogue refresh, timers per mount, multi-process writers | §4 rules 8–9 |
| 6 | Windows path forms (`C:\`, `/c/`, case, junctions); nested/duplicate `cwd` | §1.1, §6, test 14 |
| 7 | ~20 python/shell callers of port 3334 and the single token file | §6 |
| 8 | Same-user processes can read other offices' files | §1.1 (stated limit, hashed tokens, no nested cwd) |
| 9 | Migration by moving files while the server holds WAL and locks | §11 phase 1 (in place), test 15 |
| 10 | Vite dev proxy and Electron single-home assumptions | §3 |
| 11 | Id used as a path, log/health not per office, destructive remove | §1, §4 rule 10, §12 |
| 12 | Tests import the server and read its module state; import-time side effects; two more `homeDir` users (phase-0 inventory) | §4 rules 11-14 |

## 14. Not yet checked

All of `server/index.js` (~3800 lines): more module-level state may exist than the ~15 variables found. How the hook locates the right token file. Cost of one SQLite handle per office. Whether `OfficeContext` can be introduced without breaking `server/index.js` exports used by tests. Whether the SPA fallback for `/o/*` and a Vite `base` of `/` work in the Electron build and the dev proxy.
