# Phase 0 / 1A / 1B results

Existing dirty work was preserved. No commit, push, deployment, or active office configuration change was made.

## Changes in this session

- `package.json`: added `test:win`.
- `scripts/test-win.mjs`: prepend Git Bash bin and usr/bin to Windows PATH (or use `GIT_INSTALL_ROOT`), run up to four isolated test-file processes, enforce 15-second async test/hook timeouts and a 120-second process-tree deadline per file. Optional positional arguments filter filenames, e.g. `npm run test:win -- process-lock meters-payroll`.
- `src/meters.ts`, `src/components/Meters.tsx`: distinguish absent, partial, and complete cost coverage; aggregate measured costs only; label unknown costs and burn as `not reported`, partial totals as `(partial)`. Legacy status-line costs retain measured status, including zero. Tooltips also distinguish missing coverage.
- `server/process-lock.mjs`: publish PID, timestamp and unique ownership token as an atomically created child-directory record inside `.reclaim`. Dead owners or records older than 30 seconds can be removed; abandoned empty directories require the same age threshold. Retry atomic mkdir once. Cleanup targets the observed owner record; live main lock owners remain protected regardless of reclaim age.
- `tests/meters-payroll.test.ts`: actual server-rendered Payroll assertions for unknown, partial, complete and zero costs.
- `tests/process-lock.test.ts`: dead PID plus legacy leftover directory regression, killed reclaimer with eight competing processes and one winner, fresh live reclaimer and stale-record/live-main-owner protection.

## Verification

- `npm run test:win -- meters-payroll process-lock meters-store`: **15 passed**, no failed files, repeated after final changes (`phase01-targeted.log`).
- `npm run build`: **passed**, including TypeScript (`phase01-build.log`).
- `git diff --check`: **passed**.
- Complete `npm run test:win`: exit 1, **14 failed files**. Completed file summaries report **875 passed / 43 failed / 2 skipped**; these counts exclude incomplete timed-out files and import failures (`phase01-test-win.log`).
- File deadlines demonstrably terminated `hook-script.test.ts` and `plugin.test.ts` at 120 seconds. `scripts.test.ts` completed in 104 seconds with 15 passed and 8 failed.
- Import failures: doctor, electron-helpers, open-office.
- Assertion failures: hardening, permissions, release, install-hooks, sessions-registry, status-line, transcript, ws-auth, scripts.

The full Windows baseline is still not green. This session did not repair unrelated suite failures or establish that every failure predates these changes. Timed-out lifecycle files remain unverified beyond partial execution. Payroll was verified through rendered markup, not an interactive browser session. Crash recovery was verified with disposable real Node processes, not by crashing the active office or testing packaged Electron.
