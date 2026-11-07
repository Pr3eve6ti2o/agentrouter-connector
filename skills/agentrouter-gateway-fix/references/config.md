# Configure the process environment

## Protect and load credentials

- Protect the existing private key file with mode 600.

  ```sh
  chmod 600 "$HOME/workspace/.agentrouter-keys"
  ```

- Use the lane client `~/workspace/bawa-wallet/agent-g-android/mcp-chat.mjs` to read `~/workspace/.agentrouter-keys` with `readFileSync`, matching each line against `/^(AGENTROUTER_KEY_\d+)=(.+)$/` and trimming the value. It treats values as opaque strings and never evaluates, sources, executes, prints or logs them. An unreadable file stops the run; if neither key is found, the client throws `No keys parsed` before spawning. The client spawns `node` with `dist/src/server.js`, combining `process.env`, the loaded keys and the 12 model-limit variables in the server's environment. The server validates on import through `loadConfig()` in `mcp-server/src/config.ts` and throws if a required variable is missing or no non-empty key remains. Never print or log the credential-bearing configuration. The two-key instructions describe the full setup, not the minimum. At least one non-empty key suffices; the process on this machine is configured with `AGENTROUTER_KEY_2` alone.

  The full two-key setup is blocked until the account owner provisions the missing `AGENTROUTER_KEY_1` line in the same file, keeping the file at mode 600 and never printing the value. No authorised route for obtaining that second key is identified in this skill.

- Keep shell tracing disabled and avoid environment dumps or logged authorisation headers. Never copy credential values into commands, examples, logs or saved diagnostic artefacts.

## Supply 12 required model-limit variables and at least one key

- Load `AGENTROUTER_KEY_1` when present through the lane client `mcp-chat.mjs`. From the client's directory, run `node mcp-chat.mjs <prompt> <output>` to load the keys and spawn the server with the loaded environment. This key is required when `AGENTROUTER_KEY_2` is absent; otherwise it is optional for rotation and failover. Do not print its value.

- Load `AGENTROUTER_KEY_2` when present in the same `node mcp-chat.mjs <prompt> <output>` invocation of the lane client `mcp-chat.mjs`. It loads the available keys together and spawns the server with the loaded environment; no separate invocation is needed for this key. This key is required when `AGENTROUTER_KEY_1` is absent; otherwise it is optional for rotation and failover. Do not print its value.

- Set `AGENTROUTER_GPT_6_ASTRA_CONTEXT_TOKENS` to `1050000`.

- Set `AGENTROUTER_GPT_6_ASTRA_EFFORT_MIN` to `low`.

- Set `AGENTROUTER_GPT_6_ASTRA_EFFORT_MAX` to `max`.

- Set `AGENTROUTER_DEEPSEEK_V4_FLASH_CONTEXT_TOKENS` to `1048576`.

- Set `AGENTROUTER_DEEPSEEK_V4_FLASH_EFFORT_MIN` to `none`.

- Set `AGENTROUTER_DEEPSEEK_V4_FLASH_EFFORT_MAX` to `max`.

- Set `AGENTROUTER_CLAUDE_OPUS_5_CONTEXT_TOKENS` to `1000000`.

- Set `AGENTROUTER_CLAUDE_OPUS_5_EFFORT_MIN` to `low`.

- Set `AGENTROUTER_CLAUDE_OPUS_5_EFFORT_MAX` to `max`.

- Set `AGENTROUTER_CLAUDE_OPUS_4_8_CONTEXT_TOKENS` to `1000000`.

- Set `AGENTROUTER_CLAUDE_OPUS_4_8_EFFORT_MIN` to `low`.

- Set `AGENTROUTER_CLAUDE_OPUS_4_8_EFFORT_MAX` to `max`.

- Check these model-limit values against `~/workspace/bawa-wallet/agent-g-android/mcp-chat.mjs` lines 31 to 42. Do not infer model availability from the presence of a required configuration variable.

## Handle optional variables

- Keep `AGENTROUTER_HOSTS` optional and leave it unset unless an override is needed. Unset selects the defaults `agentrouter.org` and `ps.air-outer.com`. For an override, use comma-separated hostnames, for example `agentrouter.org,ps.air-outer.com`. The parser in `mcp-server/src/config.ts` trims entries, drops empty entries and de-duplicates them. If the resulting list is empty or any hostname fails validation, the whole override falls back to the defaults rather than stopping the run.

- Keep `AGENTROUTER_RETRY_ROUNDS` optional. Its default is `3`, with a clamp from `1` to `10`, as set in `mcp-server/src/config.ts`.

- Keep `AGENTROUTER_LEDGER_PATH` optional and retain the configured path. No default ledger path is verified here.

### Align caps and timeout configuration

- Use `AGENTROUTER_TIMEOUT_MS` with the default `1200000` ms unless an approved override is needed. Keep any override within the verified `10000` to `1800000` ms clamp. Set this timeout default and clamp in `mcp-server/src/config.ts`. Keep this configuration change distinct from the streaming remedy and the worker's existing one-hour timeout.

- Set optional `AGENTROUTER_ASTRA_MAX_TOKENS` to `32000` if an older override would otherwise restrict the fix. Its default is `32000`, with a clamp from `1000` to `32000`. Set the Astra cap default and clamp in `mcp-server/src/config.ts`, using the verified configuration at lines 109 to 112 as evidence.

## Send the required client headers

- Check `src/server.ts` lines 113 to 116 and `src/upstream.ts` lines 22 to 24 for the verified client identification headers.

- Set `Originator` to `codex_cli_rs`.

- Set `Version` to `0.101.0`.

- Set `User-Agent` to `codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464`.

## Build and run the correct process

- Verify the source immediately after each serial edit. Follow the build procedure and inspect compiled code before making the next test call.

- Run with the configured process environment, keeping credential values private and shell tracing disabled.

The build and run commands live in [the repository map](repo-map.md).
