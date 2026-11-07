# Repository and evidence map

## Repository and implementation

Work in `~/workspace/agentrouter-connector/mcp-server`, inside repository `Pr3eve6ti2o/agentrouter-connector`. Do not assume the local streaming fix exists remotely.

Implementation paths below are relative to the MCP server root.

- Find `package.json` at the root.
- Read `src/server.ts` for request handling.
- Read `src/config.ts` for configuration.
- Read `src/upstream.ts` for upstream requests.
- Read the existing worker in `src/worker.ts` and job tools in `src/tools/jobs.ts`.
- Inspect compiled output under `dist/src/`.

## Lane clients

Use these callers to exercise the rebuilt server:

- `~/workspace/bawa-wallet/agent-g-android/mcp-chat.mjs`
- `~/workspace/bawa-wallet/agent-g-android-api1/mcp-chat.mjs`

Run a lane call from its configured lane directory after rebuilding. The lane client spawns the MCP server itself as a stdio subprocess, so no separate server start is needed.

## Evidence logs and ledgers

- Inspect recorded worker artefacts under `jobs/` at the MCP server root.
- `~/MEMORY.md` is a historical reference, unavailable on this machine because the file does not exist here. The 2026-11-06 stop-and-fix entry has no accessible substitute on this machine and is recorded here as unavailable. For the 2026-11-07 fix-verified entry, the checked api2 lane notes at `~/workspace/bawa-wallet/agent-g-android/NOTES.md` record "Fix test (Orion, direct streamed fetch, 95-word B1a2a prompt, max_output_tokens 32000): status completed, 9,759 chars, 442s (past the cut window), usage output 18,994 / reasoning 16,536". They also record "MCP server fix applied (local, unpushed): server.ts agentrouter_chat now streams Responses + 32k clamp, config defaults 32k cap / 20-min timeout, jobs clamp 32k; both mcp-chat.mjs clients pass 32000." The checked api1 lane notes at `~/workspace/bawa-wallet/agent-g-android-api1/NOTES.md` record the fixed-server landings: "F 26,319 characters (ledger 2026-11-06T20:31:51Z, 514,445 ms), G 16,871 characters (ledger 2026-11-06T21:13:28Z, 501,435 ms), H 34,514 characters, I 24,474 characters, J 22,375 characters, K 18,222 characters". All were verified first-hand, with no gateway failures since the fix.
- `~/AGENTS.md` is a historical reference, unavailable on this machine because the file does not exist here. The checked api2 lane notes at `~/workspace/bawa-wallet/agent-g-android/NOTES.md` supply the two-error diagnosis: "(A) idle transport cut ~291s on non-streamed calls; (B) reasoning starvation" and "worker receipts proved f21e08cc burned 16,000/16,000 reasoning tokens with zero text." The parallel-edit race has no accessible substitute on this machine and is recorded here as unavailable.
- Check `~/workspace/bawa-wallet/agent-g-android/NOTES.md` and `~/workspace/bawa-wallet/agent-g-android-api1/NOTES.md` for failure tallies, worker records and 2026-11-07 verification entries.

## Verified change inventory

The verified connector diff changed exactly four files, with 84 insertions and 7 deletions. These paths are relative to the repository root:

- `mcp-server/src/config.ts`
- `mcp-server/src/server.ts`
- `mcp-server/src/tools/jobs.ts`
- `mcp-server/src/upstream.ts`

At the 2026-11-06 check at approximately 21:15 UTC, those connector changes were still uncommitted.

Exclude the untracked `mcp-server/sol-work/` directory from the fix. Do not label `package.json`, `src/worker.ts` or either lane client as changed by the verified four-file diff.

Verify the source immediately after each serial edit. Build and inspect compiled code before making the next test call.

## Build and inspect

Confirm repository dependencies are available before building. In the verified workspace, `tsc` is present in `node_modules`, and the `package.json` build script runs `tsc`.

This is a build procedure using existing dependencies, not a verified dependency-installation procedure. If dependencies are missing, inspect `package.json`, any existing lockfile and repository setup instructions to establish and verify the installation command. No dependency-installation command is verified in this record.

Build from the MCP server directory and require a successful result:

```sh
cd "$HOME/workspace/agentrouter-connector/mcp-server"
npm run build
```

The verified `dist/src/server.js` was built from the current source and contains `readResponsesStream`. Inspect the relevant branches under `dist/src/` for:

- SSE assembly.
- `stream: true`.
- Cap and timeout configuration.
- Helper clamps.
- The fatal budget-exhaustion break.

Do not accept a single occurrence of `32000` as sufficient compiled-artifact verification.

## Run the correct process

Before testing rebuilt code, replace any old owned process and verify that it has exited. Use the worker-specific `SIGKILL` workaround only when required, and avoid duplicate workers.

For lane testing, use the lane client as described above rather than starting a separate server.

Start the server alone only when needed, from `~/workspace/agentrouter-connector/mcp-server` after building and populating its process environment:

```sh
node dist/src/server.js
```

Start the worker separately only when worker jobs are needed, from the same server directory after building and populating its process environment. Verify whether an owned worker is already running before starting another:

```sh
node dist/src/worker.js
```