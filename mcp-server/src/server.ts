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
  isAnthropic,
  isRetryable,
  pauseForAttempt,
  redact,
  ANTHROPIC_TIMEOUT_MS,
  clientHeaders,
} from "./upstream.js";
import { readSseEvents } from "./sse.js";

const server = new McpServer({ name: "agentrouter", version: "1.0.0" });

// 2026-11-07: streamed Responses assembly. The gateway kills an idle
// non-streamed connection after ~291s while the model is still reasoning
// (no bytes flow until reasoning finishes), and a 16,000-token cap starves
// max-reasoning calls to zero text (B1a2a needed 16,536 reasoning tokens).
// Streaming keeps bytes flowing through the whole reasoning window, and the
// 32,000 cap gives the model room to finish thinking and then write.
// Only status "completed" counts as success: a stream that ends early, or
// ends incomplete, must never be saved as a landed section.
// SSE framing and reader cleanup are shared; response integrity checks stay here.
async function readResponsesStream(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("AgentRouter /responses: empty stream");
  let accumulated = "";
  let finalResponse: any = null;
  let finalStatus: string | null = null;
  let sawMalformedLine = false;

  for await (const event of readSseEvents(response)) {
    if (event.kind === "malformed") {
      sawMalformedLine = true;
      continue;
    }

    const eventName = event.eventName;
    try {
      // Retain the original JSON.parse payload handling, including null/primitives.
      const data: any = event.data;
      if (eventName === "response.output_text.delta" && typeof data?.delta === "string") {
        accumulated += data.delta;
      } else if (eventName === "response.completed" || eventName === "response.failed" || eventName === "response.incomplete") {
        finalResponse = data.response ?? data;
        finalStatus = data.response?.status ?? eventName.replace(/^response\./, "");
      }
    } catch {
      // Keep reading; integrity is checked before returning a completed result.
      sawMalformedLine = true;
    }
  }

  if (finalStatus === "completed" && finalResponse) {
    const finalText =
      typeof finalResponse.output_text === "string" && finalResponse.output_text.length > 0
        ? finalResponse.output_text
        : null;

    if (finalText !== null && finalText !== accumulated) {
      throw new Error("AgentRouter /responses: stream integrity failure (final output_text differs from accumulated text)");
    }
    if (finalText === null && sawMalformedLine) {
      throw new Error("AgentRouter /responses: stream integrity failure (malformed SSE data without authoritative final output_text)");
    }

    return { ...finalResponse, output_text: finalText ?? accumulated };
  }
  if (finalStatus) {
    const reason = finalResponse?.incomplete_details?.reason ?? finalResponse?.error?.code ?? "";
    throw new Error(`AgentRouter /responses gateway status: ${finalStatus}${reason ? ` (${reason})` : ""}`);
  }
  throw new Error("AgentRouter /responses: stream ended without a completed response");
}

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
  const timeoutMs = path === "/messages" ? ANTHROPIC_TIMEOUT_MS : config.timeoutMs;
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  const streamed =
    path === "/responses" &&
    typeof body === "object" &&
    body !== null &&
    "stream" in body &&
    body.stream === true;
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
            // [glue] User-Agent from the measured codex_cli_rs header set (S-03).
            ...clientHeaders,
            ...(path === "/messages" ? { "anthropic-version": "2023-06-01" } : {}),
            ...(streamed ? { Accept: "text/event-stream" } : {}),
          },
          body: serializedBody,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (streamed && response.ok) return await readResponsesStream(response);
        raw = await response.text();
      } catch (error) {
        lastStatus = null;
        lastBody = error instanceof Error ? error.message : String(error);
        lastKind = "upstream-transient";
        // Retrying a max_output_tokens starvation cannot help: the same
        // prompt burns the same cap on every combo. Stop instead of
        // burning 12 attempts x 32k tokens.
        if (/gateway status: incomplete \(max_output_tokens\)/.test(lastBody)) break attempts;
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
    // 2026-11-07: cap raised 16,000 -> 32,000 (starvation proof in
    // config.ts). Responses streams so the ~291s idle cut cannot fire.
    max_tokens = Math.min(max_tokens, config.astraMaxTokens);
  }

  const anthropic = isAnthropic(model);
  const body = anthropic
    ? { model, messages, system, max_tokens, stream: false }
    : {
        model, input: messages, instructions: system,
        max_output_tokens: max_tokens, store: false, stream: true,
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
