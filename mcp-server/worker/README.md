# Persistent job worker — why it exists, and what it does not fix

## The cancellation problem, in one paragraph

A long `gpt-6-astra` generation at `reasoning=max` takes roughly
9–15 minutes (the last successful MCP call took 543 s; the current
section-F call was still running past 12 minutes). Three different
limits kill such a call before it finishes, and they must not be
conflated:

1. **The MCP server's own fetch timeout: 600,000 ms per attempt.**
   `server.ts` aborts a gateway call at 10 minutes and rotates to the
   next host x key combination, discarding that attempt's progress.
   Any generation longer than 10 minutes therefore *cannot* land
   through `agentrouter_chat`, no matter how healthy the gateway is.
2. **The gateway's internal proxy.** AgentRouter's backend proxies to
   `model-proxy-cp.model-proxy.svc.cluster.local:8089`. When its caller
   disconnects (for example, because of limit 1), its Go client reports
   `client cancelled request before upstream response: … context
   canceled`. That bare Go error does not match the MCP server's error
   wrapper (`AgentRouter /responses (…) […]`), so a bare copy of it
   cannot have come from the current `agentrouter_chat` path; it is
   either a gateway body surfaced by a caller that bypasses the wrapper,
   or a gateway-side log line.
3. **VM replacement in the sandbox.** On 2026-10-31 at ~13:46 UTC the
   VM rebooted, killing a detached `mcp-chat.mjs` call that had run
   36 minutes, with no output file and no log line. A detached child
   survives a tool-call cancellation and a turn end, but not a reboot.

## Why background mode is not the fix here (verified 2026-10-31)

- `POST /v1/responses` with `background: true, store: false` returned
  HTTP 200 **synchronously** in 5,306 ms, with the returned body
  showing `background: false, status: completed`. No queued job was
  created, so there is nothing to poll.
- `GET /v1/responses/{id}` returns **404 `Invalid URL`** for two
  independent response IDs (one synchronous, one SSE). The gateway
  offers no retrieval-by-ID route, so a background job could not be
  reconnected to even if one were created.
- Therefore `agentrouter_submit_background` / `check` / `get` tools
  were **deliberately not built**: they would either block (same
  problem) or pretend a job exists that the gateway cannot return.
  If a future `store: true` background test is authorised, it must
  first evaluate retention: `store: true` means the gateway stores
  the response (and, by implication, the input needed to reproduce
  it) server-side for later retrieval, retrievable by anyone holding
  the response ID and the key, for a retention period the gateway
  does not publish in its responses. The worker below preserves
  `store: false` and does not need that trade-off.

## SSE (verified 2026-10-31)

- `stream: true` returns `text/event-stream` with
  `response.output_text.delta` partials and a final
  `response.completed`. Partial output *is* delivered continuously.
- SSE is **not** a deadline fix on its own: it still requires holding
  one connection for the whole generation, and after a connection loss
  there is no observed resume mechanism (no `Last-Event-ID` replay,
  no GET retrieval). Its value is that a worker can save partials
  continuously, so a cut loses only the tail, not everything.

## The worker (Phase 4)

`node dist/src/worker.js` is a separate process, not a child of the
MCP stdio server. It:

- Picks up jobs created by `agentrouter_submit_job` (which returns a
  job ID immediately and never calls the gateway, so submitting can
  never duplicate a generation).
- Calls the gateway **once per job**, through the exact host x key
  combination recorded at submit time, with `stream: true`,
  `store: false`, `reasoning: max` for Astra, and the job's token cap
  (Astra default 16,000). It does not rotate mid-job and does not
  auto-retry a transport failure.
- Saves SSE deltas to `<job>.partial.txt` continuously, then saves
  the final text atomically to `<job>.output.txt` and the gateway
  object to `<job>.result.json` on completion.
- On a transport failure or timeout (default 3,600,000 ms, not
  600,000 ms), marks the job `interrupted`, keeps the partial, and
  does **not** regenerate it. Only `agentrouter_resume_job` — an
  explicit call — re-queues an interrupted or failed job, archiving
  the old partial first so two generations' text is never mixed.
- On startup, marks stale `running` jobs (heartbeat older than 120 s)
  as `interrupted`, unless `AGENTROUTER_JOB_AUTO_RESUBMIT=1` is set.
- Honours `agentrouter_cancel_job` within seconds (checked every 5 s
  while streaming).

Job files live in `AGENTROUTER_JOBS_PATH` (default `mcp-server/jobs/`,
git-ignored, in the workspace, which survives VM replacement). No key
material is ever stored in a job file — only host and keyIndex.

## Surviving a reboot

The worker alone does not survive VM replacement. Two relaunch
options are provided, **neither installed by default**:

- `worker/guard.sh` — run it from cron every few minutes; it
  relaunches the worker if `dist/src/worker.js` is not running, and
  reads only `AGENTROUTER_KEY_1/2` from `~/workspace/.agentrouter-keys`
  (never printed). Enabling a recurring guard is a separate decision.
- `worker/agentrouter-worker.service` — an example systemd user unit
  with `Restart=always`. Copy it to `~/.config/systemd/user/`, set
  `EnvironmentFile` to a keys file, adjust `WorkingDirectory`, then
  enable it. It covers crashes, not a replaced VM.

## Tools

- `agentrouter_submit_job` — create a job, return its ID immediately.
- `agentrouter_job_status` — status, host/keyIndex, attempts, sizes, error.
- `agentrouter_job_result` — completed output, or saved partial for an
  interrupted job (labelled as partial).
- `agentrouter_list_jobs` — all jobs, oldest first.
- `agentrouter_cancel_job` — cancel pending/running; completed cannot
  be cancelled.
- `agentrouter_resume_job` — re-queue interrupted/failed only.

Existing tools (`agentrouter_chat`, batch, health, diagnostics,
config-gen) are unchanged, including their rotation and timeout
settings. The four host x key combinations remain available: a job
pins one combination, and different jobs can use different ones.
