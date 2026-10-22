# BUILD REPORT — glue pass + build + live test (2026-10-23)

**Scope:** Orion-side glue only. Every design/code section remains GPT-6-Astra's verbatim output; the edits below are the minimal mechanical changes needed to compose her fragments into a buildable, runnable MCP server. No tool was renamed, no logic redesigned. Glue is marked in the sources with `[glue]` comments.

**Build gate:** `npm install` (registry reachable; @modelcontextprotocol/sdk 1.32.1, zod 3.25.76, typescript 5.9.3, @types/node 22.20.5) → `npx tsc` → **exit 0** (after one iteration; the single error and its fix are G-9 below). Entry point: `dist/src/server.js`; smoke script: `dist/smoke-test.js`.

---

## Glue changes (file:line, before → after, why)

### New files (Orion-authored scaffolding/glue, not Astra code)
- `package.json` — name `agentrouter-mcp`, `type: module`, scripts `build: tsc`, `start: node dist/src/server.js`, `smoke: node dist/smoke-test.js`; deps `@modelcontextprotocol/sdk`, `zod`; devDeps `typescript`, `@types/node`.
- `tsconfig.json` — target ES2022, module/resolution NodeNext, `strict: false` (Astra's fragments do not pass strict), outDir `dist`, rootDir `.`, includes `src/**` + `smoke-test.ts`.
- `.env.example` — `AGENTROUTER_KEY_1/2` placeholders + the per-model limit env vars Astra's config loader requires (canonical values from `config-schema.json`).
- `src/upstream.ts` — shared helpers Astra's fragments assume but never defined: `probe()` / `probeOnce()` (diagnostics, smoke-test), `appendLedger()` / `redact()` / `readLedgerTotals()` (batch, diagnostics), and `chatOnce()` — a prompt→response call using the same request shape as `src/server.ts` (Responses vs Anthropic Messages by model, two-key failover in config order on 401/402/503, local `ledger.jsonl` per S-05). This is the "shared request helper" the batch registration needed.
- `test-client.mjs` — raw JSON-RPC-over-stdio live test client (keys parsed from `~/workspace/.agentrouter-keys`, never printed). Results saved to `test-results.json`.

### G-1 — `src/server.ts` key source (known fix #4)
- Before (was lines 5–6): `const key = process.env.AGENTROUTER_API_KEY?.trim(); if (!key) throw …` — one key only.
- After (lines 13–16): `const keys = config.apiKeys;` from Astra's own config loader (`src/config.ts`, `AGENTROUTER_KEY_1`/`AGENTROUTER_KEY_2`).
- `request()` now loops the keys in config order and fails over on 401/402/503, throwing the last error if all keys fail. Why: reconcile the server with Astra's two-key config without inventing new policy — config order is her failover order.

### G-2 — `src/server.ts` User-Agent header
- Before: headers carried `Originator`/`Version` only. After (line 31): adds `"User-Agent": "codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464"`, completing the measured codex_cli_rs header set from the S-03 routing design.

### G-3 — `src/server.ts` tool wiring
- Before: the file registered only `agentrouter_list_models` + `agentrouter_chat`; Astra's recovered tool modules were never imported (they referenced a bare `server` and could not run).
- After (lines 4–11 imports, 93–97 calls): imports and calls `registerBatch(server)`, `registerHealth(server)`, `registerDiagnostics(server, keys)`, `registerConfigGen(server)` before connecting the stdio transport.

### G-4 — `src/tools/batch.ts` chatOnce + concurrency (known fix #1)
- Before: core signature `batchChat(tasks, chatOnce)` with pool size hard-coded `Math.min(8, tasks.length)`; the registration (fragment R-09b1c) called `batchChat(requests)` — missing `chatOnce`, and its `concurrency` input was dropped.
- After: `batchChat(tasks, chatOnce, concurrency = 8)` (line 18) and the pool uses `Math.min(concurrency, tasks.length)` (line 37); the registration is wrapped in `export function registerBatch(server)` (line 70) and calls `batchChat(requests as ChatTask[], chatOnce, concurrency ?? 8)` (line 85), with `chatOnce` imported from `src/upstream.ts`. The cast is needed because the SDK's schema inference types the zod array elements' fields as optional; the zod schema still validates them as required at runtime.

### G-5 — `src/tools/health.ts` key source (known fix #3)
- Before (fragment R-09b2b): keys parsed only from `AGENTROUTER_KEYS`, an env var nothing else in the project sets — the tool would always have probed zero keys.
- After (line 40): `config.apiKeys` (the config loader's `AGENTROUTER_KEY_1/2`) wins; the fragment's own `AGENTROUTER_KEYS` parsing is kept verbatim as a fallback. Registration wrapped in `registerHealth(server)` (line 48) to resolve the bare `server`.

### G-6 — `src/tools/diagnostics.ts` classifier call (known fix #2)
- Before: `classification: await classifyStatus(status)` — one argument for `classifyStatus(status, bodyText)`, so 401 subtypes could never be distinguished.
- After (line 49): `classification: classifyStatus(status, body)` — the probe's captured body text is passed (the body is what separates `auth-client` from `auth-token`).
- Also: `export` added to `classifyStatus` (line 15) so smoke-test can import it; imports for `probe`/`readLedgerTotals` added; registration wrapped in `registerDiagnostics(server, keys)` (line 65) resolving the bare `server`/`keys`; the optional `models` input falls back to the four configured models.

### G-7 — `src/tools/config-gen.ts` wired; duplicate renamed
- The two config-gen copies were byte-identical except a 3-line provenance header on `src/config-gen.ts`. Neither was wired. The `tools/` copy is now the wired one: `registerConfigGen(server)` appended (line 65) registers it as `agentrouter_generate_config` (S-01's `generate_config`). The unused copy was renamed to `src/config-gen.ts.unused` (nothing deleted).
- **Deliberately not invoked during live testing** — calling it rewrites the real `~/.codex/config.toml` and `~/.claude/settings.json`. Note this also differs from S-01's "generate without writing" design line; the recovered function writes files. Flagged, not changed.

### G-8 — `smoke-test.ts` composition
- Before: referenced undefined `probeOnce`, and `const kind = classifyStatus(status)` (wrong arity, and the classifier's `{kind, fix}` object assigned whole to `kind`).
- After: imports `probeOnce` (upstream), `classifyStatus` (diagnostics), `config`; line 16: `const kind = classifyStatus(status, "").kind;`. A standalone entry point was appended (`node dist/smoke-test.js` runs `smokeAll` on the configured keys and prints JSON).

### G-9 — Compile iteration
- First `tsc` run: one error, `src/tools/batch.ts` TS2345 (SDK-inferred optional fields vs `ChatTask[]`). Fixed by the cast in G-4. Second run: **exit 0**.

### Auth-header decision for `/messages` (known fix #4, second half)
- Astra's draft sends `Authorization: Bearer` for all paths, including `/messages` (URL `https://agentrouter.org/v1/messages` — base `/v1` + `/messages`, the correct Anthropic URL). Our historically measured Opus route used `x-api-key` + `anthropic-version`.
- **Live evidence (2026-10-23):** Opus chat via the server (Bearer) → 503 no-channel. Raw probe of the same model/key with `x-api-key` + `anthropic-version: 2023-06-01` → **identical 503 no-channel on both keys**. No 401 occurred in either variant, so this is not an auth failure and the deciding condition for switching did not occur. **Bearer kept, no change made.** If a future 401 appears on `/messages` only, revisit.

---

## Live test results (2026-10-23 ~02:26 IST, via test-client.mjs + standalone smoke script)

Server spawned from `dist/src/server.js` with both keys + config env; stdio JSON-RPC: initialize → tools/list → calls in order.

| Step | Outcome | Detail |
|---|---|---|
| initialize | ✅ | server `agentrouter` 1.0.0 |
| tools/list | ✅ | `agentrouter_list_models`, `agentrouter_chat`, `agentrouter_batch_chat`, `agentrouter_health`, `agentrouter_diagnose`, `agentrouter_generate_config` |
| `agentrouter_health` | ✅ 1,714 ms | both keys: `status 200, kind ok` (GET /v1/models per key) |
| `agentrouter_list_models` | ✅ 1,354 ms | 200; gateway's current list for key 1: `gpt-5.6-sol`, `gpt-6-astra`, `gpt-6.1-sol` — **DeepSeek and both Opus models are not listed at all right now** (the list is dynamic, per S-02) |
| `agentrouter_chat` gpt-6-astra | ✅ 5,083 ms (2,764 ms on first run) | answer `"ready"` (5 chars), Responses path, no reasoning field |
| `agentrouter_chat` deepseek-v4-flash | ❌ 503 **no-channel** (1,627 ms) | gateway: no available channel for the model in the account group — on **both** keys after failover. Channel state, not a build failure |
| `agentrouter_chat` claude-opus-5 | ❌ 503 **no-channel** (838 ms) | same, both keys, `/messages`. Identical result with `x-api-key` (see above) |
| `agentrouter_batch_chat` (2 tasks, concurrency 2) | ⚠️ tool OK, both items failed upstream (4,494 ms) | task 1 (gpt-6-astra): HTTP 502 `upstream error` — 502 is not in the failover set (401/402/503), and the registration calls `batchChat` directly, so Astra's `chatWithRetry` retry/ledger layer is not on this path; task 2 (deepseek): 503 no-channel. The batch engine itself (pool, ordering, per-item error capture) worked as designed |
| `agentrouter_diagnose` (default: 4 models × 2 keys) | ✅ 8,873 ms | gpt-6-astra: 200/`ok` on both keys. deepseek-v4-flash, claude-opus-5, claude-opus-4-8: 503/`no-channel` on both keys. Ledger totals returned (0 entries — see remaining issues) |
| `dist/smoke-test.js` standalone | ✅ exit 0 | gpt-6-astra 200/`ok` (7,659 ms); the other three 503/`no-channel`, correctly classified per model |

**Reading of the failures:** every failure is Astra-taxonomy **503 no-channel** (plus one transient 502), corroborated three independent ways — chat on both keys, diagnose probes on both keys, and the gateway's own `/v1/models` list omitting those models. This is upstream channel/pool state for these accounts today, not a build defect: the one model with a live channel (gpt-6-astra) passes end-to-end through chat, diagnose, and smoke.

## Remaining issues
1. **Upstream channels down for 3 of 4 models** (deepseek-v4-flash, claude-opus-5, claude-opus-4-8): 503 no-channel on both keys at test time. Nothing in the build can fix this; re-run the smoke script when the gateway restores channels.
2. **Batch path has no retry/ledger:** the registration uses `batchChat` directly; Astra's `chatWithRetry` (backoff + ledger append) is defined but unused, and 502 is outside the failover set — a transient 502 fails that task immediately. Wiring `chatWithRetry` around `chatOnce` is a design decision for Astra/the user, not glue.
3. **Ledger stays empty in practice:** because of (2), `appendLedger` is never called on the batch path, and the chat tool doesn't ledger either — `diagnose`'s ledger totals therefore read 0. Same design decision as (2).
4. **Smoke semantics:** `smokeAll` counts a model as "passed" when its probe merely doesn't throw (Astra's verbatim logic) — the per-model `value.ok` / `value.kind` fields carry the real verdict. Left as Astra wrote it.
5. **`agentrouter_generate_config` registered but untested by design** (it writes real client config files; see G-7). It also writes files although S-01's design said "generate without writing" — discrepancy is Astra's, flagged here.
6. **Startup env requirement:** importing Astra's config loader validates the per-model limit env vars on import, so the server will not start without them (see `.env.example`). This is Astra's "deployment-verified limits" design; the registration snippets below include them.

## Registration snippets (printed for the user — NOT installed; `~/.codex` and `~/.claude` were not modified)

### Codex CLI — add to `~/.codex/config.toml`
```toml
[mcp_servers.agentrouter]
command = "node"
args = ["/home/hatch/workspace/agentrouter-mcp-build/mcp-skeleton/dist/src/server.js"]
env = { AGENTROUTER_KEY_1 = "sk-...", AGENTROUTER_KEY_2 = "sk-...",
  AGENTROUTER_GPT_6_ASTRA_CONTEXT_TOKENS = "1050000", AGENTROUTER_GPT_6_ASTRA_EFFORT_MIN = "low", AGENTROUTER_GPT_6_ASTRA_EFFORT_MAX = "max",
  AGENTROUTER_DEEPSEEK_V4_FLASH_CONTEXT_TOKENS = "1048576", AGENTROUTER_DEEPSEEK_V4_FLASH_EFFORT_MIN = "none", AGENTROUTER_DEEPSEEK_V4_FLASH_EFFORT_MAX = "max",
  AGENTROUTER_CLAUDE_OPUS_5_CONTEXT_TOKENS = "1000000", AGENTROUTER_CLAUDE_OPUS_5_EFFORT_MIN = "low", AGENTROUTER_CLAUDE_OPUS_5_EFFORT_MAX = "max",
  AGENTROUTER_CLAUDE_OPUS_4_8_CONTEXT_TOKENS = "1000000", AGENTROUTER_CLAUDE_OPUS_4_8_EFFORT_MIN = "low", AGENTROUTER_CLAUDE_OPUS_4_8_EFFORT_MAX = "max" }
```

### Claude Code
```bash
claude mcp add agentrouter \
  -e AGENTROUTER_KEY_1=sk-... -e AGENTROUTER_KEY_2=sk-... \
  -e AGENTROUTER_GPT_6_ASTRA_CONTEXT_TOKENS=1050000 -e AGENTROUTER_GPT_6_ASTRA_EFFORT_MIN=low -e AGENTROUTER_GPT_6_ASTRA_EFFORT_MAX=max \
  -e AGENTROUTER_DEEPSEEK_V4_FLASH_CONTEXT_TOKENS=1048576 -e AGENTROUTER_DEEPSEEK_V4_FLASH_EFFORT_MIN=none -e AGENTROUTER_DEEPSEEK_V4_FLASH_EFFORT_MAX=max \
  -e AGENTROUTER_CLAUDE_OPUS_5_CONTEXT_TOKENS=1000000 -e AGENTROUTER_CLAUDE_OPUS_5_EFFORT_MIN=low -e AGENTROUTER_CLAUDE_OPUS_5_EFFORT_MAX=max \
  -e AGENTROUTER_CLAUDE_OPUS_4_8_CONTEXT_TOKENS=1000000 -e AGENTROUTER_CLAUDE_OPUS_4_8_EFFORT_MIN=low -e AGENTROUTER_CLAUDE_OPUS_4_8_EFFORT_MAX=max \
  -- node /home/hatch/workspace/agentrouter-mcp-build/mcp-skeleton/dist/src/server.js
```
