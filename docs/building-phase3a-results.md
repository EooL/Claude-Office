# Building Phase 2, sub-step 3a: per-office secrets (done by the boss after Codex's quota ran out)

Date: 2026-10-21. Local dirty checkout; no commit, push or deployment. Verified: `npm run test:win -- --serial` 76/76 files, 1,209 tests passed, 15 skipped, exit 0 (`e2e-review-2026-10-21/building-phase3a-serial.log`).

## What changed
- New `server/office-auth.mjs`: `createOfficeAuth(tokenFile)` owns one office's file token, UI token, `tokenMatches`, `uiTokenMatches`, request-signature check, permission `proof`, health `officeProof` and `writeTokenFile`. `readTokenFile` (with the Windows symlink fix) moved here unchanged. It reads the token file but never writes it; a fresh token exists in memory until `writeTokenFile()` runs after listen.
- `server/office.mjs`: every office now has `auth` (`createOfficeAuth(<home>/auth-token)`).
- `server/index.js`: the module-level token code is gone. `AUTH_TOKEN`, `REUSED_TOKEN`, `UI_TOKEN`, `TOKEN_FILE` stay as exported constants of the default office (tests and `officeLink` use them); `tokenMatches`, `uiTokenMatches`, `signatureValid`, the permission proof, the health proof and the WebSocket `uiToken` all ask `currentOffice().auth`. `readTokenFile` keeps its signature and export. No behaviour change for the default office.
- `server/office-routing.mjs`: a bearer token is no longer refused outright on a non-default office's read routes; it is checked against that office's own token. Cookies and signed requests stay refused (501) until the routes that use them are scoped.
- `tests/office-router.test.ts`: the old "Authorization gets 501" assertion was replaced (cookies and signatures still 501); new test "each office has its own secrets" shows distinct secrets, that A's token never matches B (and the reverse) including proof/officeProof, that nothing is written to B's token file, and, over real HTTP with the same signal in both offices, that a private command is visible only with the token of the office being read (A's token on B and B's on A see nothing, as does no token). A token-guarded write (`POST /o/<B>/event`) is still 501 even with B's own token.

## Still to do for sub-step 3 (unchanged from `building-phase2-2-results.md`, minus the secrets)
Per-office broadcast and WebSocket membership (enable non-default upgrades), per-office stores for status/permissions/tasks, health/registry split, artifacts roots and tmp, file paths for writes (last-chat, inbox, answer marker), cwd-based hook dispatch, then enabling write routes one group at a time with matching-id tests.
