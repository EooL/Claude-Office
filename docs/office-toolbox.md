# Office toolbox

`scripts/office-tools-mcp.mjs` is a small read-only MCP server (stdio, newline-delimited JSON-RPC 2.0, no third-party runtime dependency; shared security helpers in `server/project-files.mjs` and sanitization in `server/tool-needs.mjs`, so it now imports `server/` modules) that the office owns. Any CLI (Codex, Claude Code, Antigravity, OpenCode, Qoder) can look around a project through the same jailed tools instead of running shell commands. Motivation: Antigravity in headless mode has no search/list tool, ran shell commands and was refused. If a CLI lacks a tool, the office provides one.

Start: `node scripts/office-tools-mcp.mjs --root <project>` (or env `OFFICE_TOOLS_ROOT`; default is the server's current directory).

## Tools

Tool results are text, cut at 60,000 characters before an added "truncated" note. Caught tool failures return `isError: true`.

| Tool | Arguments | Limits |
| --- | --- | --- |
| `list_files` | `path`, `depth`, `limit` | depth 2 (max 6), 300 entries (max 1000). Git (`ls-files`, tracked + untracked-not-ignored, 5 s) or a bounded walk (skips node_modules, .git, dist, build, coverage, dot-folders, files over 1 MB). Directories end with `/`. |
| `search_text` | `pattern`, `literal`, `path`, `glob`, `max_results`, `ignore_case`, `context` | Done by the server (no rg/grep). Pattern and glob max 200 chars; 100 output-line target (max target 500; a context group may overshoot), context 0-3 (default 0). Up to 20,000 candidate files; worker deadline 3 s, termination at 3.5 s, after collection. Skips binary, over 1 MiB and secret files; counts reflect the selected collection. |
| `read_file_range` | `path`, `start_line`, `end_line` | Numbered lines, 200 by default, max 800 per call, files up to 2 MB, no binary. |
| `git_log` | `path`, `max_count`, `author` | 20 (max 100). Fixed argument arrays, `--` before paths. |
| `git_show` | `rev`, `path` | `--stat --patch`. |
| `git_diff` | `base`, `head`, `path`, `stat_only` | Default: working tree vs HEAD. |

`rev`/`base`/`head` must match `/^[A-Za-z0-9._\/~^@{}-]{1,100}$/`, not start with `-`, and resolve to a commit. Raw blob/tree IDs and `rev:path` are refused. Git strips inherited `GIT_*` overrides, suppresses system/global configuration, fixes its repository and worktree, and disables fsmonitor, pager, signature verification, external diff and textconv. Secret-looking files are excluded from git show/diff output by case-insensitive pathspecs. Linked worktrees (`.git` files), redirected Git directories and bare repositories are refused by Git tools; file listing/search falls back to a bounded walk.

## Jail and secret filter

Paths are resolved against the root, canonicalized and refused unless they stay inside the real root; missing historical Git paths instead validate their existing parent (so traversal outside the root, absolute paths elsewhere and symlink/junction escapes fail). File-tool paths cannot address `.git` or `node_modules`; Git commands still read repository metadata. Refused as secret-looking: names `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `auth-token`, `credentials*`, `.npmrc`, any name containing "secret", and any `.ssh`/`.gnupg`/`.aws` segment. They are not listed, read or searched.

The policy is case-insensitive and also excludes `.git-credentials`, `.netrc`, `.pypirc` and `*.kdbx`. Windows ADS, short-name syntax, drive-relative/UNC/device paths, reserved device names and trailing dots/spaces are refused. Reads use bounded regular-file descriptors and revalidate canonical paths and file identity; this is not an OS sandbox or a proof against every concurrent parent-directory replacement. Secrets in innocently named file contents are outside this name-based filter's scope. The same policy protects agy prompt context.

Search patterns and globs both run inside the killable worker. Walks bound visited entries and depth. JSON-RPC input has a 256 Ki-character decoded-line limit and nesting limit of 64; input and output use backpressure.

## Audit log

If `OFFICE_TOOLS_LOG` is set, each tool call attempts to append `{t, tool, ok, ms, args}` (`args` contains only string `path`, `pattern`, `rev`, `base`, `head`, each sanitized to 200 characters; tool name to 80). No tool output is logged; argument text may contain sensitive content. Summaries redact recognized secrets and replace controls with spaces. Logs request mode 0600 (Windows ACLs are inherited), drop the oldest half of nonempty lines above 1 MiB (or all retained lines if necessary), refuse symlinks, multiply linked/nonregular files and preexisting files above 2 MiB, and do not promise transactional rotation across concurrent writers. Unset means nothing is logged.

## Registering it (by a human)

`node scripts/office-tools-mcp.mjs --print-config <codex|agy|claude|opencode|qoder> [--root <project>]` only prints the snippet and the permission rule; it writes nothing. Add the snippet to the CLI's MCP configuration by hand. The output describes configuration formats as checked against documentation. Claude Code has no UNVERIFIED label; Codex, agy, OpenCode and Qoder label remaining permission or headless behavior UNVERIFIED. None was run against the toolbox; see `office-toolbox-registration.md` for the recorded checks.

Where headless runs need explicit permission, allow only this server's tools. OpenCode is documented here as default-allow; its explicit MCP rule remains inferred. The owner adds that rule by hand; nothing in this repo edits any CLI setting.

## Needs log and report

- **Recorded**: when a run fails with the permission kind (for example agy's "a tool required the 'command' permission that headless mode cannot prompt for"), one line `{at, service, mode, kind, message, command, task}` is attempted to `<office home>/tool-needs.jsonl` (mode 0600 requested; Windows ACLs inherited; 1 MiB rotation drops the oldest half of nonempty lines, or all if needed; symlinks, multiply linked/nonregular files and preexisting files above 2 MiB are refused; write failure returns false). `command` is filled only for agy, from the last `"CommandLine":"..."` string in the newest eligible `.db` modified since run start (at most 2,000 directory entries, 8 MiB file); extraction first cuts to 200 characters. Other CLIs leave it empty; `finishCircuit` leaves `task` empty.
- **Selected fields only**: no prompt or file-content field and no other conversation fields. Messages or commands can still contain prompt/content fragments; this is not content DLP. `message` is cut to 240 characters, `command` to 200, `task` to 120; user-home prefixes become `~` (remaining path retained); recognized Basic/Bearer and sk/pk/ghp/gho/xoxb/xoxp/AKIA tokens become `[redacted]`, credential assignments become `key=[redacted]`, and controls become spaces. Imported records are sanitized again.
- **Report**: `npm run toolbox-needs [-- --home <dir>] [--limit N] [--json]` reads the newest 500 entries by default (limit clamped to 1-5000), groups by service, mode and command head (or normalized message), and suggests a toolbox tool. Nonempty text reports end with a plan-only task template; JSON includes it even with no rows, while empty text reports only say no commands were recorded.
- **Nothing is automatic**: no tool and no permission is ever added by this log or report. A person reads it and decides.
