// Persistent job store for the independent job worker (Phase 4).
// A job is created by an MCP tool call that returns immediately; the
// worker (src/worker.ts, a separate process) is the only process that
// calls the gateway for that job. Nothing here calls the gateway, so
// submitting a job can never duplicate a generation.
//
// Job files live in the workspace (which survives VM replacement) under
// AGENTROUTER_JOBS_PATH, default <cwd>/jobs. Keys are NEVER stored:
// only host + keyIndex are recorded, and the worker resolves keyIndex
// to a key value from its own environment at call time.
//
// Atomicity: job JSON is always written via tmp + rename; the final
// output file is written via tmp + rename; partial SSE text is appended
// by the single worker process only, so a crash cannot interleave two
// generations into one file. On a re-run after an interruption, the old
// partial is archived (partial.<attempt>.txt) instead of appended to,
// so text from two different gateway generations is never mixed.

import {
  mkdir, readFile, readdir, rename, rm, writeFile, appendFile, open, unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export type JobStatus =
  | "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export type JobMessage = { role: "user" | "assistant"; content: string };

export type Job = {
  id: string;
  status: JobStatus;
  model: string;
  messages: JobMessage[];
  system?: string;
  max_tokens: number;
  effort?: "max";
  host: string;
  keyIndex: number;
  attempts: number;
  created_at: string;
  updated_at: string;
  started_at?: string;
  finished_at?: string;
  last_heartbeat?: string;
  response_id?: string;
  error?: string;
  error_kind?: string;
  partial_chars: number;
  output_chars: number;
};

export function jobsDir(): string {
  return process.env.AGENTROUTER_JOBS_PATH?.trim() || join(process.cwd(), "jobs");
}

function safeId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9-]+$/.test(id);
}

function jobFilePath(id: string, suffix: string): string {
  if (!safeId(id)) {
    throw new TypeError("Invalid job ID");
  }
  return join(jobsDir(), `${id}${suffix}`);
}

export function jobPath(id: string): string {
  return jobFilePath(id, ".json");
}
export function partialPath(id: string): string {
  return jobFilePath(id, ".partial.txt");
}
export function outputPath(id: string): string {
  return jobFilePath(id, ".output.txt");
}
export function resultPath(id: string): string {
  return jobFilePath(id, ".result.json");
}

export function claimPath(id: string): string {
  return jobFilePath(id, ".claim");
}

export function heartbeatPath(id: string): string {
  return jobFilePath(id, ".heartbeat");
}

export async function claimJob(id: string, owner: string): Promise<boolean> {
  void owner; // The on-disk claim records only this process's PID and time.
  const path = claimPath(id);

  async function tryCreate(): Promise<boolean> {
    const file = await open(path, "wx").catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        return null;
      }
      throw error;
    });
    if (file === null) return false;

    try {
      await file.writeFile(
        JSON.stringify({ pid: process.pid, claimed_at: new Date().toISOString() }),
        "utf8",
      );
    } finally {
      await file.close();
    }
    return true;
  }

  if (await tryCreate()) return true;

  let claimedAt = Number.NaN;
  try {
    const claim: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      typeof claim === "object" && claim !== null &&
      "claimed_at" in claim && typeof claim.claimed_at === "string"
    ) {
      claimedAt = Date.parse(claim.claimed_at);
    }
  } catch (error: unknown) {
    // Missing or unparseable claims are stale; other I/O errors propagate.
    if (
      !(error instanceof SyntaxError) &&
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }

  if (Number.isFinite(claimedAt) && Date.now() - claimedAt <= 120_000) {
    return false;
  }

  await releaseClaim(id);
  return tryCreate();
}

export async function releaseClaim(id: string): Promise<void> {
  try {
    await unlink(claimPath(id));
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export async function touchHeartbeat(id: string): Promise<void> {
  await writeAtomic(
    heartbeatPath(id),
    JSON.stringify({ at: new Date().toISOString() }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJobStatus(value: unknown): value is JobStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "interrupted"
  );
}

function isJobMessage(value: unknown): value is JobMessage {
  return (
    isRecord(value) &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string"
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isJob(value: unknown): value is Job {
  return (
    isRecord(value) &&
    safeId(value.id) &&
    isJobStatus(value.status) &&
    typeof value.model === "string" &&
    Array.isArray(value.messages) &&
    value.messages.every(isJobMessage) &&
    isOptionalString(value.system) &&
    typeof value.max_tokens === "number" &&
    (value.effort === undefined || value.effort === "max") &&
    typeof value.host === "string" &&
    typeof value.keyIndex === "number" &&
    typeof value.attempts === "number" &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string" &&
    isOptionalString(value.started_at) &&
    isOptionalString(value.finished_at) &&
    isOptionalString(value.last_heartbeat) &&
    isOptionalString(value.response_id) &&
    isOptionalString(value.error) &&
    isOptionalString(value.error_kind) &&
    typeof value.partial_chars === "number" &&
    typeof value.output_chars === "number"
  );
}

export async function ensureJobsDir(): Promise<void> {
  await mkdir(jobsDir(), { recursive: true });
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, path);
  } catch (error) {
    try {
      await rm(tmp, { force: true });
    } catch {
      // Cleanup is best-effort; preserve the original write/rename error.
    }
    throw error;
  }
}

function stringifyJson(value: unknown): string {
  // JSON.stringify can return undefined for a top-level non-JSON value.
  const content: unknown = JSON.stringify(value, null, 2);
  if (typeof content !== "string") {
    throw new TypeError("Value does not serialize to JSON");
  }
  return content;
}

export async function saveJob(job: Job): Promise<void> {
  await ensureJobsDir();
  job.updated_at = new Date().toISOString();
  await writeAtomic(jobPath(job.id), stringifyJson(job));
}

export async function readJob(id: string): Promise<Job | null> {
  if (!safeId(id)) return null;
  try {
    const value: unknown = JSON.parse(await readFile(jobPath(id), "utf8"));
    if (!isJob(value) || value.id !== id) return null;

    try {
      const heartbeat: unknown = JSON.parse(await readFile(heartbeatPath(id), "utf8"));
      if (
        typeof heartbeat === "object" && heartbeat !== null &&
        "at" in heartbeat && typeof heartbeat.at === "string"
      ) {
        const sidecarAt = Date.parse(heartbeat.at);
        const jobAt = typeof value.last_heartbeat === "string"
          ? Date.parse(value.last_heartbeat)
          : Number.NaN;

        if (
          Number.isFinite(sidecarAt) &&
          (!Number.isFinite(jobAt) || sidecarAt > jobAt)
        ) {
          value.last_heartbeat = heartbeat.at;
        }
      }
    } catch {
      // Sidecars are best-effort; retain the job-file heartbeat.
    }

    return value;
  } catch {
    return null;
  }
}

export async function listJobs(): Promise<Job[]> {
  await ensureJobsDir();
  const jobs: Job[] = [];
  for (const name of await readdir(jobsDir())) {
    if (!name.endsWith(".json") || name.includes(".tmp-")) continue;
    const id = name.slice(0, -".json".length);
    const job = await readJob(id);
    if (job) jobs.push(job);
  }
  jobs.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return jobs;
}

export async function createJob(input: {
  model: string;
  messages: JobMessage[];
  system?: string;
  max_tokens: number;
  effort?: "max";
  host: string;
  keyIndex: number;
}): Promise<Job> {
  const now = new Date().toISOString();
  const job: Job = {
    id: randomUUID(),
    status: "pending",
    model: input.model,
    messages: input.messages,
    system: input.system,
    max_tokens: input.max_tokens,
    effort: input.effort,
    host: input.host,
    keyIndex: input.keyIndex,
    attempts: 0,
    created_at: now,
    updated_at: now,
    partial_chars: 0,
    output_chars: 0,
  };
  await saveJob(job);
  return job;
}

export async function appendPartial(id: string, text: string): Promise<number> {
  await ensureJobsDir();
  await appendFile(partialPath(id), text, "utf8");
  const job = await readJob(id);
  if (job) {
    job.partial_chars += text.length;
    await saveJob(job);
    return job.partial_chars;
  }
  return text.length;
}

export async function archivePartial(id: string, attempt: number): Promise<void> {
  try {
    await rename(
      partialPath(id),
      jobFilePath(id, `.partial.${attempt}.txt`),
    );
  } catch (error) {
    if (!isRecord(error) || error.code !== "ENOENT") {
      throw error;
    }
    // No partial to archive.
  }
}

export async function saveOutput(id: string, text: string): Promise<void> {
  await ensureJobsDir();
  await writeAtomic(outputPath(id), text);
}

export async function saveResultJson(id: string, value: unknown): Promise<void> {
  await ensureJobsDir();
  await writeAtomic(resultPath(id), stringifyJson(value));
}

export async function readOutput(id: string): Promise<string | null> {
  try {
    return await readFile(outputPath(id), "utf8");
  } catch {
    return null;
  }
}

export async function readPartial(id: string): Promise<string | null> {
  try {
    return await readFile(partialPath(id), "utf8");
  } catch {
    return null;
  }
}

export async function removeJobFiles(id: string): Promise<void> {
  // Not used by the tools; kept for local cleanup only. Never deletes
  // a completed output without an explicit local decision.
  await rm(jobPath(id), { force: true });
}
