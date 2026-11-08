# Verification report — 2026-10-03

## Source verification

The attached build record says the existing `custom.agentrouter` connector was live-tested on 2026-10-03:

- plain key-only request: `unauthorized client detected`;
- the same request with the three documented client headers reached key validation;
- `GET /v1/models` on `agentrouter.org` returned HTTP 200;
- a tiny `deepseek-v4-flash` chat completion returned HTTP 200;
- the source record reports `co.agentrouter.org` returned HTTP 401 `Invalid API Key!` for that specific key during its negative check.

## Current documentation cross-check

Current AgentRouter documentation has evolved beyond the endpoint used by the attached historical connector record. The current docs describe a capability-first Agentic API at `https://api.agentrouter.to/api/agentic-api`, a hosted MCP endpoint at `https://mcp.agentrouter.to`, and explicit capability tools such as `models_chat_complete_execute` and `models_list_execute`. The OpenAI-compatible/legacy surface should therefore be treated as a selectable compatibility surface, not silently substituted.

## Code verification performed in this environment

1. Python syntax check of `bin/ar_call.py` with `python3 -m py_compile` — pass.
2. TypeScript parser validation for every `src/**/*.ts`, `tests/**/*.ts`, and `scripts/**/*.ts` using the installed TypeScript parser — pass (`16` files).
3. JSON parse validation for `package.json` and `docs/mcp-client.example.json` — pass.
4. Secret-leak scan for common key formats across the project — pass.
5. Runtime logic checks for retry classification, fallback classification, model extraction, secret redaction, and semaphore initialization — pass.
6. URL composition test — pass.
7. Static source review found and fixed these issues:
   - MCP health tool now actually checks upstream reachability through the model catalog instead of claiming reachability from configuration alone.
   - connector-only fields `modelCandidates` and `allowFallback` are removed before upstream forwarding.
   - streaming requests are not retried, preventing duplicate/partial generations.
   - MCP batch successes now append usage metadata to the ledger.
   - upstream credential, connector credential, and MCP credential remain separate secrets.
   - Python secure-vault path continues to use `custom.agentrouter` + `dynamic_credentials` + `hsurr:*` surrogate credentials.

## Dependency/build limitation in this environment

A full `npm install` / `npm test` / `npm run build` could not be completed here because the environment has no access to the npm registry and no dependency cache. Running `tsc -p tsconfig.json --noEmit` therefore stops at the missing local Node type definitions. This is an environment limitation, not a reported source-code failure.

After cloning/deploying in a normal internet-connected Node 22+ environment, run:

```bash
npm install
npm run check
npm test
npm run build
```

Then perform the live AgentRouter catalog smoke and one tiny generation smoke described in `docs/PROCESS.md`.

## What could not be live-verified here

The execution environment does not have working DNS/network access to `agentrouter.org`/`co.agentrouter.org`, and the secure `custom.agentrouter` credential is not exposed to the local container. Therefore this environment could not repeat the user's live AgentRouter request against the connected account.

The historical live verification remains explicitly attributed to the attached build record rather than being presented as a new live test.

## Addendum — 2026-11-08: lint plus architecture verification

This addendum records the lint plus architecture verification state after both passes were merged into the working copy on 2026-11-08.

- Merged tree against HEAD `17ec298`: 38 files, 1144 insertions, 450 deletions.
- Lint phase 1 alone: 36 files, 1036 insertions, 355 deletions.

### Live verification on the merged tree

- `mcp-server`: `tsc` clean; build OK.
- Tool listing: 12 tools listed.
- Tiny probe: `The probe works.` — 16 characters in 2,989 ms.
- Compiled tests: 4/0.
- Smoke check: OK.
- Root `tsc`: 18 errors, all in the pre-existing missing-root-`node_modules` class (baseline 17 plus 1 explained `TS7006`); not a regression.

The gateway-fix skill's `scripts/verify.sh` on the merged tree reported `BEHAVIOURAL 20/0`, `PASS 74/5` and `AUDIT 0/2`.

The five failing `PASS` checks are the skill's textual pins on code moved by the lint and architecture passes: header literals to `env.ts`, clamps to `config.astraMaxTokens` and `astraMaxTokens()`, and the `tools/jobs.ts` cap. These are not behaviour failures; the docs pass updates those pins afterwards.

### Architecture changes verified live

- `tsconfig` has `strict` set to `true`.
- New modules: `mcp-server/src/env.ts` and `mcp-server/src/sse.ts`.
- Worker keys-only boot.
- `jobs/worker.pid` plus the guard PID-file check replace `pgrep`.
- Atomic job claims with a 120-second stale break plus a heartbeat sidecar.
- Deliberate behaviour change: `textTokens` equals output tokens minus reasoning tokens.
- `recordLedger` deleted.
- `joinUrl` exported and tested.
- One merge-time fix: `ensureJobsDir` before the `worker.pid` write.
