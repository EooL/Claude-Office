# Autonomous run — 2 hours (09:40–11:40 local, 2026-10-21)

Owner away. Claude (boss) drives; agy is the worker; Codex is **not used** (5 h quota 90% at 09:35, resets 12:07; weekly 30%).
A timestamped log is kept in `AUTONOMOUS-LOG.md`; the final summary is `AUTONOMOUS-RUN-REPORT.md`.

## Hard rules (never relaxed during the run)

1. No commit, push, deploy, release, tag, branch change.
2. No change to production code, settings, permissions, hooks or the user's real `~/.agent-office` / active office config. Production-code findings become **proposals** in the report, not edits. Test-only fixes are allowed only if a test is plainly wrong, and are listed.
3. No use of `--yolo`, `--dangerously-skip-permissions` or any bypass **as a test subject**. (agy as a worker runs with its permission bypass inside the repo, writing only the files named in its task.)
4. No sign-in, login, token, credential, install, update or uninstall of any tool. A tool that needs a sign-in is recorded as blocked.
5. Disposable folders and `AGENT_OFFICE_HOME` under the system temp dir only. Never delete anything outside files created by this run.
6. Tiny prompts, 60 s caps, at most 3 models tried per provider. A provider rejection is a result, not something to work around.
7. A boundary violation (a file written without approval) → reproduce once, write it up, stop that line of work, continue the others.
8. Hard stop at 11:40, or earlier when every task is done. No new work is started after 11:20.

## Tasks (time-boxed)

| # | When | Who | Task | Output |
|---|---|---|---|---|
| T0 | 09:40–09:55 | Claude | Close the Qoder probe. Harvest `PHASE4A-QODER.md` if agy writes it; if agy is still stuck at 09:55, stop that agy process (started by this run) and record Qoder as blocked with the smoke evidence (`qodercli -p` produced no output in 60 s; likely needs sign-in). | `PHASE4A-QODER.md` or a Qoder section in the report |
| T1 | 09:55–10:25 | Claude | Full `npm run test:win` (61 files) to validate the `server/adapters.mjs` change that Codex made after the Phase 3 full run. Any failure is classified (new vs known) with logs. | `autonomous-test-win.log` |
| T2 | 10:00–10:45 | Claude | OpenCode plan and write with a non-Google model that has local credentials (Anthropic / OpenAI / OpenRouter, from `opencode models`), via the existing `phase4a-probe.mjs`. | `PHASE4A-OPENCODE-RETRY.md` |
| T3 | 10:45–11:10 | Claude | Antigravity plan/write: direct CLI experiment in a disposable folder with `--mode accept-edits` and with `--sandbox` (no bypass) to see whether the file can be created without the permission bypass. Result is a recommendation only. | section in the report |
| T4 | 10:00–11:20 | agy (worker) | **Read-only** Building phase-0 inventory, document only: every module-level `Map`/`Set`/`let`/counter in `server/` tagged G0 or office; every `mount*` call with its captured dependencies; every user of `homeDir`; every script/hook that assumes one home or port 3334. Task text hands over the state of the project and the path of the Codex session log for context. May write only `docs/building-phase0-inventory.md`. | `docs/building-phase0-inventory.md` |
| T5 | 11:20–11:40 | Claude | Verify T4 against the code (spot-check 10 entries), write `AUTONOMOUS-RUN-REPORT.md`, notify the owner. | report |

## Checkpoints and stop conditions

- After each task: append a line to `AUTONOMOUS-LOG.md` (time, task, result, evidence path).
- If T1 shows a failing file that passed at 09:30, stop other work, find the cause (compare with the Phase 3 log), and report. No production edit.
- If agy hits a quota or auth error, stop agy work and carry on with Claude-side tasks.
- If anything is ambiguous or needs a decision from the owner, record it under "Needs the owner" in the report and move on.

## Not in scope (waits for the owner)

Qoder sign-in; Antigravity bypass testing; OpenCode/Google schema workaround; `.gitattributes` for `*.sh`; real live provider limits; Electron packaged shutdown/relaunch; WSL/Linux run of the 16 skips; implementing any phase of `building-and-levels.md`; committing.
