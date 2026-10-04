import { AgentRouterClient } from './agentrouter.js';
import type { ChatRequest } from './types.js';

const client = new AgentRouterClient();

export type RoutedChatResult = {
  response: unknown;
  modelUsed: string;
  attemptedModels: string[];
};

export async function routedChat(
  request: ChatRequest,
  candidates: string[],
  allowFallback: boolean
): Promise<RoutedChatResult> {
  const unique = [...new Set(candidates.filter(Boolean))];
  if (!unique.length) throw new Error('At least one model is required.');

  const attempted: string[] = [];
  let last: unknown;
  const { modelCandidates: _modelCandidates, allowFallback: _allowFallback, ...upstreamRequest } = request as ChatRequest & Record<string, unknown>;

  for (const model of unique) {
    attempted.push(model);
    try {
      const response = await client.chat({ ...upstreamRequest, model } as ChatRequest);
      return { response, modelUsed: model, attemptedModels: attempted };
    } catch (error) {
      last = error;
      if (!allowFallback || !AgentRouterClient.isFallbackWorthy(error)) throw error;
    }
  }
  throw last ?? new Error('All model candidates failed.');
}

export { client as agentRouterClient };
