# The Perfect AgentRouter MCP — Design + Code

**Written by GPT-6-Astra via AgentRouter, both APIs** (API 1 and API 2), 2026-10-22. Every section below is Astra's verbatim output, saved per call under `astra/` (recovered sections under `astra/parts/`). Only this framing and the section headings are the coordinator's. Input facts given to Astra: the verified terminal/model routing research, the scraped awesome-mcp-servers notes (SCRAPE-NOTES.md), and our existing connector inventory.

Production notes (coordinator): v1 open-ended prompts burned 100% of the token cap on hidden reasoning (0 chars, both keys). The landing config was micro-prompts (<=~680 chars, strictly bounded output). Four code sub-parts (batch tool, health tool, diagnostics tool, smoke test) never landed in the 2026-10-22 run despite 20+ attempts each (later receipts show that window ended in HTTP 402 budget-pool exhaustion). RETRY 2026-10-23: in a fresh window, with both keys probing HTTP 200, ALL missing parts landed on the first attempt each — batch (3 sub-parts), health (2), diagnostics (3), smoke test (2), the truncated S-08b config-loader tail, and a redo of the S-02b JSON with real canonical values instead of null placeholders. Recovered text is marked "Recovered 2026-10-23" inside S-02/S-08/S-09/S-10 with per-part API and attempt counts; the per-call receipts are in astra/parts/R-*.md.

---

# S-01 — Architecture

- Model: gpt-6-astra via https://agentrouter.org/v1/responses (API 1)
- max_output_tokens: 6400
- Attempts: full: chars=1758 usage={"input_tokens": 147, "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0}, "output_tokens": 3402, "output_tokens_details": {"reasoning_tokens": 2973}, "total_tokens": 3549}
- Usage (final): {"input_tokens": 147, "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0}, "output_tokens": 3402, "output_tokens_details": {"reasoning_tokens": 2973}, "total_tokens": 3549}

## Prompt used

You design an MCP server (TypeScript) for AgentRouter models in terminals. Models: gpt-6-astra + deepseek-v4-flash (Responses API, https://agentrouter.org/v1, Codex CLI); claude-opus-5 + claude-opus-4-8 (Anthropic Messages, https://agentrouter.org NO /v1, Claude Code). Reply ONLY: max 120 words prose + markdown table max 12 rows: Tool | Purpose | Inputs/Outputs. Reuse existing tools health/list_models/chat/batch_chat and ledger/semaphore/router/retry/redact modules. Tools must also cover diagnostics, config generation, smoke tests. Write immediately.

## Astra's answer (verbatim)

Implement a TypeScript stdio MCP server using `@modelcontextprotocol/sdk` and validated schemas. Route `gpt-6-astra` and `deepseek-v4-flash` through Responses, base `https://agentrouter.org/v1`, for Codex CLI. Route `claude-opus-5` and `claude-opus-4-8` through Anthropic Messages, base `https://agentrouter.org` **without a `/v1` suffix**, for Claude Code. Preserve existing tools. Reuse `router` for dispatch, `semaphore` for concurrency, `retry` for bounded transient retries honoring Retry-After, `ledger` for attempts/usage, and `redact` for outputs/logs. Read credentials from environment variables. Reserve stdout for MCP; log to stderr. Never silently substitute models. Generate configuration without writing files; require explicit opt-in for paid probes.

| Tool | Purpose | Inputs/Outputs |
|---|---|---|
| `health` | Local readiness | `{}` → version, credential-presence flags, module status |
| `list_models` | Expose configured routes | `{}` → models, protocols, bases, CLIs, verification state; initially unverified |
| `chat` | Single native-API request | `model, messages, limits?` → normalized content, usage, latency, request ID |
| `batch_chat` | Reuse `chat` with bounded concurrency | `requests[], concurrency?` → ordered per-item results/errors |
| `diagnose` | Check configuration, DNS/TLS, authentication, routing | `client?, config?, network=false` → redacted findings and fixes |
| `generate_config` | Generate terminal-client setup | `client, model, key_env` → Codex TOML or Claude Code settings JSON, plus shell environment bindings; no embedded secrets |
| `smoke_test` | Verify actual model/protocol compatibility | `models[], allow_paid=false, token_cap` → plan; when authorized, per-model pass/fail, usage, latency, errors |

---

# S-02 — Config schema (recovered in 2 parts)

- Model: gpt-6-astra via https://agentrouter.org/v1/responses (both APIs; per-part provenance in each part file under astra/parts/)

## Part 02a — Astra's answer (verbatim)

| Model | API | Terminal | Effort range | Context | Subagent cap |
|---|---|---|---|---|---|
| gpt-6-astra | Responses | Codex | low-max | 1050000 | user-set no ceiling |
| deepseek-v4-flash | Responses | Codex | none/low/high/max | 1048576 | user-set |
| claude-opus-5 | Anthropic Messages | Claude Code | low-max via `CLAUDE_CODE_EFFORT_LEVEL` | 1M | default 20 / workflows 256 |
| claude-opus-4-8 | Anthropic Messages | Claude Code | low-max via `CLAUDE_CODE_EFFORT_LEVEL` | 1M | default 20 / workflows 256 |
## Part 02b — Astra's answer (verbatim)

```json
{
  "_notice": "Unverified template, not canonical: AgentRouter MCP schema and model capabilities are unverified. API values are illustrative placeholders; null denotes unknown.",
  "keys": {
    "key1": "AGENTROUTER_KEY1",
    "key2": "AGENTROUTER_KEY2"
  },
  "models": {
    "gpt-6-astra": {"api": "responses", "terminal": null, "effort": null, "context": null},
    "deepseek-v4-flash": {"api": "responses", "terminal": null, "effort": null, "context": null},
    "claude-opus-5": {"api": "anthropic", "terminal": null, "effort": null, "context": null},
    "claude-opus-4-8": {"api": "anthropic", "terminal": null, "effort": null, "context": null}
  },
  "caps": {
    "maxConcurrency": 8,
    "maxBatchTasks": 32
  }
}
```

## Part 02b — REDO, Recovered 2026-10-23 (Astra, verbatim; API 2, 1 attempt)

Re-asked with the canonical values from the Part 02a table in the prompt; this time Astra emitted real values (no nulls, no _notice):

```json
{
  "keys": {
    "key1": "AGENTROUTER_KEY_1",
    "key2": "AGENTROUTER_KEY_2"
  },
  "models": {
    "gpt-6-astra": {"api": "responses", "base": "https://agentrouter.org/v1", "terminal": "Codex", "effort": "max", "context": 1050000},
    "deepseek-v4-flash": {"api": "responses", "base": "https://agentrouter.org/v1", "terminal": "Codex", "effort": "max", "context": 1048576},
    "claude-opus-5": {"api": "anthropic", "base": "https://agentrouter.org", "terminal": "Claude Code", "effort": "max", "context": 1000000},
    "claude-opus-4-8": {"api": "anthropic", "base": "https://agentrouter.org", "terminal": "Claude Code", "effort": "max", "context": 1000000}
  },
  "caps": {"maxConcurrency": 8, "maxBatchTasks": 32}
}
```

---
# S-03 — Routing engine

- Model: gpt-6-astra via https://agentrouter.org/v1/responses (API 1)
- max_output_tokens: 6400
- Attempts: full: chars=2023 usage={"input_tokens": 187, "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0}, "output_tokens": 5094, "output_tokens_details": {"reasoning_tokens": 4591}, "total_tokens": 5281}
- Usage (final): {"input_tokens": 187, "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0}, "output_tokens": 5094, "output_tokens_details": {"reasoning_tokens": 4591}, "total_tokens": 5281}

## Prompt used

You design an MCP server (TypeScript) for AgentRouter models in terminals. Models: gpt-6-astra + deepseek-v4-flash (Responses API, https://agentrouter.org/v1, Codex CLI); claude-opus-5 + claude-opus-4-8 (Anthropic Messages, https://agentrouter.org NO /v1, Claude Code). Facts: without codex_cli_rs headers (Originator: codex_cli_rs, Version: 0.101.0, matching User-Agent) AgentRouter returns 401 unauthorized client - a client check, not a dead key. DeepSeek tools+thinking: pass reasoning_content back or HTTP 400. Reply ONLY: max 180 words prose + table max 6 rows covering per-model wire routing, header set, streaming passthrough, tool-calling passthrough, reasoning_content rule.

## Astra's answer (verbatim)

Use a TypeScript stdio MCP server with explicit per-model adapters. Preserve `tools`, `tool_choice`, IDs, extension fields and continuation state; never substitute Chat Completions. Parse SSE incrementally and relay events through client-supported MCP notifications, buffering when unsupported; return a final tool result. MCP itself is not a raw SSE tunnel.

Both adapters send `Content-Type: application/json`.

**R headers:** `Authorization: Bearer $KEY`; `Originator: codex_cli_rs`; `Version: 0.101.0`; `User-Agent: codex_cli_rs/0.101.0`.

**A headers:** configured Claude Code authentication (`Authorization: Bearer $KEY` or `x-api-key: $KEY`); `anthropic-version: 2023-06-01`; preserve native client/beta headers.

Configure Anthropic’s base **without `/v1`**; let its SDK construct the Messages path. A `401 unauthorized client` indicates client-header rejection, not a dead key.

| Model | Wire routing | Headers | Streaming passthrough | Tool-calling passthrough | `reasoning_content` rule |
|---|---|---|---|---|---|
| `gpt-6-astra` | Codex CLI; Responses `https://agentrouter.org/v1/responses` | R | `stream:true`; native Responses events | `function_call` / `function_call_output`; preserve `call_id` | Not required; preserve native reasoning items |
| `deepseek-v4-flash` | Codex CLI; Responses `https://agentrouter.org/v1/responses` | R | `stream:true`; preserve extension payloads | Native Responses calls/results and IDs | Tools + thinking: retain and resend unchanged on continuation; omission → HTTP 400 |
| `claude-opus-5` | Claude Code; Anthropic Messages; base `https://agentrouter.org` | A | `stream:true`; native Messages events | `tool_use` / `tool_result`; preserve linked IDs | Not an Anthropic field; preserve native thinking blocks/signatures |
| `claude-opus-4-8` | Claude Code; Anthropic Messages; base `https://agentrouter.org` | A | `stream:true`; native Messages events | `tool_use` / `tool_result`; preserve linked IDs | Not an Anthropic field; preserve native thinking blocks/signatures |

---

# S-04 — Multi-key failover + pool health

- Model: gpt-6-astra via https://agentrouter.org/v1/responses (API 2)
- max_output_tokens: 6400
- Attempts: full: chars=1202 usage={"input_tokens": 110, "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0}, "output_tokens": 3889, "output_tokens_details": {"reasoning_tokens": 3619}, "total_tokens": 3999}
- Usage (final): {"input_tokens": 110, "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0}, "output_tokens": 3889, "output_tokens_details": {"reasoning_tokens": 3619}, "total_tokens": 3999}

## Prompt used

Context: AgentRouter MCP, TWO keys (different accounts); budget pools exhaust independently, route to the healthy pool; Key 2 historically faster. Backup host ps.air-outer.com works with codex_cli_rs headers; co.agentrouter.org does NOT work. Reply ONLY: max 180 words prose + table max 7 rows: Signal/state | Action - covering failover, 402 pool handling, circuit breaker, backoff, and telling 401-client vs 401-token vs 503 vs 429 apart.

## Astra's answer (verbatim)

Prefer healthy Key 2 (historically faster); track both account pools independently. For host failures, use `ps.air-outer.com` with known-working `codex_cli_rs` headers; exclude `co.agentrouter.org`. Distinguish 401 causes using error codes/body, not status alone. Retry only replay-safe requests.

| Signal/state | Action |
|---|---|
| 401-client: client/header rejected | Fix client compatibility/headers; don’t rotate credentials blindly. |
| 401-token: invalid/expired/revoked token | Disable that key until repaired/replaced; use the other healthy key. |
| 402: pool exhausted | Mark that account pool unavailable across hosts until replenishment/reset. Use the other pool; both exhausted → fail fast. |
| 429: rate limited | Cool down the affected scope; honor `Retry-After`, otherwise use capped exponential backoff with jitter. Switch only to an independently eligible pool. |
| 503: unavailable; transport failure | Bounded retries with jitter; fail over to a healthy endpoint/pool. Don’t infer exhausted budget. |
| Circuit breaker | Isolate the affected host/pool/key. Repeated transient failures open it; after cooldown, allow one half-open probe. Success closes; failure extends cooldown. |

---

# S-05 — Account diagnostics

- Model: gpt-6-astra via https://agentrouter.org/v1/responses (API 1)
- max_output_tokens: 6400
- Attempts: full: chars=1165 usage={"input_tokens": 127, "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0}, "output_tokens": 3382, "output_tokens_details": {"reasoning_tokens": 3106}, "total_tokens": 3509}
- Usage (final): {"input_tokens": 127, "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0}, "output_tokens": 3382, "output_tokens_details": {"reasoning_tokens": 3106}, "total_tokens": 3509}

## Prompt used

Context: AgentRouter MCP diagnostics must be HONEST: measured, GET /v1/models works; /v1/balance /v1/usage /v1/me /v1/credits all 404 - NO quota API exists. Diagnostics = tiny probes per key x model + error taxonomy + local ledger (ledger.jsonl). Reply ONLY: max 150 words prose + table max 7 rows: Error | Meaning | Next action - for 401-client, 401-token, 402-pool, 503-no-channel, 400, 429, 200. Invent NO endpoints.

## Astra's answer (verbatim)

Per your measurements, `GET /v1/models` works; `/v1/balance`, `/v1/usage`, `/v1/me`, and `/v1/credits` return 404. No quota API exists.

Use tiny, bounded probes per key × model. Assign subtypes from explicit error details—not status alone; preserve ambiguity. Append timestamp, nonsecret key ID, model, status, redacted error, latency, and reported tokens to `ledger.jsonl`. This records local activity, not authoritative quota or remaining balance. Model listing alone does not prove inference access.

| Error | Meaning | Next action |
|---|---|---|
| 401-client | Caller authentication rejected | Check client key/auth header. |
| 401-token | Explicit token-validation failure | Repair affected token; escalate if upstream. |
| 402-pool | Reported shared-pool credit exhaustion | Contact operator; don’t infer per-key balance. |
| 503-no-channel | No usable channel for requested model | Check routing/availability; retry later. |
| 400 | Invalid or unsupported request | Correct payload using error details. |
| 429 | Throttling | Back off; honor supplied `Retry-After`. |
| 200 | Probe succeeded at that moment | Record outcome/usage; quota remains unknown. |

---

# S-06 — Subagent/batch engine

- Model: gpt-6-astra via https://agentrouter.org/v1/responses (API 2)
- max_output_tokens: 6400
- Attempts: full: chars=1177 usage={"input_tokens": 114, "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0}, "output_tokens": 3868, "output_tokens_details": {"reasoning_tokens": 3624}, "total_tokens": 3982}
- Usage (final): {"input_tokens": 114, "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0}, "output_tokens": 3868, "output_tokens_details": {"reasoning_tokens": 3624}, "total_tokens": 3982}

## Prompt used

Context: AgentRouter MCP batch engine. Caps: our connector MAX_CONCURRENCY=8, MAX_BATCH_TASKS=32; Codex subagent concurrency user-set, no published ceiling; Claude Code default 20 raisable, workflows max 256, 1000 agents/run. Our Python runner: atomic per-task saves, progress file, resume, spend caps. Reply ONLY: max 180 words prose + table max 6 rows: Design choice | Decision | Why - including keep-or-raise verdict on 8/32.

## Astra's answer (verbatim)

Scale queue depth independently from concurrency. Reuse your Python runner as the execution core; competitor workflow and run totals are not safe concurrency benchmarks. Treat 256 as a pilot queue limit, not a validated ceiling.

| Design choice | Decision | Why |
|---|---|---|
| Concurrency: 8 | **Keep 8 initially**; allow benchmark-gated, configurable increases. | Provider quotas, latency, and in-flight spend determine useful parallelism. |
| Batch tasks: 32 | **Raise 32 → 256 queued tasks**, conditional on durable asynchronous submission. | Larger batches need not increase simultaneous execution; retain 32 while calls remain synchronous. |
| MCP interface | Thin submit/status/results/cancel API over the runner; return job IDs and paginated results. | Avoid duplicate schedulers, request timeouts, and oversized responses. |
| Recovery | Preserve atomic task saves, progress, and resume; add stable job/task IDs. | Skip confirmed completions and recover interrupted jobs reliably. |
| Global safeguards | Shared concurrency budget, bounded rate-aware retries, and in-flight spend reservations. | Multiple batches and retries must not bypass worker or cost limits. |

---

# S-07 — Borrow from awesome-mcp-servers

- Model: gpt-6-astra via https://agentrouter.org/v1/responses (API 1)
- max_output_tokens: 3200
- Attempts: full: chars=1046 usage={"input_tokens": 150, "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0}, "output_tokens": 2213, "output_tokens_details": {"reasoning_tokens": 1989}, "total_tokens": 2363}
- Usage (final): {"input_tokens": 150, "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0}, "output_tokens": 2213, "output_tokens_details": {"reasoning_tokens": 1989}, "total_tokens": 2363}

## Prompt used

Context: scraped punkpeye/awesome-mcp-servers README. In the list: TaskMaster (PRD->task graph). NOT in current list (grep-verified): Ruflo/claude-flow, PAL/zen-mcp, Sequential Thinking. Coding Agents finds: bernstein (orchestrator, worktrees, cost routing), forge (validated DAG, parallel worktrees), tirith (TTL file claims, task board), llm-bus (claims, leases, shared ledger), magents (session bus), claude-concilium (cross-CLI parallel review, fallback chains). Reply ONLY: table max 10 rows: Source | Borrow or skip | Why. For an AgentRouter MCP.

## Astra's answer (verbatim)

| Source | Borrow or skip | Why |
|---|---|---|
| bernstein | Borrow | Cost-aware routing and isolated worktrees directly fit AgentRouter’s dispatch responsibilities. |
| forge | Borrow | Validate task DAGs before dispatch; execute independent tasks in parallel worktrees. |
| tirith | Borrow | TTL file claims reduce conflicting edits; task-board state exposes ownership and progress. |
| llm-bus | Borrow | Task claims, leases, and a shared ledger support recoverable coordination and explicit ownership. |
| magents | Borrow selectively | Use the session bus for status/results; avoid creating a second authority for task ownership. |
| claude-concilium | Borrow | Cross-CLI parallel review and fallback chains provide useful multi-agent dispatch patterns. |
| TaskMaster | Borrow selectively | Consume planner-produced task graphs; keep PRD decomposition outside AgentRouter. |
| Ruflo/claude-flow; PAL/zen-mcp; Sequential Thinking | Skip here | Absent from the supplied grep-verified list. Evaluate separately—not as README-backed sources. |

---

# S-08 — Code 1: skeleton (recovered in 2 parts)

- Model: gpt-6-astra via https://agentrouter.org/v1/responses (both APIs; per-part provenance in each part file under astra/parts/)

## Part 08a — Astra's answer (verbatim)

.
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts
│   ├── config.ts
│   ├── router.ts
│   ├── upstream/
│   │   ├── responses.ts
│   │   └── anthropic.ts
│   ├── tools/
│   │   └── {chat,batch,health,diagnostics,config-gen,smoke}.ts
│   ├── ledger.ts
│   ├── semaphore.ts
│   ├── retry.ts
│   ├── redact.ts
│   ├── errors.ts
│   └── types.ts
├── tests/
└── README.md
## Part 08b — Astra's answer (verbatim)

```typescript
/* package.json (save this file as config.ts)
{
  "name": "agentrouter-mcp-config",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/config.js",
  "types": "./dist/config.d.ts",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc --strict --target ES2022 --module NodeNext --declaration --outDir dist config.ts"
  },
  "devDependencies": { "@types/node": "^22.0.0", "typescript": "^5.7.0" }
}
*/
import { env } from "node:process";

export const caps = Object.freeze({
  maxConcurrency: 8,
  maxBatchTasks: 32,
} as const);

type Api = "responses" | "anthropic";

// Require deployment-verified limits rather than inventing model specifications.
// For each prefix below, set _CONTEXT_TOKENS, _EFFORT_MIN, and _EFFORT_MAX.
// Context is measured in tokens; effort endpoints are provider-defined labels.
export function loadConfig(source: NodeJS.ProcessEnv = env) {
  const required = (name: string): string => {
    const value = source[name]?.trim();
    if (!value) throw new Error(`Missing environment variable: ${name}`);
    return value;
  };

  const apiKeys = [...new Set(
    [source.AGENTROUTER_KEY_1, source.AGENTROUTER_KEY_2]
      .map(key => key?.trim()).filter((key): key is string => !!key)
  )];
  if (!apiKeys.length)
    throw new Error("Set AGENTROUTER_KEY_1 and/or AGENTROUTER_KEY_2");

  const model = <A extends Api>(api: A, prefix: string) => {
    const name = `${prefix}_CONTEXT_TOKENS`;
    const raw = required(name);
    const context = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(context))
      throw new Error(`${name} must be a positive safe integer`);
    return Object.freeze({
      api, context,
      effortRange: Object.freeze({
        min: required(`${prefix}_EFFORT_MIN`),
        max: required(`${prefix}_EFFORT_MAX`),
      }),
    });
  };

  const models = Object.freeze({
    "gpt-6-astra": model("responses", "AGENTROUTER_GPT_6_ASTRA"),
    "deepseek-v4-flash": model("responses", "AGENTROUTER_DEEPSEEK_V4_FLASH"),
    "claude-opus-5": model("anthropic", "AGENTROUTER_CLAUDE_OPUS_5"),
    "claude-opus-4-8": model("anthropic", "AGENTROUTER_CLAUDE_OPUS_4_8"),
  });
  return Object.freeze({ apiKeys: Object.freeze(apiKeys), models, caps });
}

// Validate on import. Never log this credential-bearing object to MCP stdout.
export const config = loadConfig();
export const MODELS = config.models;
export type ModelId = keyof typeof MODELS;
export

## Part 08b tail — Recovered 2026-10-23 (Astra, verbatim; API 1, 1 attempt)

Astra's completion of the truncated final export in Part 08b above (whose fence was left unclosed as received). Joined to the trailing `export` line it forms `export type Config = ReturnType<typeof loadConfig>;`:

```typescript
type Config = ReturnType<typeof loadConfig>;
```

---
# S-09 — Code 2: core server (recovered in parts)

- Model: gpt-6-astra via https://agentrouter.org/v1/responses (both APIs; per-part provenance in astra/parts/)

## Part 09a — Astra's answer (verbatim)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const key = process.env.AGENTROUTER_API_KEY?.trim();
if (!key) throw new Error("Set AGENTROUTER_API_KEY");
const base = "https://agentrouter.org/v1";
const server = new McpServer({ name: "agentrouter", version: "1.0.0" });

async function request(
  path: "/models" | "/responses" | "/messages",
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Originator: "codex_cli_rs",
      Version: "0.101.0",
      "Content-Type": "application/json",
      ...(path === "/messages" ? { "anthropic-version": "2023-06-01" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await response.text();
  if (!response.ok)
    throw new Error(`AgentRouter ${path} (${response.status}): ${raw.slice(0, 2048)}`);
  try { return JSON.parse(raw); }
  catch { throw new Error("AgentRouter returned invalid JSON"); }
}

async function asTool(work: () => Promise<unknown>) {
  try {
    const data = await work();
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      }],
    };
  }
}

server.registerTool("agentrouter_list_models", {
  description: "List available AgentRouter models; returns the upstream JSON.",
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, () => asTool(() => request("/models")));

server.registerTool("agentrouter_chat", {
  description: "Chat: Claude models use Anthropic Messages; others use Responses. Returns JSON.",
  inputSchema: {
    model: z.string().min(1),
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    })).min(1),
    system: z.string().optional(),
    max_tokens: z.number().int().positive().default(4096),
  },
}, ({ model, messages, system, max_tokens }) => {
  const anthropic = /claude/i.test(model);
  const body = anthropic
    ? { model, messages, system, max_tokens, stream: false }
    : {
        model, input: messages, instructions: system,
        max_output_tokens: max_tokens, store: false, stream: false,
      };
  return asTool(() => request(anthropic ? "/messages" : "/responses", body));
});

await server.connect(new StdioServerTransport());
```

## Part 09b1 — Recovered 2026-10-23 (Astra, verbatim, in 3 sub-parts)

### R-09b1a — batchChat core (worker-pool limiter, max 8 concurrent, max 32 tasks, ordered results) (API 1, 1 attempt)

```typescript
type ChatTask = { model: string; prompt: string };
type ChatResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

async function batchChat<T>(
  tasks: ChatTask[],
  chatOnce: (task: ChatTask) => Promise<T>
): Promise<ChatResult<T>[]> {
  if (tasks.length > 32) throw new RangeError("At most 32 tasks are allowed");
  const results = new Array<ChatResult<T>>(tasks.length);
  let next = 0;

  // A fixed worker pool limits concurrency to eight calls.
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await chatOnce(tasks[i]!) };
      } catch (error) {
        results[i] = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(8, tasks.length) }, () => worker()));
  return results;
}
```

### R-09b1b — chatWithRetry (backoff + jitter, ledger append, redacted errors) (API 2, 1 attempt)

```typescript
async function chatWithRetry<T, R extends { model: string; tokens: number }>(
  task: T,
  chatOnce: (task: T) => Promise<R>
): Promise<R | string> {
  let lastError: unknown;
  for (let n = 0; n < 3; n++) {
    try {
      const result = await chatOnce(task);
      await appendLedger({ model: result.model, tokens: result.tokens });
      return result;
    } catch (error: unknown) {
      lastError = error;
      if (n < 2) {
        await new Promise<void>(resolve =>
          setTimeout(resolve, 250 * 2 ** n + Math.floor(Math.random() * 250))
        );
      }
    }
  }
  return redact(lastError instanceof Error ? lastError.message : String(lastError));
}
```

### R-09b1c — agentrouter_batch_chat MCP registration (API 1, 1 attempt)

```typescript
import { z } from "zod";

server.registerTool(
  "agentrouter_batch_chat",
  {
    inputSchema: {
      requests: z
        .array(z.object({ model: z.string(), prompt: z.string() }))
        .max(32),
      concurrency: z.number().int().min(1).max(8).optional(),
    },
  },
  async ({ requests }) => {
    const result = await batchChat(requests);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  },
);
```

## Part 09b2 — Recovered 2026-10-23 (Astra, verbatim, in 2 sub-parts)

### R-09b2a — health() — GET /v1/models per key, status classification (API 2, 1 attempt)

```typescript
async function health(keys: readonly string[]) {
  return Promise.all(keys.map(async (key, keyIndex) => {
    try {
      const response = await fetch("https://agentrouter.org/v1/models", {
        method: "GET",
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${key}`,
          Originator: "codex_cli_rs",
          Version: "0.101.0",
        },
        signal: AbortSignal.timeout(15_000),
      });
      const status = response.status;
      await response.body?.cancel().catch(() => {});
      const kind =
        status === 200 ? "ok" :
        status === 401 ? "client-or-token" :
        status === 402 ? "pool" :
        status === 503 ? "no-channel" : "error";
      return { keyIndex, ok: status === 200, status, kind };
    } catch {
      return { keyIndex, ok: false, status: 0, kind: "error" };
    }
  }));
}
```

### R-09b2b — agentrouter_health MCP registration (API 1, 1 attempt)

```typescript
const keys = (process.env.AGENTROUTER_KEYS ?? "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

server.registerTool("agentrouter_health", { inputSchema: {} }, async () => {
  try {
    const result = await health(keys);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    };
  }
});
```

---
# S-10 — Code 3 + gaps (recovered in parts)

- Model: gpt-6-astra via https://agentrouter.org/v1/responses (both APIs; per-part provenance in astra/parts/)

## Part 10a1 — Recovered 2026-10-23 (Astra, verbatim, in 3 sub-parts)

### R-10a1a — classifyStatus() — error taxonomy 200/401-client/401-token/402/400/429/503 (API 2, 1 attempt)

```typescript
type StatusKind =
  | "ok" | "auth-client" | "auth-token" | "pool-exhausted"
  | "bad-request" | "rate-limited" | "no-channel" | "unknown";

function classifyStatus(status: number, bodyText: string): { kind: StatusKind; fix: string } {
  switch (status) {
    case 200:
      return { kind: "ok", fix: "No action needed." };
    case 401:
      return /unauthorized[\s_-]+client/i.test(bodyText)
        ? { kind: "auth-client", fix: "Check client authorization." }
        : { kind: "auth-token", fix: "Refresh or replace the token." };
    case 402:
      return { kind: "pool-exhausted", fix: "Replenish or switch the account pool." };
    case 400:
      return { kind: "bad-request", fix: "Validate the request payload." };
    case 429:
      return { kind: "rate-limited", fix: "Retry with exponential backoff." };
    case 503:
      return { kind: "no-channel", fix: "Enable a channel for the requested model." };
    default:
      return { kind: "unknown", fix: "Inspect the response and server logs." };
  }
}
```

### R-10a1b — diagnose() — per key x model probes + local ledger totals (API 1, 1 attempt)

```typescript
async function diagnose(models: readonly string[], keys: readonly string[]) {
  const results = await Promise.all(
    keys.flatMap((key, keyIndex) =>
      models.map(async (model) => {
        const { status, body } = await probe(model, key);
        return {
          model,
          keyIndex,
          status,
          body,
          classification: await classifyStatus(status),
        };
      })
    )
  );

  const ledger = await readLedgerTotals();
  return { results, ledger };
}
```

### R-10a1c — agentrouter_diagnose MCP registration (API 2, 1 attempt)

```typescript
import { z } from "zod";

server.registerTool(
  "agentrouter_diagnose",
  { inputSchema: { models: z.array(z.string()).optional() } },
  async ({ models }) => {
    try {
      const result = await diagnose(models, keys);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
      };
    }
  },
);
```

## Part 10a2 — Recovered 2026-10-23 (Astra, verbatim, in 2 sub-parts)

### R-10a2a — smokeTest() — one tiny probe per model, timed, classified (API 1, 1 attempt)

```typescript
async function smokeTest(model: string, key: string) {
  const started = Date.now();
  const { status } = await probeOnce(model, key);
  const ms = Date.now() - started;
  const kind = classifyStatus(status);
  const ok = status >= 200 && status < 300;
  return { model, ok, status, kind, ms };
}
```

### R-10a2b — smokeAll() — all 4 models on key 1, sequential, pass/fail counts (API 2, 1 attempt)

```typescript
async function smokeAll(keys: string[]) {
  if (!keys[0]) throw new Error("At least one API key is required.");
  const models = [
    "gpt-6-astra", "deepseek-v4-flash", "claude-opus-5", "claude-opus-4-8",
  ] as const;
  const results: Array<{ model: string; passed: boolean; value?: unknown; error?: string }> = [];
  for (const model of models) {
    try {
      const value = await smokeTest(model, keys[0]);
      results.push({ model, passed: true, value });
    } catch (error) {
      results.push({
        model, passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const passed = results.filter(result => result.passed).length;
  const failed = results.length - passed;
  return { passed, failed, results };
}
```

## Part 10b — Astra's answer (verbatim)

```typescript
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function generateConfigs(): Promise<{
  codex: string;
  claude: string;
}> {
  const paths = {
    codex: join(homedir(), ".codex", "config.toml"),
    claude: join(homedir(), ".claude", "settings.json"),
  };

  const codex = `model_provider = "agentrouter"

[model_providers.agentrouter]
name = "AgentRouter"
wire_api = "responses"
base_url = "https://agentrouter.org/v1"
env_key = "CODEX_GATEWAY_API_KEY"
`;

  const claude = {
    // Resolve credentials at runtime; JSON env values aren't interpolated.
    // Export CODEX_GATEWAY_API_KEY in both clients' runtime environments.
    apiKeyHelper:
      `node -e "const k=process.env.CODEX_GATEWAY_API_KEY;if(!k)process.exit(1);process.stdout.write(k)"`,
    env: {
      ANTHROPIC_BASE_URL: "https://agentrouter.org",
      ANTHROPIC_MODEL: "claude-opus-5",
      CLAUDE_CODE_EFFORT_LEVEL: "max",
    },
  };

  // Replaces each entire file atomically; no key values are serialized.
  async function writeConfig(file: string, text: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, text, {
        encoding: "utf8", mode: 0o600, flag: "wx",
      });
      await rename(temp, file);
    } finally {
      await rm(temp, { force: true });
    }
  }

  await Promise.all([
    writeConfig(paths.codex, codex),
    writeConfig(paths.claude, JSON.stringify(claude, null, 2) + "\n"),
  ]);
  return paths;
}
```

## Part 10c — Astra's answer (verbatim)

## Security checklist
- **Keys env-only:** inject both keys only into processes that need them; never put values in config, repos, argv, or prompts. Restrict subprocess inheritance; rotate independently.
- **Redaction:** scrub credentials, auth headers, sensitive content, and tool output before logs, traces, or probe reports. Disable raw environment dumps.
- **Spend caps:** enforce global and per-key budgets with atomic reservations; count subagents, retries, and probes. Bound tokens/concurrency; failover must not bypass exhausted budgets.
- **Ledger:** maintain an access-controlled, append-only record of run/parent/request IDs, key alias, model, tokens, estimated/final cost, retries, and outcomes. Reconcile upstream billing.
- **MCP access:** bind to loopback by default; authenticate clients, require TLS remotely, and allowlist tools and network destinations.
- **Execution isolation:** sandbox terminals/subagents with minimal filesystem permissions. Treat tool content as untrusted; require approval for destructive or privileged actions.

## What the brief missed
- **Compatibility matrix:** verify Codex and Claude Code endpoint settings, auth env-variable names, model IDs, streaming/tool-call support, and context limits.
- **Batch supervision:** use bounded queues, per-key rate limits, jittered backoff, duplicate-task protection, cancellation, and checkpoint/resume handling.
- **Workspace coordination:** give workers separate worktrees/temp directories; define task ownership and a controlled merge process.
- **Probe design:** separate MCP liveness from upstream health; use tiny, budgeted probes and distinguish authentication, quota/rate-limit, routing, and transport failures.
- **Operations:** pin versions, validate configuration at startup, drain jobs on shutdown, and define alerts plus restart, failover, and recovery procedures.
