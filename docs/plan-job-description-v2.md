# Plan: job description v2 (improvements found while verifying v1)

Context: v1 is built and verified (`docs/agent-job-description-options.md`, "Implementation status": profiles module, 13 shipped profiles, `/profiles` routes, prompts, Settings > Team panel, enrichment module; suite 87 files / 1,362 tests green). Verifying it in a real browser found the items below. No new behaviour for the default office outside the job-description feature.

## Rules for every agent
- English everywhere in the repo and the UI. No commit, push or deploy. Never touch the real `~/.agent-office` / `~/.claude-office`, nor `%TEMP%\office-e2e-*` or `%TEMP%\office-p4a-*`. Disposable dirs and ephemeral ports only. No real AI service is called by any test.
- Edit with edit tools, not shell heredocs. Do NOT edit `scripts/*.sh` / `*.py` (they are CRLF in this working tree; a rewrite would break them under bash).
- Memory on this machine is tight: focused tests with `npm run test:win -- --serial <names>`; only the lead agent runs the full suite (`npm run test:win -- --serial`), once, at the end.
- Each agent owns ONLY the files listed for it. If it needs a change in another agent's file it says so in its report; it does not edit it.
- Guards that must stay green: `tests/server-state-guard.test.ts` (no new module-level state, no `process.cwd()`/`homeDir` in `server/`, no `dangerouslySetInnerHTML` in `src/`), `tests/server-characterization.test.ts` + `tests/fixtures/server-routes.json` (route table: no route is added or removed by this plan), the adapter contract tests.

## Work packages (run in parallel; files are disjoint)

### WP-S — server: access summary and error line numbers
Owner of: `server/agent-profiles.mjs`, the `profileView` helper in `server/index.js` (only that function and the profile routes' use of it), `tests/agent-profiles.test.ts`, `tests/agent-profile-routes.test.ts`.
1. **Line numbers on every validation error.** The parser already knows the line of syntax errors. Make it record the source line of every frontmatter key (and of every nested `office.*` key and list item) and of every body heading, and make `validateProfile` attach `line` to each field error (for example `model: must be one of ...` gets the line of the `model:` key; a missing section is reported on the line where it should start, or the last line; a size error on line 1). `ProfileError.errors` and `POST /profiles/:role/validate` carry it. Keep the existing error text; add `line`. Tests: one failing example per rule asserts the exact line.
2. **Access summary instead of noise.** Add `summarizeAccess(profile, services)` to `server/agent-profiles.mjs` (pure): from `checkAccess` it returns `{ count, byService: [{ service, issues: [{ mode, wanted, guaranteed }] }], text }` where `text` is one sentence such as `"Antigravity and Qoder cannot guarantee read-only in plan mode."` (group services with the same issue). `profileView` in `server/index.js` adds `accessSummary` computed ONLY for the services that are enabled in Settings (use the same enabled-services helper the services routes use), and keeps the existing `accessChecks` field unchanged (additive). Contract with the UI: `accessSummary: { count: number, text: string, byService: [{ service, label, issues: [{ mode, wanted, guaranteed }] }] }`; `count` 0 and `text` empty when nothing is wrong or no service is enabled. Tests: enabled-only filtering, grouping text, count 0.

### WP-U — UI: layout, validation state, access summary
Owner of: everything under `src/` and `tests/job-description.test.ts`.
1. **A room to read and edit.** Move the "Job description" panel out of the Team tab into its own Settings tab named **Agents** (tab order: Services, Brains, Team, Agents, Events). Layout: a role list on the left (13 roles with status chip: default / draft / approved), the selected role on the right using the full height of the dialog with ONE scroll area (no nested scrolling), a roomier textarea in edit mode. The Team tab keeps the org chart; clicking an agent box there still selects the brain, and a small "Job description" link in its detail card switches to the Agents tab with that role selected. No layout shift of the existing tabs. Works at the fixed 1056x682 window and below.
2. **Save only when valid.** While the text is invalid or being validated, "Save (draft)" and "Save and approve" are disabled and a status line says "Checking…", "N errors" or "Valid". Errors are listed as `line N: message` when the server gives `line`, and clicking an error puts the cursor on that line of the textarea.
3. **Access check as one line.** Show `accessSummary.text` (when `count > 0`) as a single notice with a "Details" toggle listing `byService`; hide the notice when `count` is 0 or the field is absent (older server). Keep using the existing service labels.
4. Tests: render states (read-only, editable, invalid, valid, checking, summary shown/hidden, details expanded) with `renderToString`, plus pure helpers for the error list and cursor offsets. `npm run build` must pass (tsc).

### WP-C — chat prompt: one introduction
Owner of: `server/delegation.mjs` (only `chatReplyPrompt` and helpers it uses), `tests/agent-profile-prompts.test.ts`.
The chat watcher (`scripts/chat-ai-watcher.sh`, read-only for you) builds a prompt that contains the line `You are responding as <name>, the office <role>. Stay in character.`, and `chatReplyPrompt(prompt, role, cwd)` then puts the job description in front, so the agent is introduced twice. Make `chatReplyPrompt` replace that exact sentence (match it by pattern, tolerate the CRLF/LF difference) with the job-description introduction and keep every other line of the watcher prompt as is, so the prompt has ONE introduction; when the sentence is not found it behaves as today (prepend). Tests use a verbatim copy of the real watcher prompt (read `scripts/chat-ai-watcher.sh` lines ~160-175 for it): one introduction left, the "not an execution channel" and "generated by <service>" lines kept, an unknown role and a missing profile fall back unchanged.

## Lead agent (after the three packages report)
1. Review the three diffs for overlap; run the focused tests of each package, then ONE full `npm run test:win -- --serial`, then `npm run build`. Fix integration problems.
2. Update `docs/agent-job-description-options.md` ("Implementation status") and write `docs/job-description-v2-results.md`: per file what changed, tests and results, anything not done.
3. Stop and wait. Do NOT run `scripts/enrich-agent-profiles.mjs` or the enrich route against a real service: running it on one role is an owner decision (it uses the AI subscription).

## Acceptance criteria
- Every validation error from `POST /profiles/:role/validate` and from the editor has a line number; Save is disabled while invalid.
- The Agents tab shows list and detail with a single scroll; the Team tab is unchanged apart from the link.
- A profile whose access needs cannot be guaranteed by an enabled service shows one summary line, not one line per mode and service; nothing is shown when no enabled service is affected.
- The chat prompt contains one introduction.
- Full suite green, build green, route table unchanged, guards green.

## After this plan (owner decisions, not part of it)
Run the enrichment on `debugger` against a real service and review the draft; then a browser E2E regression (agy) of the new tab; then the Building sub-step 3 (per-office stores, hook dispatch by cwd, write routes).
