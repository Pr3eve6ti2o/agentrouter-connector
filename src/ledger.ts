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
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) {
    throw new TypeError('Prompt payload must be JSON-serializable.');
  }
  return createHash('sha256').update(serialized).digest('hex');
}

export async function appendLedger(event: LedgerEvent): Promise<void> {
  try {
    await mkdir(dirname(config.runtime.ledgerPath), { recursive: true });
    await appendFile(config.runtime.ledgerPath, JSON.stringify(event) + '\n', 'utf8');
  } catch (error) {
    // Ledger writes are best-effort; the response may already have been sent.
    console.error('Failed to append ledger event:', error);
  }
}
