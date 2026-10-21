# Delegation and circuit breakers

The office chat has two paths: conversation and delegated work. A conversational answer cannot start a worker.
Task routing launches a real planning process; the agent appears in the office and publishes a plan.
`/goal` authorizes the execution process for the current plan. A finished CLI invocation is reported as an
execution result, not independently verified proof that a goal or pull request is complete.

## Task state and follow-ups

`$AGENT_OFFICE_HOME/delegation.json` (default `~/.agent-office/delegation.json`) records the last task,
phase, status and safe failure category. The original request is preserved, including language and
screenshot requirements; the classifier's shortened description does not replace it.

- `status` or `what I asked` reports actual state without asking a conversational model
  to invent progress.
- `retry the last task` starts a new **plan** for a failed request, not a silent write retry.
- A ready plan reports that execution is waiting for `/goal`.
- A denied tool permission, login problem, limit or unavailable provider is reported explicitly.
  Failed replacement planning invalidates an older plan so it cannot be executed accidentally.

Detached workers acknowledge startup over IPC. Bootstrap failures appear in the office and in the private
`delegation.log`. A process reservation prevents concurrent plans/goals from editing the same workspace.
The reservation is reclaimed when its owner has exited, and released after completion or handled failure.
The active service is included in the worker's persisted busy state and office status.

`npm run office` starts a singleton watcher supervisor. Repeated launches reuse a live supervised watcher,
including a live watcher from the older launcher. Windows uses Git Bash and terminates owned child trees.
Legacy shell entry points still have platform limitations; use `npm run office` on native Windows.

## Breaker states

Breakers are persisted in `cooldowns.json` and shared between workers. State updates use a process lock;
recovery probes use separate reservations per circuit.

| State | Behavior |
| --- | --- |
| Closed | The service/model may be called. |
| Open | Skip it immediately and try the next configured brain step. |
| Half-open | After the delay, one worker probes recovery; other workers use their fallbacks. |

A successful probe closes the circuit and resets the failure count. A failed probe reopens it.
Transient failures and headless permission refusals use exponential backoff, capped at 16 times the base
delay. Explicit retry hints take precedence over backoff. Usage limits default to 30 minutes, unavailable
services to 5 minutes, permission/unknown failures to 2 minutes, and login/credit/model failures to 6 hours.
These are retry policies, not guarantees about when the provider will recover.

- Service outages, usage limits, credits and login failures apply across that service's models.
- An unavailable model blocks only that model.
- Headless tool permission refusals apply only to `chat`, `plan`, or `write`, so a denied planning command
  does not disable text-only chat.
- A crashed probe owner can be reclaimed without waiting for the entire probe lease.
- Settings > Brains > Try now clears the selected cooldown for an explicit retry.

Fallbacks follow the configured brain chain and enabled services. A chain containing only one service
has no second service to try. The controller does not grant missing CLI permissions automatically.
Configure the provider locally or add an enabled service as a fallback.

## Verification on 2026-10-21

The exact reported failure was reproduced: Antigravity planning required a command permission that its
headless mode could not request. Its direct text-only smoke test did not establish planning permissions.
The user's Reviewer profile retained Antigravity first and gained Codex as a second step. The previous
settings were saved locally in `backend-before-delegation-fix.json`.

The original PR request was retried through the live worker in **planning mode only**. Office events
showed a real working Reviewer, the Antigravity permission failure, the switch to Codex, and `plan ready`.
No `/goal`, commit, push or PR creation was performed by this verification.

Automated coverage includes the exact Romanian follow-up, false takeover replies, preserved requirements,
failure state, stale-plan invalidation, adapter exceptions, circuit scope/backoff, cross-process single
probes, crash recovery, and duplicate watcher launches. An isolated runtime test uses the real detached
controller and HTTP event path with fake CLIs: it shows the worker, falls back, and makes one actual fixture
file edit when two goals are submitted concurrently. This fixture is not a real-provider write test.

TypeScript, Vite build and asset checks pass. The wider Windows-suite failures described in
[the earlier review](review-multi-service-2026-10-21.md) remain outside this fix; the full release gate is
not claimed green.

## Chat artifacts and later execution verification

The user subsequently approved `/goal`. The real Codex worker finished and produced a PR draft
and three screenshots in an `office-*` temporary directory. This did not create a GitHub PR.
Chat renders Markdown links and images, opens supported text files in a reader, and enlarges
images on click. Reconnecting restores the latest chat history without duplicating live messages.

Local artifacts require UI authentication and a reference in the stored message. Files must be
inside the workspace or an Office temporary directory; sensitive paths, unsupported types and
oversized files are rejected. A linked Markdown document can reference adjacent files within its
directory. Documents are rendered as escaped text with safe links and images, never executable HTML.

Antigravity's exact failing `git diff --name-only` command was also reproduced in a disposable
repository. Both `auto` and `accept-edits` denied it in headless mode. Adding the narrowly anchored
local permission `command(regex:^git diff --name-only$)` made the real command succeed in
`accept-edits`; the original settings were backed up first. Other commands still follow their
existing permission rules. See the official [headless permissions documentation](https://www.antigravity.google/docs/cli/headless/#permissions-in-headless-mode).

The chat/artifact/history, chat API, delegation and circuit-breaker regression group passes
55 tests across six files. TypeScript and the Vite build also pass. The existing wider-suite
Windows failures remain a release limitation.
