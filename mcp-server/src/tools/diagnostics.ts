// Source: Astra R-10a1a + R-10a1b + R-10a1c (recovered 2026-10-23), verbatim extraction.
// [glue] 2026-10-23 glue pass (see BUILD-REPORT.md): imports for the assumed
// helpers (probe, readLedgerTotals), classifyStatus exported for smoke-test,
// the classifier call now passes the probe body text, and the registration is
// wrapped in registerDiagnostics(server, keys) with a default model list.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { probe, readLedgerTotals } from "../upstream.js";

// --- R-10a1a (Astra, verbatim) ---
type StatusKind =
  | "ok" | "auth-client" | "auth-token" | "pool-exhausted"
  | "bad-request" | "rate-limited" | "no-channel" | "unknown"
  // [Orion] 2026-10-23 addition (user order): Azure resource state-mismatch
  // kind, added next to Astra's taxonomy above.
  | "upstream-state-mismatch";

// [glue] `export` added: smoke-test.ts imports this classifier.
export function classifyStatus(status: number, bodyText: string): { kind: StatusKind; fix: string } {
  // [Orion] 2026-10-23 addition (user order): checked BEFORE the generic 400
  // bucket — Responses-API state (resp_…/reasoning/conversation items) is
  // pinned to one upstream Azure resource; a chained follow-up routed to a
  // different resource in the gateway pool fails with this body text.
  if (/different Azure OpenAI resource/i.test(bodyText)) {
    return { kind: "upstream-state-mismatch", fix: "State from a previous response is pinned to a different upstream Azure resource. Start a fresh stateless request — do not pass previous_response_id or prior output items; retrying the same chain may keep failing. Stateless callers (this MCP) are unaffected." };
  }
  switch (status) {
    case 200:
      return { kind: "ok", fix: "No action needed." };
    case 401:
      return /unauthorized[\s_-]+client/i.test(bodyText)
        ? { kind: "auth-client", fix: "Check client authorization." }
        : { kind: "auth-token", fix: "Refresh or replace the token." };
    case 402:
      return { kind: "pool-exhausted", fix: "Replenish or switch the account pool." };
    case 400:
      return { kind: "bad-request", fix: "Validate the request payload." };
    case 429:
      return { kind: "rate-limited", fix: "Retry with exponential backoff." };
    case 503:
      return { kind: "no-channel", fix: "Enable a channel for the requested model." };
    default:
      return { kind: "unknown", fix: "Inspect the response and server logs." };
  }
}

// --- R-10a1b (Astra, verbatim) ---
async function diagnose(models: readonly string[], keys: readonly string[]) {
  const results = await Promise.all(
    keys.flatMap((key, keyIndex) =>
      models.map(async (model) => {
        const { status, body } = await probe(model, key);
        return {
          model,
          keyIndex,
          status,
          body,
          // [glue] Was classifyStatus(status): the probe's body text is
          // required — it is what separates 401 auth-client from auth-token.
          classification: classifyStatus(status, body),
        };
      })
    )
  );

  const ledger = await readLedgerTotals();
  return { results, ledger };
}

// --- R-10a1c (Astra, verbatim; registration wrapped by glue) ---
import { z } from "zod";

// [glue] The fragment referenced bare `server` and `keys`; wrapped in a
// register function taking both, and the optional `models` input now falls
// back to the four configured models (config-schema.json).
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
