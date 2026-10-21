# Phase 3 Windows baseline and triage

No commit, push, deployment, or active office configuration change was made. Existing dirty work was preserved. Three agents owned disjoint import, auth/installer, and lifecycle file groups; the integrating agent owned the corrections and remaining tests.

## Baseline comparison

Clean HEAD was `1a9ba71251326b34c3caa90d49468e75420d0dd4`. A detached worktree at `D:\work\Claude-Office-phase3-head` contained HEAD plus the identical `scripts/test-win.mjs` and a package script to invoke it. Its `node_modules` junction reused installed dependencies; no feature files were copied. Both baselines used `npm run test:win`, with Git Bash first, four supervised file processes, 15-second async test/hook limits, and 120-second file deadlines. Logs are `phase3-head.log` and `phase3-before.log`. The junction and worktree were removed after HEAD completed; other preexisting worktrees were retained.

| Classification | Failing files/cases before triage |
| --- | --- |
| Fails on HEAD too (preexisting) | doctor, electron-helpers, open-office, hardening, permissions, release, install-hooks, sessions-registry, status-line, transcript, ws-auth, scripts, hook-script, plugin: the same **14 failed files** in both runs |
| Fails only in our checkout, at file level | None |
| Fails only on HEAD, at file level | None |
| Fails only in our checkout, at individual test level | scripts: “answers the next human message, then stops at the per-minute reply…”; investigated as a fake-CLI/routing/timing fixture issue |
| Fails only on HEAD, at individual test level | scripts: future-timestamp watermark case; another timing-sensitive case in the same file |

Completed baseline summaries: HEAD **716 passed / 43 failed / 2 skipped**; this checkout **877 passed / 43 failed / 2 skipped**. These totals omit incomplete files: both runs had three import failures and hook-script/plugin file timeouts. scripts finished with HEAD 13 passed/8 failed and checkout 15 passed/8 failed. status-line also raised an unhandled empty-JSON request error in both baselines. Matching file lists do not prove every assertion is preexisting: the settings `eventMode` expectation described below was masked by an earlier mode assertion.

## Corrections and fixes

- Restored estimated-only Payroll's “needs the status line” text and added rendered tests for that branch and estimated + measured `(partial)` totals.
- A recorded `.reclaim` owner is evicted only when its PID is dead. A live PID remains protected regardless of timestamp; the 30-second threshold applies only to empty abandoned directories. Updated the comment and old-live-owner regression.
- Reproduced the three imports in plain Node and Vitest. Original modules import successfully in Node; Vite 5's SSR hashbang matcher misses CRLF and moves injected imports ahead of the shebang. The resulting transformed file fails Node syntax checking. A narrow test pre-transform strips CLI hashbangs while preserving line numbering; a CRLF fixture protects the regression.
- Recovered doctor suites exposed Windows path/executable assumptions: doctor now recognizes MSYS drive paths, compares Windows paths without case sensitivity, and finds `.exe`/`.cmd`/`.bat` tools. It warns explicitly that Windows token ACL permissions are unverified rather than treating synthetic POSIX mode bits as an ACL check. Opener tests use portable paths and disposable executable fixtures, and close SQLite before cleanup.
- Auth tests retain token-content checks on Windows, use a portable UID mock, and distinguish real POSIX chmod behavior from synthetic NTFS modes. Installer tests preserve byte-level refused/untouched checks, normalize semantic line endings and Bash/native path boundaries, and control the clock inside Bash startup instead of relying on launcher PATH precedence. The production installer now canonicalizes native and historical MSYS paths without a test-only argument-conversion workaround, accepts raw Windows `CLAUDE_CONFIG_DIR`, and validates the adjacent Python companion. It still registers the checkout directly; uninstall never deletes shared checkout source.
- Remaining tests use native path joins and semantic CRLF normalization. Registry PID-reuse coverage uses a known-live PID instead of assuming PID 1 exists. POSIX-specific hardening checks are isolated explicitly; token/marker behavior remains exercised on Windows. Updated three exact permissions-settings expectations to include the checkout's `eventMode: real` field, which the former mode failure had hidden.
- status-line's test capture server now stays responsive while subprocesses run. Native Python CRLF is normalized before splitting the event/display records, preventing an empty `\r` event. A fake sender held behind an explicit release barrier replaces the machine-speed assertion for nonblocking delivery.

- Lifecycle timeout diagnosis: the embedded tracker Python exceeded Windows' command-line limit (over 66 KB), and materializing that large heredoc also stalled Git Bash in standalone probes. The Python implementation now lives in adjacent `hooks/agent-tracker.py`, invoked as a file by the small shell wrapper. Native Python uses explicit UTF-8 and wrapper output boundaries normalize CRLF. This preserves payload-on-stdin behavior and single interpreter execution; the companion must travel with the shell wrapper.
- Lifecycle fixtures intercept fake commands inside Bash startup, account for the separate intent-classification CLI call, and use platform-correct PATH and URL handling. CLI plugin validation remains exercised with isolated configuration and bounded subprocesses. The fixes expose formerly unreachable hook assertions rather than treating a killed suite as passing.

## Verification and limits

Focused checks before integration: corrections **8 passed**; recovered imports **96 passed / 1 skipped**; ws-auth **23 passed / 6 skipped**; installer **53 passed**; status-line **16 passed**. Production build (including TypeScript), asset integrity/budget, and diff checks passed. Named logs are alongside this document.

Windows-specific skips and limits:

- Four ws-auth chmod rejection cases and two hardening mode-repair cases: NTFS `chmod`/`stat` do not implement POSIX permission bits. Content/auth checks remain enabled; these skips do not verify Windows ACLs.
- Existing ws-auth root-only chown case: unavailable root/getuid ownership capability.
- File symlink cases in ws-auth and open-office: this account cannot create the fixture symlink (EPERM). Auth's capability probe retains execution on capable hosts. Windows lacks `O_NOFOLLOW` here, so symlink enforcement remains unverified; no security claim is inferred from the skip.
- Six shell script lifecycle cases: stopped-mid-reply, three stop-office cases, and two start-office cases rely on POSIX process-group IDs, signals/traps, process-discovery tools, or Python `os.setsid`, which native Windows lacks. Portable Node opener tests and watcher HTTP/fake-CLI behavior remain enabled. These skips do not establish Windows packaged shutdown/relaunch acceptance.
- Existing registry process-start platform skip remains platform-dependent.

Final integration, run by the integrating agent after all agent edits stopped:

| Check | Result | Evidence |
| --- | --- | --- |
| Complete `npm run test:win` | **61/61 files passed; 1,130 tests passed, 16 skipped; zero failures, import errors, unhandled errors, or file timeouts; exit 0** | [phase3-final-test-win.log](phase3-final-test-win.log) |
| Former timeout: hook-script | 83 passed, 45.99 seconds | Same full-run log |
| Former timeout: plugin | 40 passed, 13.24 seconds, including installed CLI validation | Same full-run log |
| scripts lifecycle file | 17 passed, 6 skipped, 74.95 seconds | Same full-run log |
| Production build / TypeScript | Passed | [phase3-build.log](phase3-build.log) |
| Asset integrity and budget | Passed | [phase3-assets.log](phase3-assets.log) |
| `git diff --check` | Passed | Final command output |
| Clean HEAD worktree removal | Confirmed absent from `git worktree list` | Main and the preexisting `_pr-wt` remain |

Both test-level baseline differences (the checkout-only next-human reply case and HEAD-only future-watermark case) passed in the final full run. No tests were excluded from the Windows runner's file discovery: all 61 discovered files produced completed summaries. The 16 skips above remain acceptance limits, not passing platform coverage.

## Files changed in this continuation

- Test setup: `.gitattributes`, `vitest.config.ts`, `tests/fixtures/crlf-shebang.mjs`.
- Corrections: `src/components/Meters.tsx`, `server/process-lock.mjs`, `tests/meters-payroll.test.ts`, `tests/process-lock.test.ts`.
- Runtime portability: `scripts/doctor.mjs`, `hooks/agent-tracker.sh`, new `hooks/agent-tracker.py`, `hooks/install-hooks.sh`, `hooks/status-line.sh`.
- Tests: doctor, electron-helpers, open-office, ws-auth, install-hooks, hardening, permissions, release, sessions-registry, transcript, status-line, hook-script, plugin, scripts.
- Evidence: this report and the named Phase 3/focused logs in this directory. Prior dirty changes to unrelated files were retained.

Browser interaction, packaged Electron shutdown/relaunch, real office crash/recovery, Windows ACL enforcement and privileged file-symlink handling were not verified. Crash tests use disposable real Node processes; permission/network fixtures use disposable directories and ephemeral ports. No live probe processes were found during agent cleanup inspection. Automatic approval review rejected removal of temporary lifecycle probe fixtures with the stated reason “blocked by policy”; they remain in `%TEMP%` and no cleanup bypass was attempted. This does not affect the successfully removed clean-HEAD worktree.
