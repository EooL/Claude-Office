# Project review and E2E acceptance — 2026-10-21

Verdict: **not ready for an unrestricted release**. The main Codex planning/approval/execution journey works, but Windows release checks and provider permission acceptance remain open.

The existing dirty checkout was preserved. This review changed `server/adapters.mjs`, added `tests/adapter-permissions.test.ts`, and updated three settings expectations in `tests/turn-events.test.ts`. No commit, push, deployment, or change to the active office's configuration was performed. Builds regenerated ignored `dist/` output.

## Findings, in priority order

1. **P1 — OpenCode chat could write without execution approval (reproduced; mitigation added).** The adapter used the default build agent for chat and inherited permissive tool settings. A real `runAdapter('opencode', ..., { mode: 'chat' })` created `chat-boundary.txt` in a disposable directory and returned `DONE`. Chat now receives a deny-all `OPENCODE_PERMISSION`; planning allows only read/glob/grep/list; write invocations preserve the user's existing permissions. A subprocess regression verifies that these restrictions override an inherited allow-all environment and do not alter approved write mode. The environment option is documented at https://opencode.ai/docs/cli/#environment-variables.

   **Acceptance limitation:** post-fix probes using big-pickle and glm-5.3-flash-free returned “OpenCode's free tier can only be used from within OpenCode” and created no file. This is provider rejection, not a successful live permission-enforcement test. Restricted free-tier chat currently cannot be considered operational. Do not remove the restriction to make the smoke test green; validate a compatible configured model or use another enabled fallback.

2. **P2 — abandoned reclaim directories prevent crash recovery (reproduced; unresolved).** `server/process-lock.mjs:21` returns null whenever `<lock>.reclaim` already exists. A process killed after creating that directory leaves no reclaim-owner record or recovery path. A disposable fixture with a dead PID and leftover reclaim directory returned `deadOwnerReclaimed: false`. This can stall delegation, watcher supervision, or breaker recovery after the corresponding crash. Recovery needs ownership tracking and race-safe reclamation, with cross-process crash tests.

3. **P2 — unknown cost is displayed as zero (browser + source; unresolved).** The real Codex task reported tokens but no `costUsd`; Payroll nevertheless displayed `$0.00` and `$0.00/min`. The tooltip acknowledges missing cost, but the main tile at `src/components/Meters.tsx:149` formats the aggregate numeric zero. Display “not reported” when no cost was measured and identify partial totals when measured and unmeasured services are mixed.

4. **P1 release gate — Windows suite is not green (unresolved).** The final broad run excludes `scripts.test.ts`, `hook-script.test.ts`, and `plugin.test.ts`: **852 passed, 37 failed, 2 skipped**, plus three suites failed during import. The complete Git Bash run was stopped after several minutes without a completed report. No claim is made that all remaining failures predate the added features.

## Automated verification

| Check | Evidence / result |
| --- | --- |
| Initial complete `npm test` with default PATH | 819 passed, 123 failed, 11 skipped, 5 unhandled errors; WSL bash and missing sleep make this an unsuitable acceptance environment |
| Complete run with Git Bash first on PATH | Did not finish; explicitly terminated its process tree |
| Added-feature group, 15 files before this review's mitigation | 145/145 passed; `review-features-results.json` |
| Final focused adapter/brain/delegation-runtime/turn-event group | 113/113 passed; `review-final-targeted-results.json` |
| Final broad run, Git Bash, 4 workers, three lifecycle files excluded | 852 passed / 37 failed / 2 skipped; `review-final-core-results.json` |
| TypeScript + production build after changes | Passed; `review-final-build.log` |
| Asset integrity/budget | Passed; 47.7 MB of 52.5 MB |

Final broad failures: hardening 3; install-hooks 19; permissions 1; release 1; sessions-registry 1; transcript 1; ws-auth 11. Doctor, electron-helpers and open-office fail at import with `Invalid or unexpected token`. Direct Node loading/checking of `electron/helpers.cjs` succeeds, so the import failure needs runner/module-loader investigation. POSIX mode assumptions, Windows paths, and CRLF expectations account for several assertion failures. A timing-sensitive status-line assertion failed in a heavily parallel run and passed in subsequent runs.

## Browser E2E and real provider acceptance

Chrome browser controls exercised the production build at `http://127.0.0.1:4334`, using separate runtime `%TEMP%/office-review-20261021`. Task work ran from a separate Git directory `%TEMP%/office-review-workspace-20261021`; it did not target this dirty project checkout. Browser console inspection returned no captured warnings/errors at the final check.

| User flow | Observed result |
| --- | --- |
| Bare URL | Read-only indicator and disabled first-run submission |
| Authenticated first run | Choose Codex, continue, selected service persisted; backend.json enabled only Codex |
| Brains | Created E2E Review Brain, resolved model chain appeared, Save disabled after save |
| Team | Auto-assigned 13 unconfigured role brains and displayed their assignments |
| Events | Changed real → emulated, confirmed server persistence, restored real mode |
| Chat task → real planning worker | Reviewer appeared, reported Codex, read README, posted a plan; acceptance.txt did not exist before approval |
| Approve and execute plan | Approval recorded in chat, real Codex execution completed; independently verified exact bytes `OFFICE_E2E_OK`, with no trailing newline |
| Markdown file link | Authenticated README reader opened and showed content and adjacent links |
| Local image | Inline reviewer image loaded and click opened enlarged preview |
| Page reload | Persisted task, approval, completion and artifact message restored without duplicate artifact messages |

Screenshots: `completed-chat.png`, `image-preview.png`.

The artifact message was a synthetic authenticated fixture posted to the isolated server. The Codex task was a real provider invocation. The automated delegation-runtime tests use fake CLIs and additionally verify fallback and single execution for concurrent approvals; they are not evidence of real-provider exhaustion/recovery.

## Remaining acceptance scope

- Successful restricted OpenCode chat/plan and approved write against a compatible model.
- Live plan/write boundaries for Claude, Antigravity and Qoder; controlled provider limit and recovery behavior.
- Complete hook/plugin/script lifecycle runs, Windows shutdown/relaunch acceptance, and Electron packaged application testing.
- Resolve crash-reclaim recovery and unknown-cost display before describing the added features as fully verified.

The review's isolated server and watcher are stopped after evidence collection. The test runtime and disposable files remain available for inspection. The user's active office and authenticated CLI subscriptions were not reset.
