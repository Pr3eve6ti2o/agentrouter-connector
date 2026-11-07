# Diagnose the recorded failures

See the [fix](fix.md), [verification](verification.md) and [classifier](../scripts/diagnose.py) alongside this catalog.

## 1. Silent Responses transport cut

- Recognise the roughly 291-second cut by `upstream-transient: fetch failed`, `client cancelled request before upstream response: context canceled` or `RemoteDisconnected`.

- Compare the observed cuts at roughly 270 to 291 seconds on long non-streamed calls with the MCP per-attempt timeout of 600 seconds. That 600-second application timeout does not account for these earlier cuts. The old forwarder-routed runner saw the same cut. Direct egress returned 401 in about 1.3 seconds without an authorisation header, which was only a connectivity check, not a matched long-call comparison. Treat an upstream silent-connection cut as a working diagnosis, not an established cause. No matched direct-versus-routed request traces exist to isolate the layer closing the connection.

- [Enable `stream: true` and assemble the SSE response](fix.md). Do not present a longer application timeout alone as the fix.

## 2. Reasoning starvation at 16,000 tokens

- Identify output-budget exhaustion by `status` equal to `incomplete` and `incomplete_details.reason` equal to `max_output_tokens`. The recorded failures include zero text when reasoning consumes the whole output budget, as in f21e08cc, and partial text cut off by the cap, as in 59aaf0f2. Check the output array as well as top-level output text before classifying a result as zero text.

- Inspect `~/workspace/agentrouter-connector/mcp-server/jobs/f21e08cc-6118-4759-96f8-9b83bd6b688e.result.json`. The receipt records `status` as `incomplete` and `incomplete_details.reason` as `max_output_tokens`, with `usage.input_tokens` 162, `usage.output_tokens` 16,000, `usage.output_tokens_details.reasoning_tokens` 16,000 and `usage.total_tokens` 16,162. Output text is 0 characters. Reasoning consumed the entire output budget and no text arrived.

- Inspect `~/workspace/agentrouter-connector/mcp-server/jobs/59aaf0f2-a175-4223-a988-35c199f3070e.result.json`. The receipt records `status` as `incomplete` and `incomplete_details.reason` as `max_output_tokens`, with `usage.input_tokens` 170, `usage.output_tokens` 16,000, `usage.output_tokens_details.reasoning_tokens` 15,054 and `usage.total_tokens` 16,170. Top-level output text is empty, but the output array holds 4,033 characters of partial text. The 16,000-token cap stopped the generation after partial text had arrived, not with zero text overall.

- [Raise the Astra cap to 32,000 throughout the request path](fix.md). The [successful B1a2a receipt](verification.md), `bawa-wallet/agent-g-android/stream-test-B1a2a.result.json`, records `status` as `completed` and `incomplete_details` as `null`, with `usage.input_tokens` 162, `usage.output_tokens` 18,994, `usage.output_tokens_details.reasoning_tokens` 16,536 and `usage.total_tokens` 19,156. It returned 9,759 characters of text in 442,503 ms. Reasoning alone exceeded the old 16,000-token cap by 536 tokens, so the former entire budget was insufficient for this completed response.

## 3. Eastus2 shared token rate limit

- Recognise `rate_limit_exceeded`, which the gateway attributes to the eastus2 token pool for `gpt-6-astra`. Worker job `6a93fedc` on `ps.air-outer.com` with key index 1 hit the limit after 2 seconds; the lane notes record a further worker job hitting the same pool limit immediately. These observations are limited to keys using that pool. No quota figure, pool membership list or per-key allowance is recorded.

- Wait for capacity or quota recovery instead of retrying blindly. Keep this failure separate from the 291-second cut and reasoning starvation, and do not invent a full identifier from the recorded short job identifier.

## 4. Azure continuation-state mismatch

- Identify `upstream-state-mismatch` when continuing a chain. The recorded diagnosis is that the upstream provider pins Responses state to one Azure resource, so continuing against a different resource fails. No failure-and-recovery receipt pair is recorded on the VM.

- The recorded recovery advice is to abandon the dead chain, start a new `agentrouter_chat` call and resubmit the full context in the new prompt; there is no response id to reuse. In `mcp-server/src/server.ts`, each call builds a fresh Responses request with no `previous_response_id`, response chaining or continuation state. This server's request construction makes the MCP path stateless; MCP itself is not inherently stateless.

## 5. Gateway 502 per-request lottery

- Recognise the recorded 502 lottery as intermittent per-request gateway failure. The internal backend cause is unknown, and no timestamped response sequence is recorded.

- Consider rotating across approved hosts and keys as a workaround to try, not an established reliability gain. Follow the [approved-host and credential-selection procedure](config.md) and keep retries bounded. Do not treat a tiny successful probe as a prediction that a full section will complete.

## 6. Unauthorised client check

- The operator's controlled comparison on 2026-11-07 tested GET `/v1/models` on `agentrouter.org` and `ps.air-outer.com`, with key 1 and key 2 on each host. For each host/key pair, the host, key and payload were held constant; only the three `codex_cli_rs` client headers changed. The responses were `401 unauthorized client detected` without them and 200 with them. This establishes client identification checking as the cause of those 401 responses and excludes dead keys for those two keys on those two hosts.

- Send the exact headers in the [client-header section](config.md). Inspect the error body, host and headers before diagnosing credential failure.

## 7. Astra on the wrong endpoint

- Recognise `please use /v1/responses instead` from an Astra request to `/v1/chat/completions`. Astra requires the Responses endpoint.

- [Send Astra requests to `/v1/responses`](fix.md). Do not keep using a chat-completions runner for Astra merely because other models use that endpoint.

## 8. Claude Opus reasoning starvation

- Recognise `claude-opus-5-5` spending the full `max_tokens` budget thinking while returning zero text. In the recorded tests, caps of 1,500 and 3,200 tokens were both fully spent on thinking with zero text emitted. The outcome was prompt- and window-dependent: the same task starved in one window and landed in another. Assistant prefill was rejected with HTTP 400.

- Keep this failure unresolved rather than transferring the Astra remedy to Claude. Do not prescribe a 32,000-token cap or rejected prefill as a proven fix, and do not invent the missing exact prefill-rejection wording.

## 9. DeepSeek and Claude without a channel

- Recognise the recorded DeepSeek and Claude 503 `no-channel` responses as off-list model/channel failures. The exact tested aliases are absent from this record, so do not extend the finding to either whole model family.

- Use authenticated catalogue discovery to identify candidates for an availability workaround. On 2026-11-07, the operator checked GET `/v1/models` on both `agentrouter.org` and `ps.air-outer.com`, using each of key 1 and key 2 with the `codex_cli_rs` headers. All four calls returned 200 with exactly three models: `gpt-5.6-sol`, `gpt-6-astra` and `gpt-6.1-sol`.

  The request below was also verified end to end on the VM with key 2 and these headers, returning the same three model IDs. Load the key privately from the key file exactly as shown; never paste a key value into a command or a file.

  ```sh
  KEY2=$(grep '^AGENTROUTER_KEY_2=' ~/workspace/.agentrouter-keys | cut -d= -f2-)
  curl -s -m 20 https://agentrouter.org/v1/models \
    -H "Authorization: Bearer $KEY2" \
    -H "Originator: codex_cli_rs" \
    -H "Version: 0.101.0" \
    -H "User-Agent: codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464"
  ```

  Without the `codex_cli_rs` headers, `/v1/models` returns 401 `unauthorized client detected`. This is an authentication failure at the client check, not a channel failure. A 503 `no-channel` is a channel failure. Catalogue membership proves only that a model is listed; it does not prove that inference succeeds or a channel is available. Do not expect retries alone to make an off-list model available.

## 10. Stale saved job status

- Recognise a saved JSON file remaining `pending` for about two hours after the job had already failed. A stale snapshot was mistaken for live status.

- From a lane directory, run `node mcp-chat.mjs --list`; it returns 12 tools, including `agentrouter_job_status`. The status tool is defined in `~/workspace/agentrouter-connector/mcp-server/src/tools/jobs.ts`. For a schema-valid status request, call `agentrouter_job_status` with the input field `job_id` set to the actual job ID as a non-empty string (minimum length 1).

  The tool returns the job record fields `id`, `status`, `model`, `host`, `keyIndex`, `attempts`, `created_at`, `started_at`, `finished_at`, `last_heartbeat`, `response_id`, `error`, `error_kind`, `partial_chars` and `output_chars`, read from saved job state without calling the gateway.

  Treat `completed`, `failed`, `interrupted` and `cancelled` as terminal. For `completed`, call `agentrouter_job_result` with the same `job_id` for the full output text. For `failed` or `interrupted`, call `agentrouter_job_result` with the same `job_id`; it returns the saved partial text with the error. For `pending` or `running`, keep polling the live status tool and never trust a saved JSON file for current liveness. Treat saved results as historical evidence, not authority for current liveness.

## 11. Worker, VM, tunnel and proxy lifecycle failures

- Recognise the recorded worker remaining alive after `SIGTERM`. Verify the owned worker process before using `SIGKILL` when required, then confirm exit. Treat this as a stopping workaround, because the exact signal-handling cause is not supplied and the streaming patch does not repair it.

- Recheck required processes after a VM reboot and restart those that stopped. Detached processes were killed by the reboot, so detached does not mean reboot-persistent.

- Recognise the Pinggy free tunnel expiring after 60 minutes. Renew or recreate it as a lifecycle workaround rather than diagnosing the expiry as an AgentRouter model failure.

- Recognise proxy credentials expiring within about 60 seconds in the recorded setup. Route new connections through the forwarder at `127.0.0.1:3129` as the recorded workaround, after starting and checking it. This forwarder is a component of the operator's sandbox machine. The VM used for this fix reaches the gateway directly and has no forwarder.

  On the operator machine, run `~/workspace/nova-bot-test/run-forwarder.sh`. This idempotent launcher exits if a `python3 proxy-forward.py` process is already running. Otherwise, it starts `/home/hatch/workspace/nova-bot-test/proxy-forward.py` detached with `setsid nohup python3`, appending output to `/home/hatch/workspace/nova-bot-test/proxy-forward.log`, waits one second, then exits 0 if the process is running or reports failure against the log.

  Check the process with `pgrep -af "python3 .*/proxy-forward[.]py"`. Run `ss -ltnp` and confirm a listener on `127.0.0.1:3129`. Then route a curl request through that proxy and confirm a live response.

  For proxy authentication, curl in the recorded setup ignored userinfo in proxy environment variables and sent no `Proxy-Authorization` header, so an environment-style curl probe received HTTP 407. The forwarder supplies authentication by injecting its live in-process sandbox-proxy credential into every upstream `CONNECT`.

  For credential expiry, credentials rotate within about a minute, and a credential read from a file is already dead within seconds of being written. A running process keeps working on its in-process credential. The forwarder holds one such live credential and injects it into each new `CONNECT`, which is why new connections routed through it work while direct file-credential connections fail. Do not use file credentials for new connections.

## 12. Superseded 12,000-token remedy

- The historical advice recorded for line 33 of `~/workspace/custom-skills/agentrouter_gateway_failures/SKILL.md` is superseded: `Raise max_output_tokens to 12000 for gpt-6-astra Responses audits and keep tasks sequential.` The file does not exist on the audited machine and cannot be consulted there.

- Replace that Astra remedy with [streaming plus a 32,000-token cap](fix.md). The [successful generation](verification.md) needed 16,536 reasoning tokens, already exceeding both 12,000 and 16,000.

- Keep splitting input and lowering reasoning effort labelled as unproven starvation remedies for these prompts. Do not silently edit the older skill.

## 13. Parallel-edit lost write

- Trace the lost change to two parallel whole-file edits targeting one file. The later write discarded the earlier change despite a successful tool report, and grepping `dist/` caught the omission.

- Edit each file serially and verify its source after every edit. [Build and inspect the compiled branches](verification.md) before claiming success, because tool success does not prove an edit survived.