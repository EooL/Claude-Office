# Full E2E test task (worker: agy, tester: browser through chrome-devtools MCP)

You are the E2E tester for the Claude-Office app. **Read-only toward the project**: you test a disposable snapshot of the app and write only your report and evidence. Everything is in English.

## Environment (given by the boss in the prompt)
- `E2E_SNAPSHOT`: a copy of the app (own `node_modules` junction, production build already in `dist/`). Test **only** this copy, never `D:\work\Claude-Office` itself.
- `E2E_HOME`: an empty disposable runtime dir. Start the app yourself:
  `node server/index.js` in `E2E_SNAPSHOT` with env `AGENT_OFFICE_HOME=<E2E_HOME>`, `AGENT_OFFICE_PORT=<free port>`; wait for `/health`. The office link with the token fragment (`http://127.0.0.1:<port>/#token=…`) is printed at start; read the token only from `<E2E_HOME>\auth-token`.
- Providers: use **fake CLIs** you write yourself (small Node scripts) and point the app at them with `AGENT_OFFICE_BIN_CLAUDE`, `AGENT_OFFICE_BIN_CODEX`, `AGENT_OFFICE_BIN_AGY`, `AGENT_OFFICE_BIN_OPENCODE` (see `server/adapters.mjs`, the `launcherFor`/`overrideOf` code) so no subscription quota is used. A fake can answer a chat reply, return a plan, and (in write mode) create a file; also one that prints a usage-limit message and one that hangs, to see the fallback/circuit behaviour. One real-provider smoke is allowed at the end: your own `agy` with `gemini-3.8-flash-low`, one tiny prompt.
- Stop everything you started at the end (kill process trees), and delete only what you created.

## Rules
No change to any project file, setting, hook, or the real `~/.agent-office`/`~/.claude`. No commit/push/deploy. No sign-in, install, update. No credential entry. If the browser tool fails 3 times on the same step, record "blocked" and go on. Keep evidence: screenshots to `docs/e2e-review-2026-10-21/e2e-full/` (PNG, short names), console errors/warnings and failed network requests per journey.

## Journeys (record pass / fail / blocked + evidence for each)
1. **First run and access:** bare URL without token (read-only banner, submit disabled); with `#token=` (token removed from the address bar after load, session persists across reload); wrong token.
2. **Start screen / services:** pick a service, continue; `backend.json` shows only that service enabled; switch service later in Settings.
3. **Settings tabs:** Services, Brains, Team, Events. Create a custom brain (name, model chain, save, no dirty state after save); auto-assign role brains on Team; change event mode real ↔ emulated and confirm persistence after reload and in `GET /settings`.
4. **Chat basics:** send a message, get the fake reply; reload, history restored without duplicates; reactions; threads; long text; markdown rendering; `/status`, `/help`, `/agents`, `/incident`, `/all-clear`; a privileged command (`/clear`) without token is refused.
5. **Delegation:** chat task → plan appears → approval prompt → approve → execution creates the file in the disposable workspace (verify bytes on disk) → completion message; deny path; approve twice (second must be refused, executes once).
6. **Artifacts:** a Markdown link and an image link in a reply open in the reader/modal; a path outside the workspace is refused; Escape/close works; keyboard focus returns.
7. **Provider failure handling:** the limit fake → cooldown/circuit state visible in Brains/Settings, next role falls back to another enabled service, recovery after the cooldown; the hanging fake → timeout message in chat, UI stays responsive.
8. **Agents and office scene:** post hook-style events (`POST /event`, signed with the token as `hooks/agent-tracker.sh` does, or via the documented `scripts/chat-post.py`/office-run) for a session with 2 subagents; cards appear, roles/avatars correct, completion removes them; permission request dialog appears, Approve/Deny answer it; "needs you" bell/hand states.
9. **Meters:** Payroll with no cost reported shows "not reported"; with cost shows a number; estimated vs measured; context/memory; tooltips readable.
10. **Incident mode:** declare, flash/banner, all-clear, reload keeps/clears as designed.
11. **Responsive and a11y:** 1280×800, 768×1024 and 390×844: no horizontal scroll, controls reachable; keyboard-only pass through chat, settings and dialogs (focus visible, Escape closes, no trap); contrast of the main text; every icon button has an accessible name.
12. **Robustness:** kill the server while the page is open → UI shows a disconnected state and recovers on restart without a manual reload; send 50 chat messages quickly; paste a very long message and HTML (`<img src=x onerror=…>` must render as text, no script runs).
13. **Persistence and restart:** stop/start the server; chat, settings, brains, delegation state intact; token unchanged; a second tab sees the same data.
14. **Security smoke:** unauthenticated API calls to protected routes are 401; a bad `Host` header gets 421; a cross-origin request gets no CORS allowance; WebSocket without token is read-only and redacted.
15. **Real-provider smoke (one call):** your own `agy` flash-low through the app's chat; confirm the reply shows and usage is displayed.

## Report
Write `docs/e2e-review-2026-10-21/E2E-FULL-REPORT.md`:
- table: journey × result (pass/fail/blocked) × evidence file;
- a **bug list**: each with id, severity (blocker/major/minor/cosmetic), exact repro steps, expected vs actual, screenshot, console/network evidence, and a one-line guess at the cause only if you verified it;
- what you could not test and why; the commands/ports you used; anything you left running (should be nothing).
Do not fix anything. Stop when the report is written.
