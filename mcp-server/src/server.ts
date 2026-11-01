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
import { registerJobs } from "./tools/jobs.js";
import {
  combos,
  classifyUpstream,
  isRetryable,
  pauseForAttempt,
  redact,
} from "./upstream.js";

const server = new McpServer({ name: "agentrouter", version: "1.0.0" });

async function request(
  path: "/models" | "/responses" | "/messages",
  body?: unknown,
): Promise<unknown> {
  // Sol 2026-10-31: Rotate host x key combos over retry rounds with backoff.
  const combinations = combos();
  if (combinations.length === 0) {
    throw new Error("No host x key combos configured");
  }

  const rounds = Math.max(1, config.retryRounds);
  const totalAttempts = rounds * combinations.length;
  const timeoutMs = path === "/messages" ? 120_000 : config.timeoutMs;
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  let lastStatus: number | null = null;
  let lastBody = "";
  let lastKind = "upstream-transient";

  attempts:
  for (let round = 0; round < rounds; round++) {
    for (let comboIndex = 0; comboIndex < combinations.length; comboIndex++) {
      const { host, key } = combinations[comboIndex];
      const attemptIndex = round * combinations.length + comboIndex;
      let response: Response;
      let raw: string;

      try {
        response = await fetch(`https://${host}/v1${path}`, {
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
          body: serializedBody,
          signal: AbortSignal.timeout(timeoutMs),
        });
        raw = await response.text();
      } catch (error) {
        lastStatus = null;
        lastBody = error instanceof Error ? error.message : String(error);
        lastKind = "upstream-transient";
        if (attemptIndex < totalAttempts - 1) {
          await pauseForAttempt(attemptIndex);
        }
        continue;
      }

      if (response.ok) {
        try { return JSON.parse(raw); }
        catch { throw new Error("AgentRouter returned invalid JSON"); }
      }

      lastStatus = response.status;
      lastBody = raw;
      lastKind = classifyUpstream(response.status, raw).kind;
      if (!isRetryable(response.status)) break attempts;

      if (attemptIndex < totalAttempts - 1) {
        await pauseForAttempt(attemptIndex);
      }
    }
  }

  throw new Error(
    `AgentRouter ${path} (${lastStatus ?? "transport"}) [${lastKind}]: ${redact(lastBody).slice(0, 2048)}`,
  );
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
    max_tokens: z.number().int().positive().optional(),
    effort: z.enum(["max", "low"]).optional(),
  },
}, ({ model, messages, system, max_tokens, effort }) => {
  const astra = /^gpt-6-astra$/i.test(model);
  if (effort === "low" && astra) {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: 'Low effort is rejected for Astra (gpt-6-astra) and must not be sent. Omit effort or use "max".',
      }],
    };
  }

  if (max_tokens === undefined) {
    max_tokens = astra ? config.astraMaxTokens : 4096;
  } else if (astra) {
    max_tokens = Math.min(max_tokens, 16_000);
  }

  const anthropic = /claude/i.test(model);
  const body = anthropic
    ? { model, messages, system, max_tokens, stream: false }
    : {
        model, input: messages, instructions: system,
        max_output_tokens: max_tokens, store: false, stream: false,
        ...(effort === undefined ? {} : { reasoning: { effort } }),
      };
  return asTool(() => request(anthropic ? "/messages" : "/responses", body));
});

// [glue] Wire Astra's recovered tool modules into this server.
registerBatch(server);
registerHealth(server);
registerDiagnostics(server, config.apiKeys);
registerConfigGen(server);
// Phase 4 (2026-10-31): persistent jobs. These tools never call the
// gateway; the independent worker does. Existing agentrouter_chat is
// untouched, including its rotation and timeout settings.
registerJobs(server);

await server.connect(new StdioServerTransport());
