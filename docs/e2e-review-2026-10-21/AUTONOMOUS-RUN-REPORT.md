# Autonomous run report — 2026-10-21 (plan: `AUTONOMOUS-PLAN.md`, log: `AUTONOMOUS-LOG.md`)

All six tasks finished well inside the window; nothing was committed, pushed or deployed. No production code, settings, hooks or real `~/.agent-office` were touched during the run (a file-mtime scan of the repo outside `docs/` found no change in the 30 minutes after the agy task started).

## Results

| Task | Result | Evidence |
| --- | --- | --- |
| T0 Qoder | **Blocked by the provider.** Every call, on every model tried, got HTTP 403 `RESOURCE_LIMIT` (queue `p3`). No boundary violation (no file written in chat, plan or write). **Finding:** `qodercli` does not exit on that error, it polls the queue; the adapter waits 150–180 s per call and reports "timed out", not "limit", so the circuit breaker is not told it is a limit. | `PHASE4A-QODER.md` (written by agy, numbers cross-checked in the three `phase4a-qoder-*.log`) |
| T1 Full test suite | **Pass.** `npm run test:win`: 61/61 files, 1132 tests passed, 0 failed, no file timeouts, exit 0. Confirms Codex's later `server/adapters.mjs` change broke nothing. | `autonomous-test-win.log` |
| T2 OpenCode, non-Google models | **Blocked by credentials**, 3 models tried (the maximum): Anthropic key "not scoped to a workspace"; OpenAI gateway key "invalid, expired, or revoked"; OpenRouter timed out at 60 s. No tokens, no cost, no boundary violation. OpenCode writes a small `.git/opencode` file in a workspace on first use (metadata; flagged so a strict snapshot is not misread). | `PHASE4A-OPENCODE-RETRY.md` |
| T3 Antigravity without the bypass | **Plan and write both pass without `--dangerously-skip-permissions`**, also with `--sandbox`, when the prompt tells it to use its file tools and not the shell. `acceptance.txt` = 12 bytes `OFFICE_P4_OK`, no newline; plan mode returned a plan and created nothing. The earlier "blocked" came from the model choosing a shell command, which headless mode refuses. | `PHASE4A-AGY-EXPERIMENT.md` |
| T4 Building phase-0 inventory (agy) | **Done, 365 lines** — module-level state with classification, every `mount*` and its captured dependencies, every path/home/cwd/tmp use, every script/hook assuming one home or port 3334, risks. | `docs/building-phase0-inventory.md` |
| T5 Verification of T4 | 16 of 17 sampled code references matched the file and line exactly; one was off (`mountRegistry` is at `server/sessions.js:361`, the inventory says 367). A scan for top-level `Map`/`Set`/`WeakMap`/array/`let` in `server/index.js` found none missing from the document. | this report |

## What the inventory adds to the plan (T4, worth reading)

1. **Tests import `server/index.js` and read its module-level state.** `tests/helpers.ts` `loadOffice()` (`vi.resetModules()`, then import) is used by 30+ test files, which inspect `activeAgents`, `sessions`, `AUTH_TOKEN`, `broadcast`. The refactor therefore needs a **compatibility facade**: the old exports proxy to a default office context while the tests are migrated. This is not in `building-and-levels.md` yet.
2. **Two more `homeDir` users** than the plan lists: `scripts/report-usage.mjs` and `scripts/watcher-run.mjs`.
3. **Import-time side effects:** `server/index.js` and `chat-db.js` create the runtime dir, open SQLite, start timers (`index.js:3384`, `status.js:504`) and create the HTTP/WebSocket servers at import, not in a `start()`. Multi-office needs a `createOffice()` and a `start()` split first.
4. `health` was left "unsure" (building-wide uptime plus per-office counts); `registry` is classed G0 because it reads the machine-wide `~/.claude/sessions`. Both need an owner decision.

## Needs the owner

1. **Qoder:** the account is rate-limited (all models, queue p3). Retry later; or decide whether the adapter should treat a hanging `qodercli` as a limit (production change, below).
2. **OpenCode credentials:** make the Anthropic key workspace-scoped (or set the workspace header), reissue the OpenAI gateway key, check OpenRouter by hand. Then re-run the probe (`PHASE4A-OPENCODE-RETRY.md`, last section).
3. **Production changes proposed, not applied** (they need your yes):
   - agy plan/write prompt: one sentence "use your file read/edit tools, do not run shell commands", then re-run the agy probes through `runAdapter` and `handleGoal` (`PHASE4A-AGY-EXPERIMENT.md`).
   - Qoder: detect the `RESOURCE_LIMIT` / queue-polling case (stop the process on the first limit message and report `limit` so the circuit breaker opens) instead of waiting for the 150 s timeout.
   - Antigravity chat now answers in plan mode (consequence of the earlier boundary fix); confirm that is acceptable.
4. **Update `docs/building-and-levels.md`** with the facade and the `createOffice()`/`start()` split (item 1 and 3 above) and the two extra `homeDir` users.
5. Still open from before: `.gitattributes` `*.sh text eol=lf` (git warned that `hooks/install-hooks.sh` will turn CRLF); Antigravity bypass as a test subject (not run, no consent); the 16 platform skips on WSL/Linux; Electron packaged shutdown/relaunch; live provider limits; ACL hardening of token files on Windows.

## Resource use
- Codex was not used (5 h quota at 90%, reset 12:07). Weekly 30%.
- agy as worker: two runs, ~474 K and ~418 K tokens (mostly cached context), 25 min and 15 min. The T3 experiment used ~52 K tokens in three calls. OpenCode and Qoder probes reported 0 tokens (all blocked).
- Left on disk: disposable workspaces and homes under `%TEMP%\office-p4a-*` (incl. `agyexp-*`, `opencode-*`, `qoder`), the three agy and probe JSON files in `%TEMP%`. Nothing outside files created by this run was deleted.

## Addendum (continuation)
- `docs/building-and-levels.md` now carries the facade, the `createOffice()`/`start()` split and the two extra `homeDir` users (rules 11-14 in section 4).
- `PROPOSED-CHANGES.md`: exact diffs, tests and live checks for the agy prompt sentence and for Qoder limit detection (`qodercli` prints nothing when limited; the limit is only in `~/.qoder/logs/runs/*/qodercli.log`). Not applied.
