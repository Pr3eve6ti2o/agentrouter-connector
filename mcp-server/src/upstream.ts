// ORION GLUE — not Astra's code. Shared upstream helpers that Astra's recovered
// tool fragments assume but never defined: probe / probeOnce (diagnostics,
// smoke-test), appendLedger / redact / readLedgerTotals (batch, diagnostics).
// Plus chatOnce: a single prompt->response call on the same request shape as
// src/server.ts (S-09a), with two-key failover in config order on 401/402/503.
// Added in the 2026-10-23 glue pass; every change is listed in BUILD-REPORT.md.
import { appendFile, readFile } from "node:fs/promises";
import { config } from "./config.js";

const base = "https://agentrouter.org/v1";
export const apiKeys: readonly string[] = config.apiKeys;

// Same client-identity header set as src/server.ts, plus the User-Agent from
// the measured codex_cli_rs header set (S-03 routing design).
const clientHeaders = {
  Originator: "codex_cli_rs",
  Version: "0.101.0",
  "User-Agent": "codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464",
  "Content-Type": "application/json",
};

export function isAnthropic(model: string): boolean {
  return /claude/i.test(model);
}

async function rawRequest(
  path: "/responses" | "/messages",
  body: unknown,
  key: string,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      ...clientHeaders,
      ...(path === "/messages" ? { "anthropic-version": "2023-06-01" } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  return { status: response.status, text: await response.text() };
}

// Body shapes mirror src/server.ts's agentrouter_chat: Anthropic Messages for
// Claude models, Responses for everything else. Token caps mirror the probe
// practice for these models (Responses models need headroom for hidden
// reasoning; no `reasoning` field is sent, per Astra's design).
export async function chatOnce(task: { model: string; prompt: string }): Promise<unknown> {
  const anthropic = isAnthropic(task.model);
  const body = anthropic
    ? {
        model: task.model,
        messages: [{ role: "user", content: task.prompt }],
        max_tokens: 512,
        stream: false,
      }
    : {
        model: task.model,
        input: [{ role: "user", content: task.prompt }],
        max_output_tokens: 3200,
        store: false,
        stream: false,
      };
  let lastError: unknown;
  for (const key of apiKeys) {
    const { status, text } = await rawRequest(anthropic ? "/messages" : "/responses", body, key);
    if (status >= 200 && status < 300) {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("AgentRouter returned invalid JSON");
      }
    }
    lastError = new Error(
      `AgentRouter ${anthropic ? "/messages" : "/responses"} (${status}): ${redact(text).slice(0, 2048)}`,
    );
    if (![401, 402, 503].includes(status)) break;
  }
  throw lastError;
}

// Tiny per-key x per-model probe used by diagnostics: returns the raw status
// and body text (the caller classifies; body text decides 401 subtypes).
export async function probe(
  model: string,
  key: string,
): Promise<{ status: number; body: string }> {
  const anthropic = isAnthropic(model);
  const body = anthropic
    ? { model, messages: [{ role: "user", content: "ping" }], max_tokens: 16 }
    : { model, input: "ping", max_output_tokens: 16, store: false };
  const { status, text } = await rawRequest(anthropic ? "/messages" : "/responses", body, key);
  return { status, body: text };
}

export async function probeOnce(
  model: string,
  key: string,
): Promise<{ status: number }> {
  const { status } = await probe(model, key);
  return { status };
}

// --- Local ledger (ledger.jsonl; see S-05: local activity record, not quota) ---
const ledgerPath = (): string =>
  process.env.AGENTROUTER_LEDGER_PATH?.trim() || "ledger.jsonl";

export async function appendLedger(entry: { model: string; tokens: number }): Promise<void> {
  try {
    await appendFile(
      ledgerPath(),
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
    );
  } catch {
    // Best-effort: a ledger failure must not fail the chat it records.
  }
}

export async function readLedgerTotals(): Promise<{
  entries: number;
  totalTokens: number;
  byModel: Record<string, number>;
}> {
  try {
    const raw = await readFile(ledgerPath(), "utf8");
    const byModel: Record<string, number> = {};
    let entries = 0;
    let totalTokens = 0;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { model?: string; tokens?: number };
        entries++;
        const tokens = typeof entry.tokens === "number" ? entry.tokens : 0;
        totalTokens += tokens;
        if (entry.model) byModel[entry.model] = (byModel[entry.model] ?? 0) + tokens;
      } catch {
        // Skip a torn final line.
      }
    }
    return { entries, totalTokens, byModel };
  } catch {
    return { entries: 0, totalTokens: 0, byModel: {} };
  }
}

export function redact(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-…[redacted]");
}
