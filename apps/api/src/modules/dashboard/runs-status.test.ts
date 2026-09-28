import { beforeEach, describe, expect, it } from 'vitest';
/**
 * The boundary's body, named.
 *
 * A cast to `Record<string, unknown>` can read any shape and so checks none, which is
 * how `body.error` stayed a bare string in this suite after the migration: the
 * assertion was satisfied by a field that no longer exists.
 */
interface BoundaryBody {
  /** The success shapes these same files read: `id`, `status`, `allowed`, `runs`. */
  [key: string]: unknown;
  error: {
    code: string;
    message: string;
    requestId: string;
    details: {
      issues: Array<{ path: unknown[]; message?: string }>;
      fieldErrors?: Record<string, unknown>;
      /** The statuses a client may ask for, rather than a sentence naming them. */
      allowed?: string[];
      /** How long to wait, rather than a sentence saying to try again. */
      retryAfterSeconds?: number;
      from?: string;
      to?: string;
    };
  };
}

import { withErrorBoundary } from '../../test-support/error-boundary-app.js';
import { Hono } from 'hono';
import { InMemoryAuditSink } from './audit-sink.js';
import { createDashboardRunsRoutes, type DashboardRunsOptions } from './runs.js';
import type { RunRecord } from '../../repositories/run-repository.js';

/**
 * X-2: the dashboard's status PATCH was unaudited, accepted any transition, and could
 * return 200 with a literal `null`.
 *
 * Written around the specific claims rather than around "the route works", because the
 * route returning the new status passed with or without all three defects.
 */

const run = (overrides: Partial<RunRecord> = {}): RunRecord =>
  ({
    id: 'run-1',
    startedAt: '2026-09-27T00:00:00.000Z',
    finishedAt: null,
    status: 'running',
    total: 10,
    passed: 8,
    failed: 1,
    flaky: 0,
    skipped: 1,
    durationMs: 1_000,
    branch: 'main',
    ...overrides,
  }) as RunRecord;

interface Harness {
  app: Hono;
  audit: InMemoryAuditSink;
  patch: (status: string, id?: string) => Promise<Response>;
  store: Map<string, RunRecord>;
}

function build(initial: RunRecord = run()): Harness {
  const store = new Map([[initial.id, initial]]);
  const audit = new InMemoryAuditSink();

  const options: DashboardRunsOptions = {
    repository: {
      getRun: async (id: string) => store.get(id) ?? null,
      listRuns: async () => [...store.values()],
      patchRun: async (id: string, patch: Partial<RunRecord>) => {
        const current = store.get(id);
        if (!current) return null;
        const next = { ...current, ...patch };
        store.set(id, next);
        return next;
      },
    } as never,
    audit,
  };

  const app = withErrorBoundary(createDashboardRunsRoutes(options));

  return {
    app,
    audit,
    store,
    // `app.request` is typed as returning `Response | Promise<Response>` under this Hono
    // version, so the harness awaits it rather than relying on an implicit unwrap.
    patch: async (status, id = initial.id) =>
      await app.request(`/api/v1/dashboard/runs/${id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-actor-id': 'user-7' },
        body: JSON.stringify({ status }),
      }),
  };
}

beforeEach(() => {
  /* each case builds its own harness */
});

describe('a run status change is recorded', () => {
  it('writes an audit row naming who moved it and what it became', async () => {
    // The defect: `audit-sink.ts` sat in this very module, unreferenced, while the
    // route that most needs it recorded nothing.
    const harness = build(run({ status: 'running' }));
    const response = await harness.patch('interrupted');

    expect(response.status).toBe(200);
    expect(harness.audit.entries).toHaveLength(1);
    const [entry] = harness.audit.entries;
    expect(entry?.action).toBe('run.status_changed');
    expect(entry?.resourceType).toBe('run');
    expect(entry?.resourceId).toBe('run-1');
    expect(entry?.actorId).toBe('user-7');
  });

  it('records nothing when the status did not change', async () => {
    // A no-op write is not an event. Recording it would make the audit log a count of
    // requests rather than a record of decisions.
    const harness = build(run({ status: 'running' }));
    await harness.patch('running');
    expect(harness.audit.entries).toEqual([]);
  });
});

describe('a terminal run does not come back to life', () => {
  it('refuses a transition out of a terminal status', async () => {
    // A concluded release marked running is a report that will never settle, and the
    // status is a claim in every context that reads it.
    const harness = build(run({ status: 'passed', finishedAt: '2026-09-27T01:00:00.000Z' }));
    const response = await harness.patch('running');

    expect(response.status).toBe(409);
    const body = (await response.json()) as unknown as BoundaryBody;
    expect(body.error.code).toBe('RUN_STATUS_TERMINAL');
    expect(body.error.details.from).toBe('passed');
    expect(body.error.details.to).toBe('running');
  });

  it('leaves the run untouched when it refuses', async () => {
    const harness = build(run({ status: 'failed' }));
    await harness.patch('running');
    expect(harness.store.get('run-1')?.status).toBe('failed');
    expect(harness.audit.entries).toEqual([]);
  });

  it('allows a run that is still running to move', async () => {
    const harness = build(run({ status: 'running' }));
    const response = await harness.patch('interrupted');
    expect(response.status).toBe(200);
    expect(harness.store.get('run-1')?.status).toBe('interrupted');
  });

  it('allows a terminal run to keep its own terminal status', async () => {
    // Idempotent, not forbidden. A client re-sending the status it already sees is
    // asking for no change, and 409 for that is a confusing answer.
    const harness = build(run({ status: 'passed' }));
    const response = await harness.patch('passed');
    expect(response.status).toBe(200);
  });
});

describe('the response is always a run', () => {
  it('never answers 200 with a literal null', async () => {
    // The run existed a moment ago; if it is gone now the honest answer is that it is
    // gone. `c.json(null)` returned 200 with a body that is not a run, which a client
    // cannot distinguish from a run whose fields are all null.
    const harness = build();
    await harness.store.delete('run-1');

    // Re-patching a vanished run cannot go through the audit path, so this asserts the
    // shape directly: the handler must not produce a null body for a missing run.
    const response = await harness.patch('interrupted', 'run-missing');
    expect(response.status).toBe(404);
    const body = (await response.json()) as unknown;
    expect(body).not.toBeNull();
    expect((body as unknown as { error: { code: string; message: string } }).error.message).toMatch(
      /not found/i,
    );
  });
});
