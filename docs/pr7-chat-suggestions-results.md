# PR7: inline chat suggestions

Implemented on `pr/7-chat-suggestions`, branched from `a82bf98`. This theme adds Start / Ignore controls to agent suggestions without changing execution approval or adding HTTP routes.

## Files and behavior

| File | Change |
|---|---|
| `server/chat-actions.mjs` | Recognizes case-insensitive, single-line `Suggested next step:` and `Suggested next steps:` as well as `NEXT_ACTION:`. The trimmed task must contain 8–600 characters. An explicit marker wins when the reply also repeats a prose suggestion; multiple explicit markers remain ambiguous and are rejected. Existing `next:<messageId>` identifiers, newest-message selection, supersession, busy checks and approve/decline endpoints remain. |
| `server/chat-actions.mjs` | Adds a nullable outcome column to the existing `chat_action_approvals` SQLite decision ledger, not another table/file or browser store. GET `/chat/actions` additionally returns decided suggestions for the existing recent-message window. Outcomes survive new controller state and page refresh; legacy ledger entries remain consumed without inventing whether they were approved or declined. Ignore logs `Ignored: <suggestion gist>` in the chat. |
| `src/components/ChatActions.tsx` | Adds `ActionMessage`, renders a suggestion quote and Start / Ignore inside its source message, disables controls in flight, reports request errors, and renders a calm Started / Ignored state after a decision. Polling merges pending actions with persisted decisions. Plan execution, pending-plan and retry actions retain their existing approval labels. Paused suggestions have disabled controls; other paused approvals retain the previous hidden behavior. |
| `src/components/SlackChat.tsx` | Uses `ActionMessage` at the existing message-body position; there is no second suggestions block. A matching source suggestion line is hidden only while actionable controls replace it. Read-only, superseded, paused and decided messages retain the source text. Other prose is not discarded when an explicit marker wins. Stored messages are unchanged. |
| `src/styles/chat-content.css` | Styles the short quote and explicit keyboard focus outline. |
| `tests/chat-actions.test.ts` | Adds parsing/boundary tests, fresh-controller decision persistence for Start and Ignore, duplicate-click refusal, migration of the old ledger and isolation between two databases. Updates the suggestion Ignore log expectation; existing plan decisions remain unchanged. |
| `tests/chat-suggestions.test.ts` | Seven server-rendered UI cases cover controls, Started, Ignored, read-only/superseded/paused rendering, escaped hostile markup, source-line hiding, hidden HTML comments, unchanged plan approval wording and preservation of a different prose proposal. |

Start uses the existing approve command: `Please investigate and plan this next step: …`. It requests planning, not goal execution. Execution still requires the later authenticated `/goal` approval. Existing per-office database scoping and the non-default-office fail-closed routing remain unchanged; this feature does not enable previously unscoped routes.

## Automated verification

| Command | Exact result |
|---|---|
| `npm run build` | Passed, exit 0, including the final UI changes. |
| `npm run test:win -- --serial chat-actions chat-suggestions chat-content chat-status delegation server-state-guard server-characterization office-router office-websocket file-layout` | Final run: **11 files passed, 81 tests passed, 0 failed, 0 skipped**, exit 0. The `delegation` filter also runs `delegation-runtime`. |
| `npm run test:win` | One complete parallel run: **95 files: 92 passed, 3 failed; 1,466 tests passed, 4 failed, 15 skipped**, exit 1. |
| `npm run test:win -- --serial brains hook-script plugin` | All failing files rerun serially: **3 files passed, 182 tests passed, 0 failed, 0 skipped**, exit 0. No tests were weakened or newly skipped. |

The parallel failures were:

- `brains`: “a timeout closes descendants that keep the output pipe open” exceeded its 12-second test limit.
- `hook-script`: the server-down permission test received exit `3221225794` instead of 0; the backgrounded PostToolUse test failed to spawn Bash (`spawn UNKNOWN`).
- `plugin`: StopFailure produced Git Bash `dofork` / `fork: Resource temporarily unavailable`, including exit `0xC000012D` (Windows commit/resource exhaustion).

All four assertions passed on the serial rerun. The parallel run itself is **not** reported as green. The documented start/stop shell exclusions remained existing skips; `scripts.test.ts` passed 17 tests with its six existing skips. Final UI refinements (calm terminal rows and preserving a different prose proposal) were followed by the final focused suite/build above; the complete parallel suite was not repeated, as requested.

`tests/server-characterization.test.ts` and `tests/fixtures/server-routes.json` are byte-identical to the branch base. Route fixture SHA256: `26C8EA185AAFD93AB5C51373B1892ABBEFB4A2E1EE9083C26359811642FB4FC1`. The server state guard passed without ceiling changes, module-level mutable state or unsafe HTML rendering.

## Real-browser verification

Used Chrome with a disposable server at `127.0.0.1:4897`, home `<temporary office-pr7 directory>/h` and registry root `<same directory>/r`. The real office, its home and ports 3333/3334 were not used or restarted.

Important API correction discovered during acceptance: `POST /chat` ignores the supplied role and stores a user message, regardless of an agent-looking sender name. The initial requested synthetic POST therefore correctly produced no suggestion action. Agent fixtures were subsequently posted through the existing authenticated `POST /chat/reply`. The `/chat` route was deliberately not changed to allow agent impersonation.

Observed:

1. The prose suggestion showed a quote plus Start / Ignore directly below the Reviewer's message. Its raw suggestion line and `<!-- GOAL_COMPLETE -->` were absent from that actionable body.
2. Ignore removed both buttons, displayed Ignored, and added `Ignored: Review the empty-state copy before changing the dashboard.` to the chat. Refresh retained Ignored without bringing the buttons back.
3. Start removed the buttons and displayed Started. The server queued the normal planning request and logged its existing approval line. Refresh retained Started.
4. No watcher loop or real AI provider was started. To exercise the queued request's normal consumer, the actual `scripts/delegate.mjs message` entry point was invoked once on that queued text with **all services disabled** and offline executable overrides as a second safeguard. It returned `handled` and posted exactly: **“No worker started: task routing is unavailable. Check the orchestrator brain in Settings and retry the request.”** The chat also displayed the corresponding failed status. No plan or completed goal is claimed.
5. A separate `localhost:4897` origin without the disposable token showed the suggestion text and the read-only indicator, with no suggestion controls.
6. Keyboard Tab reached Ignore from Start with `:focus-visible` true. During requests both controls were disabled. Setting only the disposable pause file immediately before Start produced the visible inline error **“AI is paused. Enable AI before approving a step.”** The fixture was then unpaused.

Six JPEG screenshots were published to the fork's existing `pr-screenshots` branch:

- [Suggestion controls](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr7-suggestion.jpg)
- [Ignored after refresh, next suggestion pending](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr7-ignored-refresh.jpg)
- [Started and unavailable planning result](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr7-started.jpg)
- [Started after refresh](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr7-started-refresh.jpg)
- [Read-only visitor](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr7-read-only.jpg)
- [Rejected request error](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr7-request-error.jpg)

## Limits and cleanup

No real AI service, successful provider-generated plan, goal execution, packaged Electron build or newly enabled multi-office action route was tested. Terminal state is reconstructed for the existing recent-message window; old ledger entries created before outcomes were recorded cannot reliably be labeled Started versus Ignored, but remain permanently consumed. The normal watcher loop was not launched; its delegation consumer was exercised explicitly as described above.

Only this theme's files are included in the implementation commit. Existing untracked review documents, E2E artifacts and `json` are excluded and preserved. The temporary screenshot worktree was removed while the pre-existing local `pr-screenshots` branch was retained. The disposable server (PID 52952) was stopped.

Automatic approval review rejected the cleanup commands with the generic reason `blocked by policy`, including a subsequent workspace-only cleanup attempt. The following disposable artifacts therefore remain, excluded from the commit: `C:\Users\iulia\AppData\Local\Temp\office-pr7-TB3Ob5`, the repository's `.pr7/` scratch directory (helpers, local disposable link, screenshot copies and logs), and the ignored `pr7-*.log` test/build logs in the repository root. No further deletion workaround was attempted. No PR is opened and nothing is pushed to `origin`.
