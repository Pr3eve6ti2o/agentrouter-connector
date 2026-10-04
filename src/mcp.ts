import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { config } from './config.js';
import { extractModelIds } from './catalog.js';
import { redactMessages } from './redact.js';
import { agentRouterClient, routedChat } from './router.js';
import { Semaphore } from './semaphore.js';
import type { ChatRequest } from './types.js';
import { appendLedger } from './ledger.js';
import { randomUUID } from 'node:crypto';

const batchLimiter = new Semaphore(config.runtime.maxConcurrency);

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function buildServer(): McpServer {
  const server = new McpServer({ name: 'agentrouter-connector', version: '2.0.0' });

  server.registerTool('agentrouter_health', {
    description: 'Check connector configuration and upstream reachability by calling the model catalog (no generation prompt is sent).',
    inputSchema: z.object({})
  }, async () => {
    try {
      const started = Date.now();
      const data = await agentRouterClient.models();
      return textResult({
        ok: true,
        upstream: config.upstream.baseUrl,
        latencyMs: Date.now() - started,
        modelCount: extractModelIds(data).length,
        defaultModel: config.runtime.defaultModel
      });
    } catch (error) {
      return textResult({
        ok: false,
        upstream: config.upstream.baseUrl,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.registerTool('agentrouter_list_models', {
    description: 'List model IDs visible through the configured AgentRouter OpenAI-compatible catalog.',
    inputSchema: z.object({})
  }, async () => {
    const data = await agentRouterClient.models();
    return textResult({ models: extractModelIds(data), raw: data });
  });

  server.registerTool('agentrouter_chat', {
    description: 'Run one chat completion through AgentRouter. Supports model fallback when explicitly enabled.',
    inputSchema: z.object({
      model: z.string().optional(),
      modelCandidates: z.array(z.string()).optional(),
      allowFallback: z.boolean().default(false),
      messages: z.array(z.object({ role: z.string(), content: z.unknown() })).min(1),
      max_tokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
      top_p: z.number().min(0).max(1).optional(),
      reasoning_effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
      stop: z.union([z.string(), z.array(z.string())]).optional(),
      tools: z.array(z.unknown()).optional(),
      tool_choice: z.unknown().optional(),
      response_format: z.unknown().optional()
    })
  }, async (input) => {
    const modelCandidates = [input.model ?? '', ...(input.modelCandidates ?? []), config.runtime.defaultModel];
    const messages = config.runtime.redactPrompts ? redactMessages(input.messages) : input.messages;
    const request = { ...input, model: modelCandidates[0], messages } as ChatRequest;
    const started = Date.now();
    const result = await routedChat(request, modelCandidates, input.allowFallback);
    await appendLedger({ ts: new Date().toISOString(), requestId: randomUUID(), model: result.modelUsed, status: 200, latencyMs: Date.now() - started, usage: (result.response as any)?.usage });
    return textResult({ modelUsed: result.modelUsed, attemptedModels: result.attemptedModels, response: result.response });
  });

  server.registerTool('agentrouter_batch_chat', {
    description: 'Run independent chat jobs concurrently with a connector-side concurrency limit. This increases throughput without bypassing AgentRouter quotas.',
    inputSchema: z.object({
      jobs: z.array(z.object({
        id: z.string().min(1),
        model: z.string().optional(),
        modelCandidates: z.array(z.string()).optional(),
        allowFallback: z.boolean().default(false),
        messages: z.array(z.object({ role: z.string(), content: z.unknown() })).min(1),
        max_tokens: z.number().int().positive().optional(),
        temperature: z.number().min(0).max(2).optional(),
        top_p: z.number().min(0).max(1).optional(),
        reasoning_effort: z.enum(['low', 'medium', 'high', 'max']).optional()
      })).min(1).max(config.runtime.maxBatchTasks)
    })
  }, async ({ jobs }) => {
    const results = await Promise.all(jobs.map(async (job) => {
      const release = await batchLimiter.acquire();
      try {
        const candidates = [job.model ?? '', ...(job.modelCandidates ?? []), config.runtime.defaultModel];
        const messages = config.runtime.redactPrompts ? redactMessages(job.messages) : job.messages;
        const request = { ...job, model: candidates[0], messages } as ChatRequest;
        try {
          const started = Date.now();
          const result = await routedChat(request, candidates, job.allowFallback);
          const usage = result.response && typeof result.response === 'object'
            ? (result.response as Record<string, unknown>).usage
            : undefined;
          await appendLedger({
            ts: new Date().toISOString(),
            requestId: randomUUID(),
            model: result.modelUsed,
            status: 200,
            latencyMs: Date.now() - started,
            usage
          });
          return { id: job.id, ok: true, modelUsed: result.modelUsed, response: result.response };
        } catch (error) {
          return { id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      } finally {
        release();
      }
    }));
    return textResult({ results, concurrency: config.runtime.maxConcurrency });
  });

  return server;
}

export const mcpHandler = createMcpHandler(buildServer, { responseMode: 'json' });
