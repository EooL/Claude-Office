# PR 17 results: Office toolbox

## Files
- `scripts/office-tools-mcp.mjs` - the MCP server and `--print-config`.
- `tests/office-tools-mcp.test.ts` - 10 tests spawning the real script over stdio.
- `docs/office-toolbox.md`, this file. Now imports shared security helpers from `server/project-files.mjs` and sanitization from `server/tool-needs.mjs`; no route; fixtures unchanged (file-layout needed no update).

## Behaviour
Six read-only tools (`list_files`, `search_text`, `read_file_range`, `git_log`, `git_show`, `git_diff`), a root jail with realpath, a secret filter, an optional audit log (`OFFICE_TOOLS_LOG`), and a print-only config helper. Details and limits: `docs/office-toolbox.md`. Regex pattern search and glob matching run in a worker thread killed after 3.5 s, so a catastrophic pattern or glob returns "stopped early" instead of hanging the server.

## Tests
`npm run build` passed. `npm run test:win -- --serial office-tools-mcp server-state-guard file-layout adapter-contract`: 0 failed files; office-tools-mcp 10/10, server-state-guard 4/4, file-layout 1/1, adapter-contract 32/32. The full suite was not run. One first-run failure was a wrong test expectation (a nonexistent path after `--` is harmless), fixed in the test.

## Not verified
No real CLI was pointed at the server. Configuration formats are described as checked against docs; Claude Code has no UNVERIFIED label, while the other four outputs label remaining permission/headless questions UNVERIFIED. Windows junction escape was exercised on this machine; on other OSes the test skips that case only if the OS refuses the link. Tracked secret files are hidden from git show/diff by pathspec, but commit messages are not filtered.
