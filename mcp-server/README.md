# AgentRouter MCP Server

A stdio MCP server for AgentRouter, written in TypeScript for Node.js.

## Prerequisites

Node.js 20 or later is required (tested with Node.js 24).

Package versions: `@modelcontextprotocol/sdk` 1.32.1, `zod` 3.25.76 and TypeScript 5.9.3.

## Install

```sh
git clone https://github.com/Pr3eve6ti2o/agentrouter-connector
cd agentrouter-connector/mcp-server
npm install
```

## Environment

Set all 14 environment variables listed in [`.env.example`](.env.example):

- Secrets: `AGENTROUTER_KEY_1` and `AGENTROUTER_KEY_2`.
- Per-model limits: 12 variables, with canonical values in [`config-schema.json`](config-schema.json).

The loader validates all 14 variables at start-up and throws an error if any is missing.

## Build

```sh
npm run build
```

This runs `tsc` and writes the output to `dist/`.

## Registration

AgentRouter is a stdio server, not a web server. The terminal launches it; running `node dist/src/server.js` by hand simply waits on stdin.

### Codex

Start the registration command with `codex mcp add agentrouter`. Supply each of the 14 environment variables using its own `--env` option, then append `-- node` followed by the absolute path to `dist/src/server.js`.

Verify registration:

```sh
codex mcp list
```

### Claude Code

Install Claude Code globally (tested with version 2.1.308):

```sh
npm install -g @anthropic-ai/claude-code
```

Start the registration command with `claude mcp add --scope user agentrouter`. Supply each of the 14 environment variables using its own `-e` option, then append `-- node` followed by the absolute path to `dist/src/server.js`.

Verify the connection; AgentRouter should show `Connected`:

```sh
claude mcp list
```

## Smoke test

`npm run smoke` runs `dist/smoke-test.js`, probing each of the four models once and reporting `ok` or a classified error per model.

```sh
npm run smoke
```

## Usage

In a Codex or Claude Code terminal session, ask the assistant to call the AgentRouter stdio MCP tools. The examples below are requests to the assistant, not shell commands.

### Call the tools

| Tool | When to use it |
| --- | --- |
| `agentrouter_list_models` | Find out which models the gateway serves now. |
| `agentrouter_chat` | Send a prompt to a specified model. |
| `agentrouter_health` | Run a free, per-key health check. |
| `agentrouter_diagnose` | Investigate when something fails. |
| `agentrouter_generate_config` | Write configuration files. Only call it when you actually intend to write those files. |

Start by checking the gateway's current model list:

```text
Call agentrouter_list_models and show the models the gateway serves now.
```

Then call `agentrouter_chat` with a model and a prompt. For example, if `deepseek-v4-flash` is listed:

```text
Call agentrouter_chat with model "deepseek-v4-flash", effort "max",
and prompt "Summarise the benefits of parallel requests in two sentences."
```

For a free check of key health:

```text
Call agentrouter_health to check each key.
```

When something fails:

```text
Call agentrouter_diagnose to investigate the failure.
```

### Batch requests

Batch tasks run in parallel, subject to these limits:

| Behaviour | Limit or guarantee |
| --- | --- |
| Concurrency | At most **8** tasks run concurrently. |
| Batch size | At most **32** tasks per batch. |
| Result order | Results are returned in input order. |
| Errors | Errors are reported per task. |

### Key failover

Failover uses two configured keys in configuration order. If a request using the first key receives HTTP `401`, `402` or `503`, it fails over to the second key.

### Local ledger and diagnosis

Each call is recorded locally in `ledger.jsonl`. Use `AGENTROUTER_LEDGER_PATH` to set the ledger path.

`agentrouter_diagnose` reads the local ledger's totals. Use it when something fails.

### Effort

Effort levels are model-dependent, ranging from `low` to `max`. Choose an `effort` value supported by the model.

- **`deepseek-v4-flash`:** Use the literal value `max` for maximum effort. `xhigh` maps down and is not equivalent to `max`.
- **Opus:** `max` is a value of this MCP's `effort` parameter, not a Claude Code setting.

## Troubleshooting

See [docs/MCP-SERVER.md](../docs/MCP-SERVER.md) for the error taxonomy, fixes and security notes.
