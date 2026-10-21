# Phase 4A — OpenCode retry on non-Google models (autonomous run)

Goal: get a real plan and an approved write through OpenCode with a locally credentialed model other than Google (T2 of `AUTONOMOUS-PLAN.md`). Harness: `phase4a-probe.mjs` (real `runAdapter` and `handleGoal`, disposable workspace and office home, 60 s cap). Credentials seen with `opencode auth list`: Anthropic, Google, OpenRouter, OpenAI (labels only; no key was printed or changed). Three models tried, the maximum allowed.

| Model | Plan | Write | Reason (provider text) |
| --- | --- | --- | --- |
| `anthropic/claude-haiku-5-5` | **blocked** (5 s) | **blocked** (4 s) | "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header…" |
| `openai/gpt-4.1-mini` | **blocked** (5 s) | **blocked** (5 s) | "The gateway key is invalid, expired, or revoked. Ask the gateway operator to issue a new virtual key." |
| `openrouter/~anthropic/claude-haiku-latest` | **blocked** (timeout 60 s) | **blocked** (timeout 60 s) | no output before the cap; reason unknown (key, queue or network) |

- No tokens were reported and no cost incurred by any of the six calls.
- Boundary: in all six runs `chat-boundary.txt`, `plan-boundary.txt` and `acceptance.txt` stayed absent. Nothing in the workspace changed except `.git/opencode`, a small file OpenCode itself creates inside `.git` on first use (project id cache). It is metadata, not a boundary violation, but a strict "no workspace changes" snapshot that includes `.git` will show it; the harness flags plan runs with exit code 2 because of it.
- No restriction was relaxed, no key or configuration was changed, no further model was tried.

## Needs the owner
The OpenCode credentials, not the product, block this check: the Anthropic key must be workspace-scoped (or the header configured), the OpenAI "gateway key" must be reissued, and the OpenRouter key/connectivity needs a look (`opencode` run by hand). After that, run: `node docs/e2e-review-2026-10-21/phase4a-probe.mjs opencode plan <model> <tag>` then `write` (the workspace for a new tag must exist as a git repo with a `seed.txt`).
