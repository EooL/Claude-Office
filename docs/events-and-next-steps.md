# Events and recommended next steps

## Real events by default

Settings > Events stores `eventMode: "real"` in the Office runtime settings. Real signals remain
enabled in both modes. Choosing emulation adds the existing timed office events; their announcements
are labeled `[Emulated]`. Switching back stops the random event timer. Demo/video URLs retain
emulation. Cosmetic walks and coffee breaks remain part of the animated office.

The existing Claude Code hooks report observed test, build, push and deployment signals. Local
failures do not establish a production outage: incident text now names the observed failure, avoids
invented root causes, and does not claim recovery when an alert merely expires. Real mode also uses
neutral agent lifecycle chatter instead of invented PR, merge or deployment outcomes.

Commands run outside those hooks can report real outcomes with:

```sh
node scripts/report-run.mjs test Claude-Office -- node node_modules/vitest/vitest.mjs run
node scripts/report-run.mjs build Claude-Office -- node node_modules/vite/bin/vite.js build
```

The wrapper runs the supplied executable without a shell, reports start and actual exit status to
the local Office server, and returns the command's exit code. No command output is uploaded. On
Windows, use an executable such as `node` rather than a `.cmd` shim. Reporting is best effort and
cannot turn a failed command into a successful one. Use `AGENT_OFFICE_HOME` and `AGENT_OFFICE_PORT`
for a different local Office instance.

External CI is not automatically connected. A runner/integration that can reach Office may send an
authenticated `POST /event` using its Office token:

```json
{
  "type": "signal",
  "project": "my-project",
  "signals": [{ "kind": "build_failed", "target": "CI main", "exitCode": 1 }]
}
```

Supported outcomes include `test_start`, `test_ok`, `test_failed`, `build_start`, `build_ok`,
`build_failed`, `deploy_start`, `deploy_success`, `deploy_fail`, `push`, `push_done`, `push_failed`.
Use a stable target for failure/recovery pairs. Keep credentials in the integration's secret storage;
the local server is bound to loopback. A hosted runner cannot reach it without a separate connection.
No GitHub credentials, webhook exposure or remote pipeline monitoring are configured by this change.

## Recommendations and approval

Office chat replies and execution reports are instructed to recommend one concrete next task when
the context supports it. Greetings and resolved questions need no invented follow-up. The reply uses
one bounded `NEXT_ACTION: <task with context>` line, displayed as a suggested next step.

- **Plan recommended step** approves planning the displayed task. It does not approve edits.
- **Approve planning** accepts the controller's pending planning proposal.
- **Approve and execute plan** approves the full displayed plan and may change files.
- **Retry planning** replans a failed task before another execution approval.

Buttons require the authenticated Office page. The server derives commands from stored agent replies
and controller state; a client cannot submit an arbitrary command. Only the latest contextual
recommendation is available. Busy workers, paused AI and superseded/used proposals cannot be approved.
Approvals are recorded transactionally in SQLite to prevent duplicate clicks. An execution approval
also carries a fingerprint of the plan; the locked worker checks it again before executing. A changed
plan requires a new approval. Typed `/goal` remains available for approving the current plan manually.

Approval queues the request for the watcher. The chat distinguishes queued approval, running work
and reported completion; a click is not evidence of completion. The existing per-tool permission
policy still applies. The earlier provider chat-permission review findings remain separate work.

## Verification

128 tests across 13 related files pass, including real detached fixture execution, duplicate and
stale approvals, authentication, event settings, incident wording, safe artifacts, real command exit
reporting and history. Two selected watcher tests also pass with Git Bash on Windows: recommendation
line preservation and authenticated goal dispatch. TypeScript, strict plugin validation, Vite build,
asset budget and diff whitespace checks pass. The previously documented wider Windows-suite failures
remain; this is not a full release-gate pass.
