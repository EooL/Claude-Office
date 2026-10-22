# PR9: delegated agent identity and report back

Implemented on `pr/9-agent-identity`, based on `9ab8fea`. No HTTP route was added. No real AI service, real office home, active office configuration or server on ports 3333/3334 was used or restarted.

## Behavior and files

| File | Change |
|---|---|
| `scripts/delegation-context.mjs` | Resolves request identity from authenticated chat history and an active session with the same canonical cwd. Prefers a real terminal session to the logical fallback. Office-chat requests identify Boss as requester and `assistant` as the orchestrator router; agent requests retain the agent sender. A matching stored row supplies its real message ID. |
| `scripts/office-client.mjs` | Adds authenticated office reads and returns existing JSON POST responses. Uses the configured office port and the existing `OFFICE_ID` credential-home selection. |
| `scripts/delegate.mjs` | Supplies request context to the real controller, carries project/cwd/session/creator/router in spawn events, and uses the existing reply route for report delivery, including startup/unexpected-worker failures. Planning jobs carry their context through the serialized detached-worker payload. Agent-requested plans also retain a public copy for the existing execution-approval card, with an additional creator-inbox copy. |
| `server/delegation-identity.mjs` | Pure bounded creator validation and `Name — Re: <short task>` report formatting. No mutable module state. |
| `server/delegation.mjs` | Carries identity through planning, pending confirmation, retries, execution and failure reporting. Execution uses the actual `/goal` approval request's identity when available. Existing deps without identity still work; a missing cwd no longer causes basename derivation to throw. |
| `server/index.js` | Sanitizes, stores, persists and exposes `createdBy` and `routedBy` on agent records and inspector responses. Resolves the session authoritatively within the current office. Reuses an active session for the cwd, otherwise creates stable ID `office-chat` through `touchSession`. This record has source `office-chat`, `hooked: false`, and is persisted/restored explicitly rather than pretending that Claude Code emitted a hook. |
| `server/index.js` | Existing `/chat/reply` accepts authenticated report metadata, prefixes the request reference and addresses a live agent creator by its existing inbox name. Completed/missing creators fall back to general chat. Recipient activity records the incoming report and the existing unread counter increases. Existing `/chat/inbox/read` now accepts the current office's UI token as well as its file token so the authenticated card can acknowledge reading. |
| `server/chat-actions.mjs` | Recognizes the request-reference prefix on displayed plans, preserving the existing plan approval flow. |
| `src/types.ts`, `src/officeReducer.ts`, `src/inspector.ts` | Carry creator/router through socket hydration, scene state and inspector fallback. The logical `office-chat` ID is displayed in full instead of being shortened like terminal UUIDs. |
| `src/components/AgentCard.tsx` | Shows project/session/cwd, `requested by Boss · message #…` and `routed by assistant (orchestrator)` separately. Old hook-created records keep the existing parent/session wording. On an authenticated open/poll, unread inbox messages are marked read through the existing endpoint; read-only pages cannot acknowledge them. All values remain escaped React text. |
| `src/components/SessionStrip.tsx`, `src/mainState.ts` | Exclude the logical office-chat context from Claude Code terminal pills/counts, avoiding a false “not hooked: install hooks” warning. The context remains visible on its delegated workers' cards. |
| `tests/agent-identity.test.ts` | Nine tests cover real/absent/ambiguous request identity, optional explicit message IDs, pending-request confirmation with an in-place store, fake-deps hire/report success and failure, persisted server identity, real-session reuse, old records, per-office fail-closed behavior, Boss reports, creator inbox/unread/read acknowledgement, missing-creator fallback, escaped card rendering and logical-session labeling. |
| `tests/delegation-runtime.test.ts` | The existing real detached runtime tests now post a synthetic Boss request, run only fake CLIs, and assert the request ID on the actual spawned worker/persisted plan. The goal test verifies that execution records the actual approval message ID. |

The creator object is `{ kind: 'boss' | 'orchestrator' | 'agent', name, messageId? }`. The router is separate `routedBy` metadata, not a replacement for Boss as requester. Agent records without these fields remain compatible.

## Sessions, request matching and office boundaries

The literal `office-chat` is a logical per-office session key, not a fabricated Claude Code UUID. Matching sessions are looked up only in the current office's collections. The record follows the existing session touch/persistence path; no second registry, global identity map, listener or timer is added.

Legacy shell callers pass only request text to `delegate.mjs`. The new context helper matches that text to authenticated recent history. If multiple rows have identical text, it deliberately omits the optional message ID rather than attributing work to an invented/wrong row. Callers able to supply `AGENT_OFFICE_MESSAGE_ID` can disambiguate. If history is unavailable or the request is outside its recent window, Boss remains the fallback requester without an asserted message ID. Shell/Python callers were not edited.

Agent inbox addressing uses the existing agent-name/address lookup. The project/session metadata and inbox records stay in the selected office. Existing non-default-office mutations remain fail-closed with 501; this theme does not enable previously unscoped event, messaging or mounted-store routes. The isolation test attaches a second office and verifies it cannot see the first office's agent or accept its event mutation.

## Tests and build

| Verification | Exact result |
|---|---|
| Final `npm run build` | Passed, exit 0; 100 modules transformed. |
| `npm run test:win -- --serial agent-identity delegation chat-actions chat-a2a chat-status inspector main-state session-strip status-strip server-state-guard server-characterization office-router office-websocket sessions file-layout` | **15 files passed, 190 tests passed, 1 existing skip, 0 failures**, exit 0. Filters select the matching existing filenames, including delegation-runtime and sessions-registry. |
| One full parallel `npm run test:win` | **97 files: 96 passed, 1 failed; 1,484 tests passed, 3 failed, 15 skipped**, exit 1. Only `chat-status.test.ts` failed. |
| Serial replay of the failing file before the fix | **12 passed, 3 failed**, reproducing the issue. |
| Final focused run after the fix | Includes **all 15 chat-status tests passing**, alongside the 190-test focused result above. No test was weakened. |

The full run found a real compatibility regression: deriving `basename(deps.cwd)` assumed that old fake controller deps always supplied a cwd. Three status tests intentionally omit it. The implementation now derives the project only when cwd exists; real CLI delegation still supplies cwd explicitly. This was an implementation fix, not an environment failure. The final focused suite and build passed after it; the complete parallel suite was not repeated, as requested. The full run itself is not claimed green.

`tests/server-characterization.test.ts` and `tests/fixtures/server-routes.json` are unchanged. Route fixture SHA256 remains `26C8EA185AAFD93AB5C51373B1892ABBEFB4A2E1EE9083C26359811642FB4FC1`. State-guard fixture and ceilings are unchanged; no new server `process.cwd()`/home lookup, mutable module state or unsafe HTML rendering was introduced.

## Browser acceptance and screenshots

Used Chrome with a disposable server on `127.0.0.1:4897`, home/root below `C:\Users\iulia\AppData\Local\Temp\office-pr9-NBGpHI`, and a disposable `identity-project` cwd. Provider executables were overridden by an offline fixture. Posted the real delegation event shapes and synthetic report replies; no actual AI job was run in the browser.

Observed:

1. The Reviewer's live inspector showed `identity-project · session office-chat`, the disposable cwd, `requested by Boss · message #1`, and `routed by assistant (orchestrator)`. It retained those fields after completion.
2. The Boss completion message read: `Boss — Re: Review the identity fixture` followed by `Finished: identity metadata verified. No project files changed.`
3. A separate creator Architect received `Architect — Re: Review the identity fixture` in its inbox. The scene showed `1 unread message`; an independent GET `/agents` also returned unread 1.
4. Opening Architect's card displayed `from Reviewer: … Finished: the delegated fixture is ready for review.` in history, cleared the visible badge and independently returned unread 0 through GET `/agents`. Architect was intentionally an old-style agent without creator/project metadata, so its card retained the legacy fallback wording. Overlapping moving sprites initially selected Boss; after selecting the separated Architect sprite, the correct card and acknowledgement were verified.

Four JPEGs were published to the fork's existing `pr-screenshots` branch:

- [Request identity](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr9-request-identity.jpg)
- [Boss completion report](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr9-boss-report.jpg)
- [Creator unread notification](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr9-creator-unread.jpg)
- [Creator report read in the card](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr9-inbox-read.jpg)

## Limits and cleanup

No real-provider journey or packaged Electron run was performed. Anonymous/text-only legacy invocations cannot always provide a message ID; the ambiguity behavior above is explicit. Agent creator lookup follows the existing name-based inbox mechanism. Fully live second-office mutations remain deferred/fail-closed, rather than being enabled by this feature.

The disposable server (PID 8868) was stopped, its browser tab was closed, and the temporary screenshot worktree was removed while retaining the pre-existing local `pr-screenshots` branch. Repository-root PR9 test/build logs were removed.

Automatic approval review rejected both recursive directory deletions with the generic reason `blocked by policy`. These exact disposable paths remain, excluded from the implementation commit: `D:\work\Claude-Office\.pr9` (fixture helpers, screenshot copies, metadata and `server.log`) and `C:\Users\iulia\AppData\Local\Temp\office-pr9-NBGpHI`. No deletion workaround was attempted after the rejections. Existing untracked review/research documents, E2E artifacts and `json` are excluded and preserved. No PR is opened and no push targets `origin`.
