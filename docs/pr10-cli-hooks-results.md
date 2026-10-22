# CLI hooks for terminal sessions (PR 10)

Date: 2026-10-22. Branch: `pr/10-cli-hooks`, based on `ded664e` (`pr/9-agent-identity`). No upstream push or PR. No real CLI configuration was written, no provider CLI or AI service was invoked, and the running office was not contacted or restarted.

## Files and behavior

| File | Change |
| --- | --- |
| `docs/hooks-other-clis-research.md` | Includes the supplied research unchanged, including its explicit runtime uncertainties. |
| `hooks/cli-tracker.mjs` | Cross-platform, positional `<cli> <event>` entry point and exported normalizer. Namespaces session/worker ids by CLI; maps lifecycle, tools, attention, compaction and subagent events onto existing `/event` types. Adds `cli`, project/cwd/model/transcript identity. SDK-inferred OpenCode fields are marked in code. Tool arguments, responses and arbitrary error text are excluded. |
| `scripts/install-cli-hooks.mjs` | Preview by default; only `--write` changes files. Supports one CLI/all, redirected `--home`, `--dry-run`, `--print` and `--uninstall`. Validates all targets before installation, preserves foreign handlers, refuses invalid JSON/unmanaged plugins, creates exclusive UUID backups, writes through private temporary files and atomic rename, and preserves bytes on an idempotent reinstall. Generates OpenCode's plugin in `.config/opencode/plugins/`. Does not edit TOML or `notify`, and prints the Codex trust instruction. |
| `server/adapters.mjs` | Sets `AGENT_OFFICE_RUN=1` after environment overrides for adapter runs and on model-list CLI spawns. Arguments, prompts, working directory and permission settings are unchanged. |
| `scripts/doctor.mjs` | Adds read-only configuration presence lines for installed PATH entries (`qodercli` for Qoder). These are informational PASS lines regardless of presence, so existing failure/exit behavior is preserved. Presence does not prove trust or execution. |
| `tests/adapter-contract.test.ts` | Fake CLIs record the suppression flag in a separate sidecar and assert it. The golden recording and fixture remain unchanged. |
| `tests/cli-hooks.test.ts` | 57 tests: synthetic per-CLI/event normalization, worker attribution, missing/unknown input, no tool/error content leakage, silent malformed/oversized input, missing token/server, stalled server, agy neutral replies, immediate suppression, logging levels, exact HMAC bytes, and signed tracker processes creating four distinct sessions through a real disposable server on an ephemeral port. |
| `tests/install-cli-hooks.test.ts` | 12 tests: preview does not write, create/backup/idempotence/uninstall for all four CLIs, owner hook/notify preservation, mixed handler groups, invalid JSON and unmanaged plugin refusal, validation before writing, moved-checkout repointing, unique backups, Windows command quoting/exec arguments and doctor PATH presence lines without executing CLIs. |
| `README.md` | Installation, preview, uninstall, trust, limitations, suppression and doctor instructions. |

The tracker reads the same office endpoint/home knobs and token file as the Claude shell hook, signs requests without putting the token on argv, and has a two-second total process deadline (HTTP abort at 1.8 seconds). No token means no request. Stdin is capped at 256 KiB. `AGENT_OFFICE_RUN=1` exits before reading stdin or producing output. Errors always exit zero without diagnostics. *Superseded in PR 13 (see `docs/pr13-review-fixes-results.md`): the tracker never approves a tool. Agy PreToolUse, PostToolUse and Stop all emit `{}`; the agy target is no longer part of `all` and needs `--unverified-agy-contract`. Stdin is read only until one full JSON object arrives (500 ms cap).* No other event prints output.

Prompt/reply forwarding uses the existing `off`/`summary`/`full` setting from the disposable/configured office's settings file (default summary, 200 characters; full 2,000). The server also applies its existing logging policy. The tracker never logs those values. Permission requests are telemetry only (`answerable: false`); no permission poll or office-issued decision is added.

## Validation

- `npm run build`: **passed**, TypeScript and Vite (100 modules).
- `npm run test:win -- --serial cli-hooks install-cli-hooks adapter-contract adapters doctor server-state-guard server-characterization office-router office-websocket file-layout`: **9 files passed, 140 tests passed, zero failures/skips**, exit 0. There is no separate `adapters.test.ts`; adapter coverage in this selection is the existing contract file.
- The initial focused run encountered **V8 Zone Allocation / process out of memory** while starting `server-state-guard`; it had no assertion result for that file. The subsequent serial focused run above passed it unchanged (4 tests). No test was weakened or newly skipped.
- `npm run test:win` (one full parallel run): **99 files passed, 1,557 tests passed, 15 existing skips, zero failures**, exit 0. The shell-script file passed (17 passed / 6 existing skips); no environment failure needed a serial rerun.
- Final `npm run test:win -- --serial cli-hooks install-cli-hooks`, after reviewing worker attribution: **2 files passed, 69 tests passed, zero failures/skips**, exit 0.

`tests/server-state-guard.test.ts`, `tests/server-characterization.test.ts`, `tests/fixtures/server-state.json`, `tests/fixtures/server-routes.json` and `tests/fixtures/adapter-contract.json` are unchanged. Route fixture SHA256 remains `26C8EA185AAFD93AB5C51373B1892ABBEFB4A2E1EE9083C26359811642FB4FC1`. No route, server state, UI rendering, shell script or Python file was added/changed.

## Not verified and owner follow-up

- **No CLI was run with these hooks installed.** No real user configuration was installed or changed. Synthetic payloads and a disposable HTTP server prove the normalizer/transport contracts, not vendor runtime behavior.
- Codex trust must be performed by the owner: open Codex, run `/hooks`, review and trust the exact Agent Office command hooks; changed definitions require review again. No trust bypass is attempted. This agrees with [official OpenAI documentation](https://learn.chatgpt.com/docs/hooks).
- Agy's documented output details and camelCase payloads are based on the supplied research; its official page could not be fetched by the documentation browser in this round. Agy has no prompt text, SessionEnd or subagent event contract in that research. No transcript is read to invent missing events or content.
- OpenCode's payload field names remain SDK-inferred. User-message metadata updates indicate activity without inventing prompt text; the plugin does not read transcript files or join text parts. Session deletion is mapped, but ordinary process exit is not detectable by this plugin. The owner must check actual events and plugin loading in an interactive session. The plugin mechanism/location matches [official OpenCode documentation](https://opencode.ai/docs/plugins/).
- Qoder exec-form commands and event configuration follow the supplied research and [official Qoder hook documentation](https://docs.qoder.com/cli/hooks); native Windows execution under Qoder remains unverified.
- Real CLI hook loading, failure/timeout semantics, environment inheritance and headless suppression remain unverified for all four. The existing Claude bash tracker remains unchanged and does not gain the new suppression guard in this theme.
- Installation targets the standard configuration paths beneath `--home` (or the default user home). Alternate vendor-specific configuration roots must be checked by the owner before installing; the installer does not inspect or modify those automatically.
- No browser check was needed: there is no UI change. No packaged/Electron build was run.

## Cleanup

New tests removed their disposable homes; no `office-cli-*` test directories remained in TEMP after verification. No scratch folder or worktree was created. Unrelated untracked reviews, `json` and the pre-existing E2E output directory are excluded and left untouched.

Automatic approval review rejected removal of `D:\work\Claude-Office\.pr10-full.log` with the generic reason `blocked by policy`. That test log remains on disk, excluded from the commit. No alternative deletion method was attempted.
