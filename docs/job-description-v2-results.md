# Job description v2 results (2026-10-21)

Implemented the three work packages in parallel with disjoint ownership. The lead reviewed their changes and reran the package tests together before the full serial suite. Existing unrelated checkout changes were preserved. No commit, push, deployment, real enrichment or real AI call was made.

## Changes by file

| File | Change |
| --- | --- |
| `server/agent-profiles.mjs` | Records source locations for frontmatter fields, nested keys, list items and body headings as non-enumerable parser metadata. Validation and `ProfileError.errors` include lines without changing individual error messages. Missing fields use their parent or line 1; missing headings use an insertion location or the last source line; size errors use line 1. Adds pure `summarizeAccess(profile, services)`. |
| `server/index.js` | Adds the summary to `profileView`, using the existing `services()` helper filtered by Settings-enabled services. Preserves `accessChecks`; no route registration changes. |
| `src/components/SettingsPanel.tsx` | Adds Agents between Team and Events and moves the editor there. Agents-specific sizing leaves the other tabs' layout rules unchanged. |
| `src/components/OrgChart.tsx` | Keeps brain selection and adds a Job description link in the selected agent's detail card, selecting that role in Agents. |
| `src/components/JobDescription.tsx` | Adds the role/status sidebar, full-height detail area, expanding editor, checking/error/valid status, disabled saves while checking or invalid, located error buttons and optional access summary/details. Ignores obsolete validation replies; validation transport failures keep saving disabled. Updates sidebar status after saving. |
| `src/jobDescription.ts` | Adds error formatting and line-to-cursor-offset helpers, including CRLF handling and bounds. |
| `src/styles/job-description.css` | Uses a sidebar/detail grid and one detail scroll area; removes nested body, diff and textarea scrolling. Compact styles fit smaller windows; very small windows use the whole panel as the sole scroll area so roles remain reachable. |
| `src/styles/settings.css` | Adds Agents-only dimensions and explicitly overrides the ordinary panel's inherited scrolling. |
| `server/delegation.mjs` | Replaces the watcher's exact introduction line with the job description in place, preserving all other prompt bytes, including LF/CRLF. When absent, prepends as before; unavailable or unknown profiles retain the existing fallback. |
| `tests/agent-profiles.test.ts` | Adds exact source-line assertions across the validation rules, nested/list/heading and CRLF metadata coverage, access-summary grouping and zero-issue cases. |
| `tests/agent-profile-routes.test.ts` | Pins enabled-only summary filtering, unchanged full `accessChecks`, zero issues and validation-error lines over HTTP. |
| `tests/job-description.test.ts` | Uses `renderToString` for read-only/editable/error/checking/valid states, both save buttons, optional/empty/expanded summaries, role status chips and located errors; tests formatting and cursor offsets. |
| `tests/agent-profile-prompts.test.ts` | Pins the verbatim watcher template against its read-only shell source, byte-preserving replacement for LF and CRLF, a single introduction, retained safety/provider text and fallback cases. |
| `tests/scripts.test.ts` | Lead integration fix: replaces the old watcher-introduction expectation with the new profile introduction, asserts it appears exactly once, rejects the old introduction and checks the conversational safety/provider lines. No shell source change. |
| `docs/agent-job-description-options.md` | Updates Implementation status for v2. |

## Compatibility decisions

`accessSummary` is additive: `{ count, text, byService: [{ service, label, issues: [{ mode, wanted, guaranteed }] }] }`. Count means affected service/mode pairs (for example, four for two services with chat and plan issues). Text groups service labels for matching issues; different issues produce separate sentences within one notice. No enabled or affected services means count zero and empty text. The UI hides absent or zero summaries, keeps existing service labels, and accepts validation errors without `line` from an older server.

Parser location metadata does not change the enumerable `{ frontmatter, body }` shape or serialized profile files. Existing routes, access checks, exports, profile storage and approval requirements remain intact. Chat prompt replacement changes only the exact introduction line plus the existing follow-up suffix.

## Verification

Lead integration command: `npm run test:win -- --serial agent-profiles agent-profile-routes agent-profile-prompts job-description`.

| Focused file | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `agent-profiles` | 89 | 0 | 0 |
| `agent-profile-routes` | 10 | 0 | 0 |
| `agent-profile-prompts` | 7 | 0 | 0 |
| `job-description` | 12 | 0 | 0 |
| Total: 4 files | 118 | 0 | 0 |

Each package also ran its own focused serial tests successfully.

The single full command, `npm run test:win -- --serial`, completed with **87 files: 86 passed, 1 failed; 1,402 tests passed, 1 failed, 15 skipped; exit 1**. The only failure was `tests/scripts.test.ts:218`, an existing assertion for the exact old watcher introduction deliberately replaced by WP-C. All other files passed, including adapter contracts (32), server characterization (4), state guard (4) and the legacy layout snapshot (1). No memory exhaustion occurred and no tests were weakened or newly skipped.

The lead corrected that stale integration expectation and added single-introduction, safety and provider assertions. Corrective command: `npm run test:win -- --serial scripts`: **1 file passed, 17 tests passed, 6 existing skips, 0 failures, exit 0** (64.95 seconds). Production code was unchanged after the full run. Across the full run and the corrected file rerun, every file has now passed: **87 files, 1,403 passing tests, 15 existing skips**. This is a combined verification result, not a second full invocation. The full suite was not repeated, honoring the instruction to run it once; therefore the original full command's exit is reported rather than described as green after the correction.

`npm run build`: **exit 0**, TypeScript and Vite succeeded (94 modules transformed).

The route fixture's SHA256 before and after implementation is `353FF28798FDCDCDBB29D25C0BB895B7D125221BA0D904C62C1CB84A98F83BEA` (byte-identical). No guard ceilings or adapter fixtures were changed.

## Limits and deferred owner decisions

No implementation item was deliberately omitted. Browser geometry at 1056x682 and smaller, interactive cursor placement and visual layout remain unverified in a real browser; render tests, offset tests and responsive CSS cover their implementation, not browser acceptance. The plan explicitly leaves browser E2E regression and one-role live enrichment for subsequent owner decisions. Neither the enrichment script nor a real-service enrichment route was invoked.

Tests use disposable homes and ephemeral ports through the existing test harness. The protected real homes and the other agents' E2E/P4A temporary directories were not used. Shell/Python source files were read only; none were edited by this block.
