// Sol 2026-10-31: Retry now uses upstream chatDetailed; Astra defaults to concurrency 1.
// Per-task results report index/attempts/kind.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { chatDetailed, appendLedger } from "../upstream.js";

type ChatTask = {
  model: string;
  prompt: string;
  effort?: "max" | "low";
};

type BatchResult = { index: number } & (
  | {
      ok: true;
      value: unknown;
      attempts: number;
      host: string;
      keyIndex: number;
      latencyMs: number;
    }
  | {
      ok: false;
      error: string;
      kind: string;
      attempts: number;
      host: string;
      keyIndex: number;
      status: number | null;
    }
);

async function batchChat(
  tasks: ChatTask[],
  concurrency?: number,
): Promise<BatchResult[]> {
  if (tasks.length > 32) throw new RangeError("At most 32 tasks are allowed");

  const poolSize =
    concurrency === undefined
      ? (tasks.some((task) => /^gpt-6-astra$/i.test(task.model)) ? 1 : 8)
      : Math.max(1, Math.min(8, concurrency));

  const results = new Array<BatchResult>(tasks.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const index = next++;
      const task = tasks[index]!;

      try {
        const detail = await chatDetailed(task, { effort: task.effort });
        const usage = (detail.value as any)?.usage;
        const tokens =
          typeof usage?.total_tokens === "number"
            ? usage.total_tokens
            : typeof usage?.input_tokens === "number" &&
                typeof usage?.output_tokens === "number"
              ? usage.input_tokens + usage.output_tokens
              : typeof usage?.output_tokens === "number"
                ? usage.output_tokens
                : 0;
        const reasoningTokens =
          typeof usage?.output_tokens_details?.reasoning_tokens === "number"
            ? usage.output_tokens_details.reasoning_tokens
            : typeof usage?.reasoning_tokens === "number"
              ? usage.reasoning_tokens
              : 0;
        const textTokens =
          tokens > 0 ? Math.max(0, tokens - reasoningTokens) : 0;

        try {
          await appendLedger({
            model: task.model,
            tokens,
            host: detail.host,
            keyIndex: detail.keyIndex,
            status: 200,
            errorKind: "ok",
            attempts: detail.attempts,
            latencyMs: detail.latencyMs,
            reasoningTokens,
            textTokens,
          });
        } catch {
          /* best effort */
        }

        results[index] = {
          index,
          ok: true,
          value: detail.value,
          attempts: detail.attempts,
          host: detail.host,
          keyIndex: detail.keyIndex,
          latencyMs: detail.latencyMs,
        };
      } catch (error) {
        const e = error as any;
        const kind =
          typeof e?.kind === "string"
            ? e.kind
            : (String(e?.message ?? error).match(/\[([^\]]+)\]/)?.[1] ??
              "unknown");
        const attempts = typeof e?.attempts === "number" ? e.attempts : 0;
        const host = typeof e?.host === "string" ? e.host : "unknown";
        const keyIndex = typeof e?.keyIndex === "number" ? e.keyIndex : -1;
        const status = typeof e?.status === "number" ? e.status : null;

        try {
          await appendLedger({
            model: task.model,
            tokens: 0,
            host,
            keyIndex,
            status,
            errorKind: kind,
            attempts,
            latencyMs: typeof e?.latencyMs === "number" ? e.latencyMs : 0,
            reasoningTokens: 0,
            textTokens: 0,
          });
        } catch {
          /* best effort */
        }

        results[index] = {
          index,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          kind,
          attempts,
          host,
          keyIndex,
          status,
        };
      }
    }
  }

  // A fixed worker pool preserves input order and limits concurrent tasks.
  await Promise.all(
    Array.from({ length: Math.min(poolSize, tasks.length) }, () => worker()),
  );
  return results;
}

export function registerBatch(server: McpServer): void {
  server.registerTool(
    "agentrouter_batch_chat",
    {
      inputSchema: {
        requests: z
          .array(
            z.object({
              model: z.string(),
              prompt: z.string(),
              effort: z.enum(["max", "low"]).optional(),
            }),
          )
          .max(32),
        concurrency: z.number().int().min(1).max(8).optional(),
      },
    },
    async ({ requests, concurrency }) => {
      // [glue] Cast: the SDK's schema inference types the array elements'
      // fields as optional; the zod schema above still validates model and
      // prompt as required strings at runtime.
      const result = await batchChat(requests as ChatTask[], concurrency);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );
}
