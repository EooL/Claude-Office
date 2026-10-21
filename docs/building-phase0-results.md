# Building Phase 0 results

Scope: the remaining Phase 0 groundwork from `building-and-levels.md` sections 4, 9 and 11 and `building-phase0-inventory.md`. No commit, push or deployment. Existing dirty work was preserved. All new runtime checks use disposable homes and ephemeral loopback ports; no active office or real `~/.agent-office` was used. Phase 1 paths/registry/migration work was not started.

## A — characterization before server edits

Added `tests/server-characterization.test.ts` and `tests/fixtures/server-routes.json` before editing production server code.

- The route fixture pins **52 explicit method/path registrations in order**, including all nine `mount*` modules, and the one additional `GET /` fallback when the UI is not built. Both built-UI and absent-UI branches are exercised. GET's implicit HEAD handling and static file middleware are documented rather than pretending all possible asset filenames form a finite route table. Introducing a nested router fails visibly until the collector understands its prefix; routes cannot silently disappear from the snapshot.
- Three real sockets on one ephemeral HTTP server pin the first frame as `{type:'auth', trusted}`, bearer-token subprotocol trust, trusted UI-token/conversation visibility, read-only redaction, and the current all-client broadcast behavior. A harmless marker reaches every connection; a prompt reaches trusted clients in full and the read-only client without private fields. This deliberately preserves today's global broadcast behavior for Phase 2 to scope later.
- Import creates a previously absent runtime home, SQLite database/WAL mode, and answer-permission marker, plus the 60-second status and five-minute stale-agent unref'd intervals. Import creates HTTP/WS server objects but does **not** listen or write `auth-token`. The test also pins compatibility exports (`activeAgents`, `sessions`, `activity` as Maps, tokens and functions). Teardown explicitly closes its databases, servers and captured timers.

An initial test assumption that `activity` was an array was corrected to the actual Map; no production behavior was changed to satisfy characterization.

## B — path-only office context

Added `server/office-context.mjs` with `createOfficeContext({ home, cwd })` returning only `{ id, home, cwd, tmp }`. It validates nonempty path strings, derives a deterministic opaque label, and returns frozen path metadata. It performs no filesystem calls, creates no directories/listeners/timers, and preserves caller path spelling. The label is not a registry entry and is never joined into a path.

`defaultOfficeContext` is one immutable descriptor per module instance, with id `default`. Its home retains the existing `AGENT_OFFICE_HOME || join(homedir(), '.agent-office')` behavior, including the empty-env fallback. Its cwd captures Node's startup directory via `path.resolve('.')`; it is not recomputed on requests. Its `tmp` is `join(home, 'tmp')` **metadata only**: no existing temp-file user was rerouted and no tmp directory is created.

`server/index.js` and `server/chat-db.js` now derive their existing `RUNTIME_DIR` from `defaultOfficeContext.home`; project-local MCP discovery uses `defaultOfficeContext.cwd`. No maps, tokens, DB handles, route mounts or socket state moved. No exports were removed or renamed. No directory, database filename, migration or schema changed. The server does not change cwd after startup; this implements the requested startup-cwd contract rather than introducing request-time cwd lookup.

`tests/office-context.test.ts` pins deterministic/pure construction, frozen default values captured once, absent and empty env fallback in fresh Node processes with disposable user homes, and no home/tmp creation. Characterization also verifies the server runtime and actual SQLite filename agree with the shared default descriptor and that tmp remains absent. Focused context/characterization/guard/two-process integration passed: **four files, 11 tests**, `docs/building-phase0-context-integrated.log`.

Important gate limitation: the original full baseline was not green before these production changes (see the independent token-symlink blocker below). Characterization and the guard were green before/after the path-only integration; the unrelated failing security assertion was not suppressed. Therefore the requested all-green baseline condition has not yet been established.

## C — two real process fixture

Added `tests/helpers/two-offices.ts` and `tests/two-offices.test.ts` independently of production code.

The helper launches **two actual `node server/index.js` processes**, with distinct runtime homes, workspace/user-home/config/registry/task directories, ports and tokens. Disposable `backend.json` disables provider services, avoiding subscription-backed catalogue probes. It awaits `/health` and reads only each disposable token. Port allocation briefly reserves then releases a loopback ephemeral port; a competing bind causes bounded startup failure, never fallback to the production port.

The baseline uses the **same session id, agent id, agent name, task and initial chat text** in both processes. An A-only chat message and agent completion reach A's API/WebSocket but not B; B retains its agent with the same id. A's token receives **401** when posting an event to B. B's socket heartbeat proves the negative observation did not merely use a disconnected socket. This is explicitly process-based isolation, not two contexts in one process.

`stop()` is idempotent and bounded; Windows uses `taskkill /T /F`, POSIX uses the detached process group. Child exits are awaited before deleting only the fixture's own temporary tree. The existing `listen()`/`loadOffice()` helpers are for in-process app imports, so they cannot replace direct-entry-point process startup here.

Focused verification: one file/one test passed; `docs/building-phase0-two-offices.log`. The negative socket observation is bounded (150 ms plus B ping/pong); it is a seed, not a proof of the entire later leak suite.

## D — creation/start split investigation

**Deferred: not a small, behavior-neutral change.** No misleading `createOffice()` wrapper returning the existing singleton was added.

The inventory's wording needs a distinction: import constructs `app`, `httpServer` and `wss`, but only the existing `start()` listens (or the direct-entry-point `isMainModule()` path calls it). Characterization pins that distinction. Import also opens SQLite, creates files and starts two intervals. `start()` then installs fatal/signal/exit handlers; on successful bind it starts catalogue refresh, writes the token, repairs modes, syncs the answer marker, starts registry/task polling and attaches their close handlers.

A real split requires these linked changes:

1. Introduce `openChatDb(home)` with explicit close ownership while retaining the current default DB facade. Its prepared statements and import-time schema/mode handling are currently singleton bindings.
2. Move office Maps/Sets/counters, permission/settings/token values and their helper-function closures together into a constructor. Merely returning the exports leaves every instance sharing the same state.
3. Mount routes against per-instance dependencies. Status, permissions, health, registry, tasks, backends, brains, artifacts and chat-actions currently capture `broadcast`, sessions, DB, tokens and callbacks at mount time; their captured values must be reviewed separately, not mechanically renamed.
4. Separate the shared HTTP/WS listener and trusted-socket ownership from office construction. Health's count callback references `wss`; broadcast closes over both `wss` and its trusted-client WeakSet. Their initialization order and lifetime are part of current behavior.
5. Give timers/pollers/catalogue work explicit owners and disposal. Import's two intervals, registry/tasks start/stop, catalogue refresh and process exit/signal hooks cannot be duplicated per future office. Catalogue refresh remains building-wide work.
6. Preserve the existing named exports as a default-office facade while tests migrate gradually to explicit instances. Existing import/resetModules tests depend on binding identities, token generation timing, filesystem side effects and mounted closures.

That crosses the singleton state, database, route mount and lifecycle boundaries and would require substantial test migration. It belongs in a separately gated constructor/scoping change; this block does not alter it.

## Verification, environment and guard ceilings

Initial unbounded full runs encountered OS/V8/Python memory exhaustion before production server edits, including `MemoryError`, V8 semi-space allocation failures and Windows error 1455 (“paging file is too small”). No assertions were skipped or weakened to hide those failures; no paging settings or unrelated processes were changed. A temporary opt-in worker cap and Node heap caps were used diagnostically. The one-worker run completed all other files and exposed the same `ws-auth` blocker. That diagnostic runner edit was removed after isolating fixture startup probes; the final runner retains its original four-worker behavior and deadlines. Temporary environment changes were restored.

Startup tests were also inadvertently probing installed real provider CLIs whenever `startCatalogueRefresh()` found a missing catalogue. `tests/helpers.ts:loadOffice()` now seeds a fresh empty catalogue **only inside the disposable test home** and leaves explicit catalogue fixtures intact. This prevents provider startup probes without changing production code or service settings. The import-side-effect characterization explicitly opts out with `seedCatalogue: false`, so it still tests creation of a missing home. Direct two-process fixtures separately disable services in their own homes.

Guard: **43 existing state tags unchanged**, zero new mutable module-level state. The only new module constant is frozen path metadata. `tests/fixtures/server-state.json` lowers `processCwd['index.js']` **1 → 0**; `artifacts.js` remains **1**, so the literal direct-call ceiling total drops **2 → 1**. No new direct-call user was added. The context's documented startup `path.resolve('.')` capture is the single bootstrap directory source; arbitrary implicit cwd dependencies are not covered by the guard's existing lexical scanner. All four existing `homeDir` users remain unchanged (`availability.mjs`, `brains.mjs`, `catalogue.mjs`, `settings.mjs`). The guard itself was not weakened.

### Independent preexisting token-symlink blocker

This account can now create the Windows file-symlink fixture. `tests/ws-auth.test.ts` consequently executes (rather than skipping on EPERM) its existing “does not follow a symlink” case and correctly fails: `readTokenFile` reuses the planted target's token because Windows exposes no `O_NOFOLLOW` here. This also reproduces with no office-context production edits, after disabling provider catalogue probes. Logs: `building-phase0-ws-investigation.log` and `building-phase0-isolated-startup.log`.

The narrow rejection fix would change observable token-loading behavior. Permission was requested because the block explicitly forbids behavior changes. The test stays enabled; it has not been skipped, weakened or rewritten to accept the leak. No security fix has been applied pending that decision.

Final standard command, **without worker or heap overrides**:

```text
npm run test:win
```

**66 files completed: 65 passed / 1 failed. Tests: 1,148 passed / 1 failed / 15 skipped. Exit 1.** The only failure is the existing Windows planted-token-symlink assertion above. There were zero file timeouts, import failures or unhandled/memory errors in this final run. The original 63-file suite gained three files (characterization, office-context, two-offices); the existing guard's two tests remain enabled.

Evidence: `docs/building-phase0-final.log`. Focused context/characterization/guard/two-office tests: **11/11 passed**, `docs/building-phase0-context-integrated.log`. `git diff --check` passed. No new test skips were introduced; the total fell from the earlier 16 to 15 because the previously privilege-skipped symlink test now runs and fails.

The user's all-green gate is **not satisfied**. This is reported as a blocker rather than silently expanding the authorized behavior-change scope. The pending choice is whether to permit the separate narrow symlink rejection fix or retain current runtime behavior and keep this baseline failure visible.

## Phase 1 assumptions and remaining limits

Phase 1 can rely on the explicit route fixture (both UI branches), auth-first/redacted-vs-trusted WebSocket characterization, current broadcast fan-out, import lifecycle characterization, shared immutable default paths and the reusable process-isolation fixture. Existing module exports remain the compatibility facade. The context factory's opaque labels are not authoritative office ids or a registration API.

It **cannot** yet rely on a green full baseline, safe Windows token symlink handling, constructor ownership/disposal or same-process multi-office isolation. No office routing, registry, `g0Dir`/`officeHome`, `building.json`, file migration, scoped broadcast or new authentication behavior has been implemented. Do not start Phase 1 until the baseline/security decision is resolved.

## Files changed in this block

- Production: new `server/office-context.mjs`; path-source substitutions only in `server/index.js` and `server/chat-db.js`.
- Characterization/context: new `tests/server-characterization.test.ts`, `tests/office-context.test.ts`, `tests/fixtures/server-routes.json`; lowered cwd ceiling in existing `tests/fixtures/server-state.json`.
- Process fixture: new `tests/helpers/two-offices.ts`, `tests/two-offices.test.ts`.
- Test isolation: `tests/helpers.ts` seeds the disposable catalogue, with an explicit opt-out for import characterization.
- Documentation/evidence: this report and `docs/building-phase0-*.log`. No permanent runner edit remains. All preexisting unrelated dirty files and the compatibility exports were retained.

## Addendum: token symlink fix (applied after owner approval)
`readTokenFile` (server/index.js) now also checks, after the open, that the path still names the file that was opened (`lstat` is not a symlink and has the same dev/ino as the descriptor). Windows has no `O_NOFOLLOW`, so the open may have followed a planted link; such a token is no longer reused and the server mints a new one. `tests/ws-auth.test.ts` "does not follow a symlink" passes. Full `npm run test:win`: 66/66 files, 1149 passed, 15 skipped, exit 0 (log `p0-after-symlink-fix.log` in docs/e2e-review-2026-10-21).
