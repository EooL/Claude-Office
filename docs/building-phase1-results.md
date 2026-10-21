# Building Phase 1: paths and registry

Date: 2026-10-21. Local dirty checkout; no commit, push or deployment. All
runtime and registry writes used disposable directories; no live office
configuration or real home files were written or moved. Provider helpers
used fake CLIs; no subscription prompts.

## Changes

| File | Change |
|---|---|
| `.gitattributes` | Keep the layout fixture at LF so its byte comparison survives Windows checkouts. |
| `server/paths.mjs` | Read-only `g0Dir()`, `officeHome(id)`, `officeTmp(id)`. Validate ids and resolve explicit registry homes; never construct a home from an id. |
| `server/canonicalCwd.mjs` | Canonical Windows drive/case/separator/Git Bash/UNC/extended paths, native realpath including existing ancestors, strict boundary-aware `isNested(parent, child)`. Missing paths use a lexical fallback without creation. |
| `server/registry.mjs` | In-memory absent-registry default, schema validation, explicit add/remove/list, maximum 16 offices, cwd overlap checks, bounded process-lock acquisition, atomic replacement and bounded Windows sharing-error retries. Archive non-legacy homes and preserve project files. |
| `server/settings.mjs` | Removed exported `homeDir`; `backend.json` resolves through G0. |
| `server/availability.mjs` | Cooldowns, circuit state lock and probe locks resolve through G0; existing process locking remains. |
| `server/brains.mjs` | `brain-last.json` resolves through G0. |
| `server/catalogue.mjs` | `catalogue.json` resolves through G0. |
| `server/index.js` | Runtime directory resolves through `officeHome(OFFICE_ID ?? 'default')`; existing chat, agents, inbox, token and settings paths remain relative to that directory. No state, auth, routes or broadcasts changed. |
| `server/chat-db.js` | Database runtime directory uses the same office path resolver; database initialization and exports remain. |
| `scripts/delegate.mjs` | Delegation state, lock and log use the env-selected office home. |
| `scripts/chat-backend.mjs` | Delegation reply guard reads the selected office state. |
| `scripts/office-client.mjs` | Existing token read resolves through the selected office home; HTTP contract unchanged. |
| `scripts/report-usage.mjs` | Existing token read resolves through the selected office home. |
| `scripts/watcher-run.mjs` | Supervisor lock and watcher PID use the selected office home. Shell child behavior unchanged. |
| `scripts/office-run.mjs` | Existing token path resolves through the selected office home. |
| `scripts/test-win.mjs` | Per-file disposable runtime, registry root, HOME and USERPROFILE overrides; optional `--serial` retains all assertions and existing timeouts under memory pressure. |
| `tests/server-state-guard.test.ts` | Added old-export import guard across server, scripts, frontend and Electron sources. |
| `tests/fixtures/server-state.json` | Lowered `homeDirUsers` to empty; no other ceiling raised. |
| `docs/building-and-levels.md` | Recorded the absent-registry and legacy G0 decisions, safe legacy-removal refusal, and unchanged Python/shell callers for Phase 3. |

`AGENT_OFFICE_ROOT` selects only the registry root (default
`~/.claude-office`). Without `building.json`, reads synthesize schema version
1 and office `default` from the startup context. Reads/imports/startup never
initialize the registry or create its root. Explicit mutations persist
`g0Home`, preserving the old shared state location even after offices are
added. Deleting the registry restores the legacy single-office view.

## Characterization and new tests

Step A was captured and passed before migrating production path consumers.
`tests/file-layout.test.ts` drives two real server entry-point processes in
disposable homes/workspaces, with provider discovery disabled. For one office
it exercises settings and chat API writes, an agent event and directed inbox
message, backend settings, catalogue save, brain-last save, cooldown and a
live recovery-probe lock, the real delegate worker's no-plan path, the
already-supervised watcher path and the disabled-service office-run path.
The helper stops both process trees and removes their disposable data.

`tests/fixtures/file-layout.json` records the relative file layout, including
SQLite WAL/SHM files and the transient probe lock (hash normalized). The test
compares serialized UTF-8 snapshot text directly with the fixture, rather
than updating a snapshot automatically. It passed before and after path
migration: **identical fixture bytes**. Runtime timestamps, random tokens and
SQLite content are not asserted to be byte-identical.

Other new coverage:

- `tests/canonical-cwd.test.ts`: 6 tests covering Windows spellings, junctions,
  native short-path resolution, UNC, nonexistent descendants, containment
  and shared-prefix siblings. A system with 8.3 names disabled may return the
  long spelling; the test verifies the native spelling returned by Windows.
- `tests/paths.test.ts`: 13 tests covering absent-registry no-creation,
  explicit paths, invalid/unknown ids, stable G0, and migrated real helper
  paths. A local ephemeral HTTP receiver verifies selected-office token
  reads by office-client, report-usage, delegate and office-run; fake agy
  prevents provider traffic. Watcher lock selection is exercised directly.
- `tests/building-registry.test.ts`: 20 tests covering synthesis, explicit
  writes, every requested refusal, actual canonical junction/alias duplicate
  rejection, future/malformed schema refusal without rewriting, maximum
  offices, archives preserving project bytes, levels-under-root archives,
  two concurrent child-process additions with a concurrent JSON observer,
  and injected temporary Windows rename denial with the prior revision
  remaining visible.
- Existing Phase 0 route/handshake/two-process isolation tests remain part of
  the full suite. No compatibility export was removed except the expressly
  requested `settings.mjs` `homeDir` export.

## Verification

Final command: `npm run test:win -- --serial`.

**70/70 files passed; 1,190 tests passed; 15 skipped; 0 failed files; exit 0.**
The completed log is
[`building-phase1-final.log`](e2e-review-2026-10-21/building-phase1-final.log).
This includes the final ID/newline checks and per-file HOME/USERPROFILE,
runtime and registry-root isolation. No memory error or file timeout occurred
in the final run. Compared with Phase 0, this adds four files and 41 passing
tests; skips remain 15. `git diff --check` also passed.

Non-fatal MaxListeners warnings remain in the repeated startup fixtures in
`ws-auth`; their exit/SIGINT/SIGTERM listener lifecycle was left unchanged.

The first full run found a real Windows `EPERM` replacement race in the new
concurrency test. The registry now retries only temporary Windows sharing
errors, retaining atomic replacement under its lock; it never unlinks the
old file first. Focused tests passed after that correction.

A subsequent parallel run overlapped a targeted check and hit native Node
`Zone Allocation failed - process out of memory` errors. No tests, assertions
or timeout limits were weakened. Serial reruns passed; the final run above
also includes the tightened user-home isolation. Earlier diagnostic logs are
`building-phase1-full.log`, `building-phase1-full-final.log` and
`building-phase1-serial.log` in the same review directory.

Guard ceilings: `homeDirUsers` went from four server files to `[]`.
`processCwd` remains `artifacts.js: 1`, `index.js: 0`. The 43 existing
module-level state tags are unchanged; no new mutable module state was added.

## Limits and deferred work

- Removing the legacy office is deliberately refused while its home also
  contains G0. Archiving it would move shared state, violating this phase's
  hard constraint. Other office homes are archived, never project folders.
  A later explicit G0 separation decision is required before legacy removal.
- Archive moves use filesystem rename. Cross-volume archives and recovery
  after a process dies between a home rename and registry publication were
  not verified. Ordinary write failure attempts to move the home back.
  Registry operations do not stop running contexts or invalidate tokens;
  Phase 2 must arrange office shutdown before archiving live state.
- The successful fake-provider office-run probe reproducibly triggered this
  machine's native `win/async.c` `UV_HANDLE_CLOSING` assertion at forced
  `process.exit`. Its path regression runs the real script with exitCode and
  natural event-loop drain instead. Direct successful CLI teardown failed in
  that probe and remains unfixed in this behavior-preserving path phase;
  production exit behavior was left unchanged. The disabled-service CLI
  path runs directly in the layout characterization.
- The watcher probe exercises lock reuse, not a live subscription-backed
  watcher session. Chat-backend's provider execution is covered by the
  existing suite; no new live-provider acceptance was attempted.
- No hooks, hook installer, Python/shell scripts, token semantics, HTTP/WS
  routing, broadcasts or OfficeContext state were changed. The plan lists
  the remaining single-home Python/shell callers for Phase 3. In particular,
  the watcher shell still needs its own office-aware migration then.
- This provides path/registry groundwork, not concurrent office contexts
  within one process or per-office route authorization. Existing singleton
  state and default workspace capture remain for Phase 2.

## What Phase 2 can assume

Validated registry keys resolve explicit home paths; canonical cwd keys and
strict containment checks are available. Default single-office paths remain
in place and G0 stays at its legacy location. Registry absence is reversible
and side-effect free; unknown schemas fail closed. Scripts can select a
registered home with `OFFICE_ID`, but keep the existing HTTP contract until
the routing phase. The file-layout fixture, import guard, route/handshake
baselines and state ceilings are regression gates for the next work.

## Addendum (boss verification)
A default-parallel `npm run test:win` run failed `building-registry` once: the concurrent-add test lost the Windows rename race (EPERM) after the 1 s retry budget while four workers and a 1 ms polling reader ran under memory pressure. Alone it passed 3/3. The retry budget in `writeBuilding` was raised to 5 s (`server/registry.mjs`); the next default-parallel run passed: 70/70 files, 1,190 tests, exit 0 (`e2e-review-2026-10-21/building-phase1-verify.log`).
