/**
 * Split a response body into lines, once, for every gateway.
 *
 * Both adapters needed this and both got it wrong the same way, which is the
 * definition of a helper that should have existed:
 *
 *  - **The unterminated tail was dropped.** `buffer.split(/\r?\n/)` followed by
 *    `lines.pop()` keeps the partial last line for the next read — correct while
 *    the stream is still going. But a stream that *ends* without a trailing
 *    newline was popped into `buffer` and then `break`ed on, so its final line was
 *    never parsed. A provider that closes the connection right after its last frame
 *    loses its last token, every time, silently (ledger G-1).
 *  - **The reader was never released.** `getReader()` was called and then nothing
 *    cancelled it or released its lock on any exit path, so a stream abandoned at
 *    `[DONE]` — the ordinary way a caller ends a completion — left the connection
 *    open (ledger G-2). The `finally` here is what closes it, and it runs on early
 *    exit too, because a `for await` over a generator calls `return()` on the
 *    generator when the loop is left.
 *
 * The two gateways parse different formats on top of these lines — Kilo reads SSE
 * `data:` frames, Ollama reads NDJSON — so the format-specific part stays in each
 * adapter and only the framing lives here.
 *
 * @param body the response body to read
 * @returns an async iterable of lines, with the final unterminated line included
 */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) yield line;
      if (done) {
        // The stream ended with `buffer` still holding an unterminated line. It is
        // the last event the provider sent, so it is yielded here and nowhere else.
        if (buffer.length > 0) yield buffer;
        break;
      }
    }
  } finally {
    // `cancel` rejects if the body is already closed or errored, and that rejection
    // must not replace whatever the consumer was doing — including a throw it is
    // already propagating.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/**
 * A JSON object, or `undefined` for a line that is not one.
 *
 * Used instead of a throwing parse for stream lines. A keep-alive comment, a `data:`
 * field that is not JSON, or a frame split across a chunk boundary used to abort a
 * stream that had already delivered events, discarding the rest of a completion
 * (ledger G-7). A line that is not a chunk is not a chunk — but it is also not a
 * reason to throw away everything after it.
 *
 * @param line one line of a stream body
 * @returns the parsed object, or `undefined` when the line is not JSON
 */
export function parseJsonLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (trimmed === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Combine a caller's cancellation with a request deadline.
 *
 * A gateway request was bounded only by whatever signal the caller happened to pass,
 * so a provider that accepted the connection and then stopped responding held the
 * request open indefinitely — the state with no escape (ledger G-8). The caller's
 * signal is preserved rather than replaced: a caller that cancels still cancels.
 *
 * @param signal the caller's signal, if any
 * @param timeoutMs the deadline for the request
 * @returns a signal that aborts on either input
 */
export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}
