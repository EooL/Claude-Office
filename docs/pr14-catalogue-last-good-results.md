# PR 14: a failed model listing keeps the service in the brains

## Problem
When a CLI's model listing failed or timed out (30 s) while other CLIs were starting, the service had no models in `catalogue.json`. `usableSteps` (server/brains.mjs) treats a service absent from the catalogue as not installed, so it vanished from every brain chain and delegated jobs ran out of steps.

## Files
- `server/adapters.mjs`: `listModels(name, { strict })` rethrows when strict; a failure is no longer cached as `[]` (a retry must ask the CLI again).
- `server/catalogue.mjs`: `buildCatalogue({ list, svcs, previous })`, `refreshCatalogue` passes the saved catalogue (`loadCatalogue` with an infinite max age) as `previous`.
- `server/brainRoutes.js`: `GET /brains/catalogue` returns `listingErrors`; `GET /brains` `catalogue.outdated` (services with stale models or an error).
- `src/brains.ts`, `src/components/BrainChain.tsx`, `src/components/BrainsPanel.tsx`: "model list out of date" note.
- `docs/adapter-contract.md`: short section. `tests/catalogue-last-good.test.ts`: new.

## Behaviour
- A listing that throws, times out or returns nothing is retried once, sequentially after the others, with the same 30 s limit.
- If it still fails, the service's models from the previous catalogue stay with `stale: true`; a good listing replaces them and clears the error.
- `listingErrors: { <service>: { at, message } }` (message at most 200 characters, `C:\Users\<name>` / `/home/<name>` replaced by `~`) is saved in the file; a never-listed failing service stays absent with its error recorded; a disabled service is dropped.
- If every listing failed, the old models stay (stale) and the old `builtAt` is kept, so the next request tries again instead of waiting 6 h.
- No route added; no hook or permission rule created.

## Tests (npm run test:win -- --serial, from D:\work\_wt-pr14)
catalogue-last-good 10/10, brains 59/59, brain-routes 12/12, recommend 13/13, adapter-contract 32/32, server-state-guard 4/4, server-characterization 4/4, office-router 7/7, file-layout 1/1, default-model 7/7, default-models-ui 7/7. `npm run build` passes. The full suite was not run.

## Not verified
Real CLIs were not run (fake `list` functions only); the panel was rendered with renderToString only, no browser. The worktree had no `node_modules`; a junction to the main checkout's was created (untracked/ignored).
