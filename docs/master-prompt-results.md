# Master prompt results (2026-10-21)

The three work packages used disjoint ownership and the plan's shared API. The lead reviewed and integrated their changes. No commit, push, deployment or real AI call was made. Existing unrelated checkout changes were preserved.

## Contract and persistence

The module exposes the six functions specified in the plan: `loadMasterPrompt`, `validateMasterPrompt`, `saveMasterPrompt`, `resetMasterPrompt`, `renderMasterPrompt` and `composeAgentPrompt`. Load responses contain `text`, `defaultText`, `source`, `status`, `hash` and string `warnings`; validation contains `ok`, located `errors` and string `warnings`.

Explicit saves write `<office home>/master-prompt.md` through a temporary file and atomic rename, requesting mode 0600. The first line stores `<!-- status: draft -->` or `<!-- status: approved -->`; this metadata is stripped from the returned text and rendered prompt. No sidecar is created. Metadata-free overrides are drafts. Reset removes the override and restores shipped/default status. Merely loading, rendering or validating creates no files. Invalid or unreadable overrides fall back to shipped text with a warning. Warnings about weakened rules do not prevent an explicit save.

`server/master-prompt.default.md` ships unchanged. Its SHA256 before and after is `37404A922C8D953B6645049E7A2DA33B6E00559C96B610A071BC422A28965974`.

## Changes by file

| File | Change |
| --- | --- |
| `server/master-prompt.mjs` | New loader, 8 KB UTF-8 validation, advisory rule warnings, atomic save/reset, variable rendering, capped/filtered local rules and three-layer composition. |
| `server/index.js` | Imports the module and registers exactly four master-prompt routes next to profiles. Writes require the UI token; invalid writes return 400, oversized writes 413. Uses the current office home. |
| `tests/fixtures/server-routes.json` | Adds only the four new method/path entries. |
| `tests/office-router.test.ts` | Adds exactly those entries to the non-default office fail-closed checks. |
| `server/delegation.mjs` | Adds the master layer to plan, goal and chat prompts; refreshes rules each time and includes optional project `AGENTS.md`. Keeps classification unchanged. Adds bounded, read-only Git snapshots and completion reports for approved write runs. |
| `src/components/MasterPrompt.tsx` | New project CV/editor using the shared frame, variables/size/applicability sidebar, escaped content, live validation, warning notices, draft/approved save, reset, diff and unsaved-edit handling. No enrichment action. |
| `src/components/OrgChart.tsx` | Adds Project rules above Boss, loads its status, selects its CV and reuses the existing node-change discard guard. |
| `src/components/JobDescription.tsx` | Allows the shared `CvShell` portrait to be a project glyph as well as an agent image. |
| `src/components/SettingsPanel.tsx` | Replaces only the Antigravity full-access explanation with the approved text; switch behavior is unchanged. |
| `src/styles/job-description.css` | Adds project-glyph styling. |
| `tests/master-prompt.test.ts` | Load precedence, no implicit writes, validation boundaries/warnings, status, atomic failure preserving the old override, reset, rendering, secret-line filtering/cap and composition. |
| `tests/master-prompt-routes.test.ts` | Real HTTP contract, auth, 400/413, draft/approve/reset and second-office 501 without writes. |
| `tests/agent-profile-prompts.test.ts` | Updates existing prompt assertions for the additional layer while retaining watcher-template and task-text guarantees. |
| `tests/master-prompt-prompts.test.ts` | Layer order/fallback/local rules and disposable-Git boundary-report coverage. |
| `tests/master-prompt-ui.test.ts` | Project node/CV, read-only/editor/validation states, warnings versus errors and escaped hostile text/diffs. |
| `docs/adapter-contract.md` | Adds the Master prompt section: layer order, advisory boundary and honest Antigravity/full-access limits. |

`scripts/chat-backend.mjs` and the run/report portion of `scripts/delegate.mjs` needed no edit: their existing calls already pass the script's project cwd into the shared chat prompt and delegation functions. They inherit the composition and report through those functions. The lead extended the report to failed approved runs as well: partial edits are listed without claiming completion, and the retryable plan/failure state is preserved. A new regression covers this case.

## Route delta

Before SHA256: `353FF28798FDCDCDBB29D25C0BB895B7D125221BA0D904C62C1CB84A98F83BEA`.

After SHA256: `26C8EA185AAFD93AB5C51373B1892ABBEFB4A2E1EE9083C26359811642FB4FC1`.

The fixture comparison adds only:

- `GET /master-prompt`
- `POST /master-prompt/validate`
- `PUT /master-prompt`
- `DELETE /master-prompt`

No existing entry is removed or changed. Non-default offices return 501 for all four routes. No guard ceilings or adapter fixtures were changed.

## Verification

Lead focused integration command:

`npm run test:win -- --serial master-prompt.test.ts master-prompt-routes.test.ts master-prompt-prompts.test.ts agent-profile-prompts.test.ts master-prompt-ui.test.ts job-description.test.ts agent-cv.test.ts delegation.test.ts delegation-runtime.test.ts scripts.test.ts server-state-guard.test.ts server-characterization.test.ts office-router.test.ts file-layout.test.ts`

**Exit 0: 14 files passed, 118 tests passed, 6 existing skips, 0 failures.**

| Package / compatibility file | Passed | Skipped |
| --- | ---: | ---: |
| WP-M: `master-prompt`, `master-prompt-routes` | 8 + 3 | 0 |
| WP-P: `agent-profile-prompts`, `master-prompt-prompts` | 7 + 15 | 0 |
| WP-U: `agent-cv`, `job-description`, `master-prompt-ui` | 6 + 13 + 7 | 0 |
| `delegation`, `delegation-runtime` | 24 + 2 | 0 |
| `scripts` | 17 | 6 |
| `office-router`, `server-characterization`, `server-state-guard`, `file-layout` | 7 + 4 + 4 + 1 | 0 |

Each package also passed its own focused serial run. WP-P initially encountered two test-harness issues (import-time home capture and spying on a native ESM namespace); its fixtures/mocks were corrected before the successful checks. The lead added the failed-write reporting regression, raising WP-P's new test file from 14 to 15 cases.

Full verification: **one** `npm run test:win -- --serial` invocation, **exit 0: 92 files passed, 1,443 tests passed, 15 existing skips, 0 failures** (1,458 tests including skips). This includes the adapter contracts, both route/office guards and the unchanged Phase 1 layout snapshot. There was no memory exhaustion and no full-suite retry; no test or timeout was weakened.

`npm run build`: **exit 0**, TypeScript and Vite succeeded (95 modules transformed). `git diff --check` also passed; Git emitted only existing working-tree line-ending notices.

Final hash checks match the values recorded above. The route fixture diff was reviewed against the pre-task copy and contains only the four additions; the shipped default remains byte-identical. No implementation item remains unfinished. Browser and real-service acceptance are intentionally deferred as specified by the plan.

## Limits

The master prompt is advice, not an enforced sandbox. Antigravity full access still has no enforced project boundary. The report observes Git status and metadata before/after; it never blocks or reverts changes and cannot establish that no outside-project writes occurred. Git-ignored files absent from status are not generally observable; Git config and hook metadata are checked separately. Metadata-only comparison avoids reading secret-file contents but can miss changes whose observed metadata and status remain identical. Optional local rules use a heuristic secret-line filter, not a comprehensive secret detector.

Windows writes request mode 0600; POSIX mode-bit enforcement is asserted only on non-Windows platforms and was not verified on this Windows machine. Browser layout, interactive editing/cursor/discard flows and real-provider obedience remain unverified. The plan explicitly defers browser E2E and live Antigravity boundary acceptance to owner decisions. Neither was run.

Tests use disposable homes and ephemeral ports. The protected real homes and other agents' E2E/P4A directories were not used. No shell or Python source was edited.
