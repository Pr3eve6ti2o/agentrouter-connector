# Verify before claiming success

Follow this ladder in order. Keep current observations separate from historical receipts, and limit the claim to what the tested path actually demonstrates.

## Discover the tools

Run discovery from a configured lane directory:

```sh
node mcp-chat.mjs --list
```

Expect 12 tools from the verified record. Inspect their exact names and calling schemas. Investigate failed discovery or a different count before proceeding. A tool count alone does not prove that generation works.

The historical discovery check at approximately 21:15 UTC on 2026-11-06 ran this command in the api1 lane and returned 12 tools from server `agentrouter`, version `1.0.0`. This recorded result is not a substitute for inspecting the current tools and schemas.

## Run the tiny probe

Put the verified prompt in `prompts/probe.md` within the lane directory:

```text
Reply with exactly these words and nothing else: The probe works.
```

Run it through the rebuilt streaming server, keeping the caller's `max_tokens: 32000`:

```sh
node mcp-chat.mjs prompts/probe.md probe.md
```

Expect exactly:

```text
The probe works.
```

The answer has 16 characters. This establishes connectivity and basic request handling, not long-generation reliability.

The historical api1 check ran:

```sh
node mcp-chat.mjs prompts/probe.md probe-verify.md
```

It returned exactly `The probe works.`, with 16 characters, in `5754` ms. This is historical smoke-test evidence only. It did not cross the former roughly 291-second cut and is not fresh proof.

## Run a real section

Run tool discovery first from the configured lane directory:

```sh
node mcp-chat.mjs --list
```

Confirm the server and its 12 tools, and inspect their exact names and calling schemas. Investigate failed discovery or a different count before proceeding.

Select a real section prompt and use a fresh stateless Astra Responses request. Keep `max_tokens: 32000` in the call. Size the section prompt using [prompt sizing](references/prompt-sizing.md) before running it. Do not resume a dead upstream chain.

Read the [lane client](~/workspace/bawa-wallet/agent-g-android/mcp-chat.mjs), or its api1 twin when using that lane, and the `agentrouter_chat` body construction in [server.ts](mcp-server/src/server.ts). Confirm the effective settings before claiming a pass:

- The client calls `agentrouter_chat` with `model: "gpt-6-astra"`, `messages: [{ role: "user", content: prompt }]`, `max_tokens: 32000` and `effort: "max"`.
- The server maps Astra to `/v1/responses`, sets `stream: true`, maps the cap to `max_output_tokens: min(max_tokens, 32000)` and sends `reasoning: { effort: "max" }`. With these call arguments, the effective cap is `32000`.
- The server sets `store: false`, and the outgoing request contains no `previous_response_id` or other previous-response reference. Check that each call carries only its own messages, with no chained state; `store: false` alone is not the continuation-state check.

Before running, arrange to preserve that call's full Responses object, returned as tool result JSON, before the lane client extracts `output_text`. The client writes only the text to the output file and does not save the raw JSON. Its own `mcp-request-log.jsonl` records request metadata, with elapsed time and answer character count as the only outcome measurements. It does not carry terminal status or usage.

Replace the placeholders with your real section and output names before running this command form from the lane directory:

```sh
node mcp-chat.mjs prompts/<section>.md <output>.md
```

Alternatively, make the fresh call by invoking `agentrouter_chat` directly using its discovered schema and the confirmed arguments, preserving the returned JSON. Read `status` and `usage` from that call's own result. Do not take either field from another call's receipt.

For worker jobs, invoke `agentrouter_job_status` to poll the current job live and `agentrouter_job_result` to retrieve its result, using the exact invocation and schemas from discovery. Read that job's own `status` and `usage` from its result file under `mcp-server/jobs/`.

Inspect the returned result, generated Markdown and that call's receipt. Do not rely on a success message alone. Before claiming a generation pass, require:

- Terminal status `completed`.
- Non-empty text.
- Preserved usage.

Record the model, endpoint, stream setting, cap, elapsed time, terminal status, text length and usage without credentials. Diagnose failures through the catalogue rather than treating every error as retryable.

## Read the historical proof receipts

These records are historical evidence. None establishes that you have run a fresh test.

### Historical B1a2a direct-test receipt

Correlate the result, log and verified section:

- `~/workspace/bawa-wallet/agent-g-android/stream-test-B1a2a.result.json`
- `~/workspace/bawa-wallet/agent-g-android/stream-test-B1a2a.log`
- `~/workspace/bawa-wallet/agent-g-android/G-AND-B1a2a.md`

Read the recorded fields as follows:

- `status` is `completed`.
- `incomplete_details` is `null`.
- `chars` is `9759`.
- `ms` is `442503`.
- `usage.output_tokens` is `18994`.
- `usage.output_tokens_details.reasoning_tokens` is `16536`.
- `usage.total_tokens` is `19156`.

The terminal status and null incomplete details establish that this historical result was not token-budget incomplete. Check the actual generated section; character count is not token count.

The `442503` ms generation survived beyond the former roughly 291-second cut.

Reasoning tokens are included within output tokens. Never add the reasoning and output figures together. The 16,536 reasoning tokens alone exceeded the former 16,000-token cap by 536 tokens, proving why a larger cap was needed.

### Historical F end-to-end receipt

Correlate `~/workspace/bawa-wallet/agent-g-android-api1/G-AND-F.md` with F's own row in `~/workspace/bawa-wallet/agent-g-android-api1/mcp-request-log.jsonl`.

The verified historical ledger row records:

- The timestamp is `2026-11-06T20:31:51.280Z`, the tool is `agentrouter_chat` and the model is `gpt-6-astra`.
- `reasoning_sent` is `max` and `max_output_tokens` is `32000`.
- The prompt file is `prompts/G-AND-F.md` and the output file is `G-AND-F.md`.
- The answer has `26319` characters and the elapsed time is `514445` ms.

The recorded first-hand check of that F file found `26319` characters, `0` meta hits, `8` fences (paired) and `0` secret-pattern hits. These are F's own ledger and file-check values.

F is historical end-to-end evidence of a real section landing through the fixed server in the api1 lane. Its 514.445-second duration exceeded the former roughly 291-second cut. It is not fresh verification.

Keep B1a2a as the separate direct-test receipt. F's ledger and file check do not supply terminal status or usage. Obtain those fields from F's own receipt. Do not copy them from B1a2a or infer them.

### Historical G record

The recorded update says section G has since landed in the api1 lane:

- `16,871` characters.
- `501,435` ms.
- Ledger timestamp `2026-11-06T21:13:28Z`.

Treat G as historical, never as proof of a fresh run. Do not count G, or any section, as a completed generation without its own terminal result and receipt.

## Bound the fresh verification claim

Require a fresh call to cross the roughly 291-second boundary before claiming that it demonstrates survival beyond the old cut. A fast successful call proves nothing about survival beyond that cut.

At the recorded check, no additional real section was run for this audit. F remained the historical real-lane long-generation proof. The later recorded G landing does not change the requirement for fresh evidence and each section's own terminal result and receipt.

Poll worker status live through the exact status tool discovered from the rebuilt server. Keep saved pending or failed snapshots separate from current liveness.

Limit the success claim to the combined local streaming and 32,000-token fix on the tested path. Do not claim that it repairs shared rate limits, continuation-state failures, intermittent 502s, Claude starvation or unsupported models.