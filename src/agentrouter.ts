import { config } from './config.js';
import { UpstreamHttpError } from './errors.js';
import { isFallbackWorthyStatus, isRetryableStatus, retryAfterMsFromHeaders, withRetries } from './retry.js';
import type { ChatRequest } from './types.js';

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export class AgentRouterClient {
  private readonly baseUrl = config.upstream.baseUrl.replace(/\/+$/, '');

  private headers(extra?: HeadersInit): Headers {
    const h = new Headers({
      Authorization: `Bearer ${config.upstream.key}`,
      Accept: 'application/json'
    });
    if (config.upstream.compatHeaders) {
      h.set('Originator', config.upstream.originator);
      h.set('Version', config.upstream.version);
      h.set('User-Agent', config.upstream.userAgent);
    }
    new Headers(extra ?? {}).forEach((v, k) => h.set(k, v));
    return h;
  }

  async models(): Promise<unknown> {
    return this.jsonRequest('/models', { method: 'GET' });
  }

  async chat(request: ChatRequest): Promise<unknown> {
    return this.jsonRequest('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async chatStream(request: ChatRequest): Promise<Response> {
    return this.rawRequest('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ ...request, stream: true }),
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      retryable: false
    });
  }

  private async jsonRequest(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.rawRequest(path, { ...init, retryable: true });
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  private async rawRequest(path: string, init: RequestInit & { retryable?: boolean }): Promise<Response> {
    const url = joinUrl(this.baseUrl, path);
    const doFetch = async (): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.runtime.requestTimeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          headers: this.headers(init.headers),
          signal: controller.signal
        });
        if (!response.ok) {
          const text = await response.text();
          throw new UpstreamHttpError(response.status, text.slice(0, 8000), response.headers);
        }
        return response;
      } finally {
        clearTimeout(timer);
      }
    };

    return withRetries(doFetch, {
      retries: init.retryable ? config.runtime.maxRetries : 0,
      baseDelayMs: config.runtime.backoffBaseMs,
      shouldRetry: (error) => error instanceof UpstreamHttpError && isRetryableStatus(error.status),
      retryDelayMs: (error) => error instanceof UpstreamHttpError ? retryAfterMsFromHeaders(error.headers) : undefined
    });
  }

  static isFallbackWorthy(error: unknown): boolean {
    return error instanceof UpstreamHttpError && isFallbackWorthyStatus(error.status);
  }
}
