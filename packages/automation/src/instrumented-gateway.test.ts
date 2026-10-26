import { describe, expect, it } from 'vitest';
import type { AiGateway, CompletionChunk, CompletionInput } from './ai-gateway.js';
import { instrumentedGateway, type CompletionSpan } from './instrumented-gateway.js';

const INPUT: CompletionInput = { model: 'model-a', messages: [{ role: 'user', content: 'hi' }] };

function gatewayOf(chunks: readonly CompletionChunk[], failAfter?: Error): AiGateway {
  return {
    listModels: async () => [{ id: 'model-a', gateway: 'stub' }],
    streamCompletion: () => ({
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
        if (failAfter !== undefined) throw failAfter;
      },
    }),
  };
}

async function drain(iterable: AsyncIterable<CompletionChunk>): Promise<CompletionChunk[]> {
  const out: CompletionChunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

/** A clock that advances 250 ms per reading, and fixed ids, so a span is one exact value. */
function harness(chunks: readonly CompletionChunk[], failAfter?: Error) {
  const spans: CompletionSpan[] = [];
  let tick = Date.parse('2026-10-26T00:00:00.000Z');
  const gateway = instrumentedGateway(
    gatewayOf(chunks, failAfter),
    { record: (span) => void spans.push(span) },
    {
      provider: 'ollama',
      now: () => {
        const at = tick;
        tick += 250;
        return at;
      },
      ids: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }),
    },
  );
  return { gateway, spans };
}

describe('instrumentedGateway', () => {
  it('passes every chunk through unchanged and records one chat span with the usage', async () => {
    const chunks: CompletionChunk[] = [
      { type: 'text', text: 'hello' },
      { type: 'usage', usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 } },
      { type: 'done', finishReason: 'stop' },
    ];
    const { gateway, spans } = harness(chunks);
    expect(await drain(gateway.streamCompletion(INPUT))).toEqual(chunks);
    expect(spans).toEqual([
      {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        operation: 'chat',
        provider: 'ollama',
        requestModel: 'model-a',
        responseModel: null,
        inputTokens: 12,
        outputTokens: 3,
        finishReasons: ['stop'],
        startedAt: '2026-10-26T00:00:00.000Z',
        durationMs: 250,
        status: 'ok',
        errorType: null,
      },
    ]);
  });

  it('records tokens as unknown when the provider sent no usage', async () => {
    const { gateway, spans } = harness([{ type: 'done', finishReason: 'stop' }]);
    await drain(gateway.streamCompletion(INPUT));
    expect(spans[0]).toMatchObject({ inputTokens: null, outputTokens: null, status: 'ok' });
  });

  it('records a provider failure and still throws it', async () => {
    const failure = new TypeError('provider unreachable');
    const { gateway, spans } = harness([{ type: 'text', text: 'par' }], failure);
    await expect(drain(gateway.streamCompletion(INPUT))).rejects.toBe(failure);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ status: 'error', errorType: 'TypeError', finishReasons: [] });
  });

  it('records a stream the reader abandoned as incomplete, exactly once', async () => {
    const { gateway, spans } = harness([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
      { type: 'done', finishReason: 'stop' },
    ]);
    for await (const chunk of gateway.streamCompletion(INPUT)) {
      expect(chunk.type).toBe('text');
      break;
    }
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ status: 'error', errorType: 'incomplete' });
  });

  it('never lets a failing recorder change the completion', async () => {
    const chunks: CompletionChunk[] = [{ type: 'done', finishReason: 'stop' }];
    const gateway = instrumentedGateway(
      gatewayOf(chunks),
      {
        record: () => {
          throw new Error('database down');
        },
      },
      { provider: 'kilo' },
    );
    expect(await drain(gateway.streamCompletion(INPUT))).toEqual(chunks);
    const rejecting = instrumentedGateway(
      gatewayOf(chunks),
      { record: () => Promise.reject(new Error('database down')) },
      { provider: 'kilo' },
    );
    expect(await drain(rejecting.streamCompletion(INPUT))).toEqual(chunks);
  });

  it('keeps a token count a later usage chunk leaves out, and names a non-Error failure', async () => {
    const { gateway, spans } = harness([
      { type: 'usage', usage: { inputTokens: 12 } },
      { type: 'usage', usage: { outputTokens: 4 } },
      { type: 'done', finishReason: 'length' },
    ]);
    await drain(gateway.streamCompletion(INPUT));
    expect(spans[0]).toMatchObject({ inputTokens: 12, outputTokens: 4, finishReasons: ['length'] });

    const failing: AiGateway = {
      listModels: async () => [],
      streamCompletion: () => ({
        // eslint-disable-next-line require-yield -- a stream that fails before its first chunk
        async *[Symbol.asyncIterator]() {
          throw 'a string, not an Error';
        },
      }),
    };
    const recorded: CompletionSpan[] = [];
    const wrapped = instrumentedGateway(
      failing,
      { record: (span) => void recorded.push(span) },
      {
        provider: 'kilo',
      },
    );
    await expect(drain(wrapped.streamCompletion(INPUT))).rejects.toBe('a string, not an Error');
    expect(recorded[0]).toMatchObject({ status: 'error', errorType: 'Error' });
  });

  it('records no content: neither the prompt nor the answer is in the span', async () => {
    const { gateway, spans } = harness([
      { type: 'text', text: 'the secret answer' },
      { type: 'done', finishReason: 'stop' },
    ]);
    await drain(
      gateway.streamCompletion({
        model: 'model-a',
        messages: [{ role: 'user', content: 'the private prompt' }],
      }),
    );
    const serialised = JSON.stringify(spans);
    expect(serialised).not.toContain('the secret answer');
    expect(serialised).not.toContain('the private prompt');
  });

  it('generates W3C-shaped ids by default and passes listModels through', async () => {
    const spans: CompletionSpan[] = [];
    const gateway = instrumentedGateway(
      gatewayOf([{ type: 'done', finishReason: 'stop' }]),
      { record: (span) => void spans.push(span) },
      { provider: 'kilo' },
    );
    expect(await gateway.listModels()).toEqual([{ id: 'model-a', gateway: 'stub' }]);
    await drain(gateway.streamCompletion(INPUT));
    expect(spans[0]?.traceId).toMatch(/^[0-9a-f]{32}$/u);
    expect(spans[0]?.spanId).toMatch(/^[0-9a-f]{16}$/u);
  });
});
