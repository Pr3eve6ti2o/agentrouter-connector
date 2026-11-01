// MCP tools for persistent jobs (Phase 4). These tools NEVER call the
// gateway: submit returns a job ID immediately, status/result/list
// read local job files, cancel sets a flag the worker honours, and
// resume re-queues an interrupted/failed job for an explicit new
// generation. That is the whole point: the Muse tool call finishes
// without waiting for generation, so no Muse deadline can cancel it.
//
// Existing agentrouter_chat is untouched: its rotation and timeout
// settings are unchanged. A job pins ONE host x key combination at
// submit time, because polling/calling through a different combination
// cannot retrieve a generation started on another one, and rotating
// mid-job would duplicate generations. Across jobs, the caller can
// rotate by passing different host/keyIndex values; the four
// combinations from upstream.combos() remain available.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { combos } from "../upstream.js";
import {
  createJob, readJob, listJobs, saveJob, readOutput, readPartial,
} from "../jobs.js";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

function resolveCombo(host?: string, keyIndex?: number) {
  const all = combos();
  if (all.length === 0) throw new Error("No host x key combos configured");
  if (host !== undefined && !all.some((c) => c.host === host)) {
    throw new Error(`Unknown host: ${host}`);
  }
  if (keyIndex !== undefined && !all.some((c) => c.keyIndex === keyIndex)) {
    throw new Error(`Unknown keyIndex: ${keyIndex}`);
  }
  const picked = all.find(
    (c) => (host === undefined || c.host === host) &&
      (keyIndex === undefined || c.keyIndex === keyIndex),
  ) ?? all[0]!;
  return picked;
}

function publicJob(job: NonNullable<Awaited<ReturnType<typeof readJob>>>) {
  // Messages are the job's own input, stored locally so the worker can
  // resume after a reboot. They are returned here because the caller
  // supplied them; no key material is ever in a job record.
  return {
    id: job.id, status: job.status, model: job.model,
    host: job.host, keyIndex: job.keyIndex, attempts: job.attempts,
    created_at: job.created_at, started_at: job.started_at,
    finished_at: job.finished_at, last_heartbeat: job.last_heartbeat,
    response_id: job.response_id, error: job.error, error_kind: job.error_kind,
    partial_chars: job.partial_chars, output_chars: job.output_chars,
  };
}

function asTool(work: (args: any) => Promise<unknown>) {
  return async (args: any) => {
    try {
      const data = await work(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: "text" as const,
          text: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  };
}

export function registerJobs(server: McpServer): void {
  server.registerTool("agentrouter_submit_job", {
    description: "Submit a Responses-model generation as a persistent job and return its job ID immediately; the independent worker generates it. Does NOT call the gateway, so it cannot duplicate a generation. Worker supports Responses models only (not Claude).",
    inputSchema: {
      model: z.string().min(1),
      messages: z.array(messageSchema).min(1),
      system: z.string().optional(),
      max_tokens: z.number().int().positive().optional(),
      effort: z.enum(["max"]).optional(),
      host: z.string().optional(),
      keyIndex: z.number().int().nonnegative().optional(),
    },
  }, asTool(async ({ model, messages, system, max_tokens, effort, host, keyIndex }) => {
    if (/claude/i.test(model)) {
      throw new Error("Job worker supports Responses models only; Claude models use agentrouter_chat, not jobs.");
    }
    const astra = /^gpt-6-astra$/i.test(model);
    if (astra && effort === undefined) effort = "max";
    const tokens = max_tokens === undefined
      ? (astra ? 16000 : 4096)
      : (astra ? Math.min(max_tokens, 16000) : max_tokens);
    const combo = resolveCombo(host, keyIndex);
    const job = await createJob({
      model, messages, system, max_tokens: tokens, effort,
      host: combo.host, keyIndex: combo.keyIndex,
    });
    return {
      job_id: job.id, status: job.status, model: job.model,
      host: job.host, keyIndex: job.keyIndex, max_tokens: job.max_tokens,
      note: "Job is pending. The worker (node dist/src/worker.js) must be running; poll agentrouter_job_status, then agentrouter_job_result when completed.",
    };
  }));

  server.registerTool("agentrouter_job_status", {
    description: "Read a job's status, host/keyIndex, attempts, partial/output sizes and error, without calling the gateway.",
    inputSchema: { job_id: z.string().min(1) },
  }, asTool(async ({ job_id }) => {
    const job = await readJob(job_id);
    if (!job) throw new Error(`Unknown job: ${job_id}`);
    return publicJob(job);
  }));

  server.registerTool("agentrouter_job_result", {
    description: "Return a completed job's full output text. For an interrupted job, returns the saved partial text with status interrupted (never mixed with a later generation).",
    inputSchema: { job_id: z.string().min(1) },
  }, asTool(async ({ job_id }) => {
    const job = await readJob(job_id);
    if (!job) throw new Error(`Unknown job: ${job_id}`);
    if (job.status === "completed") {
      const output = await readOutput(job_id);
      if (output === null) throw new Error("Job is completed but its output file is missing");
      return { job_id, status: job.status, output, output_chars: output.length };
    }
    const partial = await readPartial(job_id);
    return {
      job_id, status: job.status, error: job.error,
      partial: partial ?? "", partial_chars: partial?.length ?? 0,
      note: "Not completed: this is saved partial text only, from before the interruption.",
    };
  }));

  server.registerTool("agentrouter_list_jobs", {
    description: "List persistent jobs, oldest first, without calling the gateway.",
    inputSchema: {},
  }, asTool(async () => {
    const jobs = await listJobs();
    return jobs.map(publicJob);
  }));

  server.registerTool("agentrouter_cancel_job", {
    description: "Cancel a pending or running job. A running worker aborts its gateway call within seconds and keeps the saved partial; a completed job cannot be cancelled.",
    inputSchema: { job_id: z.string().min(1) },
  }, asTool(async ({ job_id }) => {
    const job = await readJob(job_id);
    if (!job) throw new Error(`Unknown job: ${job_id}`);
    if (job.status === "completed") throw new Error("Job is already completed and cannot be cancelled");
    if (job.status === "cancelled") return publicJob(job);
    job.status = "cancelled";
    job.finished_at = new Date().toISOString();
    await saveJob(job);
    return publicJob(job);
  }));

  server.registerTool("agentrouter_resume_job", {
    description: "Re-queue an interrupted or failed job for an explicit new generation. Completed and cancelled jobs cannot be resumed; this is the only way an interrupted job regenerates, so it never happens silently.",
    inputSchema: { job_id: z.string().min(1) },
  }, asTool(async ({ job_id }) => {
    const job = await readJob(job_id);
    if (!job) throw new Error(`Unknown job: ${job_id}`);
    if (job.status !== "interrupted" && job.status !== "failed") {
      throw new Error(`Only interrupted/failed jobs can be resumed; this job is ${job.status}`);
    }
    job.status = "pending";
    job.error = undefined;
    job.error_kind = undefined;
    job.finished_at = undefined;
    await saveJob(job);
    return publicJob(job);
  }));
}
