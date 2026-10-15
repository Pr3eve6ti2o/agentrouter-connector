# AgentRouter Connector

A secure, high-throughput AgentRouter connector exposing:

- **MCP** at `/mcp` for AI assistants and agents.
- **OpenAI-compatible HTTP** at `/v1/models` and `/v1/chat/completions`.

The design preserves the attached `custom.agentrouter` secure-vault caller and adds a deployable gateway for other AI clients.

## Security

The connector never logs raw upstream credentials. In the secure-vault runtime, `bin/ar_call.py` uses a short-lived `hsurr:*` surrogate and a host allowlist. In standalone mode, `AGENTROUTER_KEY`, `CONNECTOR_API_KEY`, and `MCP_AUTH_TOKEN` are separate secrets.

## Throughput

Use `MAX_CONCURRENCY`, bounded batch execution, async I/O, transient-error retries, `Retry-After`, streaming, and explicit model fallback to maximize practical utilization. These mechanisms do not bypass AgentRouter's own account/provider limits.

## Source vs current docs

The attached build record is the source of truth for the existing `custom.agentrouter` secure-vault connector and its 2026-10-03 live test. Current AgentRouter public documentation now also describes a capability-first API and a hosted MCP service. See `docs/PROCESS.md`.

## Install

```bash
cp .env.example .env
npm install
npm run check
npm test
npm run build
npm start
```

## Endpoints

```text
GET  /health
GET  /v1/models
POST /v1/chat/completions
POST /mcp
```

## Batch delegation runner — `bin/delegate.py`

A Python 3 script (standard library only, no packages to install) that runs a
batch of prompts — a *job* — against external models through AgentRouter, in
parallel, with spend caps and crash-safe results. It is built for audits,
regression passes and research jobs where a run may take an hour or more.

Calls go through `bin/ar_call.py` and its secure-vault credential by default.
`delegate.py` finds it via the `AR_CALL` constant at the top of the file —
edit that path if `ar_call.py` lives somewhere else. A task may instead carry
its own `host` and `api_key` fields for a direct call.

### Job file

```json
{
  "name": "my-audit",
  "per_run_cap_usd": 5.00,
  "tasks": [
    {
      "id": "section-1",
      "model": "claude-opus-5",
      "messages": [{ "role": "user", "content": "Review this code: ..." }],
      "max_tokens": 14000
    }
  ]
}
```

Each task needs a unique `id`, a `model`, `messages`, and `max_tokens`.
Optional per-task fields: `host`, `api_key`, and `no_reword` (see Retries).

### Run it

```bash
python3 bin/delegate.py --job job.json --out ./results
python3 bin/delegate.py --job job.json --out ./results --workers 8
python3 bin/delegate.py --job job.json --out ./results --no-resume
```

| Flag | Meaning |
| --- | --- |
| `--job PATH` | Job JSON file (required). |
| `--out DIR` | Results directory (required); created if missing. |
| `--workers N` | Parallel tasks (default 4). |
| `--ledger PATH` | Spend ledger file (default alongside the skill). |
| `--monthly-cap-usd USD` | Refuse to start if this month's ledger total plus the run estimate would exceed the cap. |
| `--no-resume` | Ignore saved results and re-run every task. |

### Behaviour

- **Spend guardrails.** A job must set `per_run_cap_usd`; the run is refused
  without one. Cost is estimated up front from per-model rates, and actual
  usage is appended to the ledger when the run ends.
- **Retries.** A blank or very short response is retried up to 3 attempts and
  is never counted as a success. The third attempt normally uses a reworded
  prompt; set `"no_reword": true` on a task to retry the original prompt
  verbatim instead (recommended for audits, where the brief must not change).
- **Crash safety and resume.** Each result is written atomically to
  `<out>/<task-id>.json` the moment its task finishes, and `progress.json`
  is updated after every task; `summary.json` is written at the end.
  Re-running the same command resumes where it stopped — tasks already saved
  as successful are skipped, not re-run and not billed again.
- **Redaction.** Secret-like spans (API keys, seed phrases) are stripped from
  every prompt before anything is sent.

Each result file records `ok`, the returned `text`, token usage, the number
of `attempts`, and any error — a failed task is saved as a failure, never as
an empty success.
