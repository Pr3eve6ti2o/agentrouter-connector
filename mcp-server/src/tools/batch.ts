// Sol 2026-10-31: Retry now uses upstream chatDetailed; Astra defaults to concurrency 1.
// Per-task results report index/attempts/kind.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { chatDetailed, appendLedger, extractUsage } from "../upstream.js";
import { caps } from "../config.js";

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

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "Unknown error";
  }
}

async function batchChat(
  tasks: ChatTask[],
  concurrency?: number,
): Promise<BatchResult[]> {
  if (tasks.length > caps.maxBatchTasks) throw new RangeError(`At most ${caps.maxBatchTasks} tasks are allowed`);

  const poolSize =
    concurrency === undefined
      ? (tasks.some((task) => /^gpt-6-astra$/i.test(task.model)) ? 1 : caps.maxConcurrency)
      : Math.max(1, Math.min(caps.maxConcurrency, concurrency));

  const results = new Array<BatchResult>(tasks.length);
  // All workers share this iterator so each task is claimed once.
  const taskEntries = tasks.entries();

  async function worker(): Promise<void> {
    for (const [index, task] of taskEntries) {
      try {
        const detail = await chatDetailed(task, { effort: task.effort });
        const value: unknown = detail.value;
        const { tokens, reasoningTokens, textTokens } = extractUsage(value);

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
      } catch (error: unknown) {
        const e = isObjectLike(error) ? error : undefined;
        const kind =
          typeof e?.["kind"] === "string"
            ? e["kind"]
            : (safeString(e?.["message"] ?? error).match(/\[([^\]]+)\]/)?.[1] ??
              "unknown");
        const attempts = typeof e?.["attempts"] === "number" ? e["attempts"] : 0;
        const host = typeof e?.["host"] === "string" ? e["host"] : "unknown";
        const keyIndex = typeof e?.["keyIndex"] === "number" ? e["keyIndex"] : -1;
        const status = typeof e?.["status"] === "number" ? e["status"] : null;

        try {
          await appendLedger({
            model: task.model,
            tokens: 0,
            host,
            keyIndex,
            status,
            errorKind: kind,
            attempts,
            latencyMs: typeof e?.["latencyMs"] === "number" ? e["latencyMs"] : 0,
            reasoningTokens: 0,
            textTokens: 0,
          });
        } catch {
          /* best effort */
        }

        results[index] = {
          index,
          ok: false,
          error: error instanceof Error ? error.message : safeString(error),
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
          .max(caps.maxBatchTasks),
        concurrency: z.number().int().min(1).max(caps.maxConcurrency).optional(),
      },
    },
    async ({ requests, concurrency }) => {
      const result = await batchChat(requests, concurrency);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );
}
