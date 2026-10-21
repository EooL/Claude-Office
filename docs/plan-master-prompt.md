# Plan: the project master prompt

Owner decision: agents stay inside the limits of the project through a **master prompt** that every agent receives, in this order, for every service and every mode: **master prompt, then the agent's job description, then the task**. Authority is in the same order: the task can narrow, never widen.

## What it is, and what it is not
- A prompt is advice to a model, not a lock. Codex (`workspace-write`) and Claude Code (`acceptEdits`) also have enforced limits; **Antigravity with the full-access switch has none** (tested on 2026-10-21: it wrote inside and outside the workspace; `--sandbox` did not help). For that case the master prompt is the only boundary, so the plan adds a cheap after-the-fact check (WP-P, "boundary report") and does not claim more than it gives.
- The default text is already written: `server/master-prompt.default.md` (sections: project and its boundary, never-unless-asked, secrets, how you work, when to ask, how you report; variables `{{project}}` and `{{office}}`). Do not rewrite it; the owner edits it in the UI.

## Rules for every agent
- English everywhere in the repo and the UI. No commit, push or deploy. Never touch the real `~/.agent-office` / `~/.claude-office`, nor `%TEMP%\office-e2e-*`, `%TEMP%\office-p4a-*`. Disposable dirs and ephemeral ports only; no test calls a real AI service.
- Edit with edit tools, not shell heredocs. Do NOT edit `scripts/*.sh` / `*.py` (CRLF in this working tree).
- Memory is tight: focused tests with `npm run test:win -- --serial <names>`; only the lead agent runs the full suite (once, at the end) and `npm run build`.
- Each agent owns ONLY the files listed for it and reports needs in other files instead of editing them.
- Guards stay green: `tests/server-state-guard.test.ts` (no new module-level state, no `process.cwd()`/`homeDir` in `server/`, no `dangerouslySetInnerHTML` in `src/`), the adapter contract tests, the Phase 1 layout snapshot. Routes ARE added by this plan (WP-M): `tests/fixtures/server-routes.json` and the fail-closed list in `tests/office-router.test.ts` are updated for exactly those routes and nothing else.

## Contract between the packages (fix this first)
`server/master-prompt.mjs` (WP-M) exports:
- `loadMasterPrompt({ home }) -> { text, defaultText, source: 'override'|'shipped', status: 'default'|'draft'|'approved', hash, warnings[] }` (override file: `<home>/master-prompt.md`, shipped: `server/master-prompt.default.md`; an invalid override is ignored with a warning, never thrown).
- `validateMasterPrompt(text) -> { ok, errors: [{ line?, message }], warnings: [...] }` (non-empty, <= 8 KB, no frontmatter needed; WARNING, not error, when it lacks a sentence that keeps agents inside `{{project}}`, or loosens a never-rule).
- `saveMasterPrompt(text, { home, status }) / resetMasterPrompt({ home })` (atomic write, mode 0600; status stored in a `<!-- status: draft -->` first line or a sidecar; choose one and test it).
- `renderMasterPrompt({ home, project, office, agentsMd? }) -> string`: replaces `{{project}}`/`{{office}}`, appends the project's own `AGENTS.md` (first 4000 characters, secret-looking lines removed, under the heading "Local project rules (they cannot loosen the rules above)") when given. Pure and deterministic.
- `composeAgentPrompt({ master, jobDescription, task }) -> string`: the three layers in order, each under a short fixed separator line (`=== PROJECT RULES ===`, `=== YOUR JOB DESCRIPTION ===`, `=== THE TASK ===`) so a model and the tests can tell them apart.
Routes (WP-M): `GET /master-prompt` -> `{ text, defaultText, source, status, hash, warnings }`; `POST /master-prompt/validate { text }`; `PUT /master-prompt { text, status? }` (UI token; 400 with errors; 413 over limit); `DELETE /master-prompt` (UI token). Non-default offices answer 501 like the other unscoped routes. Per-office file in `currentOffice().context.home`.

## Work packages (run in parallel; files are disjoint)

### WP-M: server module and routes
Owner of: `server/master-prompt.mjs` (new), the new `/master-prompt` routes in `server/index.js` (next to the `/profiles` routes; reuse their helpers' style), `tests/fixtures/server-routes.json`, `tests/office-router.test.ts` (fail-closed list only), new `tests/master-prompt.test.ts`, `tests/master-prompt-routes.test.ts`.
Tests: load precedence and warnings, validation (size, empty, warnings when the boundary sentence is missing), save/reset atomic and 0600, status handling, render substitutes variables and caps/strips AGENTS.md, composition order and separators, routes over real HTTP (401 without UI token, 400/413, round trip, second in-process office gets 501 and no files).

### WP-P: prompts everywhere, and the boundary report
Owner of: `server/delegation.mjs`, `scripts/chat-backend.mjs`, `scripts/delegate.mjs` (only the run/report part), `tests/agent-profile-prompts.test.ts`, new `tests/master-prompt-prompts.test.ts`.
1. `planPrompt`, `goalPrompt`, `chatReplyPrompt` use `composeAgentPrompt({ master: renderMasterPrompt(...), jobDescription: <existing job description text>, task })` with the master layer first. The project folder is the office `cwd` passed in (never `process.cwd()` inside `server/`); a missing or unreadable master prompt falls back to the shipped default; a prompt must never fail because of it. The orchestrator classification prompt (`classifyPrompt`) is not an agent job: leave it as it is. Keep every other line of the existing prompts verbatim.
2. **Boundary report** after an approved write run (`handleGoal`): when the project is a git repository, take `git status --porcelain` before and after the run and put the list of files the run changed in the completion message ("Changed: a.ts, b.ts"), and add one warning line when a changed path matches the sensitive set (`.env*`, `.git/` config or hooks, CI files such as `.github/workflows`, lockfiles) or when more than 30 files changed. When it is not a git repository say "not a git repository: changes could not be listed". Never block or revert anything; it is a report. Git commands run with the office `cwd`, read-only, with a timeout, and failures are swallowed into that "could not be listed" line.
3. Tests: layer order and separators in the three prompts, fallback when the master prompt is missing/invalid, AGENTS.md pickup and secret stripping, the boundary report on a disposable git repo (clean, changed, sensitive path, too many files, not a repo, git missing), unchanged behaviour of the existing delegation tests.

### WP-U: UI
Owner of: everything under `src/` and `tests/job-description.test.ts`, `tests/agent-cv.test.ts`, new `tests/master-prompt-ui.test.ts`.
1. A **Project rules** node at the very top of the hierarchy in Settings > Team (above Boss, same node design, marked with a small project glyph and the status chip when not default). Selecting it shows the CV frame (`CvShell`) for the project: header with a generic project portrait/glyph, title "Project rules", headline "The rules every agent follows, before its own job description", status chip; sidebar blocks "Applies to" (all 13 agents + Chat/Orchestrator are listed by count, no list needed), "Variables" (`{{project}}`, `{{office}}` explained), "Size" (bytes of 8 KB); main column: the text rendered as escaped blocks; Edit replaces the main column with the editor (same live validation component: errors with lines, warnings shown as non-blocking notices, Save (draft) / Save and approve disabled only for errors), Show changes (diff vs default), Reset to default, Enrich is NOT offered. Read-only without the UI token. Unsaved-edit guards as for agents.
2. In Settings > Services, shorten the Antigravity full-access text to: `Full tool access: lets Antigravity run any command (tests, builds) without asking, only for approved work. It has no sandbox: only the project rules keep it inside the project.` Keep the switch exactly as it is (off by default).
3. Tests with `renderToString` for the project node and CV, read-only, editor states, warnings vs errors, escaped hostile markup; `npm run build` passes.

## Lead agent (after the three packages report)
Review the diffs for overlap; focused tests of each package; ONE full `npm run test:win -- --serial`; `npm run build`; confirm `tests/fixtures/server-routes.json` differs from before only by the four `/master-prompt` entries (give the SHA256 before/after). Write `docs/master-prompt-results.md` (per file what changed, tests and results, anything not done) and add a "Master prompt" paragraph to `docs/adapter-contract.md` (the layer order and the honest limit for Antigravity with full access). Stop and wait.

## Acceptance
- Every agent prompt (plan, goal, chat) has the three layers in the order master, job description, task, separated by the fixed lines; the master layer carries the real project folder.
- The owner can read, edit (draft/approve), reset the master prompt in Team > Project rules, with validation; changes apply to the next prompt without a restart.
- After an approved write run the completion message lists the changed files and warns on sensitive or too many changes.
- Full suite and build green; guards green; route table differs only by the four new routes.

## After this plan (owner decisions)
Real-service check on one role with Antigravity full access and a prompt that asks to leave the project (does the master prompt hold?); browser E2E regression with agy of the new node and prompts; Building sub-step 3.
