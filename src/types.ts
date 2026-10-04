export type ChatMessage = {
  role: string;
  content: unknown;
  name?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: unknown;
  [key: string]: unknown;
};

export type ModelCandidate = string;
