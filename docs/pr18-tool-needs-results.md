# PR 18: tool needs log and report

## Files

- `server/tool-needs.mjs` (new): `recordToolNeed`, `readToolNeeds`, `summariseToolNeeds`, `suggestionFor`. The office home is a parameter; log helpers perform filesystem I/O.
- `server/availability.mjs`: `finishCircuit` records one need when the failure kind is `permission` (home = `g0Dir()`, the same home as the cooldowns). The circuit state is written before and independently of it.
- `server/adapters.mjs`: optional adapter hook `refusedCommand({ since, env })`, implemented for agy; `runAdapter` sets `result.refusedCommand` on a permission failure (only when non-empty, so other results are unchanged).
- `server/brains.mjs`: `runWithBrain` passes `result.refusedCommand` on as `failure.command` to `finishCircuit`.
- `scripts/toolbox-needs.mjs` + `npm run toolbox-needs`: read-only table, `--home`, `--limit`, `--json`, and a task template for the office chat.
- `docs/office-toolbox.md`: "Needs log and report" replaces the planned-phase-3 note.
- `tests/tool-needs.test.ts` (new, 9 tests).

## Behaviour

One JSON line is attempted per permission failure in `<home>/tool-needs.jsonl`; false on failure, never throws. Mode 0600 is requested (Windows ACLs inherited); 1 MiB rotation drops the oldest half of nonempty lines, or all if needed. Symlinks, multiply linked/nonregular files and preexisting files above 2 MiB are refused. Message 240, command 200, task 120 characters; user-home prefixes become `~`, recognized secret tokens become `[redacted]`, credential assignments become `key=[redacted]`, controls become spaces. Imported entries are sanitized again. No dedicated prompt/content fields; messages and commands may contain fragments. `finishCircuit` does not supply `task`. agy's command is the last `"CommandLine":"..."` in the newest eligible `.db` modified since run start (at most 2,000 directory entries, 8 MiB file; latin1 read, no other fields kept, command first cut to 200 characters). No route was added; no tool or permission is ever added automatically.

## Tests

`npm run build` passes. Focused run (`test:win --serial tool-needs office-tools-mcp circuit-breaker availability adapter-contract adapter-activity adapter-hints delegation server-state-guard server-characterization file-layout`): 11 files, 105 tests, all passed, 0 failed files (tool-needs.test.ts has 9). Golden fixtures were not changed.

## Not verified

No real agy run was captured: the conversation-file format (`"CommandLine":"..."`) comes from the lead's earlier manual inspection and is tested only against a fake file. Commands the lead saw in agy's files may not always be the refused one (the last command is a best guess).
