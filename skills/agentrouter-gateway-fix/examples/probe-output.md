# Historical probe output

The recorded api1 result is historical smoke-test evidence, not proof of a fresh run.

## Verified prompt

Put the verified prompt in `prompts/probe.md` within the lane directory:

```text
Reply with exactly these words and nothing else: The probe works.
```

Run the probe through the rebuilt streaming server, keeping the caller's `max_tokens: 32000`:

```sh
node mcp-chat.mjs prompts/probe.md probe.md
```

The expected answer is exactly:

```text
The probe works.
```

The answer contains 16 characters.

## Historical api1 result

The recorded api1 check used:

```sh
node mcp-chat.mjs prompts/probe.md probe-verify.md
```

It returned exactly `The probe works.`, with 16 characters, in 5,754 ms.

This is connectivity and basic request-handling evidence only. It does not prove long-generation reliability. The historical smoke test did not cross the former roughly 291-second cut. A fast successful call proves nothing about that cut.
