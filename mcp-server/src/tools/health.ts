// Sol 2026-10-31 revision: both-host probes, full client headers,
// upstream classifier kinds, and latency per combo.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config.js";
import { hosts, classifyUpstream } from "../upstream.js";

async function health(keys: readonly string[]) {
  const results: {
    host: string;
    keyIndex: number;
    ok: boolean;
    status: number;
    kind: string;
    latencyMs: number;
  }[] = [];

  for (const host of hosts()) {
    for (const [keyIndex, key] of keys.entries()) {
      const startedAt = Date.now();

      try {
        const response = await fetch(`https://${host}/v1/models`, {
          method: "GET",
          redirect: "manual",
          headers: {
            Authorization: `Bearer ${key}`,
            Originator: "codex_cli_rs",
            Version: "0.101.0",
            "User-Agent":
              "codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464",
          },
          signal: AbortSignal.timeout(15_000),
        });
        const status = response.status;
        await response.body?.cancel().catch(() => {});
        const { kind } = classifyUpstream(status, "");

        results.push({
          host,
          keyIndex,
          ok: status === 200,
          status,
          kind,
          latencyMs: Date.now() - startedAt,
        });
      } catch {
        results.push({
          host,
          keyIndex,
          ok: false,
          status: 0,
          kind: "upstream-transient",
          latencyMs: Date.now() - startedAt,
        });
      }
    }
  }

  return results;
}

// Prefer configured keys; retain AGENTROUTER_KEYS as a fallback.
const keys: readonly string[] = config.apiKeys.length
  ? config.apiKeys
  : (process.env.AGENTROUTER_KEYS ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);

export function registerHealth(server: McpServer): void {
  server.registerTool("agentrouter_health", { inputSchema: {} }, async () => {
    try {
      const result = await health(keys);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  });
}
