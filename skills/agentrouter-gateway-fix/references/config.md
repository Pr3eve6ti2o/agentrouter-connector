# Configure the process environment

## Bootstrap a fresh machine

`mcp-server/test-client.mjs` is not a bootstrap route because its ROOT and key file paths are stale.

Run these commands in one Bash session on the new machine, stopping on any failure. Use operator-supplied repository and transfer destinations, not guessed URLs or hosts. Enter absolute paths for local directory prompts.

1. Clone the repository. It contains the skill at `skills/agentrouter-gateway-fix/` and the MCP server at `mcp-server/`.

   ```bash
   read -r -p 'Repository URL without embedded credentials: ' REPO_URL
   read -r -p 'Clone destination (absolute path): ' REPO_DIR
   git clone "$REPO_URL" "$REPO_DIR"
   test -d "$REPO_DIR/skills/agentrouter-gateway-fix"
   test -d "$REPO_DIR/mcp-server"
   ```

2. Obtain `mcp-chat.mjs` from the working copy at `~/workspace/bawa-wallet/agent-g-android/mcp-chat.mjs`. The lane client is workspace-local and is not in the repository. For an operator-arranged SSH copy, supply the source account/host whose home contains that working copy, then copy the file to the new machine.

   ```bash
   read -r -p 'Source SSH destination for the working-copy account: ' SOURCE_HOST
   read -r -p 'Client directory on this machine (absolute path): ' CLIENT_DIR
   mkdir -p "$CLIENT_DIR"
   scp "${SOURCE_HOST}:~/workspace/bawa-wallet/agent-g-android/mcp-chat.mjs" \
     "$CLIENT_DIR/mcp-chat.mjs"
   ```

3. Edit all three hardcoded paths at the top of the copied client:

   - Set `ROOT` to the cloned repository's `mcp-server/` directory.
   - Set `DIR` to the client directory. This is also used for the ledger path.
   - Replace the hardcoded key file path `/home/boxd/workspace/.agentrouter-keys` with this machine's absolute path for `~/workspace/.agentrouter-keys`.

   Print the required paths, then open the client in an installed editor. Use the printed absolute paths as JavaScript string values, not unexpanded shell variables or `~`.

   ```bash
   printf 'ROOT: %s\nDIR: %s\nKey file path: %s\n' \
     "$REPO_DIR/mcp-server" \
     "$CLIENT_DIR" \
     "$HOME/workspace/.agentrouter-keys"
   read -r -p 'Installed editor executable: ' EDITOR
   "$EDITOR" "$CLIENT_DIR/mcp-chat.mjs"
   ```

4. Build the server from `mcp-server`. Inspect the build script and its referenced configuration to identify the actual compiled output location, then inspect the emitted files. Do not guess an output directory.

   ```bash
   cd "$REPO_DIR/mcp-server" && npm run build
   npm pkg get scripts.build
   read -r -p 'Compiled output location from the build configuration (absolute path): ' BUILD_OUTPUT
   find "$BUILD_OUTPUT" -type f -ls
   ```

5. Have the account owner provision `~/workspace/.agentrouter-keys` on the new machine at mode `600`, with at least one non-empty key line. No authorized route for obtaining a key is identified in this skill. Stop until the owner completes this handoff; never print credential values.

   At least one non-empty key suffices. On the checked machine, the full two-key setup is blocked until the owner provisions the missing `AGENTROUTER_KEY_1` line.

   After provisioning, check that the file is non-empty and enforce its permissions without displaying its contents. These commands do not validate a credential.

   ```bash
   test -s "$HOME/workspace/.agentrouter-keys" &&
     chmod 600 "$HOME/workspace/.agentrouter-keys" &&
     ls -l "$HOME/workspace/.agentrouter-keys"
   ```

6. Verify startup and tool discovery from the client directory.

   ```bash
   cd "$CLIENT_DIR" && node mcp-chat.mjs --list
   rc=$?
   printf 'Exit status: %s\n' "$rc"
   test "$rc" -eq 0
   ```

   Expect the 12 tools, `server: agentrouter 1.0.0`, and exit status `0`. The operator observed this result on 2026-11-07, with no model call and no model tokens. This is not a model-call verification.

## Protect and load credentials

- Protect the existing private key file with mode 600.

  ```sh
  chmod 600 "$HOME/workspace/.agentrouter-keys"
  ```

- Use the lane client `~/workspace/bawa-wallet/agent-g-android/mcp-chat.mjs` to read `~/workspace/.agentrouter-keys` with `readFileSync`, matching each line against `/^(AGENTROUTER_KEY_\d+)=(.+)$/` and trimming the value. It treats values as opaque strings and never evaluates, sources, executes, prints or logs them. The regex accepts any numeric suffix, not just the two supported names. Duplicate matching lines overwrite silently; the last line wins. A value that is empty after trimming counts as absent for the `No keys parsed` check. An unreadable file stops the run; the client throws `No keys parsed` before spawning only when neither `AGENTROUTER_KEY_1` nor `AGENTROUTER_KEY_2` has a non-empty trimmed value. The spawn environment spreads `process.env` first, then `kv`, then applies explicit settings. File values override inherited values for names present in the file, but an inherited key name absent from the file survives into the server environment. Before spawning, remove every inherited `AGENTROUTER_KEY_*` name that is not present in the file from the spawning environment. Verify the resulting child environment with `scripts/check-loading.mjs`; GATE1 fails on the file-absent, child-present inherited-key case.

Follow the [pre-dispatch gate procedure in connector.md](connector.md); both gates must pass before any request is sent through the lane client. The client spawns `node` with `dist/src/server.js`, combining `process.env`, the loaded keys and the 12 model-limit variables in the server's environment. The server validates on import through `loadConfig()` in `mcp-server/src/config.ts` and throws if a required variable is missing or no non-empty key remains. The worker is different: it boots with only the two keys set and does not load configuration at import. Never print or log the credential-bearing configuration. The two-key instructions describe the full setup, not the minimum. At least one non-empty key suffices; the process on this machine is configured with `AGENTROUTER_KEY_2` alone.

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

- Keep `AGENTROUTER_HOSTS` optional and leave it unset unless an override is needed. Unset selects the defaults `agentrouter.org` and `ps.air-outer.com`. For an override, use comma-separated hostnames, for example `agentrouter.org,ps.air-outer.com`. The `parseHosts` parser in `mcp-server/src/env.ts` at line 9, used by `mcp-server/src/config.ts` at line 79, trims entries, drops empty entries and de-duplicates them. If the resulting list is empty or any hostname fails validation, the whole override falls back to the defaults rather than stopping the run.

- Keep `AGENTROUTER_RETRY_ROUNDS` optional. Its default is `3`, with a clamp from `1` to `10`, as set in `mcp-server/src/config.ts`. In `mcp-server/src/server.ts` line 98, `totalAttempts` equals rounds times the number of host-by-key combinations, so raising rounds multiplies the attempt budget.

- Keep `AGENTROUTER_LEDGER_PATH` optional and retain the configured path. The consumer is `ledgerPath()` in `mcp-server/src/upstream.ts` lines 338-339, not `mcp-server/src/config.ts`. If unset or blank after trimming, it falls back to the relative path `ledger.jsonl` in the server process working directory. The lane client explicitly sets it to `${DIR}/mcp-ledger.jsonl`, so the unset case only arises on a direct server run.

### Align caps and timeout configuration

- Use `AGENTROUTER_TIMEOUT_MS` with the default `1200000` ms unless an approved override is needed. Keep overrides within the verified `10000` to `1800000` ms clamp in `mcp-server/src/config.ts`. This is a server per-attempt timeout, not a total-call timeout; `/messages` instead uses a fixed `120000` ms per attempt (`mcp-server/src/server.ts` line 99 selects `ANTHROPIC_TIMEOUT_MS`, defined as `120_000` in `mcp-server/src/upstream.ts` line 23). Each server attempt gets its own timeout budget through `AbortSignal.timeout(timeoutMs)`, with a `pauseForAttempt` backoff pause between attempts, so the retry sequence can spend `totalAttempts * timeoutMs` plus backoff in the worst case. An incomplete response with `max_output_tokens` (output-token starvation) stops the loop without retrying. The lane client's per-call RPC timeout is `3600000` ms (`mcp-chat.mjs`); on a chat call, this 60-minute cap binds first when the cumulative server retry budget would exceed it. The worker has a separate per-job-attempt timeout through `workerTimeoutMs()`, defaulting to `3600000` ms (defined in `mcp-server/src/worker.ts` at line 40 and used at line 100). On expiry, the worker aborts the in-flight job attempt and records status `interrupted` (generation state unknown) with error kind `worker-timeout`, not failed (`worker.ts` lines 260-266). Generation may or may not have happened, so its outcome must be checked; never assume the job failed or retry it blindly. The health probe has a separate `15000` ms timeout per host and key (`mcp-server/src/tools/health.ts`). Keep this configuration change distinct from the streaming remedy and the worker's existing timeout.

- Set optional `AGENTROUTER_ASTRA_MAX_TOKENS` to `32000` if an older override would otherwise restrict the fix. Its default is `32000`, with a clamp from `1000` to `32000`. Set the Astra cap default and clamp in `mcp-server/src/config.ts`, using the verified optional defaults block at lines 81 to 97, with the Astra cap at lines 92 to 94, as evidence.

## Send the required client headers

- Check the shared `clientHeaders` in `mcp-server/src/env.ts` for the verified client identification headers. `mcp-server/src/server.ts` imports them at line 21 and `mcp-server/src/upstream.ts` re-exports them at lines 5 to 6.

- Set `Originator` to `codex_cli_rs`.

- Set `Version` to `0.101.0`.

- Set `User-Agent` to `codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464`.

## Build and run the correct process

- Verify the source immediately after each serial edit. Follow the build procedure and inspect compiled code before making the next test call.

- Run with the configured process environment, keeping credential values private and shell tracing disabled.

The build and run commands live in [the repository map](repo-map.md).
