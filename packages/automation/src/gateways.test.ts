import { describe, expect, it, vi } from 'vitest';
import { KiloGateway } from './kilo-gateway.js';
import { OllamaGateway } from './ollama-gateway.js';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

describe('AI gateways', () => {
  it('loads the Kilo model catalog dynamically and parses stream chunks', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'model-a', owned_by: 'kilo' }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
            'data: [DONE]\n',
          ].join(''),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const gateway = new KiloGateway({ baseUrl: 'https://kilo.test', apiKey: 'secret', fetcher });
    expect(await gateway.listModels()).toEqual([
      { id: 'model-a', gateway: 'kilo', ownedBy: 'kilo' },
    ]);
    expect(
      await collect(
        gateway.streamCompletion({ model: 'model-a', messages: [{ role: 'user', content: 'hi' }] }),
      ),
    ).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('loads Ollama tags and maps NDJSON output', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ name: 'llama3' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          '{"message":{"content":"hello"},"done":false}\n{"done":true,"done_reason":"stop"}\n',
          { status: 200 },
        ),
      );
    const gateway = new OllamaGateway({ baseUrl: 'http://ollama.test', fetcher });
    expect(await gateway.listModels()).toEqual([{ id: 'llama3', gateway: 'ollama' }]);
    expect(
      await collect(
        gateway.streamCompletion({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }),
      ),
    ).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('handles tool calls, usage, and malformed Kilo frames', async () => {
    const gateway = new KiloGateway({
      baseUrl: 'https://kilo.test',
      apiKey: 'secret',
      fetcher: vi
        .fn()
        .mockResolvedValue(
          new Response(
            [
              ': ping\n',
              'data: {"usage":{"input_tokens":2,"output_tokens":3}}\n',
              'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1"}]},"finish_reason":"tool_calls"}]}\n',
              'data: invalid\n',
            ].join(''),
            { status: 200 },
          ),
        ),
    });
    await expect(
      collect(gateway.streamCompletion({ model: 'model-a', messages: [] })),
    ).rejects.toThrow('Invalid SSE JSON');
    const noBody = new KiloGateway({
      baseUrl: 'https://kilo.test',
      apiKey: 'secret',
      fetcher: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    });
    await expect(
      collect(noBody.streamCompletion({ model: 'model-a', messages: [] })),
    ).rejects.toThrow('Kilo completion failed: 200');
  });

  it('handles terminal frames and Ollama tool usage', async () => {
    const kilo = new KiloGateway({
      baseUrl: 'https://kilo.test',
      apiKey: 'secret',
      fetcher: vi.fn().mockResolvedValue(new Response('data: [DONE]\n', { status: 200 })),
    });
    await expect(
      collect(kilo.streamCompletion({ model: 'model-a', messages: [] })),
    ).resolves.toEqual([]);
    const ollama = new OllamaGateway({
      baseUrl: 'http://ollama.test',
      fetcher: vi
        .fn()
        .mockResolvedValue(
          new Response(
            '{"message":{"content":"","tool_calls":[{"id":"call-1"}]},"prompt_eval_count":2,"eval_count":3,"done":true}\n',
            { status: 200 },
          ),
        ),
    });
    await expect(
      collect(ollama.streamCompletion({ model: 'llama3', messages: [] })),
    ).resolves.toEqual([
      { type: 'tool-call', call: [{ id: 'call-1' }] },
      { type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('surfaces non-retryable catalog errors', async () => {
    const gateway = new KiloGateway({
      baseUrl: 'https://kilo.test',
      apiKey: 'secret',
      fetcher: vi.fn().mockResolvedValue(new Response('{}', { status: 400 })),
      sleep: async () => undefined,
    });
    await expect(gateway.listModels()).rejects.toThrow('400');
  });

  it('surfaces gateway errors and retries catalog requests', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const gateway = new KiloGateway({
      baseUrl: 'https://kilo.test',
      apiKey: 'secret',
      fetcher,
      sleep: async () => undefined,
    });
    await expect(gateway.listModels()).resolves.toEqual([]);
    await expect(
      collect(gateway.streamCompletion({ model: 'model-a', messages: [] })),
    ).rejects.toThrow('500');
    const ollama = new OllamaGateway({
      baseUrl: 'http://ollama.test',
      fetcher: vi.fn().mockResolvedValue(new Response('{}', { status: 500 })),
    });
    await expect(ollama.listModels()).rejects.toThrow('500');
  });
});
