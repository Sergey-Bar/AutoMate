import { describe, expect, it } from 'vitest';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { Hono } from 'hono';
import type { CanonicalRunResult } from '@automate/shared-contracts';
import {
  ReporterIngestionService,
  type ReporterIngestionResult,
  type ReporterResultStore,
} from '../services/reporter-ingestion.js';
import { createReporterResultsRoute } from './reporter-results.js';

const digest = 'e'.repeat(64);
const result = {
  contractVersion: '2' as const,
  identity: { runId: 'run-1', workspaceId: 'workspace-1' },
  status: 'passed' as const,
  startedAt: '2026-09-25T00:00:00.000Z',
  attempts: [
    {
      index: 1,
      testId: 'test-1',
      specPath: 'tests/example.spec.ts',
      title: 'example',
      status: 'passed' as const,
      rawStatus: 'passed',
      startedAt: '2026-09-25T00:00:00.000Z',
      evidence: [],
      flakiness: 'unknown' as const,
    },
  ],
  steps: [],
  evidence: [],
  provenance: {
    producer: 'playwright' as const,
    producerVersion: '1.0.0',
    adapterVersion: '1.0.0',
    sourceDigest: digest,
    sourceUri: 'artifact://run-1/report.json',
  },
  retention: { class: 'standard' as const },
  proof: { state: 'verified' as const, digest, verifier: 'test' },
  completeness: { state: 'complete' as const, missingShards: [], duplicateShards: [] },
  raw: {},
};

/**
 * Counts what actually reached the store.
 *
 * The route reports `duplicate` on a re-post, which is a *claim* about idempotency.
 * Whether the second request reached the store at all is a different question, and
 * it is the one that matters when the two entry points of an ingestion surface are
 * the same handler registered under two paths: a body that was ingested twice is
 * indistinguishable from one that was ingested once and recognised the second time.
 */
class CountingResultStore implements ReporterResultStore {
  readonly ingested: unknown[] = [];
  private readonly inner: ReporterIngestionService;

  constructor(workspaceId: string) {
    this.inner = new ReporterIngestionService(workspaceId);
  }

  ingest(input: unknown): ReporterIngestionResult {
    this.ingested.push(input);
    return this.inner.ingest(input);
  }

  get(runId: string): CanonicalRunResult | undefined {
    return this.inner.get(runId);
  }
}

function openApp(store: ReporterResultStore): Hono {
  return withErrorBoundary(
    createReporterResultsRoute(store, {
      reporterSecret: undefined,
      requireReporterSecret: false,
    }),
  );
}

describe('reporter results route', () => {
  const openIngestion = () =>
    new Hono().route(
      '/',
      createReporterResultsRoute(new ReporterIngestionService('workspace-1'), {
        reporterSecret: undefined,
        requireReporterSecret: false,
      }),
    );

  it('accepts canonical results and reports duplicates', async () => {
    const app = openIngestion();
    const first = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      body: JSON.stringify(result),
      headers: { 'content-type': 'application/json' },
    });
    const second = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      body: JSON.stringify(result),
      headers: { 'content-type': 'application/json' },
    });
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
  });

  it('requires the reporter secret when configured', async () => {
    const app = withErrorBoundary(
      createReporterResultsRoute(new ReporterIngestionService('workspace-1'), {
        reporterSecret: 'reporter-secret',
      }),
    );
    const unauthorized = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(unauthorized.status).toBe(401);
    const authorized = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      body: JSON.stringify(result),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer reporter-secret',
      },
    });
    expect(authorized.status).toBe(202);
  });

  it('fails closed with 503 when the secret is unset and one is required', async () => {
    const previous = process.env['REPORTER_SECRET'];
    delete process.env['REPORTER_SECRET'];
    try {
      const app = withErrorBoundary(
        createReporterResultsRoute(new ReporterIngestionService('workspace-1'), {
          reporterSecret: undefined,
        }),
      );
      // An unset secret used to leave this endpoint completely open.
      const response = await app.request('/api/v1/reporter/results', {
        method: 'POST',
        body: JSON.stringify(result),
        headers: { 'content-type': 'application/json' },
      });
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'REPORTER_SECRET_NOT_CONFIGURED',
      );
    } finally {
      if (previous === undefined) delete process.env['REPORTER_SECRET'];
      else process.env['REPORTER_SECRET'] = previous;
    }
  });

  it('rejects a token that is a prefix of the secret, differs in case, or is empty', async () => {
    const app = withErrorBoundary(
      createReporterResultsRoute(new ReporterIngestionService('workspace-1'), {
        reporterSecret: 'reporter-secret',
      }),
    );
    for (const token of ['reporter-secre', 'Reporter-secret', '']) {
      const response = await app.request('/api/v1/reporter/results', {
        method: 'POST',
        body: JSON.stringify(result),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(401);
    }
  });

  it('quarantines invalid results', async () => {
    const app = openIngestion();
    const response = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(422);
  });
});

describe('the ingestion surface this file owns', () => {
  it('registers exactly one path, and it is not an events batch', async () => {
    // `POST /api/v1/jobs/:jobId/events/batch` is an *alias* of
    // `POST /api/v1/jobs/:jobId/events`, and both are registered on the execution
    // module's `handleEvents` — covered there, against that module. It is not a
    // route of this file, and this assertion is what says so: an alias family added
    // here without its twin, or a second ingestion entry point added here at all,
    // would be a path nothing had reviewed.
    const routes = (
      createReporterResultsRoute(new ReporterIngestionService('workspace-1'), {
        reporterSecret: undefined,
        requireReporterSecret: false,
      }) as unknown as { routes: Array<{ method: string; path: string }> }
    ).routes;

    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'POST /api/v1/reporter/results',
    ]);
  });

  it('answers 404 on the jobs batch alias, because this file does not serve it', async () => {
    // Stated rather than assumed: a reader who assumes the reporter-results surface
    // is where `/events/batch` lives would probe the wrong module.
    const app = openApp(new CountingResultStore('workspace-1'));

    for (const path of [
      '/api/v1/jobs/job-1/events/batch',
      '/api/v1/reporter/events/batch',
      '/api/v1/runner/v1/jobs/job-1/events/batch',
    ]) {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: [] }),
      });
      expect(response.status, path).toBe(404);
    }
  });
});

describe('a result is ingested once, however many times it is sent', () => {
  it('stores one row and recognises the second post rather than writing again', async () => {
    const store = new CountingResultStore('workspace-1');
    const app = openApp(store);
    const send = () =>
      app.request('/api/v1/reporter/results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result),
      });

    const first = await send();
    const second = await send();
    const third = await send();

    expect([
      [first.status, ((await first.json()) as { status: string }).status],
      [second.status, ((await second.json()) as { status: string }).status],
      [third.status, ((await third.json()) as { status: string }).status],
    ]).toEqual([
      [202, 'accepted'],
      [200, 'duplicate'],
      [200, 'duplicate'],
    ]);
    // One stored row, and the duplicates are byte-identical to the original: a
    // re-post that rewrote the row with a re-serialised copy would be a second write
    // wearing a `duplicate` label.
    expect(store.get('run-1')).toEqual(result);
  });

  it('rejects a batch of results outright, rather than ingesting the first member', async () => {
    // The alias families in this product accept a batch (`/events`,
    // `/events/batch`). This surface accepts exactly one canonical result. A body
    // that is an array is not a batch here, and answering 202 for it while
    // ingesting one member would report a success for eleven results that were
    // never stored.
    const store = new CountingResultStore('workspace-1');
    const app = openApp(store);

    const response = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        result,
        { ...result, identity: { runId: 'run-2', workspaceId: 'workspace-1' } },
      ]),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      status: 'quarantined',
      reason: 'invalid canonical result',
    });
    expect(store.ingested).toEqual([]);
    expect(store.get('run-1')).toBeUndefined();
  });

  it('ignores an events array smuggled alongside a result, and ingests the result once', async () => {
    // `RunResultSchema` is not `.strict()`, so an unexpected key is stripped rather
    // than refused. A caller that posts `{...result, events: [...]}` gets one
    // ingested result and silence about the events — which is the honest reading of
    // "a result was ingested", and is asserted here so that a future `.strict()`
    // turns this into a visible 422 instead of a silent change.
    const store = new CountingResultStore('workspace-1');
    const app = openApp(store);

    const response = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...result,
        events: [{ type: 'check.completed', data: result.attempts[0] }],
      }),
    });

    expect(response.status).toBe(202);
    expect(store.ingested).toHaveLength(1);
    expect(store.get('run-1')).not.toBeUndefined();
  });

  it('refuses a second, different result for the same run rather than overwriting it', async () => {
    // A replayed result whose content changed is not a retry. Overwriting would let
    // a run that failed be re-reported as passed by a second upload, with the first
    // verdict unrecoverable.
    const store = new CountingResultStore('workspace-1');
    const app = openApp(store);
    await app.request('/api/v1/reporter/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result),
    });

    const conflicting = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...result, status: 'failed' }),
    });

    expect(conflicting.status).toBe(409);
    expect(await conflicting.json()).toEqual({
      status: 'quarantined',
      reason: 'conflicting result',
    });
    // The original verdict stands.
    expect(store.get('run-1')?.status).toBe('passed');
  });

  it('checks the secret before the body, so an unauthenticated caller cannot ingest', async () => {
    const store = new CountingResultStore('workspace-1');
    const app = withErrorBoundary(
      createReporterResultsRoute(store, { reporterSecret: 'reporter-secret' }),
    );

    const response = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-secret' },
      body: JSON.stringify(result),
    });

    expect(response.status).toBe(401);
    // Not merely rejected: never parsed, never handed to the store.
    expect(store.ingested).toEqual([]);
    expect(store.get('run-1')).toBeUndefined();
  });
});

describe('workspace isolation on this surface', () => {
  it('refuses a result whose identity names another workspace, and stores nothing', async () => {
    // `WORKSPACE_ID` is the only tenancy boundary in the product, and this is the
    // one ingestion route that checks the caller-supplied identity against it. A
    // result naming somebody else's workspace is a 409 and never becomes readable
    // through this store.
    const store = new CountingResultStore('workspace-1');
    const app = openApp(store);

    const response = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...result,
        identity: { runId: 'run-foreign', workspaceId: 'workspace-other-install' },
      }),
    });

    expect(response.status).toBe(409);
    expect(store.get('run-foreign')).toBeUndefined();
    expect(store.ingested).toHaveLength(1);
  });

  it('does not let a foreign run id displace a result this installation already holds', async () => {
    const store = new CountingResultStore('workspace-1');
    const app = openApp(store);
    await app.request('/api/v1/reporter/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result),
    });

    const foreign = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...result,
        identity: { runId: 'run-1', workspaceId: 'workspace-other-install' },
      }),
    });

    // The check runs before the lookup, so a foreign-workspace body cannot even
    // reach the stored row — which is what makes a 409 here safe to answer without
    // disclosing whether `run-1` exists.
    expect(foreign.status).toBe(409);
    expect(store.get('run-1')?.identity.workspaceId).toBe('workspace-1');
  });
});
