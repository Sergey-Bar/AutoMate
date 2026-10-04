import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { createReporterRoutes } from './reporter.js';

/**
 * The `bodyLimit` bound, tested against the way it is actually attacked.
 *
 * ## What this covers
 *
 * `apps/api` bounds request bodies in two places — the reporter upload
 * (`routes/reporter.ts`, 5 MiB) and the execution routes
 * (`routes/execution.ts`, 96 MiB) — because a handler that calls
 * `c.req.json()` or reads a raw stream is an unbounded allocation on a public
 * endpoint.
 *
 * The existing coverage checks the bound against a **declared** `Content-Length`, which
 * is the honest client's path. This file covers the one that is not: a body that
 * arrives with no `Content-Length` at all, streamed, and larger than the limit.
 *
 * ## Why the version matters, and why this file is in the upgrade
 *
 * Hono 4.12.16 fixed CVE-2026-44456, where `bodyLimit()` could be bypassed by a request
 * whose length was not declared up front — chunked transfer encoding, or a request whose
 * `Content-Length` simply did not match what followed. The repository resolves a patched
 * version, but **being on a patched version is not evidence the bound holds**, and this
 * repository does not record a security claim on the strength of a version number.
 * This assertion is the evidence, and it fails if the bound ever regresses.
 *
 * The sibling advisory, CVE-2026-44457, fixed the cache middleware ignoring
 * `Vary: Authorization` and `Vary: Cookie`. This API mounts no cache middleware, so there
 * is nothing to assert here; the finding is that there is nothing to assert here.
 */

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function app(): Hono {
  return withErrorBoundary(
    new Hono().route(
      '/',
      createReporterRoutes(undefined, { repository: new InMemoryRunRepository() }),
    ),
  );
}

/**
 * A body of exactly `bytes` length with no declared length.
 *
 * `app.request` builds a `Request`, and a `ReadableStream` body carries no
 * `Content-Length` — which is the whole point. The stream is closed immediately so the
 * middleware cannot pass the request by never finishing it.
 */
function undeclaredBody(bytes: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

describe('the reporter upload bound', () => {
  it('refuses an over-large body that declared no length', async () => {
    const response = await app().request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: undeclaredBody(MAX_UPLOAD_BYTES + 1),
      duplex: 'half',
    });

    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { code: string } };
    // The product's own code, not Hono's default string: one error boundary, one shape.
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('still accepts a body inside the bound, so the refusal is the bound and not the route', async () => {
    // The twin. Without it, a test asserting "413" passes just as well against an app
    // that refuses everything, and the assertion would be measuring nothing.
    const response = await app().request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: undeclaredBody(16),
      duplex: 'half',
    });

    expect(response.status).not.toBe(413);
  });

  it('refuses an over-large body whose declared length lies', async () => {
    // The other half of the same advisory, and it is refused by a **different** party.
    //
    // `Content-Length: 16` with five megabytes behind it is a protocol violation, and
    // undici — not Hono, not this middleware — rejects the request before a handler can
    // run. So this asserts a refusal, not the code: the invariant that matters is that
    // the request never reaches ingestion, and pinning the exact status would be
    // asserting a runtime's internal choice rather than this API's behaviour.
    //
    // That is also why this case is weaker evidence than the one above. A client that
    // omits `Content-Length` entirely is perfectly legal HTTP and reaches the bound;
    // a client that misstates it never gets that far.
    const response = await app().request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '16' },
      body: undeclaredBody(MAX_UPLOAD_BYTES + 1),
      duplex: 'half',
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).not.toBe(202);
  });
});
