# Building Phase 2, sub-step 2: office scope and shared router

Date: 2026-10-21. Local dirty checkout preserved; no commit, push or deployment.
Only disposable test homes/root overrides and ephemeral ports were used.
The other agent's `office-e2e-snapshot` and `office-e2e-home` directories were
not inspected, modified or cleaned. No production path attaches a second office.

## Design decision and prototype

Use one `AsyncLocalStorage` scope and stable forwarding proxies for the
existing index aliases. A small standalone prototype in
`tests/office-scope.test.ts` was run before the production scope module:
two interleaved async scopes read a proxied native Map's size, iterator and
values without mixing receivers. Native collection methods must be bound to
the resolved underlying receiver; calling them directly on a Proxy fails
native internal-slot checks. The implemented proxy also covers WeakMap,
WeakSet, arrays, settings enumeration and scalar state properties. A second
test exercises promises/timers, interleaved offices and detached async work.

The receiver-binding prototype (the executable test also interleaves scopes):

```js
const scopes = new AsyncLocalStorage()
const view = new Proxy(new Map(), {
  get(_, key) {
    const map = scopes.getStore()
    const value = Reflect.get(map, key, map)
    return typeof value === 'function' ? value.bind(map) : value
  },
})
scopes.run(new Map([['same', 'A']]), () => view.get('same')) // A
```

The index keeps stable exported proxy references. A getter/method resolves
the current office, with implicit default fallback only while exactly one
office is live. Multiple live offices without a scope throw
`Office scope required`. Work retaining a detached office scope throws
`Office is not live`, rather than falling back. No async context is obtained
from user-supplied paths except through validated live-office lookup.

This avoids rewriting the helper graph. Index-local chat function forwarders
and a database-handle proxy use `currentOffice().chat`. The existing
`chat-db.js` compatibility exports remain exact default-instance aliases;
future non-default mounts must use the office chat dependency, not import
that raw default facade. No performance benchmark was claimed: the prototype
and 20 alternating concurrent HTTP reads demonstrate correctness under
interleaving, and the full existing suite remains the regression gate.

One prior raw-identity assertion was necessarily adapted in
`tests/office-instances.test.ts`: exported collection proxies cannot be `===`
their underlying default Maps. The replacement proves bidirectional marker
mutation on the same underlying Map, and settings values. Repeated-import
export identity, chat facade function/DB identity, token identity and default
behavior checks remain enabled. This does not clone office state.

## Per-file changes

| File | Change |
|---|---|
| `server/building-runtime.mjs` | Private live-office Map, default attached once; strict registered attachment with matching canonical home/cwd, snapshot listing, guarded detachment and in-memory lookup. No listeners or timers; detach does not close an office. |
| `server/office-scope.mjs` | ALS ownership and receiver-safe collection/object forwarding; explicit live-scope entry, no multi-office implicit fallback. |
| `server/office-routing.mjs` | Raw-id validation before Express param decoding, live lookup, request scope, conservative non-default route/credential gate, legacy ambiguity responses, and pure WebSocket upgrade-path resolution. |
| `server/index.js` | One existing route table on one Express Router, mounted at root and `/o/:officeId`; root app retains guards and shared locals. Scope proxies/forwarders replace default-only aliases. Existing status/sweep work runs explicitly in the default scope. Shared WebSocket upgrade dispatch resolves paths, with non-default upgrades denied. Unsupported event/message/sweep/broadcast helpers throw before non-default work. |
| `tests/building-runtime.test.ts` | Before-change singleton characterization and live attachment/validation/lifecycle bookkeeping checks. |
| `tests/office-scope.test.ts` | Before-change ALS/native-Map prototype and full forwarding/async/detached-scope checks. |
| `tests/helpers/inprocess-building.ts` | One ephemeral real listener, two registered/test-attached offices, own disposable roots, explicit teardown of sockets, intervals and databases. |
| `tests/office-router.test.ts` | Same-ID real-HTTP leak tests, concurrent reads, default writes, denied routes/credentials, malformed/non-live IDs, Host/Origin ordering, and WebSocket upgrade boundaries. |
| `tests/office-instances.test.ts` | Replaced the unavoidable raw Map identity assertion with bidirectional forwarding checks; retained default function/DB/export checks. |
| `tests/server-characterization.test.ts` | Root collector follows the one shared legacy Router and asserts the prefixed mount uses the exact same router object. Existing route fixture bytes unchanged. |
| `tests/server-state-guard.test.ts` | Detects ALS, shared infrastructure owners and the status store created inside explicit scope; previous scans retained. |
| `tests/fixtures/server-state.json` | Tags the required live Map and ALS owner G0; existing ownership remains honest. |

## Reachability and fail-closed boundary

Production boot still has exactly one live default office, even when the
persisted building registry contains additional offices. Attachment requires
an explicit function call; no route, startup loop or script calls it.

With one live office, root routes retain their behavior. `/o/default/...`
uses the same handler table. With two test-attached offices, legacy
non-ingest HTTP requests return 400 `{ "error": "OFFICE_ID required" }`.
Legacy ingest `/event`, `/status`, `/usage` returns 501
`{ "error": "not scoped yet" }`: cwd-based ingest dispatch is not implemented
and silently sending it to default would be unsafe. Explicit
`/o/default/...` remains available for default handlers.

A live non-default office has only these read-only routes:

- `GET` / implicit `HEAD`: `/chat`, `/agents`, `/sessions`, `/settings`, `/signals`.
- Existing transcript/command redaction remains in effect.
- Authorization, Cookie and office-signature headers cause 501 rather than
  allowing the default token to unlock another office's data.

Every other non-default request, including writes, OPTIONS, store endpoints,
inspector/artifact paths, static UI and unknown route names, returns 501.
No new route is automatically enabled by being registered on the router.
The allowlist is explicit. The moved state and chat functions are scoped;
write flows are not yet fully scoped because token checks, fixed runtime
file paths, mounted stores and global broadcast remain default dependencies.
Those routes were deliberately stopped at the middleware boundary instead
of making a partially scoped write reachable.

Malformed or non-live ids return the uniform 404
`{ "error": "Unknown office" }`. Raw lookup uses the in-memory map and
does not construct filesystem paths from ids. It precedes JSON parsing and
Express's parameter decoding, so encoded slashes/bad escapes and malformed
bodies cannot dispatch into default handlers. The unchanged Host and Origin
guards still run first. Legacy body-parser ordering is retained; only new
prefixed requests defer parsing until after office resolution.

The one shared WebSocketServer accepts `/ws` (default) and
`/o/default/ws`, entering explicit default scope for handshake/snapshot work.
Its existing Host/Origin checks, auth-first response and redaction logic
remain. Unknown upgrades get the uniform 404; live non-default upgrades get
501 before snapshot/token delivery. A non-default handshake would otherwise
read default status/permissions/health/task stores and token, and global
broadcast could leak across sockets, so it is not enabled yet. `/ws` remains
explicitly default even with two live offices, as requested.

Broadcast fan-out/auth semantics were not rewritten. A scope fence rejects
non-default or ambiguous calls. Event processing, agent messaging and stale
sweeps have the same fence before mutation. Their later office-aware
implementation remains sub-step 3 work. The existing status interval is
created inside default ALS scope; the existing sweep interval explicitly
enters default scope. The real start/listen callback also enters default
scope before starting registry/task pollers, so those resources inherit it.
No extra interval, poller or listener per office was
added. Existing async resources created in request scope inherit it.

## Scoping inventory

All rows describe non-default reachability; default retains its full routes.

| Route group | Current status | Sub-step 3 work |
|---|---|---|
| status (`/status`, `/usage`) | Needs per-office store; 501 | Scoped store/estimator, session dependencies, broadcasts and sweep ownership. |
| permissions | Needs per-office store; 501 | Office token/proof, pending dialogs, decision callbacks and socket delivery. |
| health | Building lifecycle plus office counts; 501 | Separate building health from office counts/proofs and scoped delivery. |
| session registry | Building-wide scanner; 501 | Dispatch by canonical cwd and scope callbacks/session updates. |
| tasks | Needs per-office store; 501 | Office task boards/watches, session deps, authorization and broadcasts. |
| backends | Shared definitions/settings with UI authorization; 501 | Decide building route vs office overrides, retain proper UI authorization. |
| brains | Building-wide catalogue/limits with settings links; 501 | Building vs office role overrides, UI auth and single refresh ownership. |
| artifacts (`/chat/artifact`) | Needs office roots/chat/token; 501 | Office cwd/tmp roots, office DB lookup and scoped UI authorization. |
| chat-actions | Needs office dependencies; 501 | Office chat/delegation files, approval auth, enqueue and broadcasts. |
| index chat read | Scoped read-only | Enable writes only after office tokens, last-chat/inbox paths and `ctx.broadcast`. |
| index agents list | Scoped read-only | Inspector transcript roots/auth and event-driven persistence. |
| index sessions | Scoped read-only/redacted | Tokens, event ingest, timer ownership and persisted-session initialization. |
| index signals | Scoped read-only/redacted | Scoped ingest, privileged command views and broadcasts. |
| index settings | Scoped in-memory read; POST 501 | Office settings file/answer marker, authorization and retrim broadcasts. |
| index events | Default only; non-default/ambiguous ingest 501 | Store callbacks, persistence, tokens, cwd dispatch and broadcasts. |
| index config/roster, A2A, seen/react/typing, cron-state, inspector and other routes | Default only; 501 | Explicit per-group review before allowing; no implicit fallback to default. |
| index WebSockets/static UI | Default only | Office token/UI token, office snapshots/stores and socket membership/broadcast; SPA routing review. |

## Tests and guard

The six new in-process router tests use the same agent id, session id, message
sender/text and signal sequence in both offices, with distinct marker fields.
Every enabled read is checked both ways. Twenty concurrent reads alternate
office prefixes. Default legacy writes before attachment and explicit
default chat/event writes afterwards remain local; denied B requests leave
its chat/state/files unchanged. Unsupported direct helpers throw before work.
Registered-but-not-live offices are tested separately from malformed ids.
The raw-path table includes `..`, encoded traversal/slashes, uppercase,
overlong/short ids and bad percent escapes. Default sockets remain responsive
after denied upgrades, and their snapshots exclude the other office's marker.
A real start callback test observes actual registry/task startup in explicit
default scope with a second office attached. No claim of non-default WS
delivery is made.

The unchanged route fixture and byte-layout fixture remain acceptance gates.
Only their collector's understanding of a shared Router changed; it asserts
one legacy mount and one prefixed mount of the same instance, and rejects
unexpected nested routers rather than silently omitting their routes.

Ownership tags: 31 -> 37. The required live-office Map, ALS instance and
shared Router are G0. The stronger scanner also tags the existing Express
root app, HTTP server and WebSocket server, which the old lexical scan had
omitted. These are building owners, not extra office state. The scanner also
detects the existing status-store constructor inside explicit scope.
`homeDirUsers` remains empty; direct-cwd ceilings remain
`artifacts.js: 1`, `index.js: 0`. No ceiling was raised and no existing tag
was dropped to hide state.

## Full verification

Final full command: `npm run test:win -- --serial`.

**76/76 files passed; 1,208 tests passed; 15 skipped; zero failed files;
exit 0.** Compared with the verified baseline, three new files and 11 passing
tests were added; skips remain 15. Evidence:
[`building-phase2-2-acceptance.log`](e2e-review-2026-10-21/building-phase2-2-acceptance.log).
This run includes the final startup-scope regression, all six router tests,
the stronger infrastructure guard, and the unchanged route/layout fixtures.
No file timeout or memory error occurred in this final run.

An earlier parallel completed-version attempt encountered native V8
semi-space allocation failure and a Go runtime allocation failure and did
not complete. The suite was rerun serially without weakening any assertions,
skipping tests or changing timeouts. Earlier diagnostic runs are retained in
`building-phase2-2-full.log`, `building-phase2-2-final.log` and
`building-phase2-2-serial.log` in the same directory. The final acceptance log
above is authoritative for the completed source.

`git diff --check` passed. Existing repeated-startup MaxListeners warnings
remain in `ws-auth`; process listener cleanup was not rewritten here.

## Deferred / not verified

- Non-default writes, authenticated reads, mounted stores and WebSockets are
  intentionally 501; enabling them now would cross the token, disk and
  broadcast changes reserved for sub-step 3.
- No building UI or additional SPA fallback was added. Prefixed default
  static handling uses the existing router; non-default UI is 501.
- Explicit attachment does not hydrate extra office settings/agents from
  disk or start office workers. The fixture seeds each owned state directly.
  The runtime map key is the registered id; attachment does not replace the
  factory's frozen opaque context-id metadata. Future token/logging work must
  bind the authoritative registry id explicitly.
- Default chat facade exports remain default-only compatibility references.
  Scoped index handlers use forwarders; future mounts must receive scoped
  dependencies explicitly.
- Native collection proxies are intended for existing Map/array/object
  operations, not freezing/changing prototypes of the shared facades. No
  production use of those unsupported operations was introduced.
- No live-provider calls, browser acceptance, POSIX runtime or routing to
  multiple production offices was attempted. The other browser E2E run and
  its temporary directories were left alone.

## What sub-step 3 can assume

There is one shared root/prefixed handler table, validated live-office lookup,
explicit async scope and stable state/chat forwarding. Missing scope with
multiple offices throws. The allowlist and unknown-office gate fail closed;
additional registrations cannot expose default stores to a non-default
office. Enable each route group only after its token/store/disk/broadcast
dependencies and lifecycle are scoped, with matching-id HTTP/WS tests. No
production boot or API can attach another office yet.
