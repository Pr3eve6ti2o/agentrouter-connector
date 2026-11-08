# Apply the verified local fix

- Establish the baseline from the 2026-11-06 diagnosis and failed receipts. Keep the roughly 291-second silent cut independent of the 16,000-token incomplete results.

- Compare the existing worker's streaming design with the old non-streamed server path. The lane notes record a persistent worker with a single pinned host and key, SSE with `stream: true`, a one-hour (3,600-second) timeout and continuously saved partials. They also tally non-streamed calls cut at roughly 270 to 291 seconds with `upstream-transient: fetch failed`. Worker job results under `mcp-server/jobs/`, including `f21e08cc` and `59aaf0f2`, carry `status` and `usage` but no duration field. These provide comparative evidence, not a verified worker-job duration or validation of the changed server path.

- For validation of the changed server path, use the successful fixed-server ledger receipts. Section F at `2026-11-06T20:31:51Z` used `max_output_tokens` 32000 and landed 26,319 characters in 514,445 ms. Section G at `2026-11-06T21:13:28Z` landed 16,871 characters in 501,435 ms. Both runs exceeded the former roughly 291-second cut.

## Stream and assemble Responses

- Update `readResponsesStream` in `mcp-server/src/server.ts`, recorded at line 36. It consumes the shared `readSseEvents` async generator from `mcp-server/src/sse.ts`. Accumulate string `data.delta` values only from `response.output_text.delta` events. Record any `JSON.parse(dataText)` failure in a local flag while continuing to read. On `response.completed`, `response.failed` or `response.incomplete`, the live code captures `finalResponse = data.response ?? data` and `finalStatus = data.response?.status ?? eventName`. The fallback is the full event name when the nested status is nullish, including when there is no nested response object. Thus `response.completed` fails the `completed` success check, and `response.incomplete` with reason `max_output_tokens` produces `AgentRouter /responses gateway status: response.incomplete (max_output_tokens)`, which does not match the fatal-break regex. No receipt establishes that this fallback branch was ever exercised. When implementing the fix, normalize the event-name fallback before the success check, for example by changing the assignment to `finalStatus = data.response?.status ?? eventName.replace(/^response\./, "")`. Return the final response only when `finalStatus` is `completed`, `finalResponse` exists and the integrity check below passes. Preserve its fields and set `output_text` to the accumulated text or the response's own `output_text`. For a set status other than `completed`, derive `reason` from `finalResponse?.incomplete_details?.reason ?? finalResponse?.error?.code ?? ""` and throw `AgentRouter /responses gateway status: ${finalStatus}`, appending ` (${reason})` only when a reason is present. If the stream ends with no terminal event, throw `AgentRouter /responses: stream ended without a completed response`.

- Before returning a completed result, run the integrity check. The final response's own `output_text` is authoritative when it is present as a non-empty string: if it differs from the accumulated text, throw an error and propagate the integrity failure to the caller. When it is absent, the accumulated text is the only text; if the local flag records any ignored malformed SSE line, throw an error instead of returning a possibly incomplete result. Return no assembled result and do not save either text as landed in either failure case. A `completed` status, non-empty delta text and preserved usage must not override this failure.

- Preserve usage from the final response object when assembling the result. Count only status `completed` as success.

- Set the Responses body to `stream: true` in `mcp-server/src/server.ts`, recorded at line 227. Use this branch for Astra's `/v1/responses` requests. Verify that this request path invokes the SSE reader through the call site in the same file at line 132: `if (streamed && response.ok) return await readResponsesStream(response);`.

- Break the retry loop when the error text matches `/gateway status: incomplete \(max_output_tokens\)/`, as recorded in `mcp-server/src/server.ts` at lines 138-141. The loop catches the reader's thrown error and stores its message. For status `incomplete` with reason `max_output_tokens`, the constructed error is `AgentRouter /responses gateway status: incomplete (max_output_tokens)`, which matches the fatal-break pattern exactly, so exhaustion triggers the break without further host/key attempts. Applying the normalization prescribed above makes the event-name fallback use this matching status form as well; the live prefixed fallback does not match.

## Align caps and timeout configuration

Use the corrected 32,000 cap across the request paths. Keep the timeout configuration change distinct from the streaming remedy and the worker's existing one-hour timeout. The [configuration reference](config.md) holds the cap and timeout defaults and clamps.

- Apply `Math.min(max_tokens, config.astraMaxTokens)` in `mcp-server/src/server.ts`, recorded at line 219. The default at line 215 is `max_tokens = astra ? config.astraMaxTokens : 4096`. Ensure the request can use the full corrected cap.

- Use the shared ceiling via `astraMaxTokens()` for the corresponding upstream token clamp in `mcp-server/src/upstream.ts`, recorded at line 119. Check this helper rather than assuming the server change covers every request path.

- Use the shared ceiling via `astraMaxTokens()` for the corresponding job-request clamp in `mcp-server/src/tools/jobs.ts`, recorded at lines 112-113. Check worker requests as well as direct chat requests.

- Verify that both lane `mcp-chat.mjs` callers pass `max_tokens: 32000`. Treat them as callers to check, not as files in the verified connector diff.

## Confirm the change inventory

- Compare your changes with the verified connector diff, which changed exactly four files with 84 insertions and 7 deletions. The files were `mcp-server/src/config.ts`, `mcp-server/src/server.ts`, `mcp-server/src/tools/jobs.ts` and `mcp-server/src/upstream.ts`. At the 2026-11-06 approximately 21:15 UTC check, those connector changes were still uncommitted.
- The four-file diff with 84 insertions and 7 deletions describes the 2026-11-06 repair only. The lint plus architecture passes merged on 2026-11-08 changed 38 files (1144 insertions, 450 deletions) against HEAD `17ec298`, including `mcp-server/src/worker.ts` and the new `mcp-server/src/env.ts` and `mcp-server/src/sse.ts`. Documentation updates since then add further changes. Do not present the four-file inventory as the current tree state.

- Exclude the untracked `mcp-server/sol-work/` directory from the fix. Do not label `package.json`, `src/worker.ts` or either lane client as changed by the verified four-file diff.

- Make a recoverable checkpoint before any edit. The 2026-11-07 live check still found the repair uncommitted. The published skill commit `17ec298` changed only files under `skills/agentrouter-gateway-fix/`; it is not a checkpoint of the repair. Diagnostic receipts alone are not a recoverable source and build checkpoint.

- Set `HEAD_RECORD` and `REPAIR_PATCH` to separate, unused absolute file paths in a writable location outside the connector repository, so a checkout cannot destroy them. From the connector repository root, run `git rev-parse --verify HEAD > "$HEAD_RECORD"`, then `git diff --binary "$(cat "$HEAD_RECORD")" -- mcp-server/src/config.ts mcp-server/src/server.ts mcp-server/src/tools/jobs.ts mcp-server/src/upstream.ts > "$REPAIR_PATCH"`. Stop if either command fails.

- Require `test -s "$HEAD_RECORD"` and `test -s "$REPAIR_PATCH"` to succeed. Run `git apply --stat "$REPAIR_PATCH"` and confirm that it lists exactly the four paths above, with 84 insertions and 7 deletions. Run `git apply --reverse --check "$REPAIR_PATCH"` to check the patch against the current source without applying it. Do not proceed if any check fails or the inventory differs.

- Before editing, run `npm run build` in `~/workspace/agentrouter-connector/mcp-server` and follow the process replacement and tiny-probe steps below against that build. Keep the successful build and probe receipts with the external checkpoint, and stop if either fails. The recorded HEAD and saved patch preserve the source; recover its compiled output by rebuilding that source, not by trusting an old `dist/src/`.

- Verify the source immediately after each serial edit, then follow "Build and inspect" and "Run the correct process" in [the repository map](repo-map.md). Build in `~/workspace/agentrouter-connector/mcp-server` with `npm run build`, which runs `tsc`; dependencies, including `tsc` in `node_modules`, must already be present. Inspect the compiled artefacts under `dist/src/` for SSE assembly, `stream: true`, cap and timeout configuration, helper clamps and the fatal budget-exhaustion break. One occurrence of `32000` is not enough. After building and populating the process environment, replace any old owned process and verify that the old process has exited before testing. Lane clients load the rebuilt code by spawning the server as a stdio subprocess from that directory. For standalone starts from that directory, use `node dist/src/server.js` for the server or `node dist/src/worker.js` for the worker. Run the lane client's tiny probe, `node mcp-chat.mjs prompts/probe.md probe.md`, expecting exactly `The probe works.` (16 characters), then a real section through the fixed server. Require terminal status `completed`, non-empty text and preserved usage for a streamed completion. Separately, on token-budget exhaustion, require termination without retries via the fatal break.

- If an edit, build, restart or validation goes wrong, stop and confirm that the external checkpoint is still available. From the connector repository root, run `git restore --source="$(cat "$HEAD_RECORD")" --staged --worktree -- mcp-server/src/config.ts mcp-server/src/server.ts mcp-server/src/tools/jobs.ts mcp-server/src/upstream.ts`. This discards staged and unstaged changes to exactly those files, restoring their recorded-HEAD versions without the uncommitted repair. It leaves `mcp-server/sol-work/` and other paths untouched. Stop if the restore fails.

- In `~/workspace/agentrouter-connector/mcp-server`, run `npm run build` again so the compiled output matches the restored source. After a successful build, populate the documented process environment, replace any old owned process and verify that it has exited before testing. Run `node mcp-chat.mjs prompts/probe.md probe.md` from that directory so the lane client spawns the rebuilt server. Require exactly `The probe works.` (16 characters). If the build or probe fails, stop; the rollback is not verified.

- To re-apply the saved repair afterwards, run `git apply --check "$REPAIR_PATCH"` from the connector repository root, then run `git apply "$REPAIR_PATCH"` only if the check succeeds. After application succeeds, reconfirm the inventory and repeat the build, compiled-artefact inspection, owned-process replacement, tiny probe and real-section checks above, including the separate fatal budget-exhaustion check. The reapplied repair remains uncommitted, so keep the external checkpoint.
## Alternatives for better results

- Use the existing streaming worker with its one-hour timeout when worker jobs suit the task. Keep the corrected request cap and live status polling, rather than treating the worker timeout as a substitute for either fix.

- If Azure reports `upstream-state-mismatch` on a continuation, consider a fresh stateless request. No continuation-failure receipt and no stateless-request receipt were found on this machine, so this is advice, not a verified result. Do not present it as a repair of Azure's upstream state.

- Choose a supported model/channel when a tested alias is off-list. Treat host/key rotation for intermittent 502s and waiting for shared-pool recovery as separate workarounds, not extensions of the Astra fix.
