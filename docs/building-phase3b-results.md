# Building phase 3b: office-scoped WebSockets

## Changes

- `server/index.js`
  - `ws.office`: each socket remembers the office in scope at connect (set in the `connection` handler, inside the upgrade's `runInOffice`). Membership dies with the socket; no module-level state added.
  - `broadcast()` no longer throws for a non-default office; it sends only to sockets whose office is `currentOffice()`. `currentOffice()` still throws 'Office scope required' with several offices live and none in scope. Trusted/read-only redaction is unchanged (that office's `trustedClients`).
  - Handshake snapshot: `activeAgents`, `sessions`, `signals`, `uiToken` come from the office in scope. For a non-default office the fields still backed by default-office stores are empty, marked `not scoped yet`: `statuses: null`, `health: null`, `mcpServers: []`, `pendingPermissions: []`, `taskBoards: []` (the page skips null/empty). The default snapshot is unchanged in shape and content.
- `server/office-routing.mjs`: `upgradeOffice` accepts a live non-default office at `/o/<id>/ws`; unknown or malformed ids still 404 before any upgrade. Host/Origin checks and token handling are untouched (the token is checked against the office in scope).
- Tests: `tests/office-websocket.test.ts` (new), `tests/office-router.test.ts` adapted (the 501 upgrade case removed; non-default `broadcast` no longer throws).

## Pinned by tests

Two offices with the same ids: broadcasts reach only the sockets of the scoped office both ways; read-only sockets get redacted payloads, trusted ones full; B's own token is trusted and receives B's uiToken, A's token or none is read-only without uiToken; snapshots never carry the other office's agents/sessions/signals; unscoped fields are empty for B; default `/ws` and `/o/default/ws` as before; unknown/malformed ids 404; broadcast with no scope still throws; detaching B leaves A's sockets open and B's path 404.

## Not scoped yet (left for sub-step 3)

Per-office status, permissions, tasks stores; health/registry split; mcp discovery per office cwd; artifacts roots; write paths (HTTP writes, ingest, static UI stay 501); cwd-based hook dispatch. Production boot still attaches only the default office.

## Full suite

See the final report of this sub-step (numbers recorded by the run).
