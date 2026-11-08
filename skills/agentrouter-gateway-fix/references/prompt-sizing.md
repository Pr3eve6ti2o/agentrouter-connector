# Prompt sizing at max reasoning

At reasoning `max` with a 32,000-token cap, some calls remained silent with zero returned characters until a client timeout or an owner-ordered stop. Silence and elapsed time do not establish continued model reasoning; local `ps` checks establish only process liveness. Small prompts can land quickly, although their timings also vary substantially. Prompt size is a risk factor, not a limit: there is no clean hard threshold in these observations. A 3,674-word prompt landed once in 599s, about 10 minutes, while a 2,481-word prompt timed out after 3,600s. The grouped ledger evidence distinguishes landed calls, client timeout, owner-ordered stops, and output-cap failure.

- In `astra-audit-log.jsonl`, `gpt-6-astra` ran at reasoning `max` with a 32,000-token cap. All listed calls landed.
  - A 697-word prompt landed in 69s.
  - A 574-word prompt landed in 331s.
  - A 694-word prompt landed in 193s.
  - A 661-word prompt landed in 176s.
  - A 670-word prompt landed in 133s.
  - A 675-word prompt landed in 91s.
  - A 587-word prompt landed in 208s.
  - A 3,674-word prompt landed in 599s.

- The a1/a2/b1/b2 fix ledgers record `gpt-6-astra` calls at reasoning `max` with a 32,000-token cap. All listed calls landed.
  - A 1,632-word prompt landed in 390s.
  - A 1,213-word prompt landed in 126s.
  - A 963-word prompt landed in 104s.
  - A 1,456-word prompt landed in 261s.
  - A 1,341-word prompt landed in 159s.
  - A 1,116-word prompt landed in 151s.
  - An 865-word prompt landed in 31s.
  - A 1,790-word prompt landed in 453s.
  - A 1,439-word prompt landed in 114s.
  - A 1,177-word prompt landed in 122s.
  - A 1,788-word prompt landed in 190s.

- In `b3-fix-log.jsonl`, `gpt-6-astra` ran at reasoning `max` with a 32,000-token cap. These outcomes include successful calls, a client timeout, and owner-ordered stops.
  - A 1,369-word prompt landed in 387s.
  - A 1,119-word prompt landed in 1,198s.
  - A 2,010-word prompt landed in 436s, with 1 regression.
  - The call with a 2,481-word prompt FAILED after 3,600s at the 60-minute client timeout, with 0 chars.
  - A 1,865-word prompt landed in 273s.
  - A call with a 2,160-word prompt was killed on owner order after 2,437s silent, with 0 chars.
  - A 1,834-word prompt landed in 126s.
  - A call with a 2,248-word prompt was killed on owner order after 1,629s silent, with 0 chars.
  - A 676-word prompt landed in 107s.
  - A 445-word prompt landed in 274s.
  - A 423-word prompt landed in 16s.
  - A 365-word prompt landed in 13s.
  - A 225-word prompt landed in 9s.

- In `sol-request-log.jsonl`, `gpt-6.1-sol` ran at reasoning `max` with a 32,000-token cap.
  - `prompts/expand-plan-brief.md` counts 4,469 words by `wc -w`.
  - The call failed at `2026-11-06T21:58:31Z` with gateway status `incomplete` (`max_output_tokens`).
  - This records an output-cap failure, not a client timeout or a demonstrated prompt-word limit.
## Kill and split

If a call remains silent beyond roughly 30 to 40 minutes while the client process and its MCP server child are both still alive, do not wait for the 60-minute client timeout. Obtain the owner's authorization, then kill the attempt on that instruction. Resume by splitting the work into smaller parts, not by resubmitting the same oversized prompt.

1. Use `ps` to verify that the client process ID is live before sending a kill. Confirm its MCP server child as well, so the stop targets the running pair rather than a stale process ID. Kill the verified client and its server child, then confirm that neither remains alive.

2. Record the termination in the ledger as an owner-ordered kill, never as a gateway failure. Do not imply that the client reached its timeout. Keep the record tied to the observed attempt and the owner's instruction so that an intentional stop remains distinguishable from an infrastructure error.

3. Re-split the unfinished work using complete prompts under 1,000 words as a conservative recovery target after stalls, not a universal requirement or a guarantee of completion. Count the whole submitted prompt, including repeated context and instructions, not just the new task description. Split further only while decomposition remains useful; if a compliant part repeatedly stalls or further splitting is no longer useful, follow step 5. Larger-prompt landings in `reverify-log.jsonl` are counter-evidence to a universal limit: GPT-6-Astra at reasoning `max` with a 32,000-token cap landed prompts of 2,940 words in 487s, 2,926 words in 1,827s, 3,685 words in 412s, and 3,785 words in 508s.

4. Submit the parts sequentially. Apply each landed part and re-run the checks before submitting the next part. Address problems exposed by those checks before continuing, so later parts build on checked, applied work rather than assumed results.

5. If a complete prompt under 1,000 words repeatedly stalls, or further splitting no longer produces useful, independently checkable parts, stop splitting and pause new submissions. Handle any active silent attempt using the timing, liveness checks, and owner-authorized stop procedure above. Record each attempt's complete prompt word count, model, reasoning setting, token cap, elapsed time, returned character count, process observations, actual outcome, and any owner stop instruction; distinguish client timeout from owner-ordered kill. Report the ledger entries, checked progress, remaining work, and reason for escalation to the owner. The observed client timeout and owner-ordered stops do not establish that further splitting will help or identify an upstream cause. Ask the owner whether to keep the work paused or authorize a diagnostic attempt on the smallest useful part at a lower reasoning setting. This setting change is unverified by the supplied record, not a demonstrated remedy. Use the same monitoring and authorized-stop criteria; if the attempt lands, apply it and run the checks before continuing. If it stalls, pause and report the blocker again rather than resume a split-and-retry loop.

The smaller prompts in `b3-fix-log.jsonl` support splitting as a recovery tactic: 676 words landed in 107s; 445 in 274s; 423 in 16s; 365 in 13s; and 225 in 9s. These are observed completion times, not guarantees for subsequent calls. Use complete prompts under 1,000 words as a conservative target for recovery after stalls, not a blanket requirement for real-section requests. Preserve the apply-and-check cycle between parts, and follow step 5 when compliant parts repeatedly stall or useful decomposition is exhausted.