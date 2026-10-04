import process from 'node:process';

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function int(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}`);
  return n;
}

export const config = {
  upstream: {
    baseUrl: process.env.AGENTROUTER_BASE_URL ?? 'https://agentrouter.org/v1',
    key: process.env.AGENTROUTER_KEY ?? '',
    compatHeaders: bool('AGENTROUTER_COMPAT_HEADERS', true),
    originator: process.env.AGENTROUTER_ORIGINATOR ?? 'codex_cli_rs',
    version: process.env.AGENTROUTER_VERSION ?? '0.101.0',
    userAgent: process.env.AGENTROUTER_USER_AGENT ?? 'codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464'
  },
  server: {
    host: process.env.HOST ?? '0.0.0.0',
    port: int('PORT', 3000),
    connectorKey: process.env.CONNECTOR_API_KEY ?? '',
    mcpAuthToken: process.env.MCP_AUTH_TOKEN ?? '',
    maxBodyBytes: int('MAX_BODY_BYTES', 4 * 1024 * 1024),
    publicHost: process.env.MCP_PUBLIC_HOST ?? ''
  },
  runtime: {
    defaultModel: process.env.DEFAULT_MODEL ?? 'deepseek-v4-flash',
    maxConcurrency: int('MAX_CONCURRENCY', 8),
    maxBatchTasks: int('MAX_BATCH_TASKS', 32),
    maxRetries: int('MAX_RETRIES', 4, 0),
    backoffBaseMs: int('BACKOFF_BASE_MS', 400, 0),
    requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 120000),
    redactPrompts: bool('REDACT_PROMPTS', true),
    ledgerPath: process.env.LEDGER_PATH ?? './data/ledger.jsonl',
    logPrompts: bool('LOG_PROMPTS', false)
  }
};

export function assertConfig(): void {
  if (!config.upstream.key) {
    throw new Error('AGENTROUTER_KEY is required for standalone deployments.');
  }
  if (!config.server.connectorKey) {
    throw new Error('CONNECTOR_API_KEY is required to protect the public connector API.');
  }
  if (!config.server.mcpAuthToken) {
    throw new Error('MCP_AUTH_TOKEN is required to protect the MCP endpoint.');
  }
  const u = new URL(config.upstream.baseUrl);
  if (u.protocol !== 'https:') throw new Error('AGENTROUTER_BASE_URL must use HTTPS.');
}
