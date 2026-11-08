# Repository and evidence map

## Repository and implementation

Work in `~/workspace/agentrouter-connector/mcp-server`, inside repository `Pr3eve6ti2o/agentrouter-connector`. Do not assume the local streaming fix exists remotely.

Implementation paths below are relative to the MCP server root.

- Find `package.json` at the root.
- Read `src/server.ts` for request handling.
- Read `src/config.ts` for configuration.
- Read `src/env.ts` for `parseApiKeys`, `parseHosts` and the shared `clientHeaders`.
- Read `src/upstream.ts` for upstream requests.
- Read `src/sse.ts` for the `readSseEvents` async generator.
- Read the existing worker in `src/worker.ts` and job tools in `src/tools/jobs.ts`. The worker ensures `jobs/` exists before writing `jobs/worker.pid` on startup and removes the PID file on graceful shutdown; the launcher guard in `worker/guard.sh` checks the PID with `kill -0`, a working-directory match and a command-line check for `dist/src/worker.js`.
- Inspect compiled output under `dist/src/`.

## Lane clients

Use these callers to exercise the rebuilt server:

- `~/workspace/bawa-wallet/agent-g-android/mcp-chat.mjs`
- `~/workspace/bawa-wallet/agent-g-android-api1/mcp-chat.mjs`

Run a lane call from its configured lane directory after rebuilding. The lane client spawns the MCP server itself as a stdio subprocess, so no separate server start is needed.

## Evidence logs and ledgers

- Inspect recorded worker artefacts under `jobs/` at the MCP server root.
- Job artefacts under `jobs/` include the job file, the claim file and the heartbeat sidecar. `claimJob` creates the claim file exclusively for atomic claims, with a 120-second stale break; `readJob` merges the heartbeat sidecar into `last_heartbeat`.
- `~/MEMORY.md` is a historical reference that was unavailable as of 2026-11-07 in the authoring workspace on the Boxd virtual machine `muse-vm` (user home `/home/boxd`, workspace `/home/boxd/workspace`) because the file did not exist there; the skill's `~/workspace` paths refer to that machine. The 2026-11-06 stop-and-fix entry had no accessible substitute in that workspace as of 2026-11-07 and is recorded here as unavailable at that date. For the 2026-11-07 fix-verified entry, the checked api2 lane notes at `~/workspace/bawa-wallet/agent-g-android/NOTES.md` recorded "Fix test (Orion, direct streamed fetch, 95-word B1a2a prompt, max_output_tokens 32000): status completed, 9,759 chars, 442s (past the cut window), usage output 18,994 / reasoning 16,536". They also recorded "MCP server fix applied (local, unpushed): server.ts agentrouter_chat now streams Responses + 32k clamp, config defaults 32k cap / 20-min timeout, jobs clamp 32k; both mcp-chat.mjs clients pass 32000." The checked api1 lane notes at `~/workspace/bawa-wallet/agent-g-android-api1/NOTES.md` recorded the fixed-server landings: "F 26,319 characters (ledger 2026-11-06T20:31:51Z, 514,445 ms), G 16,871 characters (ledger 2026-11-06T21:13:28Z, 501,435 ms), H 34,514 characters, I 24,474 characters, J 22,375 characters, K 18,222 characters". Both sets of lane notes were checked first-hand in that workspace on 2026-11-07; the notes recorded fixed-server landings F through K with no gateway failures as of that date.
- `~/AGENTS.md` is a historical reference that was unavailable as of 2026-11-07 in the authoring workspace on the Boxd virtual machine `muse-vm` (user home `/home/boxd`, workspace `/home/boxd/workspace`) because the file did not exist there. The api2 lane notes at `~/workspace/bawa-wallet/agent-g-android/NOTES.md`, checked first-hand in that workspace on 2026-11-07, supplied the two-error diagnosis: "(A) idle transport cut ~291s on non-streamed calls; (B) reasoning starvation" and "worker receipts proved f21e08cc burned 16,000/16,000 reasoning tokens with zero text." The parallel-edit race had no accessible substitute in that workspace as of 2026-11-07 and is recorded here as unavailable at that date.
- Check `~/workspace/bawa-wallet/agent-g-android/NOTES.md` and `~/workspace/bawa-wallet/agent-g-android-api1/NOTES.md` for failure tallies, worker records and 2026-11-07 verification entries.

## Verified change inventory

The verified connector diff changed exactly four files, with 84 insertions and 7 deletions. These paths are relative to the repository root:

- `mcp-server/src/config.ts`
- `mcp-server/src/server.ts`
- `mcp-server/src/tools/jobs.ts`
- `mcp-server/src/upstream.ts`

At the 2026-11-06 check at approximately 21:15 UTC, those connector changes were still uncommitted.

Exclude the untracked `mcp-server/sol-work/` directory from the fix. The verified four-file diff (84 insertions, 7 deletions) covers only the 2026-11-06 repair and did not change `package.json`, `src/worker.ts` or either lane client. `src/worker.ts` is changed in the current tree by the later lint plus architecture passes merged on 2026-11-08. That merge changed 38 files (1144 insertions, 450 deletions) against HEAD `17ec298`, including `mcp-server/src/worker.ts` and the new `mcp-server/src/env.ts` and `mcp-server/src/sse.ts`; documentation updates since then add further changes.

Verify the source immediately after each serial edit. Build and inspect compiled code before making the next test call.

## Build and inspect

Confirm repository dependencies are available before building. In the verified workspace, `tsc` is present in `node_modules`, and the `package.json` build script runs `tsc`.

This is a build procedure using existing dependencies, not a verified dependency-installation procedure. If dependencies are missing, inspect `package.json`, any existing lockfile and repository setup instructions to establish and verify the installation command. No dependency-installation command is verified in this record.

Build from the MCP server directory and require a successful result:

```sh
cd "$HOME/workspace/agentrouter-connector/mcp-server"
npm run build
```

- During the 2026-11-06 fix verification in the authoring workspace on the Boxd virtual machine `muse-vm` (user home `/home/boxd`, workspace `/home/boxd/workspace`), the inspected `dist/src/server.js` had been built from the source in that workspace at that time and contained `readResponsesStream`. Inspect the relevant branches under `dist/src/` for:

- SSE assembly.
- `stream: true`.
- Cap and timeout configuration.
- Helper clamps.
- The fatal budget-exhaustion break.

Do not accept a single occurrence of `32000` as sufficient compiled-artifact verification.

## Run the correct process

Before replacing an owned worker, use `agentrouter_list_jobs` to list the saved jobs and record which are `running`.

Before testing rebuilt code, replace any old owned process and verify that it has exited before starting another. Use the worker-specific `SIGKILL` workaround only when required, and avoid duplicate workers.

For lane testing, use the lane client as described above rather than starting a separate server.

Start the server alone only when needed, from `~/workspace/agentrouter-connector/mcp-server` after building and populating its process environment. Run `node dist/src/server.js`.

Start the worker separately only when worker jobs are needed, from the same server directory after building and populating its process environment. The worker records its PID in `jobs/worker.pid`; the launcher guard in `worker/guard.sh` checks the PID with `kill -0`, a working-directory match and a command-line check for `dist/src/worker.js`. Use this PID-file check to verify whether an owned worker is already running before starting another with `node dist/src/worker.js`.

After starting the replacement worker, use `agentrouter_list_jobs` again and check the previously running jobs with `agentrouter_job_status`. The status tool reads saved status and error without calling the gateway.

At startup, the worker treats `running` jobs whose heartbeat is older than 120 s as stale:

- By default, it marks them `interrupted`, with an error saying their gateway generation state is unknown and they were not silently regenerated.
- If `AGENTROUTER_JOB_AUTO_RESUBMIT=1`, it re-queues those stale running jobs instead.

Do not assume that every previously running job was interrupted or re-queued. This startup handling applies only to stale running jobs.

An `interrupted` job never resumes silently. For every interrupted job, explicitly choose one of these actions:

- Use `agentrouter_resume_job` to re-queue that job for a fresh generation. Only interrupted or failed jobs can be resumed; completed and cancelled jobs cannot.
- Use `agentrouter_job_result` instead to read that job's saved partial text with status `interrupted`, never mixed with a later generation.
