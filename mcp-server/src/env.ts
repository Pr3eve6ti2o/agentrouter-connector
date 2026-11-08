export function parseApiKeys(source: NodeJS.ProcessEnv): string[] {
  const apiKeys = [...new Set(
    [source.AGENTROUTER_KEY_1, source.AGENTROUTER_KEY_2]
      .map(key => key?.trim()).filter((key): key is string => !!key)
  )];
  return apiKeys;
}

export function parseHosts(source: NodeJS.ProcessEnv): string[] | undefined {
  const raw = source.AGENTROUTER_HOSTS?.trim();
  if (!raw) return undefined;

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

export const clientHeaders = {
  Originator: "codex_cli_rs",
  Version: "0.101.0",
  "User-Agent": "codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464",
  "Content-Type": "application/json",
};
