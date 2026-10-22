# Registering the Office toolbox in each CLI

Registering the toolbox (`scripts/office-tools-mcp.mjs`) and adding any permission rule is a change the owner makes **by hand**. Nothing in this repo edits a CLI configuration; `node scripts/office-tools-mcp.mjs --print-config <cli> --root <project>` only prints a snippet with the real absolute paths. The snippets below use placeholders.

The Antigravity permission rule widens what headless `agy -p` runs may do. It is limited to this one server, whose tools are read-only and jailed to the `--root` directory. Never use the broad `mcp(*)` form.

This is the registration research snapshot, not a runtime guarantee. "Verified" records checks against official documentation (plus the local file shape where noted); installed versions and local-file observations below were not rechecked. `--print-config` marks remaining questions UNVERIFIED for Codex, agy, OpenCode and Qoder; Claude Code has no such label. **No CLI has been run against the toolbox yet.** Server name used below: `claude-office-tools`.

## Codex (0.163.0)

| Item | Detail |
|---|---|
| Config file | User `~/.codex/config.toml`; project `.codex/config.toml` (trusted projects only). A local file with an existing `[mcp_servers.<name>]` table has the keys `url`, `default_tools_approval_mode`, `bearer_token_env_var`, confirming the table name and the approval key. |
| Snippet | `[mcp_servers.claude-office-tools]`, `command = "node"`, `args = ["D:/path/office-tools-mcp.mjs", "--root", "D:/project"]`, `startup_timeout_sec = 20`, `default_tools_approval_mode = "approve"` |
| Other keys | `env`, `env_vars`, `cwd`, `tool_timeout_sec` (default 60), `enabled`, `required`, `enabled_tools`, `disabled_tools`, `tools.<tool>.approval_mode` |
| Narrow permission | Per server `default_tools_approval_mode = "approve"` (values: auto, prompt, writes, approve), or per tool `[mcp_servers.<name>.tools.<tool>]` with `approval_mode = "approve"`. Both are per server. |
| Load check | `codex mcp list`; `codex mcp --help` for the other subcommands |
| Removal | Delete the table or set `enabled = false`. A `codex mcp remove` is not documented; check `codex mcp --help`. |
| Windows | No Windows MCP guidance in the docs. `startup_timeout_sec` defaults to 10, so set 20. Use forward slashes in TOML strings. |
| Sources | https://learn.chatgpt.com/docs/extend/mcp?surface=cli (redirect of developers.openai.com/codex/mcp); https://github.com/openai/codex/issues/24135 |
| Unverified | Whether `codex exec` honours the approval key for MCP calls. Issue 24135 (v0.130.0, user report) says exec auto-cancels MCP calls and only the dangerous bypass flag helped; `writes`/`approve` came later, so retest on 0.163.0. |

## Antigravity (agy 1.4.4)

| Item | Detail |
|---|---|
| Config file | Global `~/.gemini/config/mcp_config.json`; workspace `.agents/mcp_config.json`. The local global file has a top-level `mcpServers` whose entries use `command`, `args`, `env`, `timeout` (confirms the shape; `timeout` is seen locally only, unit inferred ms). |
| Snippet | `{"mcpServers": {"claude-office-tools": {"command": "node", "args": ["D:/path/office-tools-mcp.mjs", "--root", "D:/project"]}}}` |
| Other keys | `env`, `cwd`, `disabled`, `disabledTools` (docs) |
| Narrow permission | `permissions.allow` in `~/.gemini/antigravity-cli/settings.json` (the local file has `permissions.allow` as a list): `"mcp(claude-office-tools/*)"`. Docs: `mcp(server/tool)` one tool, `mcp(server/*)` one server, `mcp(*)` all (too broad). Unconfigured MCP tools run in Ask mode. The `mcp(<target>)` form in the agy error message is consistent with this. |
| Load check | `/mcp` inside agy (status, reload, logs). No documented `agy mcp list`. |
| Removal | Delete the entry from `mcp_config.json` or set `"disabled": true`; no documented remove command. |
| Windows | `node` with forward-slash absolute paths in JSON; no `cmd /c` needed. Timeouts are not documented. |
| Sources | https://antigravity.google/docs/mcp ; third party: https://agentpedia.codes/blog/agy-cli-errors-troubleshooting (settings path, precedence deny, ask, allow) |
| Unverified | That `agy -p` then runs the tool unattended (not run); meaning of `timeout`. |

## Claude Code (2.1.x)

| Item | Detail |
|---|---|
| Config file | Project `.mcp.json` (shared); local and user scopes live in `~/.claude.json` (exists locally; not opened). Or `claude mcp add --transport stdio --scope project claude-office-tools -- node D:/path/office-tools-mcp.mjs --root D:/project`. |
| Snippet | `{"mcpServers": {"claude-office-tools": {"type": "stdio", "command": "node", "args": [...]}}}` |
| Other keys | `env`, per-server `timeout` (ms, tool-call limit), `${VAR}` expansion. Startup timeout: env `MCP_TIMEOUT` (ms). |
| Narrow permission | `permissions.allow`: `"mcp__claude-office-tools"` (whole server) or `"mcp__claude-office-tools__*"` (documented glob after a literal server prefix). Rules with parentheses are skipped; `mcp__*` is skipped. Headless: `claude -p --allowedTools "mcp__claude-office-tools"`. `claude -p` loads `.mcp.json` servers without the approval prompt. |
| Load check | `claude mcp list`, `claude mcp get <name>`, `/mcp` |
| Removal | `claude mcp remove claude-office-tools` |
| Windows | `npx` servers need `"command": "cmd", "args": ["/c", "npx", ...]` (inferred from common guidance, not in the fetched text). `node` needs no wrapper. |
| Sources | https://code.claude.com/docs/en/mcp ; https://code.claude.com/docs/en/permissions |
| Unverified | Not run against the toolbox. The printer describes the bare `mcp__<server>` rule as checked against docs; this research snapshot inferred it from naming. The glob form is documented. |

## OpenCode (1.18.25)

| Item | Detail |
|---|---|
| Config file | `opencode.json` / `opencode.jsonc` in the project. User level `~/.config/opencode/` is inferred (the MCP page does not state it; local dir not inspected). |
| Snippet | `{"mcp": {"claude-office-tools": {"type": "local", "command": ["node", "D:/path/office-tools-mcp.mjs", "--root", "D:/project"], "enabled": true, "timeout": 20000}}}` |
| Other keys | `environment`, `cwd`, `enabled`, `timeout` (ms to fetch tools, default 5000). Tools are prefixed with the server name (`claude-office-tools_*`). |
| Narrow permission | None documented for MCP. Permissions default to `allow` (only `doom_loop` and `external_directory` ask), so probably none is needed. If `permission` was tightened: inferred `"claude-office-tools_*": "allow"` (`*` wildcards exist, but the docs list no MCP key). `opencode run --auto` approves asks but is global. |
| Load check | `opencode mcp list` |
| Removal | Delete the `mcp` entry or set `"enabled": false` (`opencode mcp logout` only removes OAuth credentials). |
| Windows | Raise `timeout` (default 5000 ms is short for a node cold start). `command` is an array, so no quoting issue. |
| Sources | https://opencode.ai/docs/mcp-servers/ ; https://opencode.ai/docs/permissions/ |
| Unverified | MCP permission key (inferred); not run. |

## Qoder (qodercli 1.1.76)

| Item | Detail |
|---|---|
| Config file | User `~/.qoder/settings.json`; project `<project>/.qoder/settings.json` or `<project>/.mcp.json`; local `<project>/.qoder/settings.local.json`; all under a top-level `mcpServers` key. The local `~/.qoder/settings.json` has an `mcp` key holding only `enableAllProjectMcpServers`, plus a `permissions` key; no server table exists locally to confirm the shape. |
| Snippet | `{"mcpServers": {"claude-office-tools": {"command": "node", "args": [...], "timeout": 30000}}}` |
| Other keys | `env`, `cwd`, `timeout` (ms); per-server `alwaysAllow` (tool-name list) and `trust` are mentioned without an example. |
| Narrow permission | `permissions.allow`: `"mcp__claude-office-tools__*"` (docs example style `mcp__context7__*`). Project-level servers also need approval: `mcp.enabledProjectMcpServers` (narrow) or `mcp.enableAllProjectMcpServers` (global, avoid). Registering in the user file avoids the project approval. CLI flag `--allowed-mcp-server-names` exists. |
| Load check | `qodercli mcp list`, `/mcp` (`/mcp reload` after edits) |
| Removal | `qodercli mcp remove claude-office-tools` |
| Windows | Not documented. Use `node` with forward-slash paths. |
| Sources | https://docs.qoder.com/en/cli/mcp-servers ; https://docs.qoder.com/cli/mcp-reference |
| Unverified | Allow-rule syntax came from the servers page via a search summary (the reference page defers to a Permissions page); `qodercli -p` behaviour with pending approvals is undocumented. Not run. |

## Which CLI to try first

1. **Claude Code**: format, scopes, list/remove and a narrow `mcp__<server>` allow rule are all documented, and `claude -p` loads project `.mcp.json` without a prompt.
2. **Antigravity**: `mcp(server/*)` is a documented narrow rule and the local files already match the format, but the headless effect is untested and the rule widens headless permissions (this one server only).
3. **OpenCode**: probably works with no permission change (default allow); only the timeout needs raising.
4. Qoder, then Codex last: Codex `exec` may still cancel MCP calls despite `approve` (open upstream issue).
