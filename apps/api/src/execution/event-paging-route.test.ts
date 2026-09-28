import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import { createExecutionRoutes } from '../routes/execution.js';
import type { ExecutionEventInput, ExecutionStore } from './types.js';
import { createErrorBoundary } from '../errors/boundary.js';

/**
 * The routes, mounted the way the application mounts them.
 *
 * The error boundary is not decoration here: since finding C-3 a handler refuses by
 * `throw`ing a `DomainError`, and this boundary is what renders it into the response
 * body. A bare `Hono` would answer 500 and the suite would be asserting the wrong thing
 * — and a body only the removed `error(c, …)` helper could produce would stop being
 * testable, which is the point.
 */
function mounted(routes: Hono): Hono {
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    // Outside a request there is no id, and the boundary is told so rather than being
    // handed a fabricated one. The production middleware supplies the real value.
    requestId: () => 'NO_REQUEST',
  });
  return new Hono().onError(onError).route('/', routes);
}

/**
 * The event list at the route, which is where a client actually meets it.
 *
 * The store-level paging in `event-paging.test.ts` proves both implementations page
 * the same way. It does not prove the *route* tells a caller how to continue, and that
 * is the half a client is written against: a `hasMore` flag nobody can act on is the
 * same as no paging, because the client either stops early or guesses.
 *
 * Two things are asserted here that only the route can decide:
 *
 * 1. **`X-Next-Cursor` is present exactly when there is more.** The runs listing
 *    established the convention — the body stays a bare array so existing clients are
 *    unaffected, and the next cursor rides in a header.
 * 2. **A cursor that is not a sequence is a 400, not a silent first page.** A cursor
 *    is a claim about where to resume. A client that sent `after=nonsense` and got
 *    page one back would read it as an empty stream and stop polling; a client that
 *    sent it after a real page would re-read the run from the start and look, from
 *    the dashboard, like the run restarted. Neither is recoverable silently, so the
 *    route says so.
 */

const WS = 'ws-event-route';

const CREATE_RUN = {
  externalId: 'ext-event-route',
  source: 'api',
  testType: 'browser',
  framework: 'playwright',
  timeoutMs: 1_000,
  requiredCapabilities: [],
  labels: [],
  configuration: {},
};

interface Built {
  app: Hono;
  runId: string;
  store: ExecutionStore;
}

let counter = 0;

async function withEvents(count: number): Promise<Built> {
  counter += 1;
  const store = new InMemoryExecutionStore();
  const app = mounted(createExecutionRoutes({ store, workspaceId: WS }));

  const { run, job } = await store.createRun(
    { ...CREATE_RUN, externalId: `ext-event-route-${counter}` },
    `key-event-route-${counter}`,
    WS,
  );
  const runner = await store.registerRunner(
    {
      id: `runner-${counter}`,
      name: `runner-${counter}`,
      version: '1.0.0',
      os: 'linux',
      arch: 'x64',
      capabilities: [],
      labels: [],
      slots: 1,
    },
    createHash('sha256').update(`token-${counter}`).digest('hex'),
    new Date(Date.now() + 3_600_000).toISOString(),
    WS,
  );
  const claim = await store.claimJob(runner.id, [], [], new Date(), WS);
  const events: ExecutionEventInput[] = Array.from({ length: count }, (_, index) => ({
    eventId: `event-${counter}-${index + 1}`,
    type: 'run.phase',
    sequence: index + 1,
    payload: { phase: 'running', outcome: null },
  }));
  await store.appendEvents(
    claim?.jobId ?? job.id,
    claim?.leaseId ?? '',
    claim?.fencingToken ?? 1,
    events,
    WS,
  );

  return { app, runId: run.id, store };
}

describe('GET /api/v1/runs/:runId/events is paged', () => {
  it('returns a bare array, so a client written against the old body is unaffected', async () => {
    const { app, runId } = await withEvents(3);
    const response = await app.request(`/api/v1/runs/${runId}/events`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);
  });

  it('sends the next cursor in a header when more exist, and omits it when not', async () => {
    const many = await withEvents(250);
    const first = await many.app.request(`/api/v1/runs/${many.runId}/events?limit=100`);
    expect(first.status).toBe(200);
    expect(first.headers.get('x-next-cursor')).toBe('100');

    const short = await withEvents(5);
    const only = await short.app.request(`/api/v1/runs/${short.runId}/events`);
    // No cursor when there is nothing after it: a client following a header that is
    // always present would loop forever on the last page.
    expect(only.headers.get('x-next-cursor')).toBeNull();
  });

  it('resumes from the cursor with no gap and no repeat', async () => {
    const { app, runId } = await withEvents(250);
    const seen: number[] = [];
    // Start with **no** cursor, then follow the header. Seeding the loop with a
    // cursor would skip the first event, and a test that starts mid-stream cannot
    // tell "resumed correctly" from "dropped one".
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const url =
        cursor === null
          ? `/api/v1/runs/${runId}/events?limit=100`
          : `/api/v1/runs/${runId}/events?limit=100&after=${cursor}`;
      const response = await app.request(url);
      const page = (await response.json()) as Array<{ sequence: number }>;
      seen.push(...page.map((event) => event.sequence));
      cursor = response.headers.get('x-next-cursor');
      if (cursor === null) break;
    }
    expect(seen).toEqual(Array.from({ length: 250 }, (_, index) => index + 1));
  });

  it('answers 400 for a cursor that is not a sequence, rather than restarting the run', async () => {
    const { app, runId } = await withEvents(5);
    for (const after of ['nonsense', '-1', '1.5', '']) {
      const response = await app.request(`/api/v1/runs/${runId}/events?after=${after}`);
      // An empty `after` is an *absent* cursor — the same as not sending one — so it
      // is the only one of the four that is not a 400.
      if (after === '') {
        expect(response.status, 'an empty cursor should be treated as absent').toBe(200);
        continue;
      }
      expect(response.status, `after=${after}`).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_CURSOR');
    }
  });

  it('still answers 404 for a run that does not exist', async () => {
    const { app } = await withEvents(1);
    expect((await app.request('/api/v1/runs/missing/events?after=5')).status).toBe(404);
  });
});
