# One contract for every tool the office runs

`server/adapters.mjs` starts five CLIs (Claude Code, OpenAI Codex, Antigravity `agy`, OpenCode, Qoder). A job must mean the same thing whichever one answers: the same **context** (folder and prompt), the same **access** (what it may touch in chat, plan and write), the same **operations** (what happens on long prompts, failures, limits). `tests/adapter-contract.test.ts` (29 tests) enforces it with fake CLIs that record how they were started; `tests/fixtures/adapter-contract.json` pins the exact arguments (rewrite it with `UPDATE_ADAPTER_CONTRACT=1` after a deliberate change).

## Context
- **Folder.** `runAdapter(name, prompt, { cwd })` starts the CLI in `cwd` (default: the folder the process runs in, as before). The office's delegation passes `deps.cwd` through the brain chain, so the CLI works in the office's project whichever process launched it. Test: an office job through `runWithBrain` starts the first step in the given folder.
- **Prompt.** The prompt is data, never shell text: Claude Code and Codex read it from stdin, the other three get it as one argument (no shell). A prompt with `$(…)`, backticks, quotes, `&`, `|` arrives byte for byte and nothing runs (test).
- **Environment.** Every CLI inherits the process environment; OpenCode adds its permission variable (below). `runAdapter(…, { env })` adds more for a worker (the office id, later).

## Access (what each mode may do)

| Mode | Claude Code | OpenAI Codex | Antigravity | OpenCode | Qoder |
| --- | --- | --- | --- | --- | --- |
| chat | `--tools ''`, `--safe-mode`, one turn: no tools at all | `-s read-only --ephemeral` | `--mode plan` | `OPENCODE_PERMISSION` deny-all | `--permission-mode dont_ask` |
| plan | `--safe-mode --permission-mode plan` | `-s read-only --ephemeral` | `--mode plan` | deny-all + read/glob/grep/list, `--agent plan` | `--permission-mode dont_ask` |
| write (approved) | `--permission-mode acceptEdits` | `-s workspace-write` | `--mode accept-edits` + "use file tools, no shell" | inherits the user's own permissions | `--permission-mode accept_edits` |
| bypass (Settings > Services, write only) | none | none | `--dangerously-skip-permissions` | none | none |

Enforced for all five by the tests: chat and plan never carry a write-enabling flag (`acceptEdits`, `workspace-write`, `accept-edits`, `accept_edits`, the bypass), even with full access configured; the bypass appears only in write mode, only when switched on for that service, and only for a CLI that has one; OpenCode's chat/plan permission is deny-all with no edit/write/bash allowed.

### Known differences (not hidden)
1. **"Chat" is not equally strict.** Claude Code and OpenCode run with no tools; Codex, Antigravity and Qoder can still read files in the folder. None may write (by their flags), but only Claude Code and OpenCode have no read access.
2. **Antigravity plan/chat is not a hard read-only boundary.** Its `--mode plan` wrote a file once in nine runs (`docs/e2e-review-2026-10-21/PHASE4A-AGY-PLAN-MODE-FINDING.md`). The flag is used, but the guarantee depends on the model's behaviour. Options for a real boundary are listed there; the owner decides.
3. **Claude Code write mode loads the user's hooks, CLAUDE.md and MCP servers** (only chat and plan use `--safe-mode`), so an approved write run is a normal session of the user's setup.
4. **OpenCode write mode** inherits whatever permissions the user configured; the office adds none.

## Model listings and the catalogue

A model listing (`adapters[name].models()`) that fails, times out (30 s) or returns nothing never removes a service from the brains. `buildCatalogue` retries that service once after the others finished, and if it still fails keeps the models of the previous `catalogue.json` with `stale: true` and records `listingErrors: { <service>: { at, message } }` (cleared by the next good listing). A refresh where every listing failed keeps the whole old catalogue (and its build time, so the next request tries again). A service that was never listed and fails stays absent, with its error recorded. The Brains panel shows "model list out of date" for such a service.

## Master prompt

Agent prompts for chat, planning and approved work carry three layers in order: **project master prompt, agent job description, task**, separated by `=== PROJECT RULES ===`, `=== YOUR JOB DESCRIPTION ===` and `=== THE TASK ===`. The task can narrow the rules, never widen them. The office loads its current `master-prompt.md` override for each prompt, falling back to the shipped default when the override is invalid or unreadable; project and office variables are rendered for that run. Optional root `AGENTS.md` rules are capped and secret-looking lines are removed before inclusion. Classification remains a separate orchestration prompt.

These rules are model instructions, not a sandbox. In particular, Antigravity with full tool access has no enforced project boundary: the master prompt is advisory. The approved-write completion report compares Git state before and after, lists detected changes and warns about sensitive paths or more than 30 changed files. This is an after-the-fact report; it cannot prevent or reliably detect writes outside the repository, and never blocks or reverts a run.

## Operations
- **Always an answer, never a rejection.** `runAdapter` resolves `{ text, model, usage, reported, code, durationMs, error }` in every case. A spawn the OS refuses is an `error` result, not a thrown exception (it used to reject the promise).
- **Long prompts.** Windows allows about 32,000 characters on a command line (Linux 128 KiB per argument). Claude Code and Codex read stdin and take any size. Antigravity, OpenCode and Qoder take the prompt as an argument; above ~30,000 characters (Windows) or ~120,000 (elsewhere) the prompt is **saved to a file in a folder of its own** and the CLI gets a short instruction that points to it: OpenCode and Qoder attach it (`-f`, `--attachment`, so the content reaches the model without any tool, also in the deny-all chat mode), Antigravity gets the folder added to its workspace (`--add-dir`) and reads the file with its file tool. The folder is deleted when the run ends. The access flags are exactly those of a short prompt (test). Before this, `spawn` threw `ENAMETOOLONG` and `runAdapter` rejected (found by running 40,000 and 120,000 character prompts through all five). Verified live with a 68,406 character prompt through `agy` in plan mode (answered correctly in 12.5 s, folder cleaned up); the OpenCode and Qoder routes are verified with fake CLIs only, because their accounts are currently blocked by their providers. If the file cannot be written the run answers with an `input` failure (`…takes the prompt as a command-line argument…`), which is the prompt not fitting, not the service being down: it never opens a circuit or starts a cooldown (`server/availability.mjs`).
- **Limits and failures** are classified the same way for every CLI (`classifyFailure`); a CLI that hangs after hitting a limit (Qoder) gets its own log read after the timeout (`timeoutHint`).
- **Timeouts.** `timeoutMs` is a soft deadline: while a run shows activity it keeps working, only an idle one is ended. When the deadline fires, a run that showed a sign of life within the last `activeWindowMs` (default 45 s, or the adapter's own: 120 s for Antigravity, whose conversation file stays quiet for 26 to 52 s while the model thinks; never longer than `timeoutMs`) gets another window, until `maxMs` in all (default: the larger of 5 x `timeoutMs` and 30 minutes); then it is ended with the usual `<name> timed out`. A sign of life is any stdout/stderr data, or the adapter's optional `activity({ since, env })` probe: Antigravity (silent until the end) reports the newest `*.db` write in `~/.gemini/antigravity-cli/conversations` (`AGENT_OFFICE_AGY_CONVERSATIONS` overrides), Qoder the newest `qodercli.log` write in its runs folder. A probe never throws (a failure counts as no activity). A CLI with no signal at all is ended at `timeoutMs`, as before. Tests: `tests/adapter-activity.test.ts`.
- **Usage** is normalised to the same fields; what a CLI does not report stays "not reported", not 0.
