# AgentRouter MCP server: troubleshooting and operations
Operational requirements and recovery procedures for the AgentRouter MCP server in `mcp-server/`.

## How to run it (short version)

This document is the troubleshooting companion — the full run guide is [`mcp-server/README.md`](../mcp-server/README.md) (§5 install and environment, §6 build, §7 smoke, §9 registration). In short, from `mcp-server/`:

```sh
npm install
npm run build
npm run smoke
```

Then register the server in Codex and/or Claude Code (guide §9) and restart the client session. The server is a local stdio process (`node dist/src/server.js`): there is no browser URL, and `stdout` is MCP traffic only. A server started with only the original 14 environment variables keeps working; the four optional v2 variables listed below simply use their defaults.

## What this server takes care of

- Routing your prompt to AgentRouter and rotating host × key combos until a transient failure clears or the retry budget (default 3 rounds = 12 attempts) runs out.
- Classifying failures by status *and* body, so a 401 header rejection, a 402/403 quota problem, a 503 off-list model, a 502/disconnect lottery failure, and a chained-state mismatch are never confused with each other.
- Recording every attempt in a local ledger (`ledger.jsonl` by default) with host, key index, kind, attempts and latency — never a key value — and reporting per-combo success rates in `agentrouter_diagnose`.
- Applying safe Astra defaults: 12,000 output tokens (overridable to 16,000), sequential batches, and rejecting `low` effort for Astra.
- It does **not** provision accounts, grant quota, make a model available, fix the gateway, or protect a chained Codex session (see "What this upgrade does not do" below).

![Request flow](../mcp-server/assets/request-flow.svg)

## Startup requirements

The server requires 14 environment variables; startup throws if any one is missing.

These four new optional variables have defaults and do not affect the 14-var contract:

| Variable | Default |
| --- | --- |
| `AGENTROUTER_HOSTS` | `agentrouter.org,ps.air-outer.com` |
| `AGENTROUTER_RETRY_ROUNDS` | `3` |
| `AGENTROUTER_TIMEOUT_MS` | `600000` |
| `AGENTROUTER_ASTRA_MAX_TOKENS` | `12000` |

A server started with only the original 14 vars keeps working unchanged.

## HTTP failure taxonomy

Never call a key dead from a `401` alone. Read the response body and inspect the request host and headers before diagnosing the failure.

| Status | Diagnosis | Fix |
| --- | --- | --- |
| 401 unauthorized client detected | Headers rejected, not a dead key | Inspect body, host, headers; correct headers; do not discard the key. |
| 401 invalid token | A real key problem | Correct/replace the key. |
| 402 | That key's budget pool is exhausted. Pools refill. | Fail over to the other key. |
| 403 quota / not enough | That key's quota is exhausted (distinct from 402) | Fail over to the other key. (Classifier kind: `pool-quota-403`.) |
| 429 | Rate-limited | Retry with backoff; do not raise caps. |
| 502, 504, transport failure (connection closed, timeout) | Transient upstream failure (kind `upstream-transient`) | Retry on another host x key combo; this is a per-request lottery, not a dead key/host/account. |
| 503 no available channel | Model off the dynamic list | Check `agentrouter_list_models` and `agentrouter_health`, pick a listed model. |
| 400 | Bad request | Validate the payload; do not retry (non-retryable, like 404 and other 4xx). |
| Chained-state failure | Upstream state pinned to one resource; follow-ups routed elsewhere fail (kind `upstream-state-mismatch`) | Use a fresh stateless request; never resume the chain. |

## Model availability and `503` recovery

Treat 503 as a model-availability problem, not key failure; the list is dynamic.

1. Check `agentrouter_list_models`.
2. Check `agentrouter_health`.
3. Pick a listed model.

### Live observation: 23 October 2026

The live model list had shrunk to:
- gpt-5.6-sol
- gpt-6-astra
- gpt-6.1-sol

| Model | Observation |
| --- | --- |
| gpt-6-astra | Working |
| deepseek-v4-flash | 503 on both keys |
| Both Opus models | 503 on both keys |

Switching keys did not resolve the failures for deepseek-v4-flash or either Opus model in this observation. Check the live tools rather than assuming those models have returned.

## Rotation and retry (MCP v2)

Requests rotate over host × key combinations in this order:
`agentrouter.org/key1` → `agentrouter.org/key2` →
`ps.air-outer.com/key1` → `ps.air-outer.com/key2`, then repeat.
The limit is `AGENTROUTER_RETRY_ROUNDS` rounds (default **3**:
**12 attempts** with 2 hosts × 2 keys). Pause **2–5 s plus jitter**
between attempts.

- Retryable: **401, 402, 403, 429, 502, 503, 504**, plus transport
  failures (fetch throw, connection closed without response, timeout).
- Non-retryable: **400, 404**, and all remaining 4xx; stop immediately.
- Timeouts: Responses defaults to **600 s** (`AGENTROUTER_TIMEOUT_MS`);
  Anthropic `/messages` defaults to **120 s** unless overridden.
- Client headers always use `Originator: codex_cli_rs`,
  `Version: 0.101.0`, and a matching `User-Agent`.

## Batch

The old limitation is **removed**: `batch_chat` now retries every task
through the same rotation. A transient 502 or disconnect no longer
fails a task immediately.

- Concurrency defaults to **1** when any task uses `gpt-6-astra`,
  otherwise **8**; callers may override to **1–8**.
- At most **32 tasks** per batch; results stay in input order.

Each result carries `index`, `ok`, `value` (success) or `error` (failure),
`attempts`, `host`, and `keyIndex`, plus `kind` on failures.
Callers can re-submit only failed tasks by `index`.

## Chat caps and effort

For `agentrouter_chat`, `gpt-6-astra` defaults to **12000** tokens
(`AGENTROUTER_ASTRA_MAX_TOKENS`); callers may override up to **16000**.
Other models retain their defaults: **4096** for chat and **3200**
for non-Astra batch tasks.

Optional `effort`:
- Omitted: no `reasoning` field is sent.
- `"max"`: sends `reasoning: { effort: "max" }` on Responses only.
- `"low"`: **rejected for `gpt-6-astra` with a clear error** and
  never sent for that model.

## Health, diagnose, and the ledger

Health and diagnose now probe **both hosts**, sequentially, covering
every host × key × model combination. Diagnose reports per-combo
success rates over the **last 60 minutes** from the ledger, plus
**all-history per-combo totals**.

Each ledger line records timestamp, model, tokens, host, key **index**
(never a key value), status (number or `null` for transport failure),
error kind, attempts used, latency per combo, and reasoning/text tokens
from the usage receipt.

Ledger path: `AGENTROUTER_LEDGER_PATH`, or `ledger.jsonl` by default.

## What this upgrade does not do

- It does not fix the gateway itself: a dead window stays a dead window;
  rotation only outlasts it.
- It does not protect a Codex session chain: stateless calls are immune
  to chain failures; chained sessions still need checkpoint-and-fresh-session.
- It does not make 503 no-channel models return; pick a model from the live list.

## Responses API state mismatch

AgentRouter API 2 can return:

> The requested item was created under a different Azure OpenAI resource

Responses API state, including `resp_` IDs, reasoning items and conversation items, is stored on a single Azure resource behind the gateway. API 2 uses a multi-resource pool without sticky routing. A chained follow-up that uses `previous_response_id` or passes output items back fails with this error if it is routed to a different resource.

This affects stateful chained clients, such as long Codex sessions. It does not affect this MCP server or stateless runners: every call is a fresh, complete prompt with no `previous_response_id`. The error does not indicate a dead key, quota exhaustion or a configuration fault.

Start a fresh stateless request; do not resume the chain. Retrying the same chain may keep failing. `agentrouter_health` and `agentrouter_list_models` are not needed for this error. `agentrouter_diagnose` classifies this response body as kind `upstream-state-mismatch`.

## Security

- Keep keys **only in environment variables**.
- **Never commit `.env`**.
- Set both client configuration files to mode `600`:

```sh
chmod 600 ~/.codex/config.toml ~/.claude.json
```
