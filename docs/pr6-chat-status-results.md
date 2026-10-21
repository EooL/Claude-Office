# Chat status indicators (PR 6, 2026-10-21)

## Changes

- `server/chat-status.mjs` and its TypeScript declaration define pure, bounded progress records and English labels for received, routing/classifying, thinking, planning, awaiting approval, working, done and failed.
- `server/office-state.mjs`, `server/office.mjs` and `server/index.js` own progress and timers per office. Existing authenticated `/event` accepts `chat_status`; broadcasts and reconnect snapshots stay scoped to the connected office. No HTTP route was added. A normal boss message reports received/thinking immediately. An agent reply clears that waiting indicator; a 180-second safety timeout also clears it. Replacing or closing the office cancels its timer. Done expires after six seconds; approval and failure remain visible.
- `server/delegation.mjs` emits optional best-effort `deps.status()` updates around classification, planning, approval, execution and failures without changing approval/concurrency reservations. `scripts/delegate.mjs` transports those updates through `/event` and reports worker startup/crash failures. `scripts/chat-backend.mjs` reports an empty/failed plain-chat result rather than leaving thinking stuck.
- `src/types.ts`, `src/hooks/useAgentSocket.ts` and `src/App.tsx` carry snapshot/live progress to chat without overloading the existing string-valued agent `status` field.
- `src/components/SlackChat.tsx`, `src/chatStatus.ts` and `src/styles/office.css` show one avatar/status row with readable labels, elapsed seconds and animated dots only while live. Awaiting approval/done/failure are calm; failures use the warning colour. The existing `typingUser` indicator remains the fallback when no progress row is visible.
- `src/components/ChatContent.tsx` strips complete, multiline and unfinished HTML comments at rendering only. Stored messages and approval/control markers are unchanged.
- `tests/chat-status.test.ts` covers labels/render states, expiry, display-only comment stripping, task/approval/goal/failure sequences, optional progress transport failures, real HTTP auth/validation, real fake-CLI chat failure, reconnect snapshots, timeout replacement/cleanup and two-office isolation.

No recent-chat prompt history or separate Suggested next step UI was added. No shell or Python script was edited. The pre-existing untracked `json` and E2E artifacts were left alone.

## Checks

Final focused command:

`npm run test:win -- --serial chat-status delegation delegation-runtime chat-content server-state-guard server-characterization office-router office-websocket file-layout`

Final focused verification: **9 files, 60 tests passed, 0 failures, 0 skips, exit 0** (including 15 new chat-status cases). `npm run build` passed (TypeScript and Vite, 98 modules). `git diff --check` passed.

The new authenticated HTTP transport test caught an existing sanitiser treating status objects as strings; `chat_status` now keeps its validated record while all existing agent statuses retain their string clamp. The real chat-backend failure regression also exposed a Windows/libuv assertion on forced process exit after HTTP reporting. Using `process.exitCode` lets HTTP/stdout handles close normally; the child now returns the expected failure code without crashing. No test was skipped or weakened.

The route fixture remains unchanged: SHA256 `26C8EA185AAFD93AB5C51373B1892ABBEFB4A2E1EE9083C26359811642FB4FC1`. No guard ceilings changed. No full-suite claim is made; the requested focused regression set was run serially.

## Browser evidence

Chrome headless/CDP exercised the built UI on a disposable server at port 4897, with disposable HOME/USERPROFILE/AGENT_OFFICE_HOME/AGENT_OFFICE_ROOT and a disposable Git project. First-run service selection chose Codex backed exclusively by a fake CLI. A task was typed in chat; the real detached delegation script classified it, prepared a plan, waited for approval and executed only after `/goal`. The fixture wrote exact bytes `OFFICE_PR6_OK` to its disposable `acceptance.txt`. The done row disappeared after six seconds; a fake provider authentication failure produced a warning-coloured reason. The completed reply's `<!-- GOAL_COMPLETE -->` marker was absent from the rendered chat.

JPEG captures: `pr6-thinking`, `pr6-routing`, `pr6-planning`, `pr6-approval`, `pr6-working`, `pr6-done`, `pr6-failed`, under the fork's `pr-screenshots` branch (`shots/*.jpg`). No real AI was called. This proves UI/runtime plumbing with fixtures, not live-provider acceptance. The final disposable server and browser were stopped and their fixture directory removed; port 3334 and the real office homes were not used.

Two failed browser-harness attempts left stopped, disposable directories at `%TEMP%/pr6-browser-fixture-X12mG2` and `%TEMP%/pr6-browser-fixture-eNqN0k`. Their Chrome process trees were stopped, but automatic approval review rejected the explicit recursive cleanup commands with only “blocked by policy” as its reason. They are not used by the implementation or the successful browser run.

## Publication boundary

The feature and screenshots are for the owner's fork only. Screenshots were published in commit `ac56a92` on its `pr-screenshots` branch. The feature starts from fork main, which contains the work proposed in #63 and #64. Opening the author's draft PR requires a new owner confirmation; upstream isolation must be checked before opening it. Unrelated PRs remain untouched.
