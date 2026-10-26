import type { AiGateway, CompletionChunk, CompletionInput } from './ai-gateway.js';

/**
 * Self-instrumentation: one GenAI `chat` span per completion, recorded around any gateway.
 *
 * A decorator rather than a change to the adapters, so Kilo, Ollama and every adapter after
 * them are measured by the same code, and an adapter's tests do not grow a telemetry concern.
 *
 * What a span carries is what the port exposes: the requested model (the stream carries no
 * response model, so `responseModel` is `null` rather than a guess), the `usage` chunk's
 * tokens when the provider sent one (`null` when it did not — never zero), the `done`
 * chunk's finish reason, the wall-clock duration, and whether it failed. **No content**: not
 * the messages, not the answer.
 *
 * A failure is recorded and still thrown, so the caller's error handling is unchanged. A
 * stream the reader abandoned before `done` is recorded as `error` / `incomplete`. A recorder
 * that throws or rejects is ignored: telemetry must never change the completion.
 */
export interface CompletionSpan {
  traceId: string;
  spanId: string;
  operation: 'chat';
  provider: string;
  requestModel: string;
  responseModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReasons: string[];
  /** ISO 8601. */
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'error';
  errorType: string | null;
}

export interface SpanRecorder {
  record(span: CompletionSpan): void | Promise<void>;
}

export interface InstrumentOptions {
  /** `gen_ai.provider.name` for every span: the gateway the composition root chose. */
  provider: string;
  /** Milliseconds since the epoch. */
  now?: () => number;
  ids?: () => { traceId: string; spanId: string };
}

function hex(bytes: number): string {
  const values = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

const randomIds = () => ({ traceId: hex(16), spanId: hex(8) });

/** What the stream said about itself, accumulated as it passes. */
interface Observed {
  inputTokens: number | null;
  outputTokens: number | null;
  finishReasons: string[];
}

function observe(observed: Observed, chunk: CompletionChunk): void {
  if (chunk.type === 'usage') {
    observed.inputTokens = chunk.usage.inputTokens ?? observed.inputTokens;
    observed.outputTokens = chunk.usage.outputTokens ?? observed.outputTokens;
  } else if (chunk.type === 'done') {
    observed.finishReasons.push(chunk.finishReason);
  }
}

function safeRecord(recorder: SpanRecorder, span: CompletionSpan): void {
  try {
    const pending = recorder.record(span);
    if (pending instanceof Promise) pending.catch(() => undefined);
  } catch {
    // Telemetry never changes the completion.
  }
}

export function instrumentedGateway(
  gateway: AiGateway,
  recorder: SpanRecorder,
  options: InstrumentOptions,
): AiGateway {
  const now = options.now ?? Date.now;
  const ids = options.ids ?? randomIds;
  return {
    listModels: (signal) => gateway.listModels(signal),
    streamCompletion: (input: CompletionInput) => ({
      async *[Symbol.asyncIterator]() {
        const started = now();
        const observed: Observed = { inputTokens: null, outputTokens: null, finishReasons: [] };
        let errorType: string | null = null;
        try {
          for await (const chunk of gateway.streamCompletion(input)) {
            observe(observed, chunk);
            yield chunk;
          }
        } catch (error) {
          errorType = error instanceof Error ? error.name : 'Error';
          throw error;
        } finally {
          const complete = errorType === null && observed.finishReasons.length > 0;
          safeRecord(recorder, {
            ...ids(),
            operation: 'chat',
            provider: options.provider,
            requestModel: input.model,
            responseModel: null,
            ...observed,
            startedAt: new Date(started).toISOString(),
            durationMs: Math.max(0, now() - started),
            status: complete ? 'ok' : 'error',
            errorType: complete ? null : (errorType ?? 'incomplete'),
          });
        }
      },
    }),
  };
}
