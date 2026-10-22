// [glue] 2026-10-23 glue pass (see BUILD-REPORT.md): this tools/ copy is the
// wired one (Astra S-10b); registerConfigGen() at the end of this file exposes
// it as the agentrouter_generate_config tool (S-01's `generate_config`).
// The duplicate src/config-gen.ts was renamed to src/config-gen.ts.unused.
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function generateConfigs(): Promise<{
  codex: string;
  claude: string;
}> {
  const paths = {
    codex: join(homedir(), ".codex", "config.toml"),
    claude: join(homedir(), ".claude", "settings.json"),
  };

  const codex = `model_provider = "agentrouter"

[model_providers.agentrouter]
name = "AgentRouter"
wire_api = "responses"
base_url = "https://agentrouter.org/v1"
env_key = "CODEX_GATEWAY_API_KEY"
`;

  const claude = {
    // Resolve credentials at runtime; JSON env values aren't interpolated.
    // Export CODEX_GATEWAY_API_KEY in both clients' runtime environments.
    apiKeyHelper:
      `node -e "const k=process.env.CODEX_GATEWAY_API_KEY;if(!k)process.exit(1);process.stdout.write(k)"`,
    env: {
      ANTHROPIC_BASE_URL: "https://agentrouter.org",
      ANTHROPIC_MODEL: "claude-opus-5",
      CLAUDE_CODE_EFFORT_LEVEL: "max",
    },
  };

  // Replaces each entire file atomically; no key values are serialized.
  async function writeConfig(file: string, text: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, text, {
        encoding: "utf8", mode: 0o600, flag: "wx",
      });
      await rename(temp, file);
    } finally {
      await rm(temp, { force: true });
    }
  }

  await Promise.all([
    writeConfig(paths.codex, codex),
    writeConfig(paths.claude, JSON.stringify(claude, null, 2) + "\n"),
  ]);
  return paths;
}

// [glue] MCP wiring for Astra's generateConfigs(). Registered so the server
// exposes it; NOT invoked during build verification — calling it rewrites the
// real ~/.codex/config.toml and ~/.claude/settings.json.
export function registerConfigGen(server: McpServer): void {
  server.registerTool(
    "agentrouter_generate_config",
    {
      description:
        "Generate Codex + Claude Code client configs for AgentRouter (writes ~/.codex/config.toml and ~/.claude/settings.json).",
      inputSchema: {},
    },
    async () => {
      try {
        const paths = await generateConfigs();
        return { content: [{ type: "text" as const, text: JSON.stringify(paths) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          }],
        };
      }
    },
  );
}
