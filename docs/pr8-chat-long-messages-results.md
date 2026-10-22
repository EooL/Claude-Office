# PR8: long chat messages

Implemented on `pr/8-chat-long-messages`, based on `ced8741`. No route was added, no real AI service was called, and the active office was not restarted or reconfigured.

## Changes

| File | Behavior |
|---|---|
| `server/chat-limits.mjs` | Defines the single stored-message bound, `CHAT_MESSAGE_LIMIT = 20_000`, and the separate delegation display bound, `DELEGATION_CHAT_LIMIT = 8_000`. The shared delegation clipping function appends an ellipsis only when truncation is necessary, inside the 8,000-character bound. |
| `server/chat-store.mjs` | Enforces the stored-message bound centrally in `addMessage`, covering direct factory/facade writes, system decisions and queued actions as well as HTTP callers. |
| `server/index.js` | Replaces old 2,000-character chat clamps on normal messages, recognized slash commands, `/goal` and agent messages with the shared bound. Chat, agent-reply and A2A JSON bodies accept up to `CHAT_MESSAGE_LIMIT * 6 + 8192` bytes (128,192), accommodating JSON escaping plus envelope metadata while retaining a finite request limit. Other JSON limits and raw-body signature capture remain unchanged. |
| `server/delegation.mjs` | Uses the shared 8,000-character clip for displayed plans and execution-result text. The complete plan still stays in delegation state; the existing execution boundary report is appended separately, as before. |
| `server/chat-actions.mjs` | Uses the same clipping function when locating the displayed plan, so long plans still expose the existing execution approval action. |
| `src/chatPreview.ts` | Determines whether rendered logical text exceeds 12 lines or 900 characters, using parsed labels rather than markdown targets, hidden HTML comments or viewport wrapping. |
| `src/components/ExpandableChatContent.tsx` | Adds collapsed-by-default previews and real Show more / Show less buttons with stable `aria-controls`, `aria-expanded` and keyboard access. Expansion remains local to the mounted message. |
| `src/components/ChatContent.tsx` | Can render a bounded token preview without splitting markdown source or changing target handling. Expanded messages use the original token renderer, including links, images, code, escaped text and hidden comments. Unshown tokens are not mounted as hidden focusable links. |
| `src/components/ChatActions.tsx` | Wraps only the message body; suggestion and plan controls remain outside the collapsed region. |
| `src/components/SlackChat.tsx` | Scrolls after expand/collapse and when action controls arrive asynchronously. The action-layout dependency uses IDs/outcomes/disabled state, avoiding a scroll reset on every unchanged polling response. Existing new-message/status scrolling remains. |
| `src/styles/chat-content.css` | Adds a bounded preview, soft bottom fade and visible keyboard focus for the toggle; preserves narrow-width wrapping. |
| `tests/chat-long-messages.test.ts` | Six tests cover storage and real HTTP/WS transport, normal/slash/goal/agent/A2A/direct writes, inbox and last-chat files, both message bounds, the finite request-body limit, delegation clipping, logical preview thresholds, expanded hostile text and accessible suggestion controls outside previews. |
| `tests/chat-actions.test.ts` | Adds a regression for execution approval on an 8,000-character displayed plan. |
| `tests/delegation.test.ts` | Adds a real delegation-flow fixture proving long plan/result clipping and preservation of the full plan in controller state. |
| `tests/hardening.test.ts` | Keeps the 10 KiB rejection assertion on a non-chat route (`/settings`), since 20,000-character chat messages are now intentionally accepted. |
| `tests/turn-events.test.ts` | Updates the obsolete assertion that a 20,000-character chat message must fail; now checks acceptance and exact returned text, while preserving the event 64 KiB and settings 10 KiB rejection assertions. |

The hook/session prompt `MAX_TEXT_LEN` remains 2,000 and was not changed. Strings are bounded using JavaScript string length, consistently with the previous implementation.

## Path audit and remaining upstream truncation

- `chat-db.js` delegates to the chat-store factory; it does not shorten text itself. SQLite retrieval and WebSocket broadcasts preserve the stored text. The connect snapshot does not contain chat messages: history is loaded through GET `/chat`, which limits the number of rows, not their string length. `src/chatHistory.ts` likewise retains 50 rows without shortening individual messages; the visible chat window still renders its existing last-12-message subset.
- The agent inbox JSON uses the same stored message object; tests verify the full text on disk and via recipient-filtered GET `/chat`. Notifications intentionally retain short 50-character summaries; this does not replace the stored chat message. Activity/inspector summaries are separate from chat text.
- `server/chat-markup.mjs` parses links/images/code without shortening source text. `scripts/chat-backend.mjs` writes the provider result without an independent numeric output clip; its reply guard may replace an inappropriate execution claim, as before. `scripts/delegate.mjs` forwards delegation output through the office client without another text clamp.
- **Unchanged shell limitation:** `scripts/chat-ai-watcher.sh:196` explicitly applies `sys.stdin.read().strip()[:1800]` before posting its plain-chat reply. It also requests at most three short sentences. That producer still loses longer replies before they reach the server. Shell/Python files were not edited, as required; this feature does not claim to recover text already discarded by that watcher or any external producer.
- **Previously truncated messages stay truncated.** Neither the database nor the UI can reconstruct discarded content. The new toggle reveals the complete text available in newly stored messages, up to the new limits.

## Tests and build

| Verification | Result |
|---|---|
| `npm run build` | Final confirmed run passed, exit 0 (`100 modules transformed`). |
| Focused serial run: `chat-long-messages chat-actions chat-content chat-suggestions chat-status chat-a2a delegation hardening server-state-guard server-characterization office-router office-websocket office-instances file-layout` | **15 files passed, 145 tests passed, 2 existing skips, 0 failures**, exit 0. |
| One full parallel `npm run test:win` | **96 files attempted: 91 passed, 5 failed**, exit 1. Completed Vitest summaries recorded **1,378 passed, 3 failed, 15 skipped**; three failed workers produced no normal test summary. |
| Serial replay: `hook-script health doctor websocket turn-events` | Ran six matching files, including `office-websocket`: **171 passed, 1 failed**. The remaining failure was the obsolete `/chat` 10 KiB assertion in `turn-events`, corrected as described above. |
| Final serial `turn-events` rerun | **1 file, 51 tests passed, 0 failures**, exit 0. Together with the other replayed files, all six have final passing results: **172 tests**. |

The parallel failure list was `hook-script`, `health`, `doctor`, `websocket`, and `turn-events`. Three workers failed without normal summaries under memory/process pressure; output included `FATAL ERROR: Zone Allocation failed - process out of memory`. Doctor's two failing assertions were installer setup failures (`bash hooks/install-hooks.sh`, including “Could not write the backup … nothing was changed”), not chat assertions; both passed serially. The third assertion failure was the stale turn-events request-size contract. Early serial attempts also encountered V8/esbuild allocation failures; subsequent focused runs passed without weakening any test or changing resource limits.

The full parallel run is **not** claimed green. The final asynchronous-controls scroll adjustment was covered by the subsequent focused suite, confirmed build and browser measurements; the full parallel suite was run only once as requested. The final turn-events contract update was verified separately. Existing Windows shell skips remain unchanged.

`tests/server-characterization.test.ts` and `tests/fixtures/server-routes.json` are unchanged. The route fixture SHA256 remains `26C8EA185AAFD93AB5C51373B1892ABBEFB4A2E1EE9083C26359811642FB4FC1`. The state guard passed with no fixture/ceiling changes, new module-level mutable state or unsafe HTML rendering.

## Browser acceptance

Used Chrome and a disposable server at `127.0.0.1:4897` with home and registry directories below `C:\Users\iulia\AppData\Local\Temp\office-pr8-AVwvB7`. Provider executables were overridden by an offline fixture, and no watcher/provider run was started. The real homes and ports 3333/3334 were not used.

Posted synthetic five-line, 25-line, exactly 15,000-character and long suggestion messages through POST `/chat`. As established in PR7, this route stores user messages regardless of an agent-looking sender. For actionable agent suggestions, also posted through the existing authenticated `/chat/reply`. Externally posted Boss rows were loaded by refreshing history because the UI intentionally ignores its own Boss WebSocket echoes.

Verified in the browser:

- Five lines displayed fully without a toggle. Twenty-five lines collapsed; Show more exposed all 25 and changed to Show less, which collapsed them again.
- Expanding the large message produced a DOM text length of exactly **15,000**, ending in **`TAIL`**. This independently proves the server/history/UI did not retain the old 2,000-character bound.
- Expansion persisted when a new message was entered through the actual chat textbox. Expansion and new-message scrolling reached the bottom (`bottomGap: 0`).
- Start / Ignore remained outside the collapsed suggestion body. After the final rebuild, controls arriving through polling were visible without manual scrolling (`bottomGap: 0`, Ignore inside the chat viewport). Ignore was clicked successfully and displayed its persisted state.
- At **1056×682** and **640×682**, the chat remained in its compact layout with no horizontal page overflow. The existing chat-status row continued to display.

Five JPEG screenshots were published to the fork's existing `pr-screenshots` branch:

- [Collapsed message](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr8-collapsed.jpg)
- [Expanded 25-line message](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr8-expanded-lines.jpg)
- [Complete 15,000-character message tail](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr8-full-15000.jpg)
- [Suggestion controls below the preview](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr8-suggestion.jpg)
- [Narrow layout](https://raw.githubusercontent.com/EooL/Claude-Office/pr-screenshots/shots/pr8-narrow.jpg)

## Cleanup and limits

The disposable server (PID 26560) was stopped, the browser tab closed, the viewport override reset and the temporary screenshot worktree removed. The pre-existing local `pr-screenshots` branch was retained. All nine PR8 test/build logs in the repository root were removed. Existing untracked review documents, E2E artifacts and `json` are excluded and preserved.

Automatic approval review rejected both recursive directory cleanup commands with the generic reason `blocked by policy`. These exact disposable paths therefore remain, excluded from the commit: `D:\work\Claude-Office\.pr8` (helpers, screenshot copies, fixture metadata and `server.log`) and `C:\Users\iulia\AppData\Local\Temp\office-pr8-AVwvB7`. No deletion workaround was attempted after those rejections.

Not verified: real-provider replies, the unchanged watcher producing replies over 1,800 characters, packaged Electron, and reconstruction of historical truncated content. No PR is opened and no push targets `origin`.
