# Windows test baseline (2026-10-21, PR 6 round 2)

## Scope

This round changes only `tests/runtime-config.test.ts` and this report. No adapter, shell/Python script, production code, PR or upstream branch is changed. The owner’s real server was neither stopped nor probed; no command in this investigation intentionally connects to port 3334.

## Runtime-config isolation

The failing assumption was in `loadRuntimeConfig > is null, and changes nothing, when the server is down, answers non-2xx or with the wrong shape`: passing `fetchImpl: undefined` uses the function's default, `globalThis.fetch`. The old assertion therefore performed a real `GET http://127.0.0.1:3334/config`; an owner's running office could return a valid result instead of the expected `null`.

The test now mocks global fetch for that one default-transport assertion and restores it in `finally`. It still asserts `null`, unchanged boss bindings/shared records and the request's abort signal, and additionally checks the expected URL. Other fake-fetch cases and timeout assertions remain intact. The mocked URL uses port 4123, but no listener state is assumed because no network request occurs.

## Shell-script investigation

Command: `npm run test:win -- --serial runtime-config server-state-guard scripts`.

Result: **3 files passed, 28 tests passed, 6 existing skips, 0 failures, exit 0**: runtime-config 7, scripts 17 passing/6 skipped, state guard 4.

**First failing assertion: none observed in this run. Failing command: none observed under the requested runner.** The previously reported Windows shell failures are not reproduced by the serial baseline here; an exact historical failure cannot be reconstructed from the handoff alone. No failure text is invented and no test was weakened or newly skipped.

The fixture's actual watcher launch is `spawn('bash', [WATCHER], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })` (`tests/scripts.test.ts`, `startWatcher`). The environment points HOME/AGENT_OFFICE_HOME at disposable directories, the office at an ephemeral port and the provider override at a fake Claude CLI. `scripts/test-win.mjs` puts Git Bash and its tools first on PATH. The launch and its assertions succeeded.

The existing native-Windows exclusions in `tests/scripts.test.ts` are unchanged:

| Group | Existing skipped tests | Existing platform limitation |
| --- | ---: | --- |
| `chat-ai-watcher.sh stopped mid-reply` | 1 | Git Bash POSIX PIDs differ from Node Win32 PIDs; negative-PID groups and SIGINT trap semantics require a POSIX host. |
| `stop-office.sh` | 3 | Same POSIX process-group/signal assumptions. These tests were not executed on Windows. |
| `start-office.sh` | 2 | The entry point creates sessions through Python `os.setsid()` and POSIX signals, which native Windows Python/process APIs do not provide. These tests were not executed on Windows. |

Consequently, this round does **not** establish runtime success or an exact first failing assertion for the excluded start/stop cases. Removing their existing guards or running a real start/stop command could violate the requested scope and disturb running processes, so neither was done.

The working tree contains CRLF for all three scripts (`git ls-files --eol`: `i/lf w/crlf attr/text eol=lf`). Read-only syntax checks of the unchanged files were also performed:

```text
"C:/Program Files/Git/bin/bash.exe" --noprofile --norc -n scripts/chat-ai-watcher.sh
"C:/Program Files/Git/bin/bash.exe" --noprofile --norc -n scripts/start-office.sh
"C:/Program Files/Git/bin/bash.exe" --noprofile --norc -n scripts/stop-office.sh
```

All three returned **0**, with empty stdout/stderr (340, 235 and 163 CRLF lines respectively). These parse-only checks do not execute script commands or prove POSIX process-control behavior. CRLF alone therefore is not established as the cause of a failure in this checkout by these results. The scripts were not rewritten or normalized.

## Antigravity check

Exactly **one live chat request and one live plan request**, both through `runAdapter('agy', prompt, { mode, cwd, timeoutMs: 180000 })`. No retries or other live AI calls occurred; tests use fixtures only. A disposable project and office home/root were created inside the repository for this round. The project contained only `example.txt` and a fake `.env` (`FAKE_ONLY=not-a-real-secret`). The prompt composed the rendered shipped master prompt, a concise read-only assistant job description and the tiny tasks below. The adapter was unchanged.

Shipped master prompt SHA256: `546EFE6319FBADF21AD5B4E7F1DDE07E25B3FC78DC2230A2275B29C80308D32E`.

| Mode | UTC start | Elapsed | Exit | Error |
| --- | --- | ---: | ---: | --- |
| chat | 2026-10-21 18:58:07.311Z | 9,302 ms | 0 | empty string |
| plan | 2026-10-21 18:58:16.614Z | 41,645 ms | 0 | empty string |

Chat task: `Reply exactly AGY_CHAT_OK. Do not use tools.`

Exact chat answer:

```text
AGY_CHAT_OK
```

Plan task: `Give a one-line plan to inspect example.txt later. Do not use tools or change files.`

Exact plan answer:

```text
Plan: Read [example.txt](file:///D:/work/Claude-Office/.round2-agy-fixture/project/example.txt) to inspect its contents.
Changed: None.
Verified: None.
Left or risky: [example.txt](file:///D:/work/Claude-Office/.round2-agy-fixture/project/example.txt) has not been inspected yet.
```

Both returned real, nonempty answers without a reported tool refusal. The plan was longer than the requested one line, following the master prompt's reporting shape, but did not claim it inspected the file. Independent disk checks found exactly the two original files and verified both contents unchanged. This is two-request acceptance, not proof of all future prompts, enforced isolation or absence of outside-project writes.

Reported tokens: chat 9,836 (9,422 input, 414 output); plan 14,846 (9,425 input, 5,421 output); total **24,682**. No measured dollar cost was reported; the adapter's unreported zero is not interpreted as free usage.

## Full verification

`npm run build`: **exit 0**, TypeScript and Vite passed (98 modules).

The **one** requested full parallel `npm run test:win` invocation completed with **exit 1: 94 files total, 93 passed/1 failed; 1,459 tests passed, 1 failed, 15 existing skips** (1,475 tests including skips). There was no memory-exhaustion error. In that run, `runtime-config` passed all 7 tests and `scripts` passed 17 with the same 6 existing skips. No shell assertion failed, including under parallel load.

The sole failed file was rerun **after** the full run as required:

`npm run test:win -- --serial office-instances`

It reproduced deterministically: **exit 1, 1 file failed, 1 test passed/1 failed, 0 skips**. Exact first failure:

```text
FAIL tests/office-instances.test.ts > constructs two offices in one process with isolated state, statements and database lifetimes
AssertionError: chatStatus: expected null not to be null // Object.is equality
tests/office-instances.test.ts:75
if (typeof a.state[key] === 'object') expect(a.state[key], key).not.toBe(b.state[key])
```

Both fresh offices legitimately initialize `chatStatus` to `null`, and JavaScript's `typeof null` is `object`. The generic mutable-object identity check therefore rejects this scalar sentinel before continuing its other isolation checks. This is separate from runtime-config and the reported shell environment issue; it does not demonstrate shared mutable chat state. `tests/office-instances.test.ts` was **not changed, weakened or skipped** in this investigation. Correcting its non-null object guard and explicitly testing chat-status mutation isolation is a follow-up owner decision; the full suite is not described as green.

## Files and leftovers

`git log --all -- json` returned no history, but the untracked root file contains `ok` (two non-whitespace bytes), so it was **left unchanged** under the owner's condition. Existing untracked E2E artifacts were also left alone.

No attempt was made this round to remove anything outside the repository. These earlier disposable directories remain as previously reported:

- `C:\Users\iulia\AppData\Local\Temp\pr6-browser-fixture-X12mG2`
- `C:\Users\iulia\AppData\Local\Temp\pr6-browser-fixture-eNqN0k`

The new acceptance helper, raw results/logs and both fake project files were removed inside the repository. Windows refused removal of the now-empty `D:\work\Claude-Office\.round2-agy-fixture\project` directory because another process holds it; its empty parent remains too. No process was stopped to release that handle.

Real office homes and the active office config were not changed. No PR was opened or modified, no upstream cherry-pick was attempted and nothing was pushed to origin or fork main in this round.
