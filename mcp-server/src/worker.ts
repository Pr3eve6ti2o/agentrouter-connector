// Independent persistent job worker (Phase 4 + Phase 5).
// Run as a SEPARATE process, never as a child of the MCP stdio server:
//   node dist/src/worker.js
// It survives Muse tool-call cancellation and MCP server death, because
// it is not a child of either. It does NOT survive VM replacement on
// its own: job state lives in the workspace jobs directory (which does
// survive), and a guard (worker/guard.sh, or a systemd unit) must
// relaunch it after a reboot. On startup it marks stale running jobs
// (heartbeat older than 120 s) as interrupted by default; an
// interrupted job needs agentrouter_resume_job. Explicitly setting
// AGENTROUTER_JOB_AUTO_RESUBMIT=1 re-queues stale running jobs instead.
//
// Per job, the worker makes ONE gateway call through the EXACT host x
// key combination recorded at submit time, using SSE (stream: true,
// store: false preserved) so partial output is saved continuously.
// It does not rotate mid-job and does not auto-retry a transport
// failure: after a disconnect the gateway offers no retrieval route
// (GET /v1/responses/{id} returns 404, verified 2026-10-31), so an
// automatic retry could silently create a second generation. The
// saved partial plus an explicit resume is the honest recovery.
//
// Timeout: the worker is not bound by any Muse tool-call deadline, so
// its gateway timeout defaults to 3,600,000 ms (1 hour), not the MCP
// server's 600,000 ms per-attempt timeout that made any Astra
// generation longer than 10 minutes impossible through agentrouter_chat.

import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  listJobs, readJob, saveJob, appendPartial, archivePartial,
  saveOutput, saveResultJson, claimJob, releaseClaim, touchHeartbeat,
  ensureJobsDir, jobsDir, type Job,
} from "./jobs.js";
import { readSseEvents } from "./sse.js";
import { parseApiKeys, parseHosts, clientHeaders } from "./env.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));


function workerTimeoutMs(): number {
  const raw = Number(process.env.AGENTROUTER_WORKER_TIMEOUT_MS);
  // Node.js converts setTimeout delays greater than 2^31 - 1 ms to 1 ms;
  // bound the configured value the same way as pollMs().
  return Number.isSafeInteger(raw) && raw >= 60_000 && raw <= 2_147_483_647
    ? raw
    : 3_600_000;
}
function pollMs(): number {
  const raw = Number(process.env.AGENTROUTER_WORKER_POLL_MS);
  // Node.js converts delays greater than 2^31 - 1 ms to 1 ms.
  return Number.isSafeInteger(raw) && raw >= 1_000 && raw <= 2_147_483_647
    ? raw
    : 10_000;
}
function autoResubmit(): boolean {
  return process.env.AGENTROUTER_JOB_AUTO_RESUBMIT === "1";
}

const KEYS = parseApiKeys(process.env);
const HOSTS = parseHosts(process.env) ?? ["agentrouter.org", "ps.air-outer.com"];
if (!KEYS.length) {
  console.error("worker: set AGENTROUTER_KEY_1 and/or AGENTROUTER_KEY_2");
  process.exit(2);
}

let shuttingDown = false;
process.on("SIGTERM", () => { shuttingDown = true; });
process.on("SIGINT", () => { shuttingDown = true; });

function log(...args: unknown[]): void {
  console.log(`[worker ${new Date().toISOString()}]`, ...args);
}
async function runJob(job: Job): Promise<void> {
  const key = KEYS[job.keyIndex];
  if (key === undefined) {
    job.status = "failed";
    job.error = `keyIndex ${job.keyIndex} is not configured in this worker process`;
    job.error_kind = "auth-token";
    job.finished_at = new Date().toISOString();
    await saveJob(job);
    return;
  }
  const attempt = job.attempts + 1;
  job.attempts = attempt;
  job.status = "running";
  // A resumed attempt gets a new gateway response; keeping the old
  // response_id would mislabel this attempt's generation.
  job.response_id = undefined;
  job.started_at = new Date().toISOString();
  job.finished_at = undefined;
  job.last_heartbeat = new Date().toISOString();
  job.error = undefined;
  job.error_kind = undefined;
  job.partial_chars = 0;
  await archivePartial(job.id, attempt);
  await saveJob(job);
  log(`start job=${job.id} attempt=${attempt} model=${job.model} host=${job.host} keyIndex=${job.keyIndex} max_tokens=${job.max_tokens}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), workerTimeoutMs());
  const heartbeat = setInterval(() => {
    touchHeartbeat(job.id).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log(`job=${job.id} heartbeat failed: ${message}`);
    });
  }, 30_000);
  const cancelWatch = setInterval(() => {
    (async () => {
      const current = await readJob(job.id);
      if (current?.status === "cancelled") controller.abort();
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log(`job=${job.id} cancellation check failed: ${message}`);
    });
  }, 5_000);

  const body = {
    model: job.model,
    input: job.messages,
    instructions: job.system,
    max_output_tokens: job.max_tokens,
    store: false,
    stream: true,
    ...(job.effort === "max" ? { reasoning: { effort: "max" } } : {}),
  };
  const t0 = Date.now();
  let accumulated = "";
  let finalText: string | null = null;
  let completedValue: unknown = null;
  let completedStatus: string | null = null;

  try {
    const response = await fetch(`https://${job.host}/v1/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        ...clientHeaders,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      const current = (await readJob(job.id)) ?? job;
      if (current.status === "cancelled") {
        // Cancel wins over the HTTP result.
      } else if (response.status === 502 || response.status === 504) {
        current.status = "interrupted";
        current.error_kind = "upstream-transient";
      } else {
        current.status = "failed";
        current.error_kind = `http-${response.status}`;
      }
      current.error = `AgentRouter /responses HTTP ${response.status}: ${text.slice(0, 500)}`;
      current.finished_at = new Date().toISOString();
      await saveJob(current);
      log(`job=${job.id} http=${response.status} status=${current.status} ms=${Date.now() - t0}`);
      return;
    }

    const isSseRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null;

    for await (const event of readSseEvents(response)) {
      if (event.kind === "data") {
        const { eventName, data } = event;
        if (data !== null && data !== undefined) {
          const eventData = isSseRecord(data) ? data : undefined;
          const responseValue = eventData?.response;
          const response = isSseRecord(responseValue) ? responseValue : undefined;
          const responseId = response?.id;
          const responseStatus = response?.status;

          if (typeof responseId === "string" && !job.response_id) {
            job.response_id = responseId;
            const cur = await readJob(job.id);
            if (cur) {
              cur.response_id = job.response_id;
              await saveJob(cur);
            }
          }
          if (
            eventName === "response.output_text.delta" &&
            typeof eventData?.delta === "string" &&
            eventData.delta
          ) {
            accumulated += eventData.delta;
            await appendPartial(job.id, eventData.delta);
          } else if (
            eventName === "response.output_text.done" &&
            typeof eventData?.text === "string"
          ) {
            finalText = eventData.text;
          } else if (eventName === "response.completed") {
            completedValue = responseValue ?? data;
            completedStatus =
              typeof responseStatus === "string" ? responseStatus : "completed";
            if (typeof response?.output_text === "string") {
              finalText = response.output_text;
            }
          } else if (
            eventName === "response.failed" ||
            eventName === "response.incomplete"
          ) {
            completedValue = responseValue ?? data;
            completedStatus =
              typeof responseStatus === "string" ? responseStatus : eventName;
          }
        }
      }
      if (shuttingDown) controller.abort();
    }

    const current = (await readJob(job.id)) ?? job;
    if (current.status === "cancelled") {
      log(`job=${job.id} cancelled, partial_chars=${accumulated.length} ms=${Date.now() - t0}`);
      return;
    }
    if (completedStatus && completedStatus !== "completed") {
      // Save the gateway object even on failure: without it, an
      // incomplete result cannot be diagnosed (usage, incomplete
      // reason, token counts are all in this object).
      if (completedValue !== null) await saveResultJson(job.id, completedValue);
      current.status = "failed";
      current.error = `Gateway response status: ${completedStatus}`;
      current.error_kind = "gateway-status";
      current.finished_at = new Date().toISOString();
      await saveJob(current);
      log(`job=${job.id} gateway_status=${completedStatus} ms=${Date.now() - t0}`);
      return;
    }
    if (completedValue === null && !finalText && !accumulated) {
      current.status = "interrupted";
      current.error = "Stream ended without a completed response and without any text";
      current.error_kind = "upstream-transient";
      current.finished_at = new Date().toISOString();
      await saveJob(current);
      log(`job=${job.id} interrupted empty-stream ms=${Date.now() - t0}`);
      return;
    }
    const output = finalText ?? accumulated;
    await saveOutput(job.id, output);
    if (completedValue !== null) await saveResultJson(job.id, completedValue);
    current.status = "completed";
    current.output_chars = output.length;
    current.finished_at = new Date().toISOString();
    await saveJob(current);
    log(`job=${job.id} completed output_chars=${output.length} ms=${Date.now() - t0}`);
  } catch (error) {
    const current = (await readJob(job.id)) ?? job;
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);
    if (current.status === "cancelled" || name === "AbortError" && shuttingDown) {
      current.status = "cancelled";
      current.finished_at = new Date().toISOString();
      await saveJob(current);
      log(`job=${job.id} cancelled ms=${Date.now() - t0}`);
    } else {
      // Transport failure / timeout: generation state is UNKNOWN
      // (gateway has no retrieval route), so this is interrupted, not
      // failed, and never auto-retried. Resume is explicit.
      current.status = "interrupted";
      current.error = message.slice(0, 500);
      current.error_kind = name === "TimeoutError" || /timeout/i.test(message)
        ? "worker-timeout" : "upstream-transient";
      current.finished_at = new Date().toISOString();
      await saveJob(current);
      log(`job=${job.id} interrupted error=${name} ms=${Date.now() - t0} partial_chars=${accumulated.length}`);
    }
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    clearInterval(cancelWatch);
    try {
      await releaseClaim(job.id);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log(`job=${job.id} claim release failed: ${message}`);
    }
  }
}
async function startupRecovery(): Promise<void> {
  const jobs = await listJobs();
  const now = Date.now();
  for (const job of jobs) {
    if (job.status !== "running") continue;
    const heartbeat = job.last_heartbeat ? Date.parse(job.last_heartbeat) : 0;
    if (now - heartbeat < 120_000) continue;
    if (autoResubmit()) {
      job.status = "pending";
      job.error = undefined;
      job.error_kind = undefined;
      log(`startup: stale running job=${job.id} re-queued (AGENTROUTER_JOB_AUTO_RESUBMIT=1)`);
    } else {
      job.status = "interrupted";
      job.error = "Worker restarted (or VM rebooted) while this job was running; its gateway generation state is unknown and it was not silently regenerated";
      job.error_kind = "worker-restart";
      job.finished_at = new Date().toISOString();
      log(`startup: stale running job=${job.id} marked interrupted (auto-resubmit off)`);
    }
    await saveJob(job);
    await releaseClaim(job.id);
  }
}

async function main(): Promise<void> {
  log(`starting pid=${process.pid} hosts=${HOSTS.join(",")} keys=${KEYS.length} timeout_ms=${workerTimeoutMs()} poll_ms=${pollMs()} auto_resubmit=${autoResubmit()}`);
  await ensureJobsDir();
  await writeFile(join(jobsDir(), "worker.pid"), `${process.pid}\n`, "utf8");
  await startupRecovery();
  while (!shuttingDown) {
    const jobs = await listJobs();
    if (shuttingDown) break;
    let ranJob = false;
    for (const next of jobs) {
      if (shuttingDown) break;
      if (next.status !== "pending") continue;
      const fresh = await readJob(next.id);
      if (shuttingDown) break;
      if (!fresh || fresh.status !== "pending") continue;
      if (!(await claimJob(next.id, `worker:${process.pid}`))) continue;
      if (shuttingDown) {
        try {
          await releaseClaim(next.id);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          log(`job=${next.id} claim release failed: ${message}`);
        }
        break;
      }
      await runJob(fresh);
      ranJob = true;
      break;
    }
    if (!ranJob && !shuttingDown) {
      await sleep(pollMs());
    }
  }
  try {
    await unlink(join(jobsDir(), "worker.pid"));
  } catch {
    // Best-effort cleanup: ignore removal errors.
  }
  log("shutting down");
}

main().catch((error) => {
  console.error("worker fatal:", error);
  process.exit(1);
});
