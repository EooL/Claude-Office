# Review fixes from the Antigravity review (PR 13)

Branch `pr/13-review-fixes` (from `pr/12-activity-based-timeouts`). Each finding was checked in the code before changing it. No real CLI, AI service or real home was touched; installer tests use disposable `--home` directories.

| # | Finding | Verdict |
| --- | --- | --- |
| 1 | agy PreToolUse printed `{"decision":"allow"}` unconditionally | Real |
| 2 | recycled PID keeps chat actions hidden past the 30-minute ceiling | Real |
| 3 | `renameSync` onto a busy config fails on Windows, backup left behind | Real |
| 4 | synchronous agy hook waits up to 2 s on a stdin that never closes | Real |
| 5 | "Auto" on an empty stored value leaves the typed draft | Real |

## 1. Tracker auto-approves for agy
- Evidence: `hooks/cli-tracker.mjs` wrote the allow decision before reading anything. The agy reply contract is unconfirmed (`docs/hooks-other-clis-research.md` 3.3).
- Fix: PreToolUse, PostToolUse and Stop all print `{}` for agy; nothing else is ever printed. `scripts/install-cli-hooks.mjs`: `all` now covers codex, opencode and qoder only; `agy` needs the explicit target plus `--unverified-agy-contract` (without the flag it throws; with it a WARNING line is printed). Uninstalling agy needs no flag. README and `docs/pr10-cli-hooks-results.md` updated.
- Tests: `cli-hooks` "never prints a decision or approves a tool" (4 CLIs x 4 events x bad/good input), agy neutral replies now `{}`; `install-cli-hooks` "`all` skips agy; agy needs --unverified-agy-contract".

## 2. Busy PID without a ceiling (`server/chat-actions.mjs`)
- Evidence: the PID check ran after the time check and could set `busy = true` at any age.
- Fix: the PID is consulted only inside the 30-minute ceiling; a live PID extends busy within it, a dead PID (ESRCH) ends it early, past the ceiling busy is false regardless.
- Test: `chat-actions` "busy: a live PID extends only within the 30-minute ceiling..." with a stub clock, the test process's own PID and a dead PID (`2**22+12345`).

## 3. Rename on Windows (`applyInstall`)
- Evidence: a single `renameSync`; the backup was written before it and never removed on failure.
- Fix: `applyInstall(plan, { rename, pause })` retries EPERM/EACCES/EBUSY up to 6 attempts with 20 ms steps. The helper in `server/registry.mjs` is not exported and is a Windows-only inline loop, so the same pattern is repeated here in a few lines. On final failure the temp file and the (then pointless) backup are removed and it throws "... could not replace the file (CODE); nothing was changed".
- Tests: rename failing twice with EPERM then succeeding (3 calls, installed); always failing (target bytes unchanged, directory listing identical, error text).

## 4. stdin wait
- Evidence: reproduced. With the old code a test piping one payload without closing stdin took 2076 ms (both new timing tests fail on the old tracker).
- Fix: parse after each chunk and stop at the first complete JSON object; stdin cap 500 ms; once parsed, the send gets its own 2 s guard (HTTP abort stays 1.8 s). 256 KB limit and always-exit-0 unchanged.
- Tests: closed-less stdin finishes in under 1.5 s with `{}`; silent stdin ends within the cap (< 1.5 s including Node start-up).

## 5. DefaultModels draft
- Evidence: by reading, `save` returned before clearing the draft; the Auto button is enabled by a draft alone.
- Fix: pure `saveDecision(value, stored)` exported from `src/components/DefaultModels.tsx`; `save` clears the draft for the service on the no-change path too (still no network call).
- Tests: `default-models-ui` "saveDecision ..." (5 assertions). The component's state update itself is not exercised (no DOM environment).

## Results
- `npm run build`: passed.
- `npm run test:win -- --serial cli-hooks install-cli-hooks chat-actions chat-suggestions default-models-ui default-model doctor adapter-contract server-state-guard server-characterization office-router file-layout`: 12 files passed (cli-hooks 60, install-cli-hooks 14, chat-actions 16, chat-suggestions 7, default-models-ui 7, default-model 7, doctor 22, adapter-contract 32, server-state-guard 4, server-characterization 4, office-router 7, file-layout 1), 0 failed.
- Old tracker against the new `cli-hooks` tests: 4 failed, confirming findings 1 and 4.

## Not verified
- Finding 2's old-code failure was reasoned from the code, not run against the old file.
- Real EPERM from another process holding a file was not reproduced; the retry is tested with injected rename functions.
- agy's real hook contract (what `{}` means for PreToolUse) is still unconfirmed.
- The worktree's `node_modules` junction was missing and was recreated (junction to the main checkout's).
