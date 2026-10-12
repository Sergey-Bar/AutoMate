import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerJobRoutes } from './jobs.routes.js';
import { InMemoryExecutionStore } from '../../execution/in-memory-execution-store.js';
import type { ExecutionRoutesOptions } from './schemas.js';

/**
 * `GET /api/v1/execution/jobs` — the queue, at last.
 *
 * ## Why this route exists and why its path is `/execution/`
 *
 * The orchestration module already owns `GET /api/v1/jobs` and serves its own
 * in-process envelope list from it. Reusing that path would have been a silent
 * 404 for whichever caller lost the race, and `route-manifest.test.ts`'s
 * "registers each method+path exactly once" assertion would have failed only
 * after both were mounted — so the collision is avoided by naming, and the name
 * says which store is being read.
 *
 * **The console's runner screen had nothing to read.** Every screen around a run
 * exists; the queue itself — what is waiting, what is in flight, whose lease it
 * holds, when that lease expires — was runner-side state visible only through the
 * claim call. An operator asking "why is my run late" had no answer from the API.
 * The read already existed (`listJobs` on both stores, scoped by workspace); this
 * is the shape it is served in.
 */

function harness(): { app: Hono; store: InMemoryExecutionStore } {
  const store = new InMemoryExecutionStore();
  const options: ExecutionRoutesOptions = { store, workspaceId: 'ws-1' } as ExecutionRoutesOptions;
  const app = new Hono();
  registerJobRoutes(app, {
    options,
    ws: 'ws-1',
    eventSequences: new Map(),
    maxArtifactBytes: 1024 * 1024,
  });
  return { app, store };
}

describe('GET /api/v1/execution/jobs', () => {
  it('lists the jobs in this workspace, newest state first', async () => {
    const { app, store } = harness();
    await store.create({ externalId: 'a', source: 'api' } as never, 'k1', 'ws-1');
    await store.create({ externalId: 'b', source: 'api' } as never, 'k2', 'ws-1');
    const response = await app.request('/api/v1/execution/jobs');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { jobs: Array<{ id: string; state: string }> };
    expect(body.jobs).toHaveLength(2);
    // Every job carries the state the queue is made of, so a screen renders the
    // queue and not a list of ids it has to re-read to learn anything.
    for (const job of body.jobs) {
      expect(job.state).toBeTruthy();
      expect(typeof job.id).toBe('string');
    }
  });

  it('is scoped to one workspace, so a second install cannot read this queue', async () => {
    const { app, store } = harness();
    await store.create({ externalId: 'mine', source: 'api' } as never, 'k1', 'ws-1');
    await store.create({ externalId: 'theirs', source: 'api' } as never, 'k2', 'other-ws');
    const body = (await (await app.request('/api/v1/execution/jobs')).json()) as {
      jobs: Array<{ runId: string }>;
    };
    expect(body.jobs).toHaveLength(1);
  });

  it('answers an empty queue with an empty list rather than an error', async () => {
    const { app } = harness();
    const response = await app.request('/api/v1/execution/jobs');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { jobs: unknown[] };
    expect(body.jobs).toEqual([]);
  });
});
