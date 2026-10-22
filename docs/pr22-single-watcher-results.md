# PR 22: one chat watcher per office home

## Evidence and cause

The old Node supervisor acquired `watcher-supervisor.lock`, then trusted only `chat-watcher.pid` and Bash `kill -0`. On reuse it released that reservation and exited. The file contains a Bash/MSYS PID, not a native Windows PID, and did not establish script identity, office-home ownership, or a persistent native process record. There was no reconciliation of already-running duplicates. A supervisor lock alone therefore did not represent ownership of an adopted or orphaned watcher.

There are two different launch paths in this checkout. `scripts/office.mjs` starts `watcher-run.mjs` directly. In the pre-change supervisor, the branch printing `Reusing the existing office chat watcher` calls `process.exit(0)` before the spawn statement. That invocation cannot both print reuse and spawn another watcher. Its Bash liveness check already uses the shell PID namespace; it would be incorrect to call that particular check a native-PID check.

The reported `os.setsid()` traceback identifies the legacy `scripts/start-office.sh` spawn helper (line 76). Its `stop_stale_watcher` deletes the PID file before checking the old command, and the shell entry point starts another watcher without acquiring the Node reservation. Native Windows Python cannot run that helper. The failed helper itself does not prove a successfully started second watcher. `open-office.mjs` opens a redirect page and does not start a watcher. These code facts establish an incomplete ownership protocol and an incompatible legacy launch path; they do not establish which additional invocation produced the owner's measured second process. No real restart was performed to reconstruct that invocation.

## Node-side fix

- Keep the existing cross-process home-local reservation throughout startup, adoption, and owned-child shutdown. A reused watcher remains supervised until it exits; subsequent starts cannot pass the reservation.
- Persist native PID, home, random command-line identity token, and start time in home-local `watcher-processes/*.json`. Native liveness uses `process.kill(pid, 0)` plus the token and encoded home in the command line (Windows CIM or POSIX `ps`). A reused PID with missing identity proof blocks startup and is never killed.
- Discover legacy Bash watchers through `/proc` on Windows/Linux, reading only their watcher script argument and office-home environment identity. Normalize Windows paths with `cygpath`, map `/proc/<bash-pid>/winpid` explicitly, and record the process birth counter. Shell PIDs are only signalled through Bash. The legacy PID file remains compatible and is never passed to Windows `taskkill` as a native PID.
- Under the reservation, retain the oldest identified healthy watcher and stop only proven same-home duplicates. Wait for each duplicate to exit before allowing the decision to finish. Other homes are excluded. Uncertain PID-file or recorded identities fail closed.
- Launch Git Bash directly through the Node runtime helper on Windows. No Python session helper is invoked. Preserve the existing Node `detached: true` POSIX session behavior. Shell and Python sources are unchanged, so directly invoking the legacy shell entry point remains outside the Node reservation protocol.
- No server routes, route fixture, state guard, or characterization test were changed. The `node_modules` junction is unchanged.

## Verification

All new process tests use disposable homes and fake Node workers or fake Bash sleep loops. The latter only use a watcher-shaped argument; they never execute the shipped chat watcher. Existing shell integration tests retain their fake providers and ephemeral servers. No real AI service was called.

`npm run build`: passed, TypeScript and Vite, 101 modules.

Focused command from the worktree:

```text
node D:\work\Claude-Office\scripts\test-win.mjs --serial scripts office-launcher open-office process-lock watcher-process server-state-guard server-characterization
node D:\work\Claude-Office\scripts\test-win.mjs --serial office-launcher watcher-legacy
```

Consolidated final focused coverage: **8 files passed, 59 tests passed, 7 existing skips, 0 failures**. The first command passed 57 tests with 7 skips; the second passed the final 7 launcher tests and 1 legacy test after adding the dead-owner regression. Open-office accounts for 1 existing skip and scripts for 6; the exclusions documented in `docs/windows-test-baseline.md` were retained. PowerShell's initial redirection wrapped expected shell-test stderr in a `NativeCommandError` diagnostic despite the runner reporting zero failed files; the parallel invocation uses direct `cmd` redirection to preserve its native exit code.

During development, an initial orphan-reuse fixture failed because killing its supervisor also terminated its child on this Windows runtime. It was replaced with an independently spawned, explicitly identified live fake watcher, which tests adoption without assuming POSIX orphan semantics. This was a fixture correction, not a skipped assertion.

Full parallel command (exactly one invocation):

```text
node D:\work\Claude-Office\scripts\test-win.mjs
```

Result: **exit 0, 109 files passed, 1,665 tests passed, 15 existing skips, 0 failures** (1,680 total tests). All files completed; no file timed out. No serial failure rerun was needed because there were no failing files. The load-sensitive files all passed in that parallel run: `delegation-runtime` 2, `adapter-contract` 32, `agent-profile-enrich-route` 6, `electron-helpers` 57, and `cli-hooks` 62 tests.

Final focused results by file:

| File | Passed | Existing skips |
| --- | ---: | ---: |
| office-launcher | 7 | 0 |
| open-office | 17 | 1 |
| process-lock | 3 | 0 |
| scripts | 17 | 6 |
| server-state-guard | 4 | 0 |
| server-characterization | 4 | 0 |
| watcher-process | 6 | 0 |
| watcher-legacy | 1 | 0 |

## Limits and cleanup

No real restart of the owner's office was done. Neither real office home nor ports 3333/3334 were intentionally accessed, and no real process was stopped. Only fixture processes were terminated. No changes were made in the main checkout; its requested test runner was executed read-only from this worktree. Native Windows fake-process tests exercise actual CIM identity and Bash/native PID mapping. A real chat round trip and POSIX host execution remain unverified. Temporary fixtures and local run logs are removed before committing.
