# Syncing with upstream

This repository is the main line of development.
- `origin`: https://github.com/EooL/Claude-Office (ours; push here).
- `upstream`: https://github.com/W17ant/Claude-Office (the original author).
Use upstream only for fetching; never push there or open a PR unless explicitly asked.

## Take author updates

Start with a clean working tree; preserve unfinished work before switching branches.
Fetch and inspect the incoming commits, then create a disposable integration branch:

```bash
git fetch upstream
git log main..upstream/main
git switch -c sync/upstream-update main
git merge upstream/main
```

Never merge upstream directly into `main`. Review the complete diff and resolve
conflicts deliberately, keeping our behaviour and integrations. Do not blindly
choose either side. Stage resolved files individually, then `git merge --continue`.
Use `git merge --abort` if the integration cannot be completed safely.

Run `npm run build` and the full test suite on the integration branch:
- Windows: `npm run test:win` (the runner puts Git Bash first on PATH).
- Other supported platforms: `npm test`.

Read [the Windows baseline](windows-test-baseline.md) for known failures and skips.
Investigate failures, rerun failing files, and record any baseline failures and
platform exclusions. Fix new regressions; unexplained failures block promotion.
If known failures remain, obtain explicit acceptance before promoting.

After review and checks, with a clean tree, fast-forward main and push only to origin:

```bash
git switch main
git merge --ff-only sync/upstream-update
git push origin main
```

If fast-forward fails because main moved, merge main into the integration branch,
review and repeat the checks before retrying. Never force main to match the branch.

## Take only selected commits

After fetching and reviewing the log, create `sync/upstream-selected` from `main`.
Run `git cherry-pick <oldest-sha> <next-sha>` in dependency order, including any
prerequisite commits. Resolve conflicts preserving our behaviour, stage the files
and run `git cherry-pick --continue`, or `git cherry-pick --abort` to stop.
Apply the same review, build, full-suite and failure-acceptance checks above;
then fast-forward main to this branch with `git merge --ff-only` and push to origin.

## Offer a change back, only when asked

Fetch upstream and create a small branch with
`git switch -c contribute/topic upstream/main`. Cherry-pick or adapt only the
requested change; keep one theme per PR and exclude our unrelated customisations.
Review and run the same checks. When explicitly asked to submit, push the branch
to `origin` and open a PR targeting the author's `main`; never push to upstream.
