# Building Phase 2, sub-step 1: state constructor

Date: 2026-10-21. Local dirty checkout retained. No commit, push or deployment.
All runtime writes and process fixtures used disposable homes/root overrides
and ephemeral ports. No active office or real user runtime/config was changed.

## Per-file changes

| File | Change |
|---|---|
| `server/chat-store.mjs` | Extracted the existing initialization, schema/migrations, pragmas, permission tightening, prepared statements and six chat functions into `openChatDb(home)`. Each call owns its statements and handle; returns `db`, API functions, `MAX_REACTIONS` and idempotent `close()`. Import opens no database. |
| `server/chat-db.js` | Compatibility facade: re-exports the factory and constant; existing functions and default DB are exact aliases of `defaultOffice.chat`. |
| `server/office-state.mjs` | Pure `createOfficeState()`: all requested collections, settings and three scalar fields. No imports, filesystem work, timers or listeners. |
| `server/office.mjs` | `createOffice({ home, cwd })` composes path metadata, independent state and chat. Construction opens SQLite only in the supplied home. `close()` closes that chat instance. |
| `server/default-office.mjs` | Sole eager default owner, constructed through the same factory from the existing home resolver and startup cwd. Its frozen metadata retains the registry office id. |
| `server/index.js` | Replaced collection/settings allocations with aliases of the default state. Replaced all scalar accesses with state properties. Existing helper functions, route/mount bodies, broadcast implementation, auth and exports remain in place. |
| `tests/chat-db-factory.test.ts` | Original facade/API characterization, independent statement/database lifetimes and legacy schema migration. |
| `tests/office-state.test.ts` | Original default state/import-lifecycle characterization and pure state-instance independence. |
| `tests/office-instances.test.ts` | Original default identity/signal/video characterization plus two-office in-process isolation and constructor resource checks. |
| `tests/server-state-guard.test.ts` | Extended detection to known office constructors and mounted-store owners; retained all previous scans and ceilings. |
| `tests/fixtures/server-state.json` | Removed moved ownership keys; tagged the default owner and previously untracked existing mounted stores honestly. |
| `docs/building-and-levels.md` | Recorded aliasing, factory/facade dependency separation and deferred closure/resource scoping. |

## Characterization and aliasing

Before production refactors, focused tests passed against the old code:

- Database: existing function exports, file path/WAL/schema, transcript
  visibility, recipient matching, inbox/read/seen mutations, reactions and
  thread retrieval.
- State: existing exported Map identities and empty defaults, settings,
  absence of listening, and the same two unref import intervals.
- Default facade and scalar behavior: repeated-import identity for
  `activeAgents`, `sessions`, `activity`, `AUTH_TOKEN`, `broadcast` and
  `processEvent`; signal sequence `[1, 2]`; video toggle response and filtering
  with deterministic timestamps.

Those tests remain enabled after extraction. The integrated identity check
also compares the exported Maps/settings directly with `defaultOffice.state`,
and every existing chat function/default DB with `defaultOffice.chat` using
reference equality. No proxy, wrapper function, copy of a Map or second
default database was introduced. Existing closures still refer to the same
aliased objects. Function names and the existing named/default export surface
remain; `openChatDb` is the additive factory export.

The small core/facade split avoids a dependency cycle: `office.mjs` imports
the side-effect-free chat factory, `default-office.mjs` constructs once, and
the old chat facade and index share it. Merely importing the explicit office
factory does not instantiate the default office. Its context uses the
existing opaque path id; the eager default metadata uses its registry id.

## Moved ownership

`createOfficeState()` owns these 17 fields:

- Maps: `activeAgents`, `subagentAliases`, `pendingStarts`, `activity`,
  `sessions`, `sessionTimers`, `pendingNeedsYou`, `needsYouTimers`,
  `sessionSignals`, `a2aPairLog`.
- `waitCalls` WeakMap; `trustedClients` WeakSet; `signalRing` array;
  mutable `settings` object.
- `signalSeq`, `videoPaused`, `videoPausedSince` scalar properties. Every
  former scalar use was grepped and changed, preserving increments, response
  key names and the timestamp cutoff comparison.

The database handle, migration column Set and all prepared statements now
belong to each chat instance. Immutable configuration lookup sets remain
unchanged.

Not moved in this sub-step:

| Owner | Reason / next work |
|---|---|
| `status`, `permissions`, `tasks` | Existing mounts construct stores and capture callbacks/dependencies. Moving them requires mount and request scoping in sub-step 2, expressly excluded here. |
| `health` | Existing building lifecycle plus callbacks reading per-office counts and shared `wss`; leave lifecycle and closures unchanged. Guard tags the current owner G0, not a claim that all its data is global. |
| session `registry` | Existing building-level scanner with captured sessions and callbacks. Cwd dispatch and office scoping remain future work. This is distinct from the Phase 1 building registry. |
| HTTP server, WebSocket server and `broadcast` | Existing shared construction/closures remain. Only ownership of the trusted-client WeakSet moved; authentication and broadcast logic did not. |
| Tokens, UI token and token helper closures | Explicitly excluded; still generated/loaded/checked by the existing code with unchanged timing. |
| Existing intervals, registry/task polling and exit/signal cleanup | No new timers or listeners. Moving ownership/disposal requires the later lifecycle split. |

The settings object was missing from the old lexical guard's keys, although
it was OFFICE in the inventory. It is now owned and covered by the default
office owner. All OFFICE-tagged collections/scalars in the old fixture moved;
the mounted office stores above remain explicitly tagged.

## In-process isolation

`tests/office-instances.test.ts` creates A and B in ONE process, in different
disposable homes, using the same agent id, session id, message sender/text
and message id 1. It verifies distinct mutable instances (including weak
collections), absent cross-office state/messages, distinct SQLite handles
and disk files, and continued B writes after A closes twice. The explicit
constructor is observed to start no timeout, interval or HTTP listener and
to create neither tokens nor tmp directories. Importing the factory leaves
the unused default home and building root absent.

`tests/chat-db-factory.test.ts` separately verifies per-instance prepared
methods, independent mutations/close, and in-place migration preserving old
rows. Existing Phase 0 route/handshake and Phase 1 byte-layout snapshots are
unchanged and remain full-suite gates.

## Guard and full verification

Guard ownership tags: 43 -> 31. Removed the 16 moved index collection/scalar
allocations and two chat-db allocations. Added one eager default owner and
five existing mounted owners (`status`, `permissions`, `tasks`, `health`,
`registry`) to the stronger scan. Constructor-local allocations are not
module-level state. No allocation is hidden behind an untagged module-level
factory call among the known owners.

Ceilings remain `homeDirUsers: []`, `processCwd: { artifacts.js: 1,
index.js: 0 }`; no ceiling rose. Existing facade aliases are references,
not duplicate state owners.

Final full command: `npm run test:win` (normal four-file parallelism).

**73/73 files passed; 1,197 tests passed; 15 skipped; zero failed files;
exit 0.** No memory exhaustion, serial retry or file timeout occurred.
Compared with the owner-verified baseline: three new files, seven additional
passing tests, unchanged skips. Evidence:
[`building-phase2-1-full.log`](e2e-review-2026-10-21/building-phase2-1-full.log).
The unchanged Phase 1 byte-layout fixture passed. `git diff --check` passed.

The existing repeated-startup MaxListeners warnings remain; signal/exit
listener lifecycle was deliberately not changed in this sub-step.

## Limits and next sub-step

This proves constructor and SQLite isolation, not request, event, socket,
token or broadcast isolation within a single server. The latter closures
still target the default office by design. No hooks, scripts or mount modules
were edited. No live-provider acceptance was attempted.

The run is on Windows; POSIX mode-bit branches are preserved but not exercised
here. `close()` owns only SQLite and does not clear Map contents or timers
that the existing server may later register in those Maps. Explicit offices
start no such work. Do not treat it as shutdown for the still-shared server.

Sub-step 2 can use real isolated office state/chat instances, exact default
facade aliases, and constructor/migration/identity/layout/route/handshake
regressions. It must scope each mount and helper closure before serving a
second office through the shared server, and assign existing lifecycle
resources an owner without duplicating timers or listeners.
