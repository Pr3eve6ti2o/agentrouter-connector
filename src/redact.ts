const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\baak_[A-Za-z0-9_-]{8,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:xoxb|xoxp|xoxa|xapp)-[A-Za-z0-9-]{20,}\b/g,
  /\b(?:Bearer|Basic)\s+\S+/gi
];

export function redactText(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[REDACTED_SECRET]');
  return out;
}

function redactToolArguments(input: string): string {
  try {
    JSON.parse(input);
  } catch {
    return redactText(input);
  }

  // Preserve JSON delimiters and non-string values when redacting arguments.
  return input.replace(/"(?:\\.|[^"\\])*"/g, (literal) => {
    const value: unknown = JSON.parse(literal);
    if (typeof value !== 'string') return literal;
    const redacted = redactText(value);
    return redacted === value ? literal : JSON.stringify(redacted);
  });
}

export function redactMessages<T>(messages: T): T {
  if (!Array.isArray(messages)) return messages;
  const arr: unknown[] = messages;
  const out = arr.map((m) => {
    if (!m || typeof m !== 'object') return m;
    const copy = { ...(m as Record<string, unknown>) };
    if (typeof copy.content === 'string') copy.content = redactText(copy.content);
    if (Array.isArray(copy.content)) {
      copy.content = copy.content.map((part) => {
        if (!part || typeof part !== 'object') return part;
        const p = { ...(part as Record<string, unknown>) };
        if (typeof p.text === 'string') p.text = redactText(p.text);
        return p;
      });
    }
    if (Array.isArray(copy.tool_calls)) {
      copy.tool_calls = copy.tool_calls.map((toolCall: unknown) => {
        if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) return toolCall;
        const call = toolCall as Record<string, unknown>;
        const fn = call.function;
        if (!fn || typeof fn !== 'object' || Array.isArray(fn)) return toolCall;
        const functionCall = fn as Record<string, unknown>;
        if (typeof functionCall.arguments !== 'string') return toolCall;
        return {
          ...call,
          function: { ...functionCall, arguments: redactToolArguments(functionCall.arguments) }
        };
      });
    }
    return copy;
  }) as unknown as T;
  return out;
}
