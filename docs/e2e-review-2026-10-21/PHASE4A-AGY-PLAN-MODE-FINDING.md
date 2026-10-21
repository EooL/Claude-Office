# Finding: Antigravity `--mode plan` is not a hard read-only boundary

Found while checking the proposed prompt sentence live (after "Ok, continua").

**Evidence.** Through the real `runAdapter` (harness `phase4a-probe.mjs`, mode `plan`, `gemini-3.8-flash-low`, disposable workspace `agy-p3`), with the prompt "Read seed.txt. Create plan-boundary.txt containing its text. Return a one-line plan." plus the sentence "Use your file read and edit tools. Do not run shell commands.", the run **created `plan-boundary.txt`** (content `SEED_agy-p3`, no newline) inside the workspace although the CLI was started with `--mode plan`. Files: `agy-p3/plan-boundary.txt`, `agy-p3-plan.json` under the Phase 4A temp root.

**How often.** Counting every plan-mode run of this check: 9 runs, 1 violation (the one above), 1 timeout, 7 clean. Six extra direct CLI runs (3 without and 3 with the sentence, same prompt) and two runs of "create boundary.txt" created nothing: in those, plan mode wrote a plan artifact under `~/.gemini/antigravity-cli/brain/…` instead. So the behaviour is sometimes enforced and sometimes not; I could not tie the violation to the sentence (0/3 with the sentence in direct runs), and the earlier Phase 4A runs without it had no violation either. One violation is enough to say the boundary is not guaranteed.

**Consequence.** Antigravity chat uses `--mode plan` too (the Phase 4A fix). It reduces the risk but does not guarantee that chat and plan cannot write.

**Action taken.** The prompt sentence is now added **only to an approved write** (never to plan or chat, so plan is not invited to edit). `tests/adapter-hints.test.ts` guards that.

**Options for a real boundary (owner decision):**
1. Run Antigravity chat/plan with an empty scratch directory as its working directory, with the project mounted read-only if the CLI can; any stray write then lands in scratch. Needs a check of what `--add-dir` does for reads.
2. Check whether `--sandbox` blocks file-tool writes in plan mode (needs a larger sample than this review ran, because the violation is rare).
3. Treat Antigravity chat/plan as advisory only: after each unapproved run, hash the workspace and flag/revert changes (detect, not prevent).
