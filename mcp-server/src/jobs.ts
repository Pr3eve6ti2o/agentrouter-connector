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
  mkdir, readFile, readdir, rename, rm, writeFile, appendFile,
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

export function jobPath(id: string): string {
  return join(jobsDir(), `${id}.json`);
}
export function partialPath(id: string): string {
  return join(jobsDir(), `${id}.partial.txt`);
}
export function outputPath(id: string): string {
  return join(jobsDir(), `${id}.output.txt`);
}
export function resultPath(id: string): string {
  return join(jobsDir(), `${id}.result.json`);
}

function safeId(id: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(id);
}

export async function ensureJobsDir(): Promise<void> {
  await mkdir(jobsDir(), { recursive: true });
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

export async function saveJob(job: Job): Promise<void> {
  await ensureJobsDir();
  job.updated_at = new Date().toISOString();
  await writeAtomic(jobPath(job.id), JSON.stringify(job, null, 2));
}

export async function readJob(id: string): Promise<Job | null> {
  if (!safeId(id)) return null;
  try {
    return JSON.parse(await readFile(jobPath(id), "utf8")) as Job;
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
    await rename(partialPath(id), join(jobsDir(), `${id}.partial.${attempt}.txt`));
  } catch {
    // No partial to archive.
  }
}

export async function saveOutput(id: string, text: string): Promise<void> {
  await ensureJobsDir();
  await writeAtomic(outputPath(id), text);
}

export async function saveResultJson(id: string, value: unknown): Promise<void> {
  await ensureJobsDir();
  await writeAtomic(resultPath(id), JSON.stringify(value, null, 2));
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
