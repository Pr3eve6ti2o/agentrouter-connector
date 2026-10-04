import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { publicError } from './errors.js';
import { appendLedger, hashPrompt } from './ledger.js';
import { Semaphore } from './semaphore.js';
import { redactMessages } from './redact.js';
import { routedChat, agentRouterClient } from './router.js';
import type { ChatRequest } from './types.js';
import { isRetryableStatus } from './retry.js';

const limiter = new Semaphore(config.runtime.maxConcurrency);

function auth(expected: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const bearer = req.get('authorization');
    const x = req.get('x-connector-key');
    const supplied = bearer?.replace(/^Bearer\s+/i, '') ?? x;
    if (!expected || supplied !== expected) return res.status(401).json({ error: { message: 'Unauthorized' } });
    next();
  };
}

function requestId(req: Request): string {
  return req.get('x-request-id') || randomUUID();
}

export function createHttpApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: config.server.maxBodyBytes }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'agentrouter-connector', upstream: config.upstream.baseUrl });
  });

  app.get('/v1/models', auth(config.server.connectorKey), async (req, res) => {
    const release = await limiter.acquire();
    const started = Date.now();
    const id = requestId(req);
    try {
      const data = await agentRouterClient.models();
      res.json(data);
    } catch (error) {
      const { status, body } = publicError(error);
      res.status(status).json(body);
    } finally {
      release();
      await appendLedger({ ts: new Date().toISOString(), requestId: id, model: '__catalog__', status: res.statusCode, latencyMs: Date.now() - started });
    }
  });

  app.post('/v1/chat/completions', auth(config.server.connectorKey), async (req, res) => {
    const started = Date.now();
    const id = requestId(req);
    const release = await limiter.acquire();
    const body = req.body as ChatRequest & { modelCandidates?: string[]; allowFallback?: boolean };

    try {
      if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
        res.status(400).json({ error: { message: 'messages must be an array' } });
        return;
      }
      const stream = Boolean(body.stream);
      if (stream) {
        const cleanMessages = config.runtime.redactPrompts ? redactMessages(body.messages) : body.messages;
        const { modelCandidates: _modelCandidates, allowFallback: _allowFallback, ...streamRequest } = body;
        const upstream = await agentRouterClient.chatStream({ ...streamRequest, messages: cleanMessages });
        res.status(upstream.status);
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
        res.setHeader('Cache-Control', upstream.headers.get('cache-control') || 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        if (upstream.body) Readable.fromWeb(upstream.body as any).pipe(res);
        else res.end();
        return;
      }

      const cleanMessages = config.runtime.redactPrompts ? redactMessages(body.messages) : body.messages;
      const candidates = [
        body.model,
        ...(Array.isArray(body.modelCandidates) ? body.modelCandidates : []),
        config.runtime.defaultModel
      ];
      const result = await routedChat({ ...body, messages: cleanMessages }, candidates, Boolean(body.allowFallback));
      res.json(result.response);

      const usage = result.response && typeof result.response === 'object'
        ? (result.response as Record<string, unknown>).usage
        : undefined;
      await appendLedger({
        ts: new Date().toISOString(), requestId: id, model: result.modelUsed, status: 200,
        latencyMs: Date.now() - started, usage,
        ...(config.runtime.logPrompts ? { promptHash: hashPrompt(cleanMessages) } : {})
      });
    } catch (error) {
      const { status, body: errBody } = publicError(error);
      if (status >= 400 && isRetryableStatus(status)) res.setHeader('Retry-After', '2');
      res.status(status).json(errBody);
      await appendLedger({ ts: new Date().toISOString(), requestId: id, model: typeof body?.model === 'string' ? body.model : '__unknown__', status, latencyMs: Date.now() - started });
    } finally {
      release();
    }
  });

  return app;
}
