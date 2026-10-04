export class UpstreamHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly headers: Headers
  ) {
    super(`AgentRouter upstream returned HTTP ${status}`);
    this.name = 'UpstreamHttpError';
  }
}

export function publicError(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof UpstreamHttpError) {
    let details: unknown = error.body;
    try { details = JSON.parse(error.body); } catch { /* text */ }
    return { status: error.status, body: { error: details } };
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  if (/timed out|aborted/i.test(message)) return { status: 504, body: { error: { message } } };
  return { status: 500, body: { error: { message } } };
}
