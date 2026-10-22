# PR 12: activity-based timeouts

## Files
- `server/adapters.mjs`: `runAdapter` options `activeWindowMs` (default 45 000) and `maxMs` (default max(5 x timeoutMs, 30 min)); optional adapter field `activity({ since, env })`; probes for `agy` and `qoder`; helper `qoderRunsRoot` shared with `timeoutHint`.
- `tests/adapter-activity.test.ts` (new, 6 tests), `docs/adapter-contract.md` (Timeouts paragraph).
- Unchanged: arguments, prompts, golden file, `server/delegation.mjs` constants, failure classification.

## Behaviour
When `timeoutMs` fires, the run is ended exactly as before (`<name> timed out`, `timedOut` path) unless its latest sign of life is younger than the window and the run is younger than `maxMs`; then the check is re-armed for one window (clamped so it never overshoots `maxMs`). Sign of life = any stdout/stderr data, or the probe's epoch-ms. The window is `min(activeWindowMs, timeoutMs)`, so a run with a short deadline is not extended by a stale signal for longer than its own deadline (needed by the existing Qoder hint test, which writes its log once at start and then stays silent). A run without any signal is ended at `timeoutMs`. `onData` is untouched.

Probes (read-only, try/catch, return 0 on any error):
- agy: newest mtime of `*.db` in `~/.gemini/antigravity-cli/conversations` (override `AGENT_OFFICE_AGY_CONVERSATIONS`), only files modified at or after the run started.
- qoder: newest mtime of `qodercli.log` in each run folder under the Qoder runs root (override `AGENT_OFFICE_QODER_LOGS`), at or after the start.
- No probe for claude, codex, opencode.

## Tests (run from `D:\work\_wt-pr12`, `--serial`)
`npm run build` ok. adapter-activity 6/6, adapter-contract 32/32, adapter-hints 5/5, adapter-permissions 2/2, brains 59/59, circuit-breaker 7/7, delegation 25/25, delegation-runtime 2/2, server-state-guard 4/4; 0 failed files. (`availability` matched no test file.)
Note: the first version (window = `activeWindowMs` regardless of `timeoutMs`) made `adapter-hints` "a run killed by its timeout reports the limit" time out; that is why the window is capped at `timeoutMs`.
Setup note: the worktree's `node_modules` junction was missing and was recreated to the main checkout's `node_modules`.

## Not verified
No real CLI was run. The real agy conversation folder layout (`*.db` files being written during a headless run) and Qoder's log writes while polling are assumptions taken from the task description; the probes are only exercised with fake CLIs.
