export function retryAfterMsFromHeaders(headers: Headers | undefined): number | undefined {
  const raw = headers?.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isFallbackWorthyStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  options: {
    retries: number;
    baseDelayMs: number;
    shouldRetry: (error: unknown) => boolean;
    retryDelayMs?: (error: unknown, attempt: number) => number | undefined;
  }
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= options.retries || !options.shouldRetry(error)) throw error;
      const custom = options.retryDelayMs?.(error, attempt);
      const jitter = Math.floor(Math.random() * Math.max(1, options.baseDelayMs));
      const delay = custom ?? options.baseDelayMs * (2 ** attempt) + jitter;
      await sleep(delay);
      attempt++;
    }
  }
}
