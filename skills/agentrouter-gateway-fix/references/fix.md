# Apply the verified local fix

- Establish the baseline from the 2026-11-06 diagnosis and failed receipts. Keep the roughly 291-second silent cut independent of the 16,000-token incomplete results.

- Compare the existing worker's streaming design with the old non-streamed server path. The lane notes record a persistent worker with a single pinned host and key, SSE with `stream: true`, a one-hour (3,600-second) timeout and continuously saved partials. They also tally non-streamed calls cut at roughly 270 to 291 seconds with `upstream-transient: fetch failed`. Worker job results under `mcp-server/jobs/`, including `f21e08cc` and `59aaf0f2`, carry `status` and `usage` but no duration field. These provide comparative evidence, not a verified worker-job duration or validation of the changed server path.

- For validation of the changed server path, use the successful fixed-server ledger receipts. Section F at `2026-11-06T20:31:51Z` used `max_output_tokens` 32000 and landed 26,319 characters in 514,445 ms. Section G at `2026-11-06T21:13:28Z` landed 16,871 characters in 501,435 ms. Both runs exceeded the former roughly 291-second cut.

## Stream and assemble Responses

- Add or verify `readResponsesStream` in `mcp-server/src/server.ts`, recorded at line 31. Accumulate `response.output_text.delta` events and ignore a malformed SSE line while continuing to read. On `response.completed`, `response.failed` or `response.incomplete`, capture `finalResponse = data.response ?? data` and `finalStatus = data.response?.status ?? eventName`. Return the final response only when `finalStatus` is `completed` and `finalResponse` exists, with `output_text` set to the accumulated text or the response's own `output_text`. If `finalStatus` is set but is not `completed`, derive `reason` from the final response using `incomplete_details?.reason ?? error?.code ?? ""` and throw `AgentRouter /responses gateway status: ${finalStatus} (${reason})`. For status `incomplete` with reason `max_output_tokens`, this produces `AgentRouter /responses gateway status: incomplete (max_output_tokens)`. If the stream ends with no terminal event, throw `AgentRouter /responses: stream ended without a completed response`.

- Preserve usage from the final response object when assembling the result. Count only status `completed` as success.

- Set the Responses body to `stream: true` in `mcp-server/src/server.ts`, recorded at line 219. Use this branch for Astra's `/v1/responses` requests.

- Break the retry loop when the error text matches `/gateway status: incomplete \(max_output_tokens\)/`, as recorded in `mcp-server/src/server.ts` at lines 130 to 133. The loop catches the reader's thrown error and stores its message. The constructed `gateway status: incomplete (max_output_tokens)` text matches the fatal-break pattern exactly, so exhaustion triggers the break without further host/key attempts.

## Align caps and timeout configuration

Use the corrected 32,000 cap across the request paths. Keep the timeout configuration change distinct from the streaming remedy and the worker's existing one-hour timeout. The [configuration reference](config.md) holds the cap and timeout defaults and clamps.

- Apply `Math.min(max_tokens, 32_000)` in `mcp-server/src/server.ts`, recorded at line 211. Ensure the request can use the full corrected cap.

- Raise the corresponding upstream token clamp in `mcp-server/src/upstream.ts` to 32,000. Check this helper rather than assuming the server change covers every request path.

- Raise the corresponding job-request clamp in `mcp-server/src/tools/jobs.ts` to 32,000. Check worker requests as well as direct chat requests.

- Verify that both lane `mcp-chat.mjs` callers pass `max_tokens: 32000`. Treat them as callers to check, not as files in the verified connector diff.

## Confirm the change inventory

- Compare your changes with the verified connector diff, which changed exactly four files with 84 insertions and 7 deletions. The files were `mcp-server/src/config.ts`, `mcp-server/src/server.ts`, `mcp-server/src/tools/jobs.ts` and `mcp-server/src/upstream.ts`. At the 2026-11-06 approximately 21:15 UTC check, those connector changes were still uncommitted.

- Exclude the untracked `mcp-server/sol-work/` directory from the fix. Do not label `package.json`, `src/worker.ts` or either lane client as changed by the verified four-file diff.

- Verify the source immediately after each serial edit, then follow "Build and inspect" and "Run the correct process" in [the repository map](repo-map.md). Build in `~/workspace/agentrouter-connector/mcp-server` with `npm run build`, which runs `tsc`; dependencies, including `tsc` in `node_modules`, must already be present. Inspect the compiled artefacts under `dist/src/` for SSE assembly, `stream: true`, cap and timeout configuration, helper clamps and the fatal budget-exhaustion break. One occurrence of `32000` is not enough. After building and populating the process environment, replace any old owned process and verify that the old process has exited before testing. Lane clients load the rebuilt code by spawning the server as a stdio subprocess from that directory. For standalone starts from that directory, use `node dist/src/server.js` for the server or `node dist/src/worker.js` for the worker. Run the lane client's tiny probe, `node mcp-chat.mjs prompts/probe.md probe.md`, expecting exactly `The probe works.` (16 characters), then a real section through the fixed server. Require terminal status `completed`, non-empty text and preserved usage for a streamed completion. Separately, on token-budget exhaustion, require termination without retries via the fatal break.

## Alternatives for better results

- Use the existing streaming worker with its one-hour timeout when worker jobs suit the task. Keep the corrected request cap and live status polling, rather than treating the worker timeout as a substitute for either fix.

- If Azure reports `upstream-state-mismatch` on a continuation, consider a fresh stateless request. No continuation-failure receipt and no stateless-request receipt were found on this machine, so this is advice, not a verified result. Do not present it as a repair of Azure's upstream state.

- Choose a supported model/channel when a tested alias is off-list. Treat host/key rotation for intermittent 502s and waiting for shared-pool recovery as separate workarounds, not extensions of the Astra fix.
