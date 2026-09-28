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

  it('handles tool calls and usage, and refuses a response with no body', async () => {
    // This test previously asserted that a malformed frame aborts the stream with
    // `Invalid SSE JSON`. Ledger G-7 is that assertion being wrong: a keep-alive
    // comment, a non-JSON `data:` field, or a frame split across a chunk boundary
    // each threw, discarding a completion that had already delivered text. The
    // rewrite keeps everything this case was really checking — usage, tool calls, and
    // a bodyless response — and states the corrected behaviour for the rest.
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
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1"}]},"finish_reason":"tool_calls"}]}\n',
            ].join(''),
            { status: 200 },
          ),
        ),
    });
    expect(await collect(gateway.streamCompletion({ model: 'model-a', messages: [] }))).toEqual([
      { type: 'usage', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } },
      // The provider's `index` is dropped from the assembled call: it is the transport
      // detail that says which fragment this was, and a caller invoking tools has no
      // use for it. What is asserted is that the fragments became *one* call.
      { type: 'tool-call', call: [{ id: 'call-1' }] },
      { type: 'done', finishReason: 'tool_calls' },
    ]);

    // A bodyless 200 is still a refusal: there is no stream to read, which is a
    // different thing from a stream containing a line we cannot use.
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
      { type: 'usage', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('issues one request for a status that will never change', async () => {
    // Ledger P-24. The fatal-status `throw` sat *inside* the `try` whose `catch`
    // swallowed it, so a 400 was indistinguishable from a transport error and was
    // attempted three times. The old test asserted only that `listModels` eventually
    // rejected, which is true either way — it never counted requests, so it passed
    // over the bug. Counting is the only assertion that can see it.
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }));
    const gateway = new KiloGateway({
      baseUrl: 'https://kilo.test',
      apiKey: 'secret',
      fetcher,
      sleep: async () => undefined,
    });

    await expect(gateway.listModels()).rejects.toThrow('400');
    expect(fetcher, 'a 400 must be asked once, not three times').toHaveBeenCalledTimes(1);
  });

  it('still retries a status that can clear, and still retries a transport error', async () => {
    // The counterweight to the case above. A fix that simply stopped retrying would
    // satisfy P-24 by making the gateway useless during an outage, which is the exact
    // moment the retry exists.
    const on503 = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(
      new KiloGateway({
        baseUrl: 'https://kilo.test',
        apiKey: 'secret',
        fetcher: on503,
        sleep: async () => undefined,
      }).listModels(),
    ).resolves.toEqual([]);
    expect(on503).toHaveBeenCalledTimes(2);

    const onNetwork = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(
      new KiloGateway({
        baseUrl: 'https://kilo.test',
        apiKey: 'secret',
        fetcher: onNetwork,
        sleep: async () => undefined,
      }).listModels(),
    ).resolves.toEqual([]);
    expect(onNetwork).toHaveBeenCalledTimes(2);
  });

  it('yields the final token of a stream that ends without a newline', async () => {
    // Ledger G-1. The buffer's tail was popped and then `break`ed on, so any stream
    // whose last frame had no trailing newline lost its last token — and the existing
    // tests all fed newline-terminated bodies, so nothing noticed. The realistic case
    // is a provider that closes the connection immediately after the final frame,
    // which is what "no trailing newline" means in practice.
    const gateway = new KiloGateway({
      baseUrl: 'https://kilo.test',
      apiKey: 'secret',
      fetcher: vi
        .fn()
        .mockResolvedValue(
          new Response(
            'data: {"choices":[{"delta":{"content":"first "}}]}\n' +
              'data: {"choices":[{"delta":{"content":"last"}}]}',
            { status: 200 },
          ),
        ),
    });

    expect(await collect(gateway.streamCompletion({ model: 'm', messages: [] }))).toEqual([
      { type: 'text', text: 'first ' },
      { type: 'text', text: 'last' },
    ]);
  });

  it('releases the response body when the consumer stops early', async () => {
    // Ledger G-2. The reader was never cancelled and its lock never released, so a
    // stream abandoned at `[DONE]` — the normal way a caller ends a completion —
    // left the connection open. Asserted on the reader itself, because a test that
    // only counted fetcher calls cannot see a body that was never closed.
    const cancel = vi.fn(async () => undefined);
    const releaseLock = vi.fn();
    const body = {
      getReader: () => ({
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"x"}}]}\n'),
          })
          .mockResolvedValue({ done: true, value: undefined }),
        cancel,
        releaseLock,
      }),
    };
    const gateway = new KiloGateway({
      baseUrl: 'https://kilo.test',
      apiKey: 'secret',
      fetcher: vi.fn().mockResolvedValue({ ok: true, status: 200, body }),
    });

    await collect(gateway.streamCompletion({ model: 'm', messages: [] }));
    expect(cancel, 'an abandoned stream must cancel its body').toHaveBeenCalled();
    expect(releaseLock, 'an abandoned stream must release the reader lock').toHaveBeenCalled();
  });

  it('merges split tool-call fragments into one call, and emits it once', async () => {
    // Ledger G-3. OpenAI streams a tool call across several chunks, split by `index`,
    // and the old code flat-appended them — so one call became N partial objects. It
    // also re-yielded the accumulated array on every chunk carrying a
    // `finish_reason`, so a stream with two of them emitted the tool call twice.
    const stream = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"search","arguments":""}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\""}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":1}"}}]}}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n',
      'data: [DONE]\n',
    ].join('');
    const gateway = new KiloGateway({
      baseUrl: 'https://kilo.test',
      apiKey: 'secret',
      fetcher: vi.fn().mockResolvedValue(new Response(stream, { status: 200 })),
    });

    const chunks = await collect(gateway.streamCompletion({ model: 'm', messages: [] }));
    const toolCallChunks = chunks.filter((chunk) => chunk.type === 'tool-call');
    expect(toolCallChunks, 'a split tool call must be emitted exactly once').toHaveLength(1);

    // `call` is the list of assembled calls, so the merged call is the first entry.
    const call = (toolCallChunks[0] as { call: Array<{ function: { arguments: string } }> }).call;
    expect(call, 'three fragments must become one call, not three').toHaveLength(1);
    expect(call[0]?.function.arguments, 'fragments must be concatenated in order').toBe('{"q":1}');
  });

  it('maps the provider usage fields instead of casting them', async () => {
    // Ledger G-4. The OpenAI-shaped body was cast to the camelCase read model, which
    // is a rename, not a mapping — every field arrived `undefined` and the caller
    // recorded no token cost at all. Ollama's adapter maps its own real field names,
    // which is why no test saw this.
    const gateway = new KiloGateway({
      baseUrl: 'https://kilo.test',
      apiKey: 'secret',
      fetcher: vi
        .fn()
        .mockResolvedValue(
          new Response(
            'data: {"usage":{"input_tokens":7,"output_tokens":11}}\n' + 'data: [DONE]\n',
            { status: 200 },
          ),
        ),
    });

    const usage = (await collect(gateway.streamCompletion({ model: 'm', messages: [] }))).find(
      (chunk) => chunk.type === 'usage',
    );
    expect(usage).toEqual({
      type: 'usage',
      usage: { inputTokens: 7, outputTokens: 11, totalTokens: 18 },
    });
  });

  it('keeps reading after a line that is not a chunk', async () => {
    // Ledger G-7. A keep-alive comment, a non-JSON `data:` field, or a frame split
    // across a chunk boundary used to abort a stream that had already delivered
    // events, discarding the rest of a completion. An existing test asserted the
    // abort as correct behaviour, so that assertion is replaced here by the
    // behaviour that is actually right: a line that is not a chunk is not a chunk.
    const stream = [
      ': ping\n',
      'data: {"choices":[{"delta":{"content":"before "}}]}\n',
      'data: not-json\n',
      'data: {"choices":[{"delta":{"content":"after"},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ].join('');
    const gateway = new KiloGateway({
      baseUrl: 'https://kilo.test',
      apiKey: 'secret',
      fetcher: vi.fn().mockResolvedValue(new Response(stream, { status: 200 })),
    });

    expect(await collect(gateway.streamCompletion({ model: 'm', messages: [] }))).toEqual([
      { type: 'text', text: 'before ' },
      { type: 'text', text: 'after' },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('forwards the tool list to Ollama, and honours a cancelled catalog request', async () => {
    // Ledger G-5 and G-6. G-5: `input.tools` was never referenced in the Ollama
    // adapter, so a tool-using request silently degraded to a plain completion —
    // the caller asked for a tool and got prose, with nothing to say so. G-6:
    // `listModels` took no `signal` parameter at all, so a cancelled catalog
    // request could not be cancelled and TypeScript never flagged the omission.
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 }));
    const gateway = new OllamaGateway({ baseUrl: 'http://ollama.test', fetcher });

    await collect(
      gateway.streamCompletion({
        model: 'llama3',
        messages: [],
        tools: [{ type: 'function', function: { name: 'search' } }],
      }),
    );
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(String((init as { body?: string }).body)).tools).toEqual([
      { type: 'function', function: { name: 'search' } },
    ]);

    const controller = new AbortController();
    const withSignal = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 }));
    await new OllamaGateway({ baseUrl: 'http://ollama.test', fetcher: withSignal }).listModels(
      controller.signal,
    );
    // The request must carry a signal that the *caller's* signal can still cancel.
    // It is deliberately not the same object: the request deadline (G-8) has to be
    // composed in, and `AbortSignal.any` is what composes it without discarding the
    // caller's intent.
    const carried = (withSignal.mock.calls[0]?.[1] as { signal?: AbortSignal }).signal;
    expect(carried, 'the request must carry a signal').toBeDefined();
    expect(carried, 'the caller signal must not be passed through as the whole signal').not.toBe(
      controller.signal,
    );
    controller.abort();
    expect(carried?.aborted, 'aborting the caller signal must abort the request').toBe(true);
  });

  it('bounds a gateway request, so a hung provider cannot hold it open forever', async () => {
    // Ledger G-8. Nothing bounded the request except whatever signal the caller
    // happened to supply, and there is no timeout primitive anywhere in the package.
    // A provider that accepts the connection and then stops responding holds the
    // request open indefinitely, which is the state with no escape.
    const fetcher = vi.fn().mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const gateway = new KiloGateway({
      baseUrl: 'https://kilo.test',
      apiKey: 'secret',
      fetcher,
      requestTimeoutMs: 25,
      sleep: async () => undefined,
    });

    await expect(gateway.listModels()).rejects.toThrow();
    const signal = (fetcher.mock.calls[0]?.[1] as { signal?: AbortSignal }).signal;
    expect(
      signal,
      'a request must carry a signal even when the caller supplied none',
    ).toBeDefined();
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
