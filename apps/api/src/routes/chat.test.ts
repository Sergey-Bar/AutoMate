import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createErrorBoundary } from '../errors/boundary.js';
import { createChatRoutes } from './chat.js';
import type { AiGateway, CompletionChunk } from '@automate/automation';

/**
 * The chat route is the only consumer `packages/automation` has.
 *
 * The package declares a two-method port — `listModels`, `streamCompletion` — and
 * two adapters, and until this route existed nothing imported any of it. The port
 * was built and never wired, which is ledger X-4 at Critical: deleting the package
 * would have removed the only interface the feature has for reaching a model, so
 * the work was to wire it rather than to delete it.
 *
 * The route depends on the **port**, not on a provider. Which gateway serves a
 * request is decided at the composition root from configuration, so a test can
 * supply a stub and never reach a network — and adding a provider is a change to
 * the root, not to this file.
 *
 * Mounted behind the real error boundary, because the refusal paths are the point
 * of half these tests: a `DomainError` thrown by a route with no boundary on it
 * escapes the request rather than becoming a coded response, so the first version
 * of this file asserted 422s against exceptions.
 */
function mounted(g: AiGateway): Hono {
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'NO_REQUEST',
  });
  return new Hono().onError(onError).route('/', createChatRoutes({ gateway: g }));
}

/** An `AsyncIterable` over fixed chunks, so a test drives the stream directly. */
async function* streamOf(chunks: CompletionChunk[]): AsyncIterable<CompletionChunk> {
  for (const chunk of chunks) yield chunk;
}

const gateway = (overrides: Partial<AiGateway> = {}): AiGateway => ({
  listModels: vi
    .fn()
    .mockResolvedValue([{ id: 'kilo/sonic', gateway: 'kilo', ownedBy: 'automate' }]),
  streamCompletion: vi.fn(() =>
    streamOf([
      { type: 'text', text: 'Checking ' },
      { type: 'text', text: 'the checkout flow.' },
      { type: 'done', finishReason: 'stop' },
    ]),
  ),
  ...overrides,
});

const app = (g: AiGateway) => mounted(g);

const completion = (body: unknown) =>
  app(gateway()).request('/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /api/v1/chat/models', () => {
  it('lists what the configured gateway can reach', async () => {
    const response = await app(gateway()).request('/api/v1/chat/models');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { models: Array<{ id: string; gateway: string }> };
    expect(body.models).toEqual([{ id: 'kilo/sonic', gateway: 'kilo', ownedBy: 'automate' }]);
  });

  it('reports a gateway that cannot answer, rather than an empty list', async () => {
    // An empty list and an unreachable provider look identical to a client, and
    // they are opposite claims: "there is no model" against "I could not ask".
    // Only the second is true here.
    const response = await app(
      gateway({ listModels: vi.fn().mockRejectedValue(new Error('gateway unreachable')) }),
    ).request('/api/v1/chat/models');
    const body = (await response.json()) as { error: { code: string } };
    // 503 with the taxonomy's existing dependency code, not a bespoke one. A route
    // that passed a status alongside a new code had it ignored — the boundary
    // resolves status from the code table — and answered 500, which says "we are
    // broken" about a provider that is merely down.
    expect(response.status).toBe(503);
    expect(body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });
});

describe('POST /api/v1/chat/completions', () => {
  it('streams the gateway chunks as server-sent events', async () => {
    const response = await completion({
      model: 'kilo/sonic',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const body = await response.text();
    // The two text chunks in order, then the terminal frame — a client reading this
    // renders the same sentence the gateway produced.
    expect(body).toContain('Checking ');
    expect(body).toContain('the checkout flow.');
    expect(body.indexOf('Checking ')).toBeLessThan(body.indexOf('the checkout flow.'));
    expect(body).toContain('event: done');
  });

  it('passes the caller’s model and messages through to the gateway', async () => {
    // Asserted because a route that silently substituted a default model would
    // still stream a plausible-looking answer, and the reader would believe it.
    const g = gateway();
    await app(g).request('/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'chosen-model',
        messages: [{ role: 'user', content: 'what failed?' }],
      }),
    });

    const call = (g.streamCompletion as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[0] as { model: string; messages: Array<{ content: string }> };
    expect(call.model).toBe('chosen-model');
    expect(call.messages[0]?.content).toBe('what failed?');
  });

  it('refuses a body with no messages, and says which field is wrong', async () => {
    // The error boundary maps `VALIDATION_FAILED` to a 422 with a stable code; a
    // chat route that streamed an empty completion instead would look like a
    // provider that had nothing to say.
    const g = gateway();
    const response = await app(g).request('/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'kilo/sonic', messages: [] }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    // And it never asked the provider, so a refusal costs no tokens.
    expect(g.streamCompletion).not.toHaveBeenCalled();
  });

  it('refuses a request with no model named', async () => {
    const g = gateway();
    const response = await app(g).request('/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(response.status).toBe(422);
    expect(g.streamCompletion).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON at all', async () => {
    const response = await app(gateway()).request('/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(response.status).toBe(422);
  });

  it('reports a provider that fails mid-stream, rather than ending the stream cleanly', async () => {
    // A stream that stops without a `done` frame is indistinguishable, on the
    // wire, from a stream that finished. The reader would render half an answer
    // and call it complete, which for this product means a half-read failure
    // report. So the error frame is explicit.
    const failing: AiGateway = {
      ...gateway(),
      streamCompletion: () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'text', text: 'Checking the ' } as CompletionChunk;
          throw new Error('provider dropped the connection');
        },
      }),
    };

    const response = await app(failing).request('/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'kilo/sonic', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const body = await response.text();

    // The partial text is still delivered — throwing it away loses work the reader
    // already paid for — and the failure is stated rather than implied by silence.
    expect(body).toContain('Checking the ');
    expect(body).toContain('event: error');
    expect(body).toContain('CHAT_PROVIDER_FAILED');
    // And no terminal frame, because it did not finish.
    expect(body).not.toContain('event: done');
  });
});
