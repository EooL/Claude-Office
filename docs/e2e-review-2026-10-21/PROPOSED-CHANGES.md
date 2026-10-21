# Proposed production changes (not applied — need the owner's yes)

Each has the evidence, the exact change, the test that would guard it and how to verify it live. Nothing here has been applied.

## 1. Antigravity: tell plan/write to use file tools, not the shell

**Evidence:** `PHASE4A-AGY-EXPERIMENT.md`. With `--mode accept-edits` (and also with `--sandbox`) and the sentence "use your file edit tool, do not run shell commands", `agy` created `acceptance.txt` with exactly `OFFICE_P4_OK`; plan mode returned a plan and created nothing. Without the sentence, the model reaches for a shell command, headless mode refuses it, and Phase 4A reported plan and write as blocked.

**Change** (`server/adapters.mjs`, the `agy` entry, `args`):

```js
args: (prompt, { model, mode }) => [
  '-p', mode === 'chat' || hasFullAccess('agy') ? prompt : `${prompt}\n\nUse your file read and edit tools. Do not run shell commands.`,
  '--output-format', 'json', ...opt('--model', model),
  ...({ write: ['--mode', 'accept-edits'], plan: ['--mode', 'plan'], chat: ['--mode', 'plan'] })[mode],
],
```

The sentence is skipped when the user turned on the service's full-access opt-in (then commands are allowed and the task may need them) and in chat.

**Test:** in `tests/adapter-permissions.test.ts`, with the existing fake `agy`, assert the prompt received in plan and write contains the sentence when full access is off, and does not when it is on.

**Live check:** `node docs/e2e-review-2026-10-21/phase4a-probe.mjs agy plan gemini-3.8-flash-low <tag>` then `write` (workspace for a new tag must be a git repo with `seed.txt`).

**Limit:** a task that really needs a command (tests, build) is still refused without the opt-in; that is intended.

## 2. Qoder: a rate-limited `qodercli` hangs instead of failing, and the breaker never learns it is a limit

**Evidence:** `PHASE4A-QODER.md`, plus a fresh check (10:19): `qodercli -p -o json --permission-mode dont_ask "…"` prints **nothing** on stdout or stderr and runs until killed (exit 124 after 40 s). The limit is visible only in its own log, `~/.qoder/logs/runs/<run>/qodercli.log` (HTTP 403 `RESOURCE_LIMIT`, `retryAfterSeconds: 30`). The adapter waits its full 150 s, reports "qoder timed out", and `classifyFailure` files that under `other`, so the cooldown is short and the next role may hit the same wait again.

**Change** (smallest, contained): in the Qoder entry, when a run ends by timeout with empty stdout and stderr, read the tail of the newest `qodercli.log` under `~/.qoder/logs/runs` (only files modified after the run started) and, if it contains `RESOURCE_LIMIT`, return `error: 'Qoder resource limit reached (RESOURCE_LIMIT), retry after 30 seconds'`. That text already matches the existing patterns and the retry hint parser in `server/availability.mjs`, so no change to `classifyFailure` is needed.

**Better, if the owner accepts a bigger change:** start watching that log file while the run is alive and terminate the process on the first `RESOURCE_LIMIT` line instead of waiting 150 s.

**Test:** a fake `qodercli` that sleeps, plus a fake log directory (`AGENT_OFFICE_QODER_LOGS` override, new, only for tests), asserting `classifyFailure(...).kind === 'limit'` and a cooldown of about 30 s.

**Risk:** depends on the CLI's private log layout; if it changes, the old behaviour (timeout classified `other`) returns, nothing worse.

## 3. Antigravity chat now answers in plan mode

Already applied by Codex (`--mode plan` for chat). Consequence: replies can read like plans. Owner to confirm it is acceptable; the alternative (a chat mode with writes disabled by another flag) was not found in `agy --help`.

---
## Status after "Ok, continua" (applied)
- (1) Applied to `server/adapters.mjs`, **narrowed**: the sentence goes only into an approved `write` without full access; a live check found plan mode can still write (`PHASE4A-AGY-PLAN-MODE-FINDING.md`), so plan and chat are left as they were. Live write through `handleGoal`: `acceptance.txt` exact 12 bytes.
- (2) Applied: new optional adapter hook `timeoutHint`, used by Qoder to read its own run log after a timeout. Live: the real, limited Qoder account now returns `Qoder usage limit reached (RESOURCE_LIMIT), retry after 30 seconds`, `classifyFailure` kind `limit`, retry 30 s.
- Tests: `tests/adapter-hints.test.ts` (5 tests). Not committed.
