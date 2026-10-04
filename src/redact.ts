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
    return copy;
  }) as unknown as T;
  return out;
}
