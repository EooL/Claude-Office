# PR 11: default model per AI service

## Behaviour
Settings > Services shows, for each installed and enabled service, a "Default model" picker (the existing ModelCombo, fed by `/brains/catalogue`; a plain text field when the service lists nothing), an "Auto" button that clears it, and the note "Used when a brain does not name a model: ...". A model missing from a non-empty catalogue is kept and flagged "unlisted". Read-only without the UI token; each change is saved on commit with a Saved / error indicator.

Precedence, implemented once in `resolveModel()` (server/adapters.mjs, used by `runAdapter`): brain step model > `defaultModels[service]` > adapter `defaultModel` > none (the CLI's own default). Chat, plan, goal, orchestrator and enrichment all go through `runAdapter`.

Storage: `defaultModels: { <service>: <id> }` in the office's backend.json (server/settings.mjs: `defaultModelFor`, `setDefaultModel`, `validModelId`). Valid id: string, at most 200 chars, no control characters; empty removes the entry. The route is `POST /backends/default-model { name, model }` (UI token; 400 unknown service / bad id); `GET /backends` and the route's reply list `defaultModel` and `adapterDefaultModel` per service.

## Files
server/settings.mjs, server/adapters.mjs, server/backends.js, src/components/DefaultModels.tsx (new), src/components/SettingsPanel.tsx, src/styles/settings.css, tests/fixtures/server-routes.json (+1 route), tests/default-model.test.ts and tests/default-models-ui.test.ts (new). No golden in tests/adapter-contract.test.ts changed.

## Tests
- `npm run build`: passes.
- Focused serial run (default-model, default-models-ui, brain-routes, adapter-contract, server-characterization, server-state-guard, office-router, paths, file-layout, brains, recommend): all pass.
- Full parallel `npm run test:win`: 2 failed files. delegation-runtime passes when re-run serially (flaky under load). agent-profiles "shipped files equal the generator output" fails identically without this change (pre-existing).

## Not verified
No browser check: layout in the 1056x682 window and keyboard behaviour were not seen live. node_modules in the worktree was missing and was re-created as a junction to the main checkout's.
