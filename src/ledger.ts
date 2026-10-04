import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { config } from './config.js';

export type LedgerEvent = {
  ts: string;
  requestId: string;
  model: string;
  status: number;
  latencyMs: number;
  usage?: unknown;
  promptHash?: string;
};

export function hashPrompt(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function appendLedger(event: LedgerEvent): Promise<void> {
  await mkdir(dirname(config.runtime.ledgerPath), { recursive: true });
  await appendFile(config.runtime.ledgerPath, JSON.stringify(event) + '\n', 'utf8');
}
