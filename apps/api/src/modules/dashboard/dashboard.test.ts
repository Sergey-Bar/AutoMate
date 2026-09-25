/**
 * dashboard.test.ts — Comprehensive tests for the dashboard module
 *
 * Covers:
 *  Runs detail:
 *   1. GET /api/v1/dashboard/runs/:id — returns run record (happy path)
 *   2. GET /api/v1/dashboard/runs/:id — returns 404 for unknown id
 *   3. PATCH /api/v1/dashboard/runs/:id/status — updates status (happy path)
 *   4. PATCH /api/v1/dashboard/runs/:id/status — 404 for unknown run
 *   5. PATCH /api/v1/dashboard/runs/:id/status — 400 for invalid status
 *
 *  Tests listing:
 *   6. GET /api/v1/dashboard/runs/:runId/tests — returns empty array for new run
 *   7. GET /api/v1/dashboard/runs/:runId/tests — returns tests after ingestion
 *   8. GET /api/v1/dashboard/runs/:runId/tests — 404 for unknown run
 *
 *  Analytics:
 *   9. GET /api/v1/dashboard/analytics/summary — empty repo → totalRuns 0, passRate 0, avgDurationMs null
 *  10. GET /api/v1/dashboard/analytics/summary — correct pass rate from completed runs
 *  11. GET /api/v1/dashboard/analytics/summary — correct avgDurationMs
 *  12. GET /api/v1/dashboard/analytics/summary — running runs not counted in passRate
 *
 *  Quarantine:
 *  13. GET /api/v1/dashboard/quarantine — empty list initially
 *  14. POST /api/v1/dashboard/quarantine — adds entry, returns 201 with id
 *  15. GET /api/v1/dashboard/quarantine — lists added entry
 *  16. POST /api/v1/dashboard/quarantine — 400 when testTitle missing
 *  17. POST /api/v1/dashboard/quarantine — 400 when testFile missing
 *  18. DELETE /api/v1/dashboard/quarantine/:id — removes entry
 *  19. DELETE /api/v1/dashboard/quarantine/:id — 404 for unknown id
 *
 *  Quality Gates:
 *  20. GET /api/v1/dashboard/quality-gates — empty list initially
 *  21. POST /api/v1/dashboard/quality-gates — creates gate, returns 201 with id
 *  22. GET /api/v1/dashboard/quality-gates — lists created gate
 *  23. GET /api/v1/dashboard/quality-gates/:id — returns single gate
 *  24. GET /api/v1/dashboard/quality-gates/:id — 404 for unknown id
 *  25. POST /api/v1/dashboard/quality-gates — 400 when name missing
 *  26. POST /api/v1/dashboard/quality-gates — 400 when passRateThreshold invalid
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { InMemoryRunRepository } from '../../repositories/in-memory-run-repository.js';
import { createDashboardRunsRoutes } from './runs.js';
import { createDashboardTestsRoutes } from './tests.js';
import { createDashboardAnalyticsRoutes } from './analytics.js';
import { createDashboardQuarantineRoutes, InMemoryQuarantineStore } from './quarantine.js';
import { createDashboardQualityGatesRoutes, InMemoryQualityGateStore } from './quality-gates.js';
import type { RunRecord, TestRecord } from '../../repositories/run-repository.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function buildDashboardApp(repo: InMemoryRunRepository): Hono {
  const app = new Hono();
  const quarantineStore = new InMemoryQuarantineStore();
  const qualityGateStore = new InMemoryQualityGateStore();
  app.route('/', createDashboardRunsRoutes({ repository: repo }));
  app.route('/', createDashboardTestsRoutes({ repository: repo }));
  app.route('/', createDashboardAnalyticsRoutes({ repository: repo }));
  app.route('/', createDashboardQuarantineRoutes({ store: quarantineStore }));
  app.route('/', createDashboardQualityGatesRoutes({ store: qualityGateStore }));
  return app;
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-001',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    total: 10,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: null,
    branch: 'main',
    commitSha: 'abc1234',
    triggeredBy: 'ci',
    ...overrides,
  };
}

function makeTest(overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id: 'test-001',
    runId: 'run-001',
    title: 'login test',
    file: 'e2e/login.spec.ts',
    status: 'passed',
    durationMs: 500,
    ...overrides,
  };
}

async function jsonBody(res: Response): Promise<unknown> {
  return res.json();
}

async function post(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patch(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(app: Hono, path: string): Promise<Response> {
  return app.request(path, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Runs detail routes
// ---------------------------------------------------------------------------

describe('GET /api/v1/dashboard/runs/:id', () => {
  it('returns run record when found', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    const run = makeRun({ id: 'run-detail-001', status: 'passed', passed: 5, total: 5 });
    await repo.upsertRun(run);

    const res = await app.request('/api/v1/dashboard/runs/run-detail-001');
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['id']).toBe('run-detail-001');
    expect(body['status']).toBe('passed');
    expect(body['passed']).toBe(5);
    expect(body['total']).toBe(5);
    expect(body['branch']).toBe('main');
    expect(body['commitSha']).toBe('abc1234');
  });

  it('returns 404 for unknown run id', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await app.request('/api/v1/dashboard/runs/does-not-exist');
    expect(res.status).toBe(404);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });
});

describe('PATCH /api/v1/dashboard/runs/:id/status', () => {
  it('updates status and returns updated run', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    await repo.upsertRun(makeRun({ id: 'run-patch-001', status: 'running' }));

    const res = await patch(app, '/api/v1/dashboard/runs/run-patch-001/status', {
      status: 'passed',
    });
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['id']).toBe('run-patch-001');
    expect(body['status']).toBe('passed');

    // Verify the repository was actually updated
    const stored = await repo.getRun('run-patch-001');
    expect(stored?.status).toBe('passed');
  });

  it('returns 404 when run does not exist', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await patch(app, '/api/v1/dashboard/runs/missing-run/status', {
      status: 'failed',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status value', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    await repo.upsertRun(makeRun({ id: 'run-patch-bad-001' }));

    const res = await patch(app, '/api/v1/dashboard/runs/run-patch-bad-001/status', {
      status: 'banana',
    });
    expect(res.status).toBe(400);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('returns 400 when status field is missing', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    await repo.upsertRun(makeRun({ id: 'run-patch-nostatus' }));

    const res = await patch(app, '/api/v1/dashboard/runs/run-patch-nostatus/status', {});
    expect(res.status).toBe(400);
  });

  it('allows all valid status transitions', async () => {
    const statuses = ['running', 'passed', 'failed', 'interrupted'] as const;
    for (const status of statuses) {
      const repo = new InMemoryRunRepository();
      const app = buildDashboardApp(repo);
      const id = `run-valid-${status}`;
      await repo.upsertRun(makeRun({ id }));

      const res = await patch(app, `/api/v1/dashboard/runs/${id}/status`, { status });
      expect(res.status).toBe(200);
      const body = (await jsonBody(res)) as Record<string, unknown>;
      expect(body['status']).toBe(status);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests listing routes
// ---------------------------------------------------------------------------

describe('GET /api/v1/dashboard/runs/:runId/tests', () => {
  it('returns empty array when run has no tests', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    await repo.upsertRun(makeRun({ id: 'run-tests-empty' }));

    const res = await app.request('/api/v1/dashboard/runs/run-tests-empty/tests');
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as unknown[];
    expect(body).toEqual([]);
  });

  it('returns tests for a run after ingestion', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    await repo.upsertRun(makeRun({ id: 'run-with-tests' }));
    await repo.upsertTest(
      makeTest({ id: 't-1', runId: 'run-with-tests', title: 'login', status: 'passed' }),
    );
    await repo.upsertTest(
      makeTest({ id: 't-2', runId: 'run-with-tests', title: 'signup', status: 'failed' }),
    );

    const res = await app.request('/api/v1/dashboard/runs/run-with-tests/tests');
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    const titles = body.map((t) => t['title']);
    expect(titles).toContain('login');
    expect(titles).toContain('signup');
  });

  it('only returns tests belonging to the requested run', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    await repo.upsertRun(makeRun({ id: 'run-a' }));
    await repo.upsertRun(makeRun({ id: 'run-b' }));
    await repo.upsertTest(makeTest({ id: 'ta', runId: 'run-a', title: 'test-a' }));
    await repo.upsertTest(makeTest({ id: 'tb', runId: 'run-b', title: 'test-b' }));

    const res = await app.request('/api/v1/dashboard/runs/run-a/tests');
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]?.['title']).toBe('test-a');
  });

  it('returns 404 when run does not exist', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await app.request('/api/v1/dashboard/runs/ghost-run/tests');
    expect(res.status).toBe(404);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('returns test record with all expected fields', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    await repo.upsertRun(makeRun({ id: 'run-fields' }));
    await repo.upsertTest({
      id: 'tf-1',
      runId: 'run-fields',
      title: 'checkout flow',
      file: 'e2e/checkout.spec.ts',
      status: 'passed',
      durationMs: 1234,
    });

    const res = await app.request('/api/v1/dashboard/runs/run-fields/tests');
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    const test = body[0];

    expect(test).toBeDefined();
    expect(test?.['id']).toBe('tf-1');
    expect(test?.['runId']).toBe('run-fields');
    expect(test?.['title']).toBe('checkout flow');
    expect(test?.['file']).toBe('e2e/checkout.spec.ts');
    expect(test?.['status']).toBe('passed');
    expect(test?.['durationMs']).toBe(1234);
  });
});

describe('GET /api/v1/dashboard/tests', () => {
  it('returns aggregated tests across all runs', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    await repo.upsertRun(makeRun({ id: 'agg-run-1' }));
    await repo.upsertRun(makeRun({ id: 'agg-run-2' }));
    await repo.upsertTest(makeTest({ id: 'agg-test-1', runId: 'agg-run-1', title: 'A' }));
    await repo.upsertTest(makeTest({ id: 'agg-test-2', runId: 'agg-run-2', title: 'B' }));

    const res = await app.request('/api/v1/dashboard/tests');
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    const titles = body.map((row) => row['title']);
    expect(titles).toContain('A');
    expect(titles).toContain('B');
  });
});

describe('GET /api/v1/dashboard/suites', () => {
  it('returns derived suite summaries grouped by test file', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    await repo.upsertRun(makeRun({ id: 'suite-run-1', startedAt: '2026-01-01T00:00:00.000Z' }));
    await repo.upsertRun(makeRun({ id: 'suite-run-2', startedAt: '2026-01-02T00:00:00.000Z' }));
    await repo.upsertTest(
      makeTest({ id: 's1', runId: 'suite-run-1', file: 'e2e/auth.spec.ts', status: 'passed' }),
    );
    await repo.upsertTest(
      makeTest({ id: 's2', runId: 'suite-run-2', file: 'e2e/auth.spec.ts', status: 'failed' }),
    );

    const res = await app.request('/api/v1/dashboard/suites');
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]?.['id']).toBe('e2e/auth.spec.ts');
    expect(body[0]?.['name']).toBe('auth.spec.ts');
    expect(body[0]?.['totalRuns']).toBe(2);
    expect(body[0]?.['passRate']).toBe(50);
    expect(body[0]?.['lastRunAt']).toBe('2026-01-02T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Analytics summary
// ---------------------------------------------------------------------------

describe('GET /api/v1/dashboard/analytics/summary', () => {
  it('returns zero values when repository is empty', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await app.request('/api/v1/dashboard/analytics/summary');
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['totalRuns']).toBe(0);
    expect(body['passRate']).toBe(0);
    expect(body['avgDurationMs']).toBeNull();
  });

  it('counts total runs correctly', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    await repo.upsertRun(makeRun({ id: 'r1' }));
    await repo.upsertRun(makeRun({ id: 'r2' }));
    await repo.upsertRun(makeRun({ id: 'r3' }));

    const res = await app.request('/api/v1/dashboard/analytics/summary');
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['totalRuns']).toBe(3);
  });

  it('computes correct pass rate for completed runs', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    // 3 passed, 1 failed → 75%
    await repo.upsertRun(makeRun({ id: 'r1', status: 'passed' }));
    await repo.upsertRun(makeRun({ id: 'r2', status: 'passed' }));
    await repo.upsertRun(makeRun({ id: 'r3', status: 'passed' }));
    await repo.upsertRun(makeRun({ id: 'r4', status: 'failed' }));

    const res = await app.request('/api/v1/dashboard/analytics/summary');
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['passRate']).toBe(75);
  });

  it('excludes running runs from pass rate calculation', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    // 1 passed, 1 running → passRate = 100 (only completed count)
    await repo.upsertRun(makeRun({ id: 'r1', status: 'passed' }));
    await repo.upsertRun(makeRun({ id: 'r2', status: 'running' }));

    const res = await app.request('/api/v1/dashboard/analytics/summary');
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['passRate']).toBe(100);
    expect(body['totalRuns']).toBe(2);
  });

  it('computes average duration correctly', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    await repo.upsertRun(
      makeRun({
        id: 'r1',
        durationMs: 1000,
        status: 'passed',
        finishedAt: new Date().toISOString(),
      }),
    );
    await repo.upsertRun(
      makeRun({
        id: 'r2',
        durationMs: 3000,
        status: 'passed',
        finishedAt: new Date().toISOString(),
      }),
    );

    const res = await app.request('/api/v1/dashboard/analytics/summary');
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['avgDurationMs']).toBe(2000);
  });

  it('ignores runs with null duration from avg calculation', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    await repo.upsertRun(
      makeRun({
        id: 'r1',
        durationMs: 4000,
        status: 'passed',
        finishedAt: new Date().toISOString(),
      }),
    );
    await repo.upsertRun(makeRun({ id: 'r2', durationMs: null, status: 'running' }));

    const res = await app.request('/api/v1/dashboard/analytics/summary');
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['avgDurationMs']).toBe(4000);
  });

  it('returns passRate 0 when all completed runs failed', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);
    await repo.upsertRun(makeRun({ id: 'r1', status: 'failed' }));
    await repo.upsertRun(makeRun({ id: 'r2', status: 'failed' }));

    const res = await app.request('/api/v1/dashboard/analytics/summary');
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['passRate']).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Quarantine routes
// ---------------------------------------------------------------------------

describe('Quarantine routes', () => {
  it('GET /api/v1/dashboard/quarantine — returns empty list initially', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await app.request('/api/v1/dashboard/quarantine');
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as unknown[];
    expect(body).toEqual([]);
  });

  it('POST /api/v1/dashboard/quarantine — adds entry with 201', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await post(app, '/api/v1/dashboard/quarantine', {
      testTitle: 'Flaky login test',
      testFile: 'e2e/login.spec.ts',
      reason: 'network timeout',
    });
    expect(res.status).toBe(201);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['id']).toBe('string');
    expect(body['testTitle']).toBe('Flaky login test');
    expect(body['testFile']).toBe('e2e/login.spec.ts');
    expect(body['reason']).toBe('network timeout');
    expect(typeof body['quarantinedAt']).toBe('string');
  });

  it('GET /api/v1/dashboard/quarantine — lists added entries', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    await post(app, '/api/v1/dashboard/quarantine', {
      testTitle: 'Test A',
      testFile: 'e2e/a.spec.ts',
    });
    await post(app, '/api/v1/dashboard/quarantine', {
      testTitle: 'Test B',
      testFile: 'e2e/b.spec.ts',
    });

    const res = await app.request('/api/v1/dashboard/quarantine');
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    const titles = body.map((e) => e['testTitle']);
    expect(titles).toContain('Test A');
    expect(titles).toContain('Test B');
  });

  it('POST /api/v1/dashboard/quarantine — reason defaults to null when omitted', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await post(app, '/api/v1/dashboard/quarantine', {
      testTitle: 'No reason test',
      testFile: 'e2e/x.spec.ts',
    });
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['reason']).toBeNull();
  });

  it('POST /api/v1/dashboard/quarantine — 400 when testTitle missing', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await post(app, '/api/v1/dashboard/quarantine', {
      testFile: 'e2e/x.spec.ts',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/v1/dashboard/quarantine — 400 when testFile missing', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await post(app, '/api/v1/dashboard/quarantine', {
      testTitle: 'Some test',
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/v1/dashboard/quarantine/:id — removes entry', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const addRes = await post(app, '/api/v1/dashboard/quarantine', {
      testTitle: 'To be removed',
      testFile: 'e2e/x.spec.ts',
    });
    const { id } = (await jsonBody(addRes)) as { id: string };

    const delRes = await del(app, `/api/v1/dashboard/quarantine/${id}`);
    expect(delRes.status).toBe(200);
    const delBody = (await jsonBody(delRes)) as Record<string, unknown>;
    expect(delBody['removed']).toBe(true);

    // Verify it is gone
    const listRes = await app.request('/api/v1/dashboard/quarantine');
    const list = (await jsonBody(listRes)) as unknown[];
    expect(list).toHaveLength(0);
  });

  it('DELETE /api/v1/dashboard/quarantine/:id — 404 for unknown id', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await del(app, '/api/v1/dashboard/quarantine/does-not-exist');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Quality gates routes
// ---------------------------------------------------------------------------

describe('Quality gates routes', () => {
  it('GET /api/v1/dashboard/quality-gates — returns empty list initially', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await app.request('/api/v1/dashboard/quality-gates');
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as unknown[];
    expect(body).toEqual([]);
  });

  it('POST /api/v1/dashboard/quality-gates — creates gate with 201', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await post(app, '/api/v1/dashboard/quality-gates', {
      name: 'Main branch gate',
      passRateThreshold: 90,
    });
    expect(res.status).toBe(201);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['id']).toBe('string');
    expect(body['name']).toBe('Main branch gate');
    expect(body['passRateThreshold']).toBe(90);
    expect(typeof body['createdAt']).toBe('string');
  });

  it('GET /api/v1/dashboard/quality-gates — lists created gates', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    await post(app, '/api/v1/dashboard/quality-gates', { name: 'Gate A', passRateThreshold: 80 });
    await post(app, '/api/v1/dashboard/quality-gates', { name: 'Gate B', passRateThreshold: 100 });

    const res = await app.request('/api/v1/dashboard/quality-gates');
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    const names = body.map((g) => g['name']);
    expect(names).toContain('Gate A');
    expect(names).toContain('Gate B');
  });

  it('GET /api/v1/dashboard/quality-gates/:id — returns single gate', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const createRes = await post(app, '/api/v1/dashboard/quality-gates', {
      name: 'Single gate',
      passRateThreshold: 75,
    });
    const { id } = (await jsonBody(createRes)) as { id: string };

    const res = await app.request(`/api/v1/dashboard/quality-gates/${id}`);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['id']).toBe(id);
    expect(body['name']).toBe('Single gate');
    expect(body['passRateThreshold']).toBe(75);
  });

  it('GET /api/v1/dashboard/quality-gates/:id — 404 for unknown id', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await app.request('/api/v1/dashboard/quality-gates/no-such-gate');
    expect(res.status).toBe(404);
  });

  it('POST /api/v1/dashboard/quality-gates — 400 when name missing', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await post(app, '/api/v1/dashboard/quality-gates', {
      passRateThreshold: 90,
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/v1/dashboard/quality-gates — 400 when passRateThreshold missing', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res = await post(app, '/api/v1/dashboard/quality-gates', {
      name: 'Missing threshold',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/v1/dashboard/quality-gates — 400 when passRateThreshold out of range', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const resNeg = await post(app, '/api/v1/dashboard/quality-gates', {
      name: 'Bad gate',
      passRateThreshold: -1,
    });
    expect(resNeg.status).toBe(400);

    const resOver = await post(app, '/api/v1/dashboard/quality-gates', {
      name: 'Bad gate',
      passRateThreshold: 101,
    });
    expect(resOver.status).toBe(400);
  });

  it('POST /api/v1/dashboard/quality-gates — accepts boundary values 0 and 100', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildDashboardApp(repo);

    const res0 = await post(app, '/api/v1/dashboard/quality-gates', {
      name: 'Zero gate',
      passRateThreshold: 0,
    });
    expect(res0.status).toBe(201);

    const res100 = await post(app, '/api/v1/dashboard/quality-gates', {
      name: 'Hundred gate',
      passRateThreshold: 100,
    });
    expect(res100.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// QuarantineStore restart-survival contract
// ---------------------------------------------------------------------------

describe('QuarantineStore restart-survival contract', () => {
  it('added entry is retrievable from same store instance (in-memory contract)', async () => {
    const store = new InMemoryQuarantineStore();
    await store.add({
      testTitle: 'flaky checkout',
      testFile: 'e2e/checkout.spec.ts',
      reason: 'Flaky CI',
    });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.testTitle).toBe('flaky checkout');
    expect(list[0]?.testFile).toBe('e2e/checkout.spec.ts');
  });

  it('entry survives remove-and-re-add cycle', async () => {
    const store = new InMemoryQuarantineStore();
    const entry = await store.add({ testTitle: 'test-a', testFile: 'e2e/a.spec.ts', reason: null });
    await store.remove(entry.id);
    expect(await store.list()).toHaveLength(0);
    await store.add({ testTitle: 'test-b', testFile: 'e2e/b.spec.ts', reason: null });
    expect(await store.list()).toHaveLength(1);
  });
});
