# AgentRouter credential discovery and auth-first diagnostics

This guide covers the stored `custom.agentrouter` credential in `~/workspace/.agentrouter-keys`. Verify that documented location on the machine running the skill. There is no credential collection step.

Never ask the user to paste a raw key in chat, set a secret environment variable, pass a secret flag or write an auth file. The approved loader is the lane client `~/workspace/bawa-wallet/agent-g-android/mcp-chat.mjs`, documented in `references/config.md` line 11, which supplies the private values programmatically from `~/workspace/.agentrouter-keys`.

Keep shell tracing disabled. Never display the private file, print matching lines, dump the environment or log authorisation headers. Do not put raw credentials in commands, examples, request dumps or saved diagnostic artefacts. Record only non-secret check results.

Treat a 401 or 403 as a question about the request before treating it as a question about the key. A request built without its credential can look like a request with a wrong token. Follow these checks in order.

## Confirm the private key file

Before any check runs, follow [Bootstrap a fresh machine](config.md#bootstrap-a-fresh-machine) to resolve the key file path and the client path.

Check the file as the account that launches the MCP server. Inspect its metadata without displaying its contents. Confirm that `~/workspace/.agentrouter-keys` exists and has mode 600. If necessary, correct only the existing file's permissions and recheck them before reading it.

If the file is missing, unreadable or cannot be protected with mode 600, stop. Report that local credential loading is blocked. This does not establish that the stored credential itself is absent. Do not guess another path or create a replacement auth file.

Use a programmatic line check to confirm that at least one expected key line is present, without printing any value. The required format is one assignment line for `AGENTROUTER_KEY_1`, one for `AGENTROUTER_KEY_2`, or both. Each line consists of the exact variable name, `=` and its private value. Report only whether each expected line is present. The server requires at least one of the two lines; one line alone is sufficient for loading.

## Confirm the server process loaded the file

The lane client `~/workspace/bawa-wallet/agent-g-android/mcp-chat.mjs` reads this same private file programmatically with `readFileSync` and retains the private values only in memory. The operator must use the programmatic line check to match the exact supported names, `AGENTROUTER_KEY_1` and `AGENTROUTER_KEY_2`, split each matching line at its first `=`, and confirm exactly one assignment with a non-empty trimmed value for each name present, with at least one of those names present. The named loader accepts any numeric suffix; it neither enforces one assignment per name nor checks every present name for a non-empty trimmed value. Duplicate matching lines overwrite silently; the last line wins, so duplicate assignments must be removed.

If the file is missing, or no key line is present, stop rather than guessing. Do not execute the file as shell input. An inherited environment value must never substitute for a missing assignment. Pass the file values directly into the MCP server process environment under their corresponding names. Before spawning, remove every inherited `AGENTROUTER_KEY_*` name that is not present in the file from that environment. Verify the child environment with `scripts/check-loading.mjs` GATE1, which fails on the file-absent, child-present inherited-key case.

Lane clients spawn the server as a stdio subprocess. Inspect the caller actually being used and `~/workspace/agentrouter-connector/mcp-server/src/config.ts` to trace the child's environment. The documented lane-client inspection point is `~/workspace/bawa-wallet/agent-g-android/mcp-chat.mjs`, which does perform the file load; do not assume that other, unnamed callers already perform that load.

Supply the other required, non-secret settings to the same server process.

- Set `AGENTROUTER_GPT_6_ASTRA_CONTEXT_TOKENS` to `1050000`, `AGENTROUTER_GPT_6_ASTRA_EFFORT_MIN` to `low` and `AGENTROUTER_GPT_6_ASTRA_EFFORT_MAX` to `max`.
- Set `AGENTROUTER_DEEPSEEK_V4_FLASH_CONTEXT_TOKENS` to `1048576`, `AGENTROUTER_DEEPSEEK_V4_FLASH_EFFORT_MIN` to `none` and `AGENTROUTER_DEEPSEEK_V4_FLASH_EFFORT_MAX` to `max`.
- Set `AGENTROUTER_CLAUDE_OPUS_5_CONTEXT_TOKENS` to `1000000`, `AGENTROUTER_CLAUDE_OPUS_5_EFFORT_MIN` to `low` and `AGENTROUTER_CLAUDE_OPUS_5_EFFORT_MAX` to `max`.
- Set `AGENTROUTER_CLAUDE_OPUS_4_8_CONTEXT_TOKENS` to `1000000`, `AGENTROUTER_CLAUDE_OPUS_4_8_EFFORT_MIN` to `low` and `AGENTROUTER_CLAUDE_OPUS_4_8_EFFORT_MAX` to `max`.

Compare these model-limit settings with lines 31 to 42 of the documented lane client. Required configuration variables do not establish model availability. Leave optional settings unchanged for this authentication check.

1. From the skill directory, before dispatching any request, run `node scripts/check-loading.mjs <server-root> <key-file>`. The arguments are optional when the documented defaults apply: server root `~/workspace/agentrouter-connector/mcp-server` and key file `~/workspace/.agentrouter-keys`. The script never prints credential values.
2. Read the GATE1 lines. Every key name present in the file must show `child=present match=yes`, and no name absent from the file may show `child=present`. A GATE1 failure means the child environment does not match the file, for example an inherited credential survived into the server.
3. Read the GATE2 lines. Every host and key combination must show `ok=true` with status 200. A GATE2 failure means the loaded credential was not accepted at the transport.
4. If either gate fails, stop at that gate and do not dispatch. Both gates must pass before dispatch. A readable file, a configured parent shell, a successful build, or a `tools/list` response does not pass these gates.

If temporary runtime checks are needed, keep them local and unpushed. Report only non-secret results on standard error, not diagnostic text on the MCP standard-output stream. After source changes, run `npm run build` from `~/workspace/agentrouter-connector/mcp-server`, inspect the compiled output and replace only old server processes you own. Verify the process used by the actual caller, not a separate test process.

For a direct server run, the launcher must invoke `node dist/src/server.js` from that same directory with the prepared process environment. Do not launch it from an unconfigured shell and assume that it loaded the file.

## Confirm the required client headers

The client identification headers live in the shared `clientHeaders` in `~/workspace/agentrouter-connector/mcp-server/src/env.ts`, imported by `server.ts` at line 21 and imported and re-exported by `upstream.ts` at lines 5 to 6.

- Send `Originator` with value `codex_cli_rs`.
- Send `Version` with value `0.101.0`.
- Send `User-Agent` with value `codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464`.

Confirm these values on the final request handed to the transport, after request construction and any header changes. Check them in memory without dumping the headers. Their presence in source code alone does not prove that the running process sends them.

A 401 without these headers is a client check, not evidence of a dead key. Apply the same request-first investigation to a 403. After any correction, rebuild where needed and repeat the checks in order.

## Assess a rejection only after verified attachment

Run the request being diagnosed through the checked server only after the pre-dispatch checks pass. Server startup or an MCP tool listing is not an upstream authentication test.

Only after that request verifiably carried the file-derived credential and the required client headers, and was still rejected, should the key itself be treated as suspect. A status code alone is not enough.

If an earlier check failed or remains unverified, stop at that check instead of blaming the key. Report the blocked step or the verified rejection to the operator using only non-secret check results and the response status. Do not request a raw credential or collect a replacement.
