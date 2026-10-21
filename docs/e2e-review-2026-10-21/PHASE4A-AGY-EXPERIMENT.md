# Phase 4A — Antigravity plan/write without the permission bypass (autonomous run, T3)

Earlier (`PHASE4A-RESULTS.md`) Antigravity plan and approved write were **blocked**: headless mode refused a command it had no allow-rule for. This experiment asks whether the bypass (`--dangerously-skip-permissions`) is really needed. Direct CLI runs, `agy 1.4.3`, model `gemini-3.8-flash-low`, disposable git workspaces under the Phase 4A temp root, 3 calls, ~52 K tokens. The bypass was **not** used. No product code was changed.

| Run | Flags | Result (verified on disk) |
| --- | --- | --- |
| A write | `--mode accept-edits`, prompt: "use your file edit tool, do not run shell commands" | **PASS** `acceptance.txt` created, 12 bytes `4f46464943455f50345f4f4b` = `OFFICE_P4_OK`, no trailing newline |
| B write | A + `--sandbox` | **PASS** identical bytes |
| C plan | `--mode plan`, prompt asks for read with the file read tool and a one-line plan, no file creation | **PASS** a plan was returned; workspace contains only `seed.txt`; `plan-boundary.txt` absent |

## Reading
- The earlier block was not a missing bypass. With the permission mode already used by the adapter, Antigravity writes files through its **file-write tool**; it only fails when the model chooses a **shell command** to do the job (headless mode cannot ask, so the command is refused). The test prompts of Phase 4A ("Create X with exactly …") let the model reach for a shell.
- `--sandbox` did not prevent the file-tool write.

## Proposal (production change, not applied — needs the owner)
For `agy` in write and plan modes, prepend one sentence to the adapter prompt: *use your file read/edit tools; do not run shell commands.* Then re-run the Phase 4A probe for `agy` plan and write. That keeps `fullAccessArgs` (the bypass) opt-in and unused for this case. Caveat: a real task that genuinely needs a command (tests, builds) will still be refused without the opt-in bypass; that is the intended trade-off.

## Not verified
Repeatability (one run per case), larger tasks, other Antigravity models, behaviour through `runAdapter`/`handleGoal` with the proposed sentence.
