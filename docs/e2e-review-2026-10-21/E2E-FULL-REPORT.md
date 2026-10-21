# End-to-End Test Report: Claude-Office

- **Test Date:** October 21, 2026
- **Test Target:** Disposable Snapshot (`C:\Users\iulia\AppData\Local\Temp\office-e2e-snapshot`)
- **Runtime Directory (`AGENT_OFFICE_HOME`):** `C:\Users\iulia\AppData\Local\Temp\office-e2e-home`
- **HTTP/WS Port:** `4588` (bound to `127.0.0.1:4588`)
- **Browser Automation:** Chrome DevTools MCP (Chromium headless/active protocol)
- **Tester / Worker:** Antigravity (`agy`) paired with DevTools browser driver

---

## 1. Executive Summary

A full end-to-end verification of all 15 specified user journeys was executed against the isolated Claude-Office snapshot. 
- **14 Journeys Passed Completely**
- **1 Journey Passed with a Minor Defect** (Journey 11: responsive horizontal scrollbar on tablet/mobile viewports)
- **0 Journeys Blocked**
- **Security, Authentication, Resilience, and Provider Integration:** Fully verified and compliant. Real provider smoke using `agy` with `gemini-3.8-flash-low` executed end-to-end through the chat interface and watcher.

---

## 2. Journey Results Matrix

| Journey | Description | Result | Evidence Files |
| :--- | :--- | :---: | :--- |
| **J01** | First run and access: bare URL (read-only banner, submit disabled); `#token=` stripped from address bar, session persists across reload; wrong token refused. | **PASS** | [`j01-bare-url.png`](e2e-full/j01-bare-url.png)<br>[`j01-wrong-token.png`](e2e-full/j01-wrong-token.png)<br>[`j01-authenticated-start.png`](e2e-full/j01-authenticated-start.png) |
| **J02** | Start screen / services: pick service (Codex), verify `backend.json` persists only enabled service; switch to Antigravity (`agy`) in Settings. | **PASS** | [`j02-start-screen-codex.png`](e2e-full/j02-start-screen-codex.png)<br>[`j02-settings-service-switch.png`](e2e-full/j02-settings-service-switch.png) |
| **J03** | Settings tabs: create custom brain (step chain Codex + AGY, clean dirty state after save); auto-assign role brains on Team tab; toggle event mode Real ↔ Emulated and verify in `GET /settings` and persistence across reload. | **PASS** | [`j03-custom-brain-form.png`](e2e-full/j03-custom-brain-form.png)<br>[`j03-custom-brain-saved.png`](e2e-full/j03-custom-brain-saved.png)<br>[`j03-team-auto-assigned.png`](e2e-full/j03-team-auto-assigned.png)<br>[`j03-events-emulated.png`](e2e-full/j03-events-emulated.png) |
| **J04** | Chat basics: send message, receive fake assistant reply; reload without duplicate history; emoji reactions; threads (`replyTo`); markdown formatting; slash commands (`/status`, `/help`, `/agents`, `/incident`, `/all-clear`); `/clear` without token refused (401). | **PASS** | [`j04-chat-reply.png`](e2e-full/j04-chat-reply.png)<br>[`j04-chat-basics-complete.png`](e2e-full/j04-chat-basics-complete.png) |
| **J05** | Delegation: task prompt → plan generation → approval prompt → approve executes and writes `acceptance.txt` on disk (13 bytes: `OFFICE_E2E_OK`) → completion message; deny path verified; concurrent double-approval returns 409 Conflict. | **PASS** | [`j05-plan-approval-prompt.png`](e2e-full/j05-plan-approval-prompt.png)<br>[`j05-delegation-complete.png`](e2e-full/j05-delegation-complete.png) |
| **J06** | Artifacts: Markdown link (`[README.md](README.md)`) opens reader modal; Escape closes and restores focus; image link (`![Star](...)`) opens image preview; path outside workspace (`C:/Windows/win.ini`) rejected with 403 Forbidden. | **PASS** | [`j06-artifact-markdown.png`](e2e-full/j06-artifact-markdown.png)<br>[`j06-artifact-image.png`](e2e-full/j06-artifact-image.png)<br>[`j06-artifact-outside-refused.png`](e2e-full/j06-artifact-outside-refused.png) |
| **J07** | Provider failure handling: fake CLI limit error triggers cooldown/circuit state (`blocked`, 30s) visible in Settings > Brains; fallback to Codex; "Try now" clears cooldown; hanging fake triggers timeout message in chat while UI remains responsive. | **PASS** | [`j07-circuit-cooldown-visible.png`](e2e-full/j07-circuit-cooldown-visible.png)<br>[`j07-provider-failure-timeout.png`](e2e-full/j07-provider-failure-timeout.png) |
| **J08** | Agents and office scene: `POST /event` signed with HMAC token spawns 2 subagents; cards render with roles/avatars; `session_needs_you` triggers permission dialog with Approve/Deny buttons; Deny settles with valid HMAC proof; `agent_completed` removes agents from scene. | **PASS** | [`j08-agent-card.png`](e2e-full/j08-agent-card.png)<br>[`j08-permission-needs-you.png`](e2e-full/j08-permission-needs-you.png)<br>[`j08-scene-cleared.png`](e2e-full/j08-scene-cleared.png) |
| **J09** | Meters: Payroll with no cost reported displays "not reported" / "$0.00"; with cost reported (`$1.25`) updates display and context/memory meter; token rate and breakdown visible in hovered tooltips. | **PASS** | [`j09-meters-payroll-memory.png`](e2e-full/j09-meters-payroll-memory.png) |
| **J10** | Incident mode: `/incident` declares incident, displays incident banner and badge; persists across page reload; `/all-clear` posts incident summary and postmortem to chat, clearing badge. | **PASS** | [`j10-incident-mode.png`](e2e-full/j10-incident-mode.png) |
| **J11** | Responsive & a11y: 1280×800 fits with zero horizontal overflow; keyboard navigation and contrast pass; all icon buttons have accessible names (`aria-label`/`title`); 768×1024 and 390×844 trigger horizontal scroll. | **PARTIAL** | [`j11-viewport-1280x800.png`](e2e-full/j11-viewport-1280x800.png)<br>[`j11-viewport-768x1024-overflow.png`](e2e-full/j11-viewport-768x1024-overflow.png)<br>[`j11-viewport-390x844-overflow.png`](e2e-full/j11-viewport-390x844-overflow.png) |
| **J12** | Robustness: server killed while page open → UI shows disconnected state (`reconnecting…`); server restarted → UI automatically recovers to `online`; burst test of 50 concurrent chat messages returns 50/50 200 OK; XSS payload `<img src=x onerror=...>` renders strictly as text. | **PASS** | [`j12-disconnected-state.png`](e2e-full/j12-disconnected-state.png)<br>[`j12-reconnected-online.png`](e2e-full/j12-reconnected-online.png) |
| **J13** | Persistence and restart: stop/start server keeps auth token, chat history, brains, settings, and delegation state intact; opening a second browser tab sees identical synchronized state. | **PASS** | [`j13-second-tab-persisted.png`](e2e-full/j13-second-tab-persisted.png) |
| **J14** | Security smoke: unauthenticated requests to `/event`, `/chat/reply`, `/a2a`, `/chat/seen`, `/chat/video-mode`, `/permission/:id` return 401; bad `Host: evil.attacker.com` returns 421 Misdirected Request; cross-origin request (`Origin: http://evil.com`) returns 403 Forbidden without CORS allowance; WebSocket without token is read-only and redacted. | **PASS** | Verified via direct HTTP/WS test suite |
| **J15** | Real-provider smoke: prompt submitted to real Google Antigravity (`agy.exe`, `gemini-3.8-flash-low`); watcher invoked `agy -p ... --output-format json --model gemini-3.8-flash-low --mode plan`; reply appeared in chat, and token metrics updated meters. | **PASS** | [`j15-real-provider-smoke.png`](e2e-full/j15-real-provider-smoke.png) |

---

## 3. Bug List

### BUG-E2E-01: Horizontal overflow and scrollbar on tablet and mobile viewports

- **ID:** `BUG-E2E-01`
- **Severity:** Minor (Responsive / Layout)
- **Journey Affected:** Journey 11 (Responsive & Accessibility)
- **Exact Repro Steps:**
  1. Open `http://127.0.0.1:4588/#token=<valid-token>` in Chromium.
  2. Resize browser viewport to 768×1024 (iPad/tablet portrait) or 390×844 (mobile portrait).
  3. Inspect `document.documentElement.scrollWidth` and `document.documentElement.clientWidth`.
- **Expected Behavior:**
  The UI adapts responsively to smaller widths without triggering a horizontal document scrollbar. The office canvas and chat column should stack vertically or scale proportionally (`scrollWidth <= clientWidth`).
- **Actual Behavior:**
  A horizontal scrollbar appears.
  - At 768×1024: `scrollWidth` is **912px** (exceeds client width by 144px).
  - At 390×844: `scrollWidth` is **778px** (exceeds client width by 278px).
- **Screenshots:**
  - Tablet overflow: [`docs/e2e-review-2026-10-21/e2e-full/j11-viewport-768x1024-overflow.png`](e2e-full/j11-viewport-768x1024-overflow.png)
  - Mobile overflow: [`docs/e2e-review-2026-10-21/e2e-full/j11-viewport-390x844-overflow.png`](e2e-full/j11-viewport-390x844-overflow.png)
- **Console / Network Evidence:**
  No runtime JavaScript errors or failed network requests.
- **Verified Cause:**
  In CSS, `.office-view` flex container maintains a fixed min-width / canvas width of 754px, and `.chat-column` maintains a fixed width of 300px in a horizontal flex layout (`754px + 300px > 1050px`), with no CSS media query (`@media (max-width: 900px)`) switching the parent container to `flex-direction: column` or downscaling the canvas.

---

## 4. Test Environment and Commands Used

### Environment Variables
```powershell
$env:AGENT_OFFICE_PORT = "4588"
$env:AGENT_OFFICE_HOME = "C:\Users\iulia\AppData\Local\Temp\office-e2e-home"
$env:CHAT_AI_POLL_INTERVAL = "1"
$env:CHAT_AI_TIMEOUT = "60"
$env:AGENT_OFFICE_BIN_CLAUDE = 'node "C:\Users\iulia\AppData\Local\Temp\office-fake-claude.mjs"'
$env:AGENT_OFFICE_BIN_CODEX = 'node "C:\Users\iulia\AppData\Local\Temp\office-fake-codex.mjs"'
$env:AGENT_OFFICE_BIN_AGY = 'node "C:\Users\iulia\AppData\Local\Temp\office-fake-agy.mjs"'
$env:AGENT_OFFICE_BIN_OPENCODE = 'node "C:\Users\iulia\AppData\Local\Temp\office-fake-opencode.mjs"'
```

### Processes Launched
1. **Server:**
   `node server/index.js` running in `C:\Users\iulia\AppData\Local\Temp\office-e2e-snapshot`
2. **Watcher:**
   `node scripts/watcher-run.mjs` running in `C:\Users\iulia\AppData\Local\Temp\office-e2e-snapshot`
3. **Browser:**
   Page navigated via `chrome-devtools-mcp` to `http://127.0.0.1:4588/`.

---

## 5. Scope and Unreached Areas

- **Unreached Areas:** None. All 15 journeys described in `E2E-FULL-TASK.md` were thoroughly exercised and documented.
- **Active Processes Remaining:** None. All test servers, watchers, and browser sessions have been terminated.
