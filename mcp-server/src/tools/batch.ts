// Source: Astra R-09b1a + R-09b1b + R-09b1c (recovered 2026-10-23), verbatim extraction.
// [glue] 2026-10-23 glue pass (see BUILD-REPORT.md): imports for the helpers the
// fragments assume, an optional `concurrency` parameter on batchChat, and the
// registration wrapped in registerBatch() with chatOnce + concurrency forwarded.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appendLedger, chatOnce, redact } from "../upstream.js";

// --- R-09b1a (Astra, verbatim) ---
type ChatTask = { model: string; prompt: string };
type ChatResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

async function batchChat<T>(
  tasks: ChatTask[],
  chatOnce: (task: ChatTask) => Promise<T>,
  // [glue] was: no third parameter; the pool size was hard-coded to 8 below.
  concurrency = 8
): Promise<ChatResult<T>[]> {
  if (tasks.length > 32) throw new RangeError("At most 32 tasks are allowed");
  const results = new Array<ChatResult<T>>(tasks.length);
  let next = 0;

  // A fixed worker pool limits concurrency to eight calls.
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await chatOnce(tasks[i]!) };
      } catch (error) {
        results[i] = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  // [glue] was Math.min(8, tasks.length): now the forwarded concurrency.
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

// --- R-09b1b (Astra, verbatim) ---
async function chatWithRetry<T, R extends { model: string; tokens: number }>(
  task: T,
  chatOnce: (task: T) => Promise<R>
): Promise<R | string> {
  let lastError: unknown;
  for (let n = 0; n < 3; n++) {
    try {
      const result = await chatOnce(task);
      await appendLedger({ model: result.model, tokens: result.tokens });
      return result;
    } catch (error: unknown) {
      lastError = error;
      if (n < 2) {
        await new Promise<void>(resolve =>
          setTimeout(resolve, 250 * 2 ** n + Math.floor(Math.random() * 250))
        );
      }
    }
  }
  return redact(lastError instanceof Error ? lastError.message : String(lastError));
}

// --- R-09b1c (Astra, verbatim; registration wrapped by glue) ---
import { z } from "zod";

// [glue] The fragment referenced a bare `server` and called
// batchChat(requests) with no chatOnce; wrapped in a register function and
// the shared chatOnce + the caller's concurrency are now forwarded.
export function registerBatch(server: McpServer): void {
  server.registerTool(
    "agentrouter_batch_chat",
    {
      inputSchema: {
        requests: z
          .array(z.object({ model: z.string(), prompt: z.string() }))
          .max(32),
        concurrency: z.number().int().min(1).max(8).optional(),
      },
    },
    async ({ requests, concurrency }) => {
      // [glue] Cast: the SDK's schema inference types the array elements'
      // fields as optional; the zod schema above still validates them as
      // required strings at runtime.
      const result = await batchChat(requests as ChatTask[], chatOnce, concurrency ?? 8);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );
}
