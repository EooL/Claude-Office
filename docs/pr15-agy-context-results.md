# PR 15: project context in the Antigravity prompt

## Why
Headless, `agy` has no search or list tool. To look around it runs shell commands, which headless mode auto-denies, so the run ends with no output and the circuit opens. A prompt that already holds the document needs no tool. This change gives it the context in the prompt, with no permission or hook change.

## Files
- `server/adapters.mjs`: exported `agyContext({ prompt, cwd, limits })`; agy adapter `preparePrompt`; `runAdapter` calls an adapter's optional `preparePrompt` before it builds the arguments (so the block is also in the prompt file of a long prompt).
- `tests/agy-context.test.ts`: new, 8 tests.
- `docs/adapter-contract.md`: "Antigravity context" section.

## Behaviour
- Modes chat and plan only, agy only, and only when a `cwd` is given. Write mode and every other adapter are untouched. The existing read-only sentence stays after the block.
- File list: `git ls-files` run by the office (5 s timeout); outside a repository, or without git, a bounded walk (skips node_modules, dist, build, coverage, dot-folders, files over 1 MB, binary extensions). 400 entries at most, the rest counted.
- Named files: tokens in the prompt with a slash or a known extension, resolved with realpath inside the project. At most 12 files, 40,000 characters each, 150,000 in all, line-numbered, truncation marked.
- Never included: outside the project (also via symlink), `.git`, `.env*`, `*.pem`, `*.key`, `id_rsa*`, `auth-token`, `credentials*`, names with "secret", binary or over 5 MB files.
- Never throws; on any error it adds nothing. `AGENT_OFFICE_AGY_CONTEXT=0` switches it off.
- Golden file `tests/fixtures/adapter-contract.json` is unchanged: its fake project folder is empty and the prompt names no file, so the block is empty.

## Tests (run from D:\work\_wt-pr15)
`npm run build`: ok. `npm run test:win -- --serial agy-context adapter-contract adapter-hints adapter-permissions adapter-activity delegation delegation-runtime server-state-guard`: 8 files passed, 84 tests passed, 0 failed. The 200,000-character test for every adapter still passes. `server-state-guard` forced the walk skip list to be a regex, not a Set (no new module-level collection).

## Not verified
No real `agy` was run, so it is not proven that the model answers from the block instead of trying a tool. The symlink-escape test needs a junction; if the OS refuses to create one, that case is skipped silently (the other escape cases still run). The worktree's `node_modules` junction was missing and was recreated.
