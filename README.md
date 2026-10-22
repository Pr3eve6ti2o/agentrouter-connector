# AgentRouter Connector

AgentRouter Connector contains two components: the original v2 HTTP connector at the repository root and a new stdio MCP server in [`mcp-server/`](mcp-server/).

## Components

### Original v2 HTTP connector

The original v2 connector lives at the repository root and provides an HTTP gateway with:

- **MCP** at `/mcp`.
- **OpenAI-compatible endpoints** at `/v1/models` and `/v1/chat/completions`.

Limits: `MAX_CONCURRENCY=8` and `MAX_BATCH_TASKS=32`.

### New stdio MCP server

The stdio MCP server in [`mcp-server/`](mcp-server/) was **designed and written by GPT-6-Astra**. **Orion** handled the integration, build and registration into terminals.

- [Specification](mcp-server/SPEC.md)
- [Build notes](mcp-server/BUILD-REPORT.md)

## Models

| Model | API | API URL | CLI |
| --- | --- | --- | --- |
| `gpt-6-astra` | Responses | `https://agentrouter.org/v1` | Codex CLI |
| `deepseek-v4-flash` | Responses | `https://agentrouter.org/v1` | Codex CLI |
| `claude-opus-5` | Anthropic Messages | `https://agentrouter.org/v1/messages` | Claude Code |
| `claude-opus-4-8` | Anthropic Messages | `https://agentrouter.org/v1/messages` | Claude Code |

Effort ranges from `low` to `max`. Two API keys are supported, with failover.

## MCP server (stdio)

The stdio MCP server is in [`mcp-server/`](mcp-server/).

### Tools

| Tool | Description |
| --- | --- |
| `agentrouter_list_models` | Returns the gateway’s live model list per key. |
| `agentrouter_chat` | Makes a single call with a model and a prompt. |
| `agentrouter_batch_chat` | Runs calls in parallel, with a maximum of 8 concurrent calls and 32 calls per batch. |
| `agentrouter_health` | Checks per-key status via `GET /v1/models`, with no spend. |
| `agentrouter_diagnose` | Probes key × model combinations, classifies errors and reports ledger totals. |
| `agentrouter_generate_config` | **WARNING: WRITES** to the real `~/.codex/config.toml` and `~/.claude/settings.json` files. |

### Quickstart

1. Clone this repository, then enter the cloned directory.
2. Enter the server directory and install dependencies:

   ```sh
   cd mcp-server
   npm install
   ```

3. Set the 14 environment variables.
4. Build the server:

   ```sh
   npm run build
   ```

5. Register the stdio MCP server.

See [`mcp-server/README.md`](mcp-server/README.md) for full setup details, including the environment variables and registration instructions.

### Authorship

- **Design (`SPEC.md`) and code:** GPT-6-Astra via AgentRouter, using both APIs.
- **[glue] Orion:** Glue, scaffolding, build and registration.

## Repository layout

- `src/`, `bin/`, `Dockerfile`, `docker-compose.yml` — the original v2 HTTP connector (the gateway). Its own docs are in `docs/PROCESS.md` and `docs/CONNECT_TO_CHAT.md`.
- `mcp-server/` — the stdio MCP server: `README.md` (setup and usage), `SPEC.md` (the design), `BUILD-REPORT.md` (build and glue log).
- `docs/MCP-SERVER.md` — troubleshooting and operations for the stdio MCP server.
