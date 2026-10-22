import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// [glue] Imports added in the 2026-10-23 glue pass (see BUILD-REPORT.md):
// two-key config loader (Astra S-08b) + registration wrappers for Astra's
// recovered tool modules, which were fragments referencing a bare `server`.
import { config } from "./config.js";
import { registerBatch } from "./tools/batch.js";
import { registerHealth } from "./tools/health.js";
import { registerDiagnostics } from "./tools/diagnostics.js";
import { registerConfigGen } from "./tools/config-gen.js";

// [glue] Was: a single AGENTROUTER_API_KEY. Now Astra's config loader keys
// (AGENTROUTER_KEY_1/2), tried in config order with failover on 401/402/503.
const keys = config.apiKeys;
const base = "https://agentrouter.org/v1";
const server = new McpServer({ name: "agentrouter", version: "1.0.0" });

async function request(
  path: "/models" | "/responses" | "/messages",
  body?: unknown,
): Promise<unknown> {
  let lastError: unknown;
  for (const key of keys) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Originator: "codex_cli_rs",
        Version: "0.101.0",
        // [glue] User-Agent from the measured codex_cli_rs header set (S-03).
        "User-Agent": "codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464",
        "Content-Type": "application/json",
        ...(path === "/messages" ? { "anthropic-version": "2023-06-01" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await response.text();
    if (response.ok) {
      try { return JSON.parse(raw); }
      catch { throw new Error("AgentRouter returned invalid JSON"); }
    }
    lastError = new Error(`AgentRouter ${path} (${response.status}): ${raw.slice(0, 2048)}`);
    if (![401, 402, 503].includes(response.status)) break;
  }
  throw lastError;
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

// [glue] Wire Astra's recovered tool modules into this server.
registerBatch(server);
registerHealth(server);
registerDiagnostics(server, keys);
registerConfigGen(server);

await server.connect(new StdioServerTransport());
