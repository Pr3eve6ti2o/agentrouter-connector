---
name: "agentrouter"
description: "Use AgentRouter when the user asks for AgentRouter or this provider's API."
---

# AgentRouter

## Purpose
Use the connected `custom.agentrouter` secure credential or the deployed connector endpoint.

## Secure-vault runtime
Python CLIs under `../bin/` must import `/opt/hatch/skills/skill-creator/bin/dynamic_credentials.py` and use `add_surrogate_to_request(...)` before authenticated requests. Authenticated hosts are limited to `agentrouter.org` and `co.agentrouter.org`. Do not print, persist, or request a raw key.

## Standalone connector runtime
The HTTP/MCP server reads `AGENTROUTER_KEY` only from the server's protected secret store/environment. The client-facing connector key and MCP auth token are separate secrets.

## Operating rules
1. Use the exact model ID returned by `GET /v1/models` where possible.
2. Fallback is allowed only to explicit candidate models and only for transient/route-availability errors.
3. Connector concurrency improves throughput but does not bypass AgentRouter/provider rate limits or billing.
4. Redact obvious secret-like values before forwarding prompts when `REDACT_PROMPTS=true`.
5. Never log prompts or credentials by default.
6. Review external model output before merging, publishing, or applying it to systems.
