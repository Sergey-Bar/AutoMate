import { describe, expect, it } from 'vitest';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { Hono } from 'hono';
import {
  currentRequestId,
  normaliseRequestId,
  requestContext,
  requireRequestId,
  runWithRequestId,
} from './request-context.js';

/**
 * O-1b: the request id was re-derived from the header at six sites, each with its own
 * fallback — some generated a UUID, one stored `null`, one stored the literal
 * `'unknown'`. So a single execution could not be traced by a single id from the log
 * line to the event row to the artifact metadata, which is the entire purpose of having
 * one.
 *
 * The tests below are about *agreement*: the same id, from every reader, for one
 * request. A test that only checks an id exists would pass with six independent
 * derivations, which is the state the finding describes.
 */

function appWithReadouts() {
  const app = withErrorBoundary(new Hono());
  app.use(requestContext);
  const read = (c: never) => c;
  void read;
  app.get('/read', (c) =>
    c.json({
      context: currentRequestId(),
      required: requireRequestId(),
      header: c.req.header('x-request-id') ?? null,
    }),
  );
  return app;
}

describe('one request has one id', () => {
  it('every reader in the same request sees the same value', async () => {
    const app = appWithReadouts();
    const response = await app.request('/read', { headers: { 'x-request-id': 'req-42' } });
    const body = (await response.json()) as {
      context: string | undefined;
      required: string;
    };
    expect(body.context).toBe('req-42');
    expect(body.required).toBe('req-42');
  });

  it('echoes the id on the response, so a client can quote it', async () => {
    // A generated id the client never sees is useless for correlation from outside.
    const app = appWithReadouts();
    const response = await app.request('/read', { headers: { 'x-request-id': 'req-42' } });
    expect(response.headers.get('x-request-id')).toBe('req-42');
  });

  it('generates one id and reuses it, rather than generating per reader', async () => {
    // The defect in one assertion: with six independent fallbacks this is a *different*
    // value at each site. With a context it cannot be.
    const app = appWithReadouts();
    const response = await app.request('/read');
    const body = (await response.json()) as { context: string; required: string };
    expect(body.context).toBe(body.required);
    expect(body.context).toBe(response.headers.get('x-request-id'));
  });

  it('does not leak an id between requests', async () => {
    // An AsyncLocalStorage that is entered once and never left would make every later
    // request look like the first one, which is a worse failure than having none.
    const app = appWithReadouts();
    const first = (await (await app.request('/read')).json()) as { context: string };
    const second = (await (await app.request('/read')).json()) as { context: string };
    expect(first.context).not.toBe(second.context);
  });

  it('propagates across an await, which is the part that matters', async () => {
    // The whole reason for AsyncLocalStorage over a mutable module-level variable: a
    // variable would be correct until two requests overlapped, and then a handler
    // would read another request's id.
    const app = withErrorBoundary(new Hono());
    app.use(requestContext);
    app.get('/slow', async (c) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return c.json({ id: currentRequestId() });
    });

    const inFlight = ['req-a', 'req-b', 'req-c'].map(async (id) => {
      const response = await app.request('/slow', { headers: { 'x-request-id': id } });
      return (await response.json()) as { id: string | undefined };
    });
    const results = await Promise.all(inFlight);
    expect(results.map((r) => r.id).sort()).toEqual(['req-a', 'req-b', 'req-c']);
  });
});

describe('a client-supplied id is not trusted blindly', () => {
  it('accepts an identifier', () => {
    expect(normaliseRequestId('req-42')).toBe('req-42');
    expect(normaliseRequestId('trace.abc_123-x')).toBe('trace.abc_123-x');
  });

  it('replaces anything that is not an identifier, rather than truncating it', () => {
    // The value lands in log lines and persisted audit rows. A truncated attacker
    // string is still an attacker string, and a log line is the wrong place to be
    // lenient about what another system will parse back out of it.
    const hostile = [
      '',
      '   ',
      'a'.repeat(65),
      'has space',
      'has\nnewline',
      'quote"and\ttab',
      null,
      undefined,
    ];
    for (const value of hostile) {
      const result = normaliseRequestId(value as string | undefined | null);
      expect(result, JSON.stringify(value)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('says so outside a request rather than inventing a correlatable-looking id', () => {
    // A fabricated id in a log line is worse than an absent one: it looks findable and
    // is not. `NO_REQUEST` is obviously not a real id.
    expect(currentRequestId()).toBeUndefined();
    expect(requireRequestId()).toBe('NO_REQUEST');
  });

  it('lets a background job establish the same context the HTTP path does', () => {
    // Otherwise the id has one way in and six other ways of being absent.
    const captured = runWithRequestId('job-7', () => requireRequestId());
    expect(captured).toBe('job-7');
    expect(requireRequestId()).toBe('NO_REQUEST');
  });
});
