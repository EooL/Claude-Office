# PR 18: tool needs log and report

## Files

- `server/tool-needs.mjs` (new): `recordToolNeed`, `readToolNeeds`, `summariseToolNeeds`, `suggestionFor`. Pure; the office home is a parameter.
- `server/availability.mjs`: `finishCircuit` records one need when the failure kind is `permission` (home = `g0Dir()`, the same home as the cooldowns). The circuit state is written before and independently of it.
- `server/adapters.mjs`: optional adapter hook `refusedCommand({ since, env })`, implemented for agy; `runAdapter` sets `result.refusedCommand` on a permission failure (only when non-empty, so other results are unchanged).
- `server/brains.mjs`: `runWithBrain` passes `result.refusedCommand` on as `failure.command` to `finishCircuit`.
- `scripts/toolbox-needs.mjs` + `npm run toolbox-needs`: read-only table, `--home`, `--limit`, `--json`, and a task template for the office chat.
- `docs/office-toolbox.md`: "Needs log and report" replaces the planned-phase-3 note.
- `tests/tool-needs.test.ts` (new, 9 tests).

## Behaviour

One JSON line per refusal in `<home>/tool-needs.jsonl` (0600, 1 MB cap drops the oldest half, never throws). Message 240, command 200, task 120 characters; user paths become `~`, secret-looking strings become `[redacted]`. No prompt text or file contents. agy's command is the last `"CommandLine":"..."` in its newest conversation file written since the run started (latin1 read, nothing else kept). No route was added; no tool or permission is ever added automatically.

## Tests

`npm run build` passes. Focused run (`test:win --serial tool-needs office-tools-mcp circuit-breaker availability adapter-contract adapter-activity adapter-hints delegation server-state-guard server-characterization file-layout`): 11 files, 105 tests, all passed, 0 failed files (tool-needs.test.ts has 9). Golden fixtures were not changed.

## Not verified

No real agy run was captured: the conversation-file format (`"CommandLine":"..."`) comes from the lead's earlier manual inspection and is tested only against a fake file. Commands the lead saw in agy's files may not always be the refused one (the last command is a best guess).
