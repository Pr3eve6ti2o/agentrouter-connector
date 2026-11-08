// Source: Astra S-08b (config loader + package.json header), verbatim extraction.
// COMPLETED 2026-10-23: the original answer ended mid-statement at a bare trailing
// `export`; Astra's recovered tail (R-08btail) now completes it — see the [join]
// note at the end of this file.

// Built with mcp-server/tsconfig.json: strict is true and declarations are not emitted.
import { env } from "node:process";
import { parseApiKeys, parseHosts } from "./env.js";

export const caps = Object.freeze({
  maxConcurrency: 8,
  maxBatchTasks: 32,
} as const);

type Api = "responses" | "anthropic";

// Require deployment-verified limits rather than inventing model specifications.
// For each prefix below, set _CONTEXT_TOKENS, _EFFORT_MIN, and _EFFORT_MAX.
// Context is measured in tokens; effort endpoints are provider-defined labels.
export function loadConfig(source: NodeJS.ProcessEnv = env) {
  const required = (name: string): string => {
    const value = source[name]?.trim();
    if (!value) throw new Error(`Missing environment variable: ${name}`);
    return value;
  };

    const optional = <T>(
    name: string, fallback: T, parse: (value: string) => T | undefined
  ): T => {
    const raw = source[name];
    const value = raw?.trim();
    const parsed = value ? parse(value) : undefined;
    if (raw !== undefined && (parsed === undefined || parsed === null)) {
      console.error(
        `Warning: ${name} is set but invalid; using fallback:`, fallback
      );
    }
    return parsed ?? fallback;
  };

  const clampedInteger = (min: number, max: number) =>
    (raw: string): number | undefined => {
      if (!/^[+-]?\d+$/.test(raw)) return undefined;
      const value = Number(raw);
      return Number.isInteger(value)
        ? Math.min(max, Math.max(min, value))
        : undefined;
    };

  const apiKeys = parseApiKeys(source);
  if (!apiKeys.length)
    throw new Error("Set AGENTROUTER_KEY_1 and/or AGENTROUTER_KEY_2");

  const model = <A extends Api>(api: A, prefix: string) => {
    const name = `${prefix}_CONTEXT_TOKENS`;
    const raw = required(name);
    const context = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(context))
      throw new Error(`${name} must be a positive safe integer`);
    return Object.freeze({
      api, context,
      effortRange: Object.freeze({
        min: required(`${prefix}_EFFORT_MIN`),
        max: required(`${prefix}_EFFORT_MAX`),
      }),
    });
  };

  const models = Object.freeze({
    "gpt-6-astra": model("responses", "AGENTROUTER_GPT_6_ASTRA"),
    "deepseek-v4-flash": model("responses", "AGENTROUTER_DEEPSEEK_V4_FLASH"),
    "claude-opus-5": model("anthropic", "AGENTROUTER_CLAUDE_OPUS_5"),
    "claude-opus-4-8": model("anthropic", "AGENTROUTER_CLAUDE_OPUS_4_8"),
  });

  const hosts = optional<string[]>(
    "AGENTROUTER_HOSTS",
    ["agentrouter.org", "ps.air-outer.com"],
    () => parseHosts(source)
  );
  const retryRounds = optional(
    "AGENTROUTER_RETRY_ROUNDS", 3, clampedInteger(1, 10)
  );
  // 2026-11-07: raised after the gateway error was diagnosed. A streamed
  // max-reasoning generation can legitimately run ~15 min (32k tokens at
  // ~37 tok/s), so the per-attempt timeout default is 20 min, cap 30 min.
  // The Astra output cap is 32,000: B1a2a provably needed 16,536 reasoning
  // tokens, more than the old 16,000 cap, and starved with zero text.
  const timeoutMs = optional(
    "AGENTROUTER_TIMEOUT_MS", 1200000, clampedInteger(10000, 1800000)
  );
  const astraMaxTokens = optional(
    "AGENTROUTER_ASTRA_MAX_TOKENS", 32000, clampedInteger(1000, 32000)
  );
  const ledgerPath = optional<string | undefined>(
    "AGENTROUTER_LEDGER_PATH", undefined, (value) => value
  );

  return Object.freeze({
    apiKeys: Object.freeze(apiKeys), models, caps,
    hosts, retryRounds, timeoutMs, astraMaxTokens, ledgerPath,
  });
}

// Validate on import. Never log this credential-bearing object to MCP stdout.
export const config = loadConfig();
export const MODELS = config.models;
export type ModelId = keyof typeof MODELS;
export type Config = ReturnType<typeof loadConfig>;
// [join: the line above is Astra's recovered tail (R-08btail, 2026-10-23, API 1, 1 attempt) completing the truncated final export.]
