# AgentRouter MCP server: troubleshooting and operations

Operational requirements and recovery procedures for the AgentRouter MCP server in `mcp-server/`.

## Startup requirements

The server requires **14 environment variables**. Startup throws if **any one of them is missing**.

Before starting or restarting the server, ensure all 14 variables are present in the server process’s environment. If startup fails because a variable is missing, supply it and check that the complete set is present before trying again.

## HTTP failure taxonomy

> **Never call a key dead from a `401` alone.** Read the response body and inspect the request host and headers before diagnosing the failure.

| Status and response | Diagnosis | Fix |
| --- | --- | --- |
| `401` — `unauthorized client detected` | Headers were rejected. This is a header problem, **not a dead key**. | Inspect the body, host and headers; correct the rejected headers. Do not replace or discard the key on the strength of this response alone. |
| `401` — `invalid token` | A real key problem. | Correct or replace the key supplied through the environment. |
| `402` | That key’s budget pool is exhausted. **Pools refill.** | Fail over to the other key. Do not treat budget exhaustion as permanent key invalidity. |
| `503` — `no available channel` | The model is off the gateway’s dynamic model list at present. | Check `agentrouter_list_models` and `agentrouter_health` first, then select a model from the current list. |
| `502` | A transient failure. | Retry the affected request. For batch requests, do not rely on automatic `502` retries; see [Batch retry limitation](#batch-retry-limitation). |

## Model availability and `503` recovery

For `503` with `no available channel`:

1. Check `agentrouter_list_models`.
2. Check `agentrouter_health`.
3. Use the current model list to select a replacement model.

Treat this as a model-availability problem, not evidence of key failure. The gateway’s list is dynamic, so a dated model list must not be treated as a permanent catalogue.

### Live observation: 23 October 2026

The live model list had shrunk to:

- `gpt-5.6-sol`
- `gpt-6-astra`
- `gpt-6.1-sol`

The observed request outcomes were:

| Model or model group | Observed outcome |
| --- | --- |
| `gpt-6-astra` | Working. |
| `deepseek-v4-flash` | `503` on both keys. |
| Both Opus models | `503` on both keys. |

Switching keys did not resolve the failures for `deepseek-v4-flash` or either Opus model in this observation. Check the live tools rather than assuming those models have returned.

## Batch retry limitation

A `502` is transient, but **batch does not yet retry `502` failures**.

The known implementation gap is that `chatWithRetry` is **not wired into batch**. Retry affected batch requests explicitly rather than assuming the batch path will recover automatically.

## Security

- Keep keys **only in environment variables**.
- **Never commit `.env`.**
- Set both client configuration files to mode `600`:

```sh
chmod 600 ~/.codex/config.toml ~/.claude.json
```
