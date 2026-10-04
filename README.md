# AgentRouter Connector

A secure, high-throughput AgentRouter connector exposing:

- **MCP** at `/mcp` for AI assistants and agents.
- **OpenAI-compatible HTTP** at `/v1/models` and `/v1/chat/completions`.

The design preserves the attached `custom.agentrouter` secure-vault caller and adds a deployable gateway for other AI clients.

## Security

The connector never logs raw upstream credentials. In the secure-vault runtime, `bin/ar_call.py` uses a short-lived `hsurr:*` surrogate and a host allowlist. In standalone mode, `AGENTROUTER_KEY`, `CONNECTOR_API_KEY`, and `MCP_AUTH_TOKEN` are separate secrets.

## Throughput

Use `MAX_CONCURRENCY`, bounded batch execution, async I/O, transient-error retries, `Retry-After`, streaming, and explicit model fallback to maximize practical utilization. These mechanisms do not bypass AgentRouter's own account/provider limits.

## Source vs current docs

The attached build record is the source of truth for the existing `custom.agentrouter` secure-vault connector and its 2026-10-03 live test. Current AgentRouter public documentation now also describes a capability-first API and a hosted MCP service. See `docs/PROCESS.md`.

## Install

```bash
cp .env.example .env
npm install
npm run check
npm test
npm run build
npm start
```

## Endpoints

```text
GET  /health
GET  /v1/models
POST /v1/chat/completions
POST /mcp
```
