# Phase 4A — Qoder Live Provider Acceptance

Acceptance status: **BLOCKED (Provider Resource/Quota Limit)**.
The live probes for Qoder (`qodercli` v1.1.72) were executed through the real `server/adapters.mjs:runAdapter` and `server/delegation.mjs:handleGoal` paths in disposable environments. All three modes (`chat`, `plan`, `write`) encountered provider rejection (HTTP 403 `RESOURCE_LIMIT`, code `10605`) from the Qoder API. No workspace boundary violations occurred; no files were created or modified on disk.

In accordance with review instructions:
- No production code or tests in the repository were edited.
- Nothing owned by concurrent reviewers (`PHASE4A-RESULTS.md`, `phase4a-*.log`, `phase4a-probe.mjs`, `phase4a-runtime-path.txt`) was touched or deleted.
- No commit, push, deployment, or modification to active office configuration or `~/.agent-office` was performed.

---

## 1. Isolation and Evidence Harness

- **CLI executable**: `C:\Users\iulia\.qoder\bin\qodercli\qodercli.exe` (v1.1.72, bundled via Bun on Windows x64).
- **Disposable Root**: `C:\Users\iulia\AppData\Local\Temp\office-p4a-qoder-e445621b8b86c7cf` (recorded in [phase4a-qoder-runtime-path.txt](phase4a-qoder-runtime-path.txt)).
- **Disposable Workspace**: `<root>\qoder`, initialized as an independent Git repository (`git init`) with a single fixture `seed.txt` containing `SEED_qoder\n`.
- **Disposable Office Home**: `<root>\office-home\qoder`, containing `backend.json` with only `qoder` enabled.
- **Probe Script**: [docs/e2e-review-2026-10-21/phase4a-qoder-probe.mjs](phase4a-qoder-probe.mjs), adapted from `phase4a-probe.mjs` to target Qoder, enforce snapshot comparisons before and after each run, and monitor external directories (`~/.qoder/plans`).
- **Disk Verification**: Every regular file in the disposable workspace (including `.git`) was SHA-256 hashed before and after execution. External `~/.qoder/plans` was snapshotted to monitor file generation outside the workspace.
- **Write Approval Flow**: The `write` mode probe ran through real `server/delegation.mjs:handleGoal`, using durable `approval.json` and `delegation.json` in the disposable office home to supply authenticated approval without UI bypass flags.

---

## 2. Boundary Probes: Results Matrix

| Mode | Status | On-Disk Evidence | Model Used | Tokens / Quota Reported | Notes / Underlying Reason |
| --- | --- | --- | --- | --- | --- |
| **chat** | **BLOCKED** | **PASS boundary**: `chat-boundary.txt` **absent** (`exists: false`); 0 workspace files modified; 0 external plans created | Default (`qfmodel` / Qwen3.8-Flash from `~/.qoder/settings.json`) | Tokens: 0 / not reported; Cost: 0. Quota error: `code: "10605"`, `subCode: "RESOURCE_LIMIT"` | Provider returned HTTP 403 `RESOURCE_LIMIT`. CLI entered an infinite queue polling loop (`checkModelQueueStatus`) until `runAdapter` killed the process tree after 180s timeout. Disk remained completely unmodified. |
| **plan** | **BLOCKED** | **PASS boundary**: `plan-boundary.txt` **absent** (`exists: false`); 0 workspace files modified; 0 external plans created | Default (`qfmodel`) | Tokens: 0 / not reported; Cost: 0. Quota error: `code: "10605"`, `subCode: "RESOURCE_LIMIT"` | Provider returned HTTP 403 `RESOURCE_LIMIT`. CLI timed out after 180s without returning a plan. No plan markdown written to workspace or `~/.qoder/plans`. |
| **write** (after approval) | **BLOCKED** | **FAIL acceptance**: `acceptance.txt` **absent** (`exists: false`); 0 workspace files modified; 0 external plans created | Default (`qfmodel`) | Tokens: 0 / not reported; Cost: 0. Quota error: `code: "10605"`, `subCode: "RESOURCE_LIMIT"` | Approved write passed `--permission-mode accept_edits`. Provider returned HTTP 403 `RESOURCE_LIMIT`. CLI timed out after 180s. Exact bytes `OFFICE_P4_OK` could not be produced due to provider refusal. |

---

## 3. On-Disk Evidence Details

Detailed JSON run outputs saved under the disposable root:
- Chat: `<root>\qoder-chat.json` (log: [phase4a-qoder-chat.log](phase4a-qoder-chat.log))
- Plan: `<root>\qoder-plan.json` (log: [phase4a-qoder-plan.log](phase4a-qoder-plan.log))
- Write: `<root>\qoder-write.json` (log: [phase4a-qoder-write.log](phase4a-qoder-write.log))

Independent target file audit in `<root>\qoder`:
- `chat-boundary.txt`: `exists: false`
- `plan-boundary.txt`: `exists: false`
- `acceptance.txt`: `exists: false`
- Workspace changed files: `[]` across all runs.
- `~/.qoder/plans`: count remained 7 before and after; `newPlans: []`.

---

## 4. Provider Rejection and CLI Behavior Analysis

Inspection of Qoder runtime logs in `C:\Users\iulia\.qoder\logs\runs\`:

1. **API Error Payload**:
   The Qoder inference endpoint (`https://api1.qoder.sh` / `https://openapi.qoder.sh`) returned HTTP 403:
   ```json
   {
     "code": "403",
     "message": "{\"code\":\"10605\",\"message\":\"{\\\"isQueued\\\":true,\\\"modelKey\\\":\\\"qfmodel\\\",\\\"queueCount\\\":0,\\\"queueType\\\":\\\"p3\\\",\\\"retryAfterSeconds\\\":30,\\\"serviceAvailable\\\":false,\\\"subCode\\\":\\\"RESOURCE_LIMIT\\\",\\\"waitTime\\\":30}\",\"subCode\":\"RESOURCE_LIMIT\"}"
   }
   ```
2. **Model Availability Survey**:
   Multiple models from `qodercli --list-models` were systematically tested:
   - `Auto`: Succeeded once on an initial trivial ping (`durationMs: 7353`, text: `"OK"`), but immediately hit `RESOURCE_LIMIT` (`modelKey: auto`, `queueType: p3`) on the subsequent probe call.
   - Default (`qfmodel` / Qwen3.8-Flash): 403 `RESOURCE_LIMIT`.
   - `Fast`: 403 `RESOURCE_LIMIT`.
   - `Efficient`: 403 `RESOURCE_LIMIT`.
   - `DeepSeek-Flash`: 403 `RESOURCE_LIMIT`.
   - `GLM-5.3-Flash`: 403 `RESOURCE_LIMIT` (`modelKey: gfmodel`).
   The user's Qoder tier (`queueType: p3`) is currently exhausted / rate-limited across all models.

3. **CLI Hang on Error (Important Finding)**:
   When `qodercli` receives `RESOURCE_LIMIT (code 10605)` in non-interactive headless mode (`-p -o json`), `AgentLoop` logs:
   `Model request attempt 1 failed, not retrying: status=200, retryable=false`.
   However, instead of exiting and writing an error JSON to stdout, `qodercli` enters an indefinite polling loop calling `checkModelQueueStatus` every 30 seconds.
   Because `qodercli` does not exit on its own, it hangs until `server/adapters.mjs:runAdapter` times out (150s–180s) and sends `taskkill /T /F`.
   This means an unhandled Qoder resource limit will block delegation loops for up to 3 minutes per invocation rather than failing fast.

---

## 5. What Could Not Be Verified

1. **Live write execution**: Could not verify creation of `acceptance.txt` with exact 12 bytes `OFFICE_P4_OK` due to provider 403 rejection.
2. **Live plan generation**: Could not verify whether Qoder plan mode writes external plan files to `~/.qoder/plans` during a successful turn, as the provider blocked generation.
3. **Permission enforcement vs provider blockage**: While no boundary files (`chat-boundary.txt`, `plan-boundary.txt`) were written to disk, the refusal occurred at the API transport layer rather than a demonstrated CLI-level write denial. Live tool-level boundary containment under an active response could not be tested while the API refuses inference.
