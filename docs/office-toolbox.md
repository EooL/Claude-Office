# Office toolbox

`scripts/office-tools-mcp.mjs` is a small read-only MCP server (stdio, newline-delimited JSON-RPC 2.0, no dependency) that the office owns. Any CLI (Codex, Claude Code, Antigravity, OpenCode, Qoder) can look around a project through the same jailed tools instead of running shell commands. Motivation: Antigravity in headless mode has no search/list tool, ran shell commands and was refused. If a CLI lacks a tool, the office provides one.

Start: `node scripts/office-tools-mcp.mjs --root <project>` (or env `OFFICE_TOOLS_ROOT`; default is the server's current directory).

## Tools

All results are text, capped at 60,000 characters with a "truncated" note. Failures are tool errors (`isError: true`), never crashes.

| Tool | Arguments | Limits |
| --- | --- | --- |
| `list_files` | `path`, `depth`, `limit` | depth 2 (max 6), 300 entries (max 1000). Git (`ls-files`, tracked + untracked-not-ignored, 5 s) or a bounded walk (skips node_modules, .git, dist, build, coverage, dot-folders, files over 1 MB). Directories end with `/`. |
| `search_text` | `pattern`, `literal`, `path`, `glob`, `max_results`, `ignore_case`, `context` | Done by the server (no rg/grep). Pattern max 200 chars, 100 results (max 500), context 0-3, 3 s total (a worker is killed if a pattern is catastrophic). Skips binary, over 1 MB and secret files and reports the counts. |
| `read_file_range` | `path`, `start_line`, `end_line` | Numbered lines, 200 by default, max 800 per call, files up to 2 MB, no binary. |
| `git_log` | `path`, `max_count`, `author` | 20 (max 100). Fixed argument arrays, `--` before paths. |
| `git_show` | `rev`, `path` | `--stat --patch`. |
| `git_diff` | `base`, `head`, `path`, `stat_only` | Default: working tree vs HEAD. |

`rev`/`base`/`head` must match `/^[A-Za-z0-9._\/~^@{}-]{1,100}$/` and not start with `-`. Git runs with `GIT_TERMINAL_PROMPT=0`, no pager, `core.fsmonitor=false`, no external diff or textconv. Secret-looking files are excluded from git show/diff output by pathspec.

## Jail and secret filter

Every path is resolved against the root, `realpath`ed, and refused unless it stays inside the real root (so `..`, absolute paths elsewhere and symlink/junction escapes fail). `.git` and `node_modules` are never touched directly. Refused as secret-looking: names `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `auth-token`, `credentials*`, `.npmrc`, any name containing "secret", and any `.ssh`/`.gnupg`/`.aws` segment. They are not listed, read or searched.

## Audit log

If `OFFICE_TOOLS_LOG` is set, each call appends `{t, tool, ok, ms, args}` (path/pattern/rev only, never file contents). Unset means nothing is logged.

## Registering it (by a human)

`node scripts/office-tools-mcp.mjs --print-config <codex|agy|claude|opencode|qoder> [--root <project>]` only prints the snippet and the permission rule; it writes nothing. Add the snippet to the CLI's MCP configuration by hand. The snippet formats are mostly **unverified**: the research doc covers hooks, not MCP configuration, and every snippet is labelled UNVERIFIED in its output; check the CLI's own docs before relying on one.

Headless runs cannot ask for approval, so each CLI needs one narrow permission that allows only this server's tools (not all MCP servers). The owner adds that rule by hand; nothing in this repo edits any CLI setting.

## Planned phase 3 (not built)

A denial log (what a CLI tried and was refused) and a "toolsmith" role that proposes new toolbox tools from those denials.
