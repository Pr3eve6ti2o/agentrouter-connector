# AgentRouter credential discovery and auth-first diagnostics

This guide covers the stored `custom.agentrouter` credential in `~/workspace/.agentrouter-keys`. Verify that documented location on the machine running the skill. There is no credential collection step.

Never ask the user to paste a raw key in chat, set a secret environment variable, pass a secret flag or write an auth file. The approved loader supplies the private values programmatically from the existing file.

Keep shell tracing disabled. Never display the private file, print matching lines, dump the environment or log authorisation headers. Do not put raw credentials in commands, examples, request dumps or saved diagnostic artefacts. Record only non-secret check results.

Treat a 401 or 403 as a question about the request before treating it as a question about the key. A request built without its credential can look like a request with a wrong token. Follow these checks in order.

## Confirm the private key file

Check the file as the account that launches the MCP server. Inspect its metadata without displaying its contents. Confirm that `~/workspace/.agentrouter-keys` exists and has mode 600. If necessary, correct only the existing file's permissions and recheck them before reading it.

If the file is missing, unreadable or cannot be protected with mode 600, stop. Report that local credential loading is blocked. This does not establish that the stored credential itself is absent. Do not guess another path or create a replacement auth file.

Use a programmatic line check to confirm that at least one expected key line is present, without printing any value. The required format is one assignment line for `AGENTROUTER_KEY_1`, one for `AGENTROUTER_KEY_2`, or both. Each line consists of the exact variable name, `=` and its private value. Report only whether each expected line is present. The server requires at least one of the two lines; one line alone is sufficient for loading.

## Confirm the server process loaded the file

The approved loading code must read this same private file programmatically. Match the exact variable names, split each matching line at its first `=` and retain the private values only in memory. Require exactly one non-empty assignment for each name present, and at least one name present. Pass those values directly into the MCP server process environment under their corresponding names.

If the file is missing, or no key line is present, stop rather than guessing. Do not execute the file as shell input or substitute an unrelated inherited environment value for a missing assignment.

Lane clients spawn the server as a stdio subprocess. Inspect the caller actually being used and `~/workspace/agentrouter-connector/mcp-server/src/config.ts` to trace the child's environment. The documented lane-client inspection point is `~/workspace/bawa-wallet/agent-g-android/mcp-chat.mjs`; do not assume that a caller already performs the file load.

Supply the other required, non-secret settings to the same server process.

- Set `AGENTROUTER_GPT_6_ASTRA_CONTEXT_TOKENS` to `1050000`, `AGENTROUTER_GPT_6_ASTRA_EFFORT_MIN` to `low` and `AGENTROUTER_GPT_6_ASTRA_EFFORT_MAX` to `max`.
- Set `AGENTROUTER_DEEPSEEK_V4_FLASH_CONTEXT_TOKENS` to `1048576`, `AGENTROUTER_DEEPSEEK_V4_FLASH_EFFORT_MIN` to `none` and `AGENTROUTER_DEEPSEEK_V4_FLASH_EFFORT_MAX` to `max`.
- Set `AGENTROUTER_CLAUDE_OPUS_5_CONTEXT_TOKENS` to `1000000`, `AGENTROUTER_CLAUDE_OPUS_5_EFFORT_MIN` to `low` and `AGENTROUTER_CLAUDE_OPUS_5_EFFORT_MAX` to `max`.
- Set `AGENTROUTER_CLAUDE_OPUS_4_8_CONTEXT_TOKENS` to `1000000`, `AGENTROUTER_CLAUDE_OPUS_4_8_EFFORT_MIN` to `low` and `AGENTROUTER_CLAUDE_OPUS_4_8_EFFORT_MAX` to `max`.

Compare these model-limit settings with lines 31 to 42 of the documented lane client. Required configuration variables do not establish model availability. Leave optional settings unchanged for this authentication check.

Verify loading inside the actual server process that will send the request, after configuration has been read. Compare its loaded private values with the corresponding file values in memory and report only pass or fail. A readable file, a configured parent shell or a successful build does not prove that the server loaded them. If loading cannot be verified, stop.

At the final request send point, compare the credential being attached with the appropriate loaded value in memory. Confirm that it is present in the request handed to the transport. Follow the existing authentication code rather than guessing a header name or scheme. An environment value alone does not prove attachment.

If temporary runtime checks are needed, keep them local and unpushed. Report only non-secret results on standard error, not diagnostic text on the MCP standard-output stream. After source changes, run `npm run build` from `~/workspace/agentrouter-connector/mcp-server`, inspect the compiled output and replace only old server processes you own. Verify the process used by the actual caller, not a separate test process.

For a direct server run, the launcher must invoke `node dist/src/server.js` from that same directory with the prepared process environment. Do not launch it from an unconfigured shell and assume that it loaded the file.

## Confirm the required client headers

Inspect `~/workspace/agentrouter-connector/mcp-server/src/server.ts` lines 113 to 116 and `~/workspace/agentrouter-connector/mcp-server/src/upstream.ts` lines 22 to 24 for the client identification headers.

- Send `Originator` with value `codex_cli_rs`.
- Send `Version` with value `0.101.0`.
- Send `User-Agent` with value `codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464`.

Confirm these values on the final request handed to the transport, after request construction and any header changes. Check them in memory without dumping the headers. Their presence in source code alone does not prove that the running process sends them.

A 401 without these headers is a client check, not evidence of a dead key. Apply the same request-first investigation to a 403. After any correction, rebuild where needed and repeat the checks in order.

## Assess a rejection only after verified attachment

Run the request being diagnosed through the checked server only after the pre-dispatch checks pass. Server startup or an MCP tool listing is not an upstream authentication test.

Only after that request verifiably carried the file-derived credential and the required client headers, and was still rejected, should the key itself be treated as suspect. A status code alone is not enough.

If an earlier check failed or remains unverified, stop at that check instead of blaming the key. Report the blocked step or the verified rejection to the operator using only non-secret check results and the response status. Do not request a raw credential or collect a replacement.
