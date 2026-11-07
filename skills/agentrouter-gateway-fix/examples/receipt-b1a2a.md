# Historical B1a2a receipt

This is historical proof from the recorded B1a2a direct test, not evidence that a fresh test has been run.

## Evidence to correlate

Correlate the result, log and verified generated section:

- `~/workspace/bawa-wallet/agent-g-android/stream-test-B1a2a.result.json`
- `~/workspace/bawa-wallet/agent-g-android/stream-test-B1a2a.log`
- `~/workspace/bawa-wallet/agent-g-android/G-AND-B1a2a.md`

## Recorded fields

```json
{
  "status": "completed",
  "incomplete_details": null,
  "chars": 9759,
  "ms": 442503,
  "usage": {
    "output_tokens": 18994,
    "output_tokens_details": {
      "reasoning_tokens": 16536
    },
    "total_tokens": 19156
  }
}
```

The `completed` status and `null` incomplete details establish that the historical result was not token-budget incomplete.

Check the actual generated section alongside the `9759` character count. Character count is not token count.

The recorded `442503` ms generation survived beyond the former roughly 291-second cut. This is historical duration evidence, not fresh proof. A fast successful call proves nothing about that cut.

## Reasoning-token interpretation

Reasoning tokens are included within output tokens. Never add `usage.output_tokens_details.reasoning_tokens` and `usage.output_tokens` together.

The 16,536 reasoning tokens exceeded the former 16,000-token cap by 536 tokens. Reasoning alone exceeded that entire budget, proving why a larger cap was needed.