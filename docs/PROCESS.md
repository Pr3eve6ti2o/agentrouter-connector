# AgentRouter Connector: complete setup + verification process

## 1. Build layers

- `bin/ar_call.py`: secure-vault/Hatch caller matching the attached build record. Uses `custom.agentrouter`, `dynamic_credentials`, `hsurr:*` surrogates, and the AgentRouter host allowlist.
- `src/index.ts`: deployable Node service exposing OpenAI-compatible HTTP plus MCP.
- `src/router.ts`: exact-model execution plus optional explicit fallback candidates.
- `src/semaphore.ts`: connector-side concurrency limit.
- `src/retry.ts`: transient retry/backoff with `Retry-After` support.
- `src/redact.ts`: obvious secret-like prompt redaction.
- `src/ledger.ts`: JSONL usage/audit events without raw prompts by default.

## 2. Endpoint distinction: do not mix the surfaces silently

The attached build record reports a verified working surface on 2026-10-03 at:

`https://agentrouter.org/v1`

and a verified `GET /v1/models` → HTTP 200, followed by a tiny DeepSeek chat request → HTTP 200.

Current AgentRouter public docs now document a capability-first Agentic API at `https://api.agentrouter.to/api/agentic-api`, a hosted MCP endpoint at `https://mcp.agentrouter.to`, and an OpenAI-compatible surface at `https://co.agentrouter.org/v1`. The available model catalog can change. Do not silently switch an existing key to another surface; choose one, then run the catalog + tiny completion smoke.

## 3. Standalone setup

1. Install Node.js 22+.
2. Copy `.env.example` to `.env`.
3. Store `AGENTROUTER_KEY` as a server secret.
4. Generate a different `CONNECTOR_API_KEY` for `/v1` clients.
5. Generate a different `MCP_AUTH_TOKEN` for `/mcp` clients.
6. Put the service behind HTTPS when exposed publicly.
7. Run `npm install`.
8. Run `npm run check && npm test && npm run build`.
9. Start `npm start`.

## 4. Verification sequence

### A. Process-only

```bash
curl -sS http://127.0.0.1:3000/health
```

### B. Free/catalog smoke

```bash
curl -sS http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer $CONNECTOR_API_KEY"
```

This verifies connector auth, outbound auth, headers, host, and model-catalog connectivity. It does not run a generation request.

### C. Tiny generation smoke

Only after the catalog succeeds:

```bash
curl -sS http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer $CONNECTOR_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"Reply only OK"}],"max_tokens":5}'
```

Use a model ID returned by `/v1/models` when the current catalog differs.

## 5. Connect to ChatGPT or another MCP client

1. Deploy this service at an HTTPS hostname.
2. Expose `https://YOUR_HOST/mcp`.
3. Configure the MCP client to use that remote URL.
4. Configure the MCP connection's bearer token with `MCP_AUTH_TOKEN`.
5. Test `agentrouter_health`.
6. Test `agentrouter_list_models`.
7. Run one `agentrouter_chat` request with `max_tokens=5`.

The current tool set in this conversation can create and validate the connector code, but it cannot programmatically attach an arbitrary new remote MCP endpoint to this existing chat. The final connector attachment is controlled by the ChatGPT account/UI.

## 6. Secure-vault connector setup from the source record

The source used:

```json
{
  "provider": "agentrouter",
  "api_hosts": ["agentrouter.org", "co.agentrouter.org"],
  "auth_scheme": "api_key",
  "placement": "bearer_header"
}
```

The resulting connector was named `custom.agentrouter`; the raw key was entered through the secure entry page and stored in the vault. The AI did not receive the key. `ar_call.py` uses `add_surrogate_to_request(...)`, so only `hsurr:*` values travel to AgentRouter.

## 7. Maximum practical usage

This build maximizes utilization through:

- bounded concurrent requests;
- non-blocking network I/O;
- retries for 408/425/429/5xx;
- honoring `Retry-After`;
- explicit model fallback for route-availability failures;
- streaming without buffering the entire response;
- model catalog discovery;
- a usage ledger for auditability.

It does not bypass AgentRouter/provider quotas, billing, authentication, or WAF restrictions.
