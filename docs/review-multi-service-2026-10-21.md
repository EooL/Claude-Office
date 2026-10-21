# Multi-service implementation review

Reviewed on 2026-10-21 on native Windows, against HEAD `1a9ba71`.
The implementation and review corrections remain uncommitted. No push or deployment was performed.

## Verdict

The new adapter/brain tests and selected watcher integration tests pass. The release gate is **not green**:
the wider suite still has Windows failures, and two hook/plugin suites did not complete within a bounded run.
Real read/write delegation and concurrent launches need further acceptance work.

## Corrections made during review

- Persist `auto: false` when a built-in brain is changed to a fixed chain.
- Handle an empty brain selection and delegation without a primary service.
- Reject malformed brain steps before saving or attempting to launch a CLI.
- Suppress queries to disabled services, including cached model-list responses.
- Allow chat brains to select/fall back to an installed service when the default CLI is absent.
- Publish watcher readiness after stale-lock cleanup and watermark initialization. Posting immediately after
  the PID file appeared could otherwise race initialization and lose a message.
- Update the watcher recovery test for the new authentication cooldown and wait for the actual answer,
  rather than treating a fallback/error notice as the generated reply.
- Handle early CLI stdin closure and preserve spawn errors. Finalize each invocation only once.
- Terminate CLI process trees on timeout; a controlled descendant-pipe regression test passes.
- Prefer Git Bash over the Windows WSL alias in `npm run office`; invoke Vite through Node without a shell.
- Clear the Brain editor's dirty draft after a successful save.
- Carry measured-field metadata into usage records, so unreported cost is distinguished from measured zero.

## Verification

| Check | Result |
| --- | --- |
| Adapter/brain/routes/delegation/recommendation/goal/status/launcher tests | 125 passed across 7 files |
| Watcher stale lock, failed login recovery, queued message, invalid watermarks | 5 passed; 16 other script tests excluded from this focused run |
| `tsc --noEmit` | Passed |
| Vite production build | Passed, output in the OS temp directory; existing `dist/` preserved |
| `node scripts/check-assets.mjs` | Passed; 47.7 MB of 52.5 MB budget |
| `claude plugin validate . --strict` | Passed, with an advisory about the README marketplace install line |
| `git diff --check` | Passed |
| Browser | Services, Brains and Team loaded; hierarchy and 8-agent auto-assignment control inspected without changing the user's choices |

Real one-shot smoke tests used only a synthetic prompt asking for `OFFICE_REVIEW_OK`, with no tools or file access requested:

| Service | Result | Approximate duration |
| --- | --- | --- |
| Codex | Correct answer | 6 s |
| Antigravity | Correct answer | 7 s |
| OpenCode | Correct answer | 12 s |
| Qoder | Correct answer, no measured usage fields | 40 s |
| Claude | Not invoked; the running office reported its 5-hour limit at 100% |

These are adapter smoke tests, not proof of real provider write permissions, plan isolation, tool events,
or an end-to-end `/goal` job. The adapter smoke script does not submit usage to the running office.

## Wider suite and baseline limits

The latest broad run, before adding the final process-tree test, excluded `scripts.test.ts`,
`hook-script.test.ts` and `plugin.test.ts`: **884 passed, 52 failed, 2 skipped (938 total)**.
All failures in that run were in legacy files:

| File | Failed tests |
| --- | ---: |
| doctor | 11 |
| hardening | 3 |
| install-hooks | 19 |
| open-office | 3 |
| permissions | 1 |
| release | 1 |
| runtime-config | 1 |
| sessions-registry | 1 |
| transcript | 1 |
| ws-auth | 11 |

An independent `git archive HEAD` export with the same dependency installation reproduced the same
failure counts for hardening, install-hooks, permissions, release, runtime-config, sessions-registry,
transcript and ws-auth. The baseline doctor, open-office and electron-helper suites failed during import
with `Invalid or unexpected token`; those comparisons are inconclusive. Do not call all 52 failures
verified pre-existing. Windows POSIX modes, path assumptions and CRLF-sensitive expectations are among
the observed failures. Git's `bin` and `usr/bin` were prepended to PATH for the meaningful Windows runs;
the initial run using the WSL alias was discarded.

A separate hook/plugin run was capped at 60 seconds and produced no completed test results; termination
also produced `ERR_IPC_CHANNEL_CLOSED`. This is not a passing or completed full-suite result.
The complete scripts file previously failed stop/start process-lifecycle tests on Windows; the final
five-test watcher run does not validate those lifecycle tests.

## Remaining review findings

Subsequent delegation work addressed findings 1 and 2 below with worker reservations, startup
acknowledgement and the `npm run office` watcher supervisor. See
[delegation and circuit breakers](delegation-and-circuit-breakers.md) for current behavior and verification.
The list below records the findings at the time of this initial review.

1. **P1: delegation exclusivity is not atomic across processes.** `scripts/delegate.mjs` detaches a new
   process for each plan/goal. `server/delegation.mjs` checks `busy` and writes it separately, and
   `server/jsonfile.mjs` makes replacement atomic but supplies no compare-and-set or mutual exclusion.
   Two concurrent goal processes can both see an idle state and launch work against the same checkout.
   This is a code-inspection finding; no concurrent real write job was launched during this review.
2. **P2: repeated office launches can start multiple chat watchers.** `scripts/office.mjs` reuses an
   existing server/UI but unconditionally starts the watcher. The watcher writes its PID without a
   singleton reservation. Duplicate replies and competing watermarks remain possible on repeated starts.
   This path was inspected but not exercised against the user's running watcher.
3. **Acceptance gaps:** real provider plan/write isolation, `/goal` execution in a disposable checkout,
   live exhaustion/recovery for every provider, and Windows shutdown of the complete office process tree
   remain unverified. Passing classifier/delegation fixtures does not close these gaps.

The full CI/release gate must be completed before treating this change as ready to publish.
