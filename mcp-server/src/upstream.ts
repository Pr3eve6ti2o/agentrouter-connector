// Sol revision 2026-10-31, part A of 3, rotation/retry core for the MCP v2 upgrade;
// original 2026-10-23 glue header preserved in spirit.
import { appendFile, readFile } from "node:fs/promises";
import { config } from "./config.js";

export const apiKeys = config.apiKeys;

export function hosts(): string[] {
  return [...config.hosts];
}
export function retryRounds(): number {
  return config.retryRounds;
}
export function responsesTimeoutMs(): number {
  return config.timeoutMs;
}
export function astraMaxTokens(): number {
  return config.astraMaxTokens;
}

const clientHeaders = {
  Originator: "codex_cli_rs",
  Version: "0.101.0",
  "User-Agent": "codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464",
  "Content-Type": "application/json",
};

export function isAnthropic(model: string): boolean {
  return /claude/i.test(model);
}

export type Combo = { host: string; key: string; keyIndex: number };
export function combos(): Combo[] {
  return hosts().flatMap(host => apiKeys.map((key, keyIndex) => ({ host, key, keyIndex })));
}

export type UpstreamKind =
  | "ok" | "auth-client" | "auth-token" | "pool-exhausted" | "pool-quota-403"
  | "forbidden" | "rate-limited" | "no-channel" | "upstream-transient"
  | "bad-request" | "unknown";

export function classifyUpstream(
  status: number | null, bodyText: string, transportError?: unknown,
): { kind: UpstreamKind; fix: string } {
  if (transportError !== undefined || status === null || status === 0)
    return { kind: "upstream-transient", fix: "Retry on another host x key combo; this is a transient transport failure, not a dead key." };
  if (status >= 200 && status < 300)
    return { kind: "ok", fix: "No action needed." };
  if (status === 401 && /unauthorized[\s_-]+client/i.test(bodyText))
    return { kind: "auth-client", fix: "Check client headers; this is not a dead key." };
  if (status === 401)
    return { kind: "auth-token", fix: "Refresh or replace the token." };
  if (status === 402)
    return { kind: "pool-exhausted", fix: "Fail over to the other key; pools refill." };
  if (status === 403 && (/quota/i.test(bodyText) || /not enough/i.test(bodyText)))
    return { kind: "pool-quota-403", fix: "That key's quota is exhausted; fail over to the other key." };
  if (status === 403)
    return { kind: "forbidden", fix: "Inspect the response; do not retry blindly." };
  if (status === 429)
    return { kind: "rate-limited", fix: "Retry with backoff; do not raise caps." };
  if (status === 503)
    return { kind: "no-channel", fix: "Check the live model list; the model may be off-list." };
  if (status === 502 || status === 504)
    return { kind: "upstream-transient", fix: "Retry on another host x key combo." };
  if (status === 400)
    return { kind: "bad-request", fix: "Validate the request payload; do not retry." };
  return { kind: "unknown", fix: "Inspect the response and server logs." };
}

export function redact(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-…[redacted]");
}

export async function rawRequest(
  host: string, path: "/responses" | "/messages", body: unknown,
  key: string, timeoutMs: number,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`https://${host}/v1${path}`, {
    method: "POST",
    headers: {
      ...clientHeaders,
      Authorization: `Bearer ${key}`,
      ...(path === "/messages" ? { "anthropic-version": "2023-06-01" } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, text: await response.text() };
}

export function pauseForAttempt(attemptIndex: number): Promise<void> {
  const delay = Math.min(2000 + attemptIndex * 500, 5000) + Math.floor(Math.random() * 1001);
  return new Promise<void>(resolve => setTimeout(resolve, delay));
}

export function isRetryable(status: number | null, transportError?: unknown): boolean {
  if (transportError !== undefined || status === null || status === 0) return true;
  return [401, 402, 403, 429, 502, 503, 504].includes(status) || status >= 500;
}

export type ChatOptions = {
  rounds?: number; timeoutMs?: number; maxTokens?: number; effort?: "max" | "low";
};
export type ChatDetail = {
  value: unknown; attempts: number; host: string; keyIndex: number; latencyMs: number;
};

function buildBody(model: string, prompt: string, options: ChatOptions): unknown {
  if (isAnthropic(model)) return {
    model, messages: [{ role: "user", content: prompt }],
    max_tokens: options.maxTokens ?? 512, stream: false
  };
  const astra = model.toLowerCase() === "gpt-6-astra";
  if (astra && options.effort === "low")
    throw new Error("reasoning effort 'low' is rejected for gpt-6-astra and must not be sent");
  if (options.effort !== undefined && options.effort !== "max" && options.effort !== "low")
    throw new Error(`unknown effort: ${String(options.effort)}`);
  const cap = astra
    ? (options.maxTokens == null ? astraMaxTokens() : Math.min(options.maxTokens, 16000))
    : options.maxTokens ?? 3200;
  return {
    model, input: [{ role: "user", content: prompt }],
    max_output_tokens: cap, store: false, stream: false,
    ...(options.effort === "max" ? { reasoning: { effort: "max" } } :
      options.effort === "low" ? { reasoning: { effort: "low" } } : {})
  };
}

function extractUsage(value: unknown): { tokens: number; reasoningTokens: number; textTokens: number } {
  const usage = (value as any)?.usage;
  if (!usage || typeof usage !== "object")
    return { tokens: 0, reasoningTokens: 0, textTokens: 0 };
  const tokens = typeof usage.total_tokens === "number" ? usage.total_tokens
    : typeof usage.input_tokens === "number" && typeof usage.output_tokens === "number"
      ? usage.input_tokens + usage.output_tokens
      : typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  const reasoningTokens = typeof reasoning === "number" ? reasoning
    : typeof usage.reasoning_tokens === "number" ? usage.reasoning_tokens : 0;
  return { tokens, reasoningTokens, textTokens: tokens > 0 ? Math.max(0, tokens - reasoningTokens) : 0 };
}

type RunResult =
  | { ok: true; detail: ChatDetail }
  | {
    ok: false; error: Error; attempts: number; host: string; keyIndex: number;
    status: number | null; kind: UpstreamKind; latencyMs: number;
  };

async function runDetailed(
  task: { model: string; prompt: string }, options: ChatOptions
): Promise<RunResult> {
  const body = buildBody(task.model, task.prompt, options);
  const anthropic = isAnthropic(task.model);
  const rounds = Math.max(1, options.rounds ?? retryRounds());
  const timeoutMs = options.timeoutMs ?? (anthropic ? 120000 : responsesTimeoutMs());
  const path = anthropic ? "/messages" : "/responses";
  const matrix = combos();
  if (!matrix.length) throw new Error("No host x key combos configured for AgentRouter");
  let attempts = 0, latencyMs = 0;
  let lastStatus: number | null = null;
  let lastKind: UpstreamKind = "upstream-transient";
  let lastText = "", lastHost = "", lastKeyIndex = -1;
  outer: for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < matrix.length; i++) {
      const combo = matrix[i];
      const attemptIndex = attempts++, callStart = Date.now();
      lastHost = combo.host;
      lastKeyIndex = combo.keyIndex;
      let reply: { status: number; text: string } | undefined;
      try {
        reply = await rawRequest(combo.host, path, body, combo.key, timeoutMs);
      } catch (error) {
        lastStatus = null;
        lastKind = classifyUpstream(null, "", error).kind;
        lastText = String((error as any)?.message ?? error);
      }
      if (reply) {
        const { status, text } = reply;
        if (status >= 200 && status <= 299) {
          let value: unknown;
          try { value = JSON.parse(text); }
          catch { throw new Error("AgentRouter returned invalid JSON"); }
          return {
            ok: true, detail: {
              value, attempts: attemptIndex + 1, host: combo.host,
              keyIndex: combo.keyIndex, latencyMs: Date.now() - callStart
            }
          };
        }
        lastStatus = status;
        lastKind = classifyUpstream(status, text).kind;
        lastText = text;
      }
      latencyMs = Date.now() - callStart;
      if (reply && !isRetryable(reply.status)) break outer;
      if (i + 1 < matrix.length || round + 1 < rounds) await pauseForAttempt(attemptIndex);
    }
  }
  return {
    ok: false,
    error: new Error(`AgentRouter ${path} (${lastStatus ?? "transport"}) [${lastKind}]: ${redact(lastText).slice(0, 2048)}`),
    attempts, host: lastHost, keyIndex: lastKeyIndex,
    status: lastStatus, kind: lastKind, latencyMs
  };
}

export async function chatDetailed(
  task: { model: string; prompt: string }, options: ChatOptions = {}
): Promise<ChatDetail> {
  const result = await runDetailed(task, options);
  if (result.ok === false) {
    const error = result.error;
    (error as any).attempts = result.attempts;
    (error as any).host = result.host;
    (error as any).keyIndex = result.keyIndex;
    (error as any).status = result.status;
    (error as any).kind = result.kind;
    (error as any).latencyMs = result.latencyMs;
    throw error;
  }
  return result.detail;
}

export async function chatOnce(
  task: { model: string; prompt: string }, options: ChatOptions = {}
): Promise<unknown> {
  return (await chatDetailed(task, options)).value;
}

// appendLedger is defined in Part C after concatenation.
export async function chatWithRetry(
  task: { model: string; prompt: string }, options: ChatOptions = {}
): Promise<unknown> {
  const result = await runDetailed(task, options);
  if (result.ok === false) {
    try {
      await appendLedger({
        model: task.model, tokens: 0, host: result.host, keyIndex: result.keyIndex,
        status: result.status, errorKind: result.kind, attempts: result.attempts,
        latencyMs: result.latencyMs, reasoningTokens: 0, textTokens: 0
      });
    } catch { /* Best effort. */ }
    throw result.error;
  }
  const { detail } = result;
  const usage = extractUsage(detail.value);
  try {
    await appendLedger({
      model: task.model, tokens: usage.tokens, host: detail.host, keyIndex: detail.keyIndex,
      status: 200, errorKind: "ok", attempts: detail.attempts, latencyMs: detail.latencyMs,
      reasoningTokens: usage.reasoningTokens, textTokens: usage.textTokens
    });
  } catch { /* Best effort. */ }
  return detail.value;
}

// probes and ledger (Part C).
function pingBody(model: string): unknown {
  return isAnthropic(model)
    ? { model, messages: [{ role: "user", content: "ping" }], max_tokens: 16 }
    : { model, input: "ping", max_output_tokens: 16, store: false };
}

export async function probeCombo(
  model: string, host: string, key: string
): Promise<{ status: number; body: string; host: string; latencyMs: number }> {
  const started = Date.now();
  try {
    const { status, text } = await rawRequest(
      host, isAnthropic(model) ? "/messages" : "/responses",
      pingBody(model), key, 60000
    );
    return { status, body: text, host, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      status: 0, body: String((error as any)?.message ?? error),
      host, latencyMs: Date.now() - started
    };
  }
}

export async function probe(
  model: string, key: string
): Promise<{ status: number; body: string }> {
  const { status, body } = await probeCombo(model, hosts()[0] || "agentrouter.org", key);
  return { status, body };
}

export async function probeOnce(model: string, key: string): Promise<{ status: number }> {
  const { status } = await probe(model, key);
  return { status };
}

export async function probeAll(model: string): Promise<Array<{
  host: string; keyIndex: number; status: number; body: string; latencyMs: number;
}>> {
  const results: Array<{
    host: string; keyIndex: number; status: number; body: string; latencyMs: number;
  }> = [];
  for (const combo of combos()) {
    const key = (combo as Combo & { key?: string }).key ?? apiKeys[combo.keyIndex];
    const result = await probeCombo(model, combo.host, key);
    results.push({ ...result, keyIndex: combo.keyIndex });
  }
  return results;
}

function ledgerPath(): string {
  return process.env.AGENTROUTER_LEDGER_PATH?.trim() || "ledger.jsonl";
}

export type LedgerEntry = {
  ts?: string; model: string; tokens: number; host?: string; keyIndex?: number;
  status?: number | null; errorKind?: string | null; attempts?: number;
  latencyMs?: number; reasoningTokens?: number; textTokens?: number;
};

export async function appendLedger(entry: LedgerEntry): Promise<void> {
  try {
    const row = {
      ts: new Date().toISOString(), ...entry,
      host: entry.host ?? "unknown",
      keyIndex: entry.keyIndex ?? -1,
      status: entry.status ?? null,
      errorKind: entry.errorKind ?? null,
      attempts: entry.attempts ?? 1,
      latencyMs: entry.latencyMs ?? 0,
      reasoningTokens: entry.reasoningTokens ?? 0,
      textTokens: entry.textTokens ?? 0
    };
    await appendFile(ledgerPath(), JSON.stringify(row) + "\n", "utf8");
  } catch {}
}

export async function readLedgerEntries(): Promise<LedgerEntry[]> {
  try {
    const entries: LedgerEntry[] = [];
    const text = await readFile(ledgerPath(), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch {}
    }
    return entries;
  } catch {
    return [];
  }
}

export async function readLedgerTotals(): Promise<{
  entries: number; totalTokens: number; byModel: Record<string, number>;
  byCombo: Record<string, {
    attempts: number; successes: number; failures: number; totalLatencyMs: number;
  }>;
}> {
  const entries = await readLedgerEntries();
  let totalTokens = 0;
  const byModel: Record<string, number> = Object.create(null);
  const byCombo: Record<string, {
    attempts: number; successes: number; failures: number; totalLatencyMs: number;
  }> = Object.create(null);
  for (const entry of entries) {
    const tokens = typeof entry?.tokens === "number" ? entry.tokens : 0;
    totalTokens += tokens;
    const model = entry?.model;
    byModel[model] = (byModel[model] ?? 0) + tokens;
    const id = `${entry?.host ?? "unknown"}:${entry?.keyIndex ?? -1}`;
    const group = byCombo[id] ??= {
      attempts: 0, successes: 0, failures: 0, totalLatencyMs: 0
    };
    group.attempts += entry?.attempts ?? 1;
    const status = entry?.status;
    const success = typeof status === "number" && status >= 200 && status <= 299;
    group.successes += success ? 1 : 0;
    group.failures += success ? 0 : 1;
    group.totalLatencyMs += typeof entry?.latencyMs === "number" ? entry.latencyMs : 0;
  }
  return {
    entries: entries.length, totalTokens,
    byModel: { ...byModel }, byCombo: { ...byCombo }
  };
}
