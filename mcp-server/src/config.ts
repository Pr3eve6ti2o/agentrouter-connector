// Source: Astra S-08b (config loader + package.json header), verbatim extraction.
// COMPLETED 2026-10-23: the original answer ended mid-statement at a bare trailing
// `export`; Astra's recovered tail (R-08btail) now completes it — see the [join]
// note at the end of this file.

/* package.json (save this file as config.ts)
{
  "name": "agentrouter-mcp-config",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/config.js",
  "types": "./dist/config.d.ts",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc --strict --target ES2022 --module NodeNext --declaration --outDir dist config.ts"
  },
  "devDependencies": { "@types/node": "^22.0.0", "typescript": "^5.7.0" }
}
*/
import { env } from "node:process";

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
    const value = source[name]?.trim();
    return value ? parse(value) ?? fallback : fallback;
  };

  const clampedInteger = (min: number, max: number) =>
    (raw: string): number | undefined => {
      if (!/^[+-]?\d+$/.test(raw)) return undefined;
      const value = Number(raw);
      return Number.isInteger(value)
        ? Math.min(max, Math.max(min, value))
        : undefined;
    };

  const apiKeys = [...new Set(
    [source.AGENTROUTER_KEY_1, source.AGENTROUTER_KEY_2]
      .map(key => key?.trim()).filter((key): key is string => !!key)
  )];
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
    raw => {
      const parsed = [...new Set(
        raw.split(",").map(host => host.trim()).filter(host => !!host)
      )];
      const hostname = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;
      return parsed.length && parsed.every(host =>
        host.length <= (host.endsWith(".") ? 254 : 253) && hostname.test(host)
      )
        ? parsed
        : undefined;
    }
  );
  const retryRounds = optional(
    "AGENTROUTER_RETRY_ROUNDS", 3, clampedInteger(1, 10)
  );
  const timeoutMs = optional(
    "AGENTROUTER_TIMEOUT_MS", 600000, clampedInteger(10000, 600000)
  );
  const astraMaxTokens = optional(
    "AGENTROUTER_ASTRA_MAX_TOKENS", 12000, clampedInteger(1000, 16000)
  );

  return Object.freeze({
    apiKeys: Object.freeze(apiKeys), models, caps,
    hosts, retryRounds, timeoutMs, astraMaxTokens,
  });
}

// Validate on import. Never log this credential-bearing object to MCP stdout.
export const config = loadConfig();
export const MODELS = config.models;
export type ModelId = keyof typeof MODELS;
export
type Config = ReturnType<typeof loadConfig>;
// [join: the line above is Astra's recovered tail (R-08btail, 2026-10-23, API 1, 1 attempt) completing the truncated final export.]
