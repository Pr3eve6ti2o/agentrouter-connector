// Source: Astra R-09b2a + R-09b2b (recovered 2026-10-23), verbatim extraction.
// [glue] 2026-10-23 glue pass (see BUILD-REPORT.md): keys now come from Astra's
// config loader (AGENTROUTER_KEY_1/2) with the fragment's AGENTROUTER_KEYS
// parsing kept as fallback, and the registration is wrapped in registerHealth().
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config.js";

// --- R-09b2a (Astra, verbatim) ---
async function health(keys: readonly string[]) {
  return Promise.all(keys.map(async (key, keyIndex) => {
    try {
      const response = await fetch("https://agentrouter.org/v1/models", {
        method: "GET",
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${key}`,
          Originator: "codex_cli_rs",
          Version: "0.101.0",
        },
        signal: AbortSignal.timeout(15_000),
      });
      const status = response.status;
      await response.body?.cancel().catch(() => {});
      const kind =
        status === 200 ? "ok" :
        status === 401 ? "client-or-token" :
        status === 402 ? "pool" :
        status === 503 ? "no-channel" : "error";
      return { keyIndex, ok: status === 200, status, kind };
    } catch {
      return { keyIndex, ok: false, status: 0, kind: "error" };
    }
  }));
}

// --- R-09b2b (Astra, verbatim; keys source + registration wrapper by glue) ---
// [glue] Was: keys parsed only from AGENTROUTER_KEYS, which nothing else in
// the project sets. Now the config loader's keys win; AGENTROUTER_KEYS is
// kept as a fallback using the fragment's own parsing.
const keys: readonly string[] = config.apiKeys.length
  ? config.apiKeys
  : (process.env.AGENTROUTER_KEYS ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);

// [glue] The fragment referenced a bare `server`; wrapped in a register fn.
export function registerHealth(server: McpServer): void {
  server.registerTool("agentrouter_health", { inputSchema: {} }, async () => {
    try {
      const result = await health(keys);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      };
    }
  });
}
