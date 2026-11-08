# AgentRouter gateway diagnosis and streaming fix

## Use this skill

- Diagnose AgentRouter gateway errors and empty Astra replies before retrying. Separate silent transport cuts from reasoning-budget exhaustion, because they need different fixes.

- Apply streaming plus a 32,000-token cap to the local MCP server. Keep the fix local-only and unpushed, with no push without the owner's explicit word.

## Available connectors

- Read the bundled [connector reference](references/connector.md) for the stored `custom.agentrouter` credential in `~/workspace/.agentrouter-keys` and auth-first diagnostics for this skill's MCP server.

- Use the working hosts from the verified record, `agentrouter.org` and `ps.air-outer.com`. Verify them afresh rather than assuming every request will succeed.

- Investigate a 401 or 403 as a question about the request before treating it as a question about the key. Never print, log or persist raw credentials during diagnostics.

- Use `muse.connector_search` to find other connectors and `muse.skill_search` to find related skills.

- If nothing here fits, use `muse.connector_search` to find a maintained API or MCP server, or build a custom connector.

- For setup guidance, run `muse.skill_search` for `custom-connector-setup` and follow any relevant setup skill it returns. No setup-skill path is bundled with this skill, so discover the guidance rather than following a link.

## Locate the repository and evidence

- Work in `~/workspace/agentrouter-connector/mcp-server`, inside repository `Pr3eve6ti2o/agentrouter-connector`. Do not assume the local streaming fix exists remotely. See the [repository and evidence map](references/repo-map.md) for implementation files, lane callers and recorded evidence.

## Diagnose the recorded failures

- For a silent roughly 291-second cut, see [case 1](references/errors.md) and the [streaming fix](references/fix.md).

- For reasoning starvation at 16,000 tokens, see [case 2](references/errors.md) and the [32,000-token cap](references/fix.md).
- When large prompts stall at max reasoning but small prompts land, see [prompt sizing](references/prompt-sizing.md).

- Use [diagnose.py](scripts/diagnose.py) alongside the error catalogue.

## Apply the verified local fix

- Follow the [local-fix procedure](references/fix.md) for dependency checks, source changes, compiled-output inspection and replacement of old owned processes. Build from the MCP server directory with dependencies available.

  ```sh
  cd "$HOME/workspace/agentrouter-connector/mcp-server"
  npm run build
  ```

- Lane clients spawn the server as a stdio subprocess. Start the server alone only when needed, from the same server directory after building and configuring its process environment.

  ```sh
  node dist/src/server.js
  ```

- Start the worker separately only for worker jobs, from the same directory after building and configuring its process environment. Check whether an owned worker is already running before starting another. Use the `jobs/worker.pid` check described in [the repository map](references/repo-map.md).

  ```sh
  node dist/src/worker.js
  ```

## Configure the process environment

- Read [process environment configuration](references/config.md) before launching the server or worker.

## Verify before claiming success

- Follow [verification](references/verification.md) for prompt setup, tool schemas, pass criteria and the historical `node mcp-chat.mjs prompts/probe.md probe-verify.md` smoke-test record.

- Discover the tools from a configured lane directory. See [list-tools.sh](scripts/list-tools.sh).

  ```sh
  node mcp-chat.mjs --list
  ```

- Put the verified prompt from [verification](references/verification.md) in `prompts/probe.md` within the lane directory, then run the tiny probe. See [probe.sh](scripts/probe.sh).

  ```sh
  node mcp-chat.mjs prompts/probe.md probe.md
  ```

- Replace the section and output placeholders before running a fresh stateless request from the lane directory. Follow the result checks in [verification](references/verification.md) before claiming success; see also [verify.sh](scripts/verify.sh).

  ```sh
  node mcp-chat.mjs prompts/<section>.md <output>.md
  ```

For alternatives, see [references/fix.md](references/fix.md).