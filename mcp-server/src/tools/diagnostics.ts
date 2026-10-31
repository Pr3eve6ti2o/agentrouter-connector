// Sol 2026-10-31 revision: both-host probes, upstream classifier,
// state-mismatch kind, and per-combo recent rates.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  hosts,
  probeCombo,
  classifyUpstream,
  readLedgerTotals,
  readLedgerEntries,
} from "../upstream.js";

// --- R-10a1a (Astra, revised by Sol; merged 2026-10-31 with upstream
// 2d96484 state-mismatch check, preserved verbatim below) ---
export function classifyStatus(
  status: number,
  bodyText: string,
  hint?: string,
): { kind: string; fix: string } {
  // [Upstream 2d96484, preserved] Checked BEFORE any other bucket —
  // Responses-API state (resp_…/reasoning/conversation items) is pinned to
  // one upstream Azure resource; a chained follow-up routed to a different
  // resource in the gateway pool fails with this body text.
  if (/different Azure OpenAI resource/i.test(bodyText)) {
    return { kind: "upstream-state-mismatch", fix: "State from a previous response is pinned to a different upstream Azure resource. Start a fresh stateless request — do not pass previous_response_id or prior output items; retrying the same chain may keep failing. Stateless callers (this MCP) are unaffected." };
  }
  if (
    hint === "state-mismatch" ||
    (/previous_response/i.test(bodyText) && /state|mismatch|affinity/i.test(bodyText))
  ) {
    return {
      kind: "upstream-state-mismatch",
      fix: "Use a fresh stateless request; never resume the chain. Chained Responses state is pinned to one upstream resource and follow-ups routed elsewhere fail.",
    };
  }

  return classifyUpstream(status, bodyText);
}

// --- R-10a1b (Astra, revised by Sol) ---
type RecentComboStats = {
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  entries: number;
};

async function diagnose(models: readonly string[], keys: readonly string[]) {
  const results: Array<{
    model: string;
    host: string;
    keyIndex: number;
    status: number;
    body: string;
    latencyMs: number;
    classification: ReturnType<typeof classifyStatus>;
  }> = [];

  for (const model of models) {
    for (const host of hosts()) {
      for (const [keyIndex, key] of keys.entries()) {
        const { status, body, latencyMs } = await probeCombo(model, host, key);
        results.push({
          model,
          host,
          keyIndex,
          status,
          body,
          latencyMs,
          classification: classifyStatus(status, body),
        });
      }
    }
  }

  const ledger = await readLedgerTotals();
  const entries = await readLedgerEntries();
  const recent: Record<string, RecentComboStats> = {};
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;

  for (const entry of entries) {
    const timestamp =
      typeof entry.ts === "number"
        ? entry.ts
        : typeof entry.ts === "string"
          ? Date.parse(entry.ts)
          : NaN;

    if (
      !Number.isFinite(timestamp) ||
      timestamp < cutoff ||
      timestamp > now ||
      entry.host == null ||
      entry.keyIndex == null
    ) {
      continue;
    }

    const combo = `${entry.host}:${entry.keyIndex}`;
    const stats = recent[combo] ?? (recent[combo] = {
      attempts: 0,
      successes: 0,
      failures: 0,
      successRate: 0,
      entries: 0,
    });

    stats.attempts += entry.attempts ?? 1;
    stats.entries += 1;

    if (entry.status >= 200 && entry.status <= 299) {
      stats.successes += 1;
    } else {
      stats.failures += 1;
    }
  }

  for (const stats of Object.values(recent)) {
    stats.successRate = stats.entries === 0 ? 0 : stats.successes / stats.entries;
  }

  return { results, ledger, recent };
}

// --- R-10a1c (Astra; registration wrapped by glue) ---
export function registerDiagnostics(server: McpServer, keys: readonly string[]): void {
  server.registerTool(
    "agentrouter_diagnose",
    { inputSchema: { models: z.array(z.string()).optional() } },
    async ({ models }) => {
      try {
        const result = await diagnose(
          models ?? ["gpt-6-astra", "deepseek-v4-flash", "claude-opus-5", "claude-opus-4-8"],
          keys,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );
}
