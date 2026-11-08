export type SseEvent =
  | { kind: "data"; eventName: string; data: unknown }
  | { kind: "malformed"; eventName: string };

// Preserve the existing LF-only block framing and field trimming.
export async function* readSseEvents(response: Response): AsyncGenerator<SseEvent, void, unknown> {
  const body = response.body;
  if (!body) throw new Error("SSE: empty stream");
  const reader = body.getReader();

  try {
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;

    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }
      if (streamDone) buffer += decoder.decode();

      let sep = buffer.indexOf("\n\n");
      while (sep >= 0 || (streamDone && buffer.length > 0)) {
        const block = sep >= 0 ? buffer.slice(0, sep) : buffer;
        buffer = sep >= 0 ? buffer.slice(sep + 2) : "";
        let eventName = "";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        const dataText = dataLines.join("\n");
        if (dataText && dataText !== "[DONE]") {
          let parsedEvent: SseEvent;
          try {
            parsedEvent = { kind: "data", eventName, data: JSON.parse(dataText) };
          } catch {
            parsedEvent = { kind: "malformed", eventName };
          }

          // Keep yield outside the parse catch so iterator.throw() is not swallowed.
          yield parsedEvent;
        }
        sep = buffer.indexOf("\n\n");
      }
      if (streamDone) done = true;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Cancellation is best effort and must not mask the result or original error.
    }
  }
}
