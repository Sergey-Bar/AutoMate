import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/create-test-app.js';
import * as fixtures from '../../../test/fixtures.js';
import * as schema from '../../../db/schema.js';

const { mockAnalyzeImpact, mockComputeStabilityGrade } = vi.hoisted(() => ({
  mockAnalyzeImpact: vi.fn<(changedFiles: string[]) => Promise<Array<{ stableId: string }>>>(),
  mockComputeStabilityGrade: vi.fn<(stableId: string, lookback?: number) => Promise<{ grade: string; passRate: number; totalRuns: number }>>(),
}));

let testApp: TestApp;

vi.mock('../../../db/client.js', () => ({
  get db() { return testApp.db; },
  get sqlite() { return testApp.sqlite; },
  get poolConnection() {
    return {
      query: async (sql: string, params: any[] = []) => {
        const sqliteSql = sql.replace(/\$(\d+)/g, '?');
        const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
        const stmt = testApp.sqlite.prepare(sqliteSql);
        if (isSelect) return { rows: stmt.all(params) };
        const info = stmt.run(params);
        return { rows: [], rowCount: info.changes };
      }
    };
  },
  isPostgres: false,
}));

vi.mock('../../../services/impact-analysis.js', () => ({ analyzeImpact: mockAnalyzeImpact }));
vi.mock('../../../services/stability-grades.js', () => ({ computeStabilityGrade: mockComputeStabilityGrade }));

describe('tests routes integration', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { testsRoutes } = await import('../../tests.js');
    await testsRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM results; DELETE FROM tests; DELETE FROM runs;');
    vi.clearAllMocks();
    mockAnalyzeImpact.mockResolvedValue([]);
    mockComputeStabilityGrade.mockResolvedValue({ grade: 'A', passRate: 95, totalRuns: 20 });
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/runs/:runId/tests returns empty array for empty state', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'run-empty' })).run();
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-empty/tests' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/runs/:runId/tests returns only tests inside selected run', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'run-a' }),
      fixtures.run({ id: 'run-b' }),
    ]).run();
    testApp.db.insert(schema.tests).values([
      fixtures.test('run-a', { id: 'a-1', status: 'passed' }),
      fixtures.test('run-a', { id: 'a-2', status: 'failed' }),
      fixtures.test('run-b', { id: 'b-1', status: 'passed' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-a/tests' });
    const body = res.json() as Array<{ id: string; runId: string }>;
    expect(res.statusCode).toBe(200);
    expect(body).toHaveLength(2);
    expect(body.map((t) => t.id).sort()).toEqual(['a-1', 'a-2']);
    expect(body.every((t) => t.runId === 'run-a')).toBe(true);
  });

  it('GET /api/runs/:runId/tests/:testId returns test with all retries', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'run-retries' })).run();
    testApp.db.insert(schema.tests).values(fixtures.test('run-retries', {
      id: 't-retry',
      title: 'retries test',
      status: 'failed',
      retryCount: 2,
    })).run();
    testApp.db.insert(schema.results).values([
      fixtures.result('t-retry', 'run-retries', { id: 'rr-0', retry: 0, status: 'failed' }),
      fixtures.result('t-retry', 'run-retries', { id: 'rr-1', retry: 1, status: 'failed' }),
      fixtures.result('t-retry', 'run-retries', { id: 'rr-2', retry: 2, status: 'passed' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-retries/tests/t-retry' });
    const body = res.json() as { id: string; results: Array<{ id: string; retry: number }> };
    expect(res.statusCode).toBe(200);
    expect(body.id).toBe('t-retry');
    expect(body.results.map((r) => r.id).sort()).toEqual(['rr-0', 'rr-1', 'rr-2']);
  });

  it('GET /api/runs/:runId/tests/:testId returns 404 for non-existent test', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'run-missing' })).run();
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-missing/tests/no-test' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Test not found' });
  });

  it('DELETE workflow: deleting run removes tests and subsequent query is empty', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'run-delete' })).run();
    testApp.db.insert(schema.tests).values(fixtures.test('run-delete', { id: 'del-1' })).run();

    const before = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-delete/tests' });
    expect((before.json() as unknown[])).toHaveLength(1);

    testApp.poolConnection.exec("DELETE FROM runs WHERE id = 'run-delete';");

    const after = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-delete/tests' });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual([]);
  });

  it('GET /api/tests/history/:stableId returns newest-first cross-run history', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'h-1', startedAt: '2026-01-01T10:00:00.000Z', branch: 'main', commitSha: 'sha-1' }),
      fixtures.run({ id: 'h-2', startedAt: '2026-01-02T10:00:00.000Z', branch: 'main', commitSha: 'sha-2' }),
      fixtures.run({ id: 'h-3', startedAt: '2026-01-03T10:00:00.000Z', branch: 'release', commitSha: 'sha-3' }),
    ]).run();
    testApp.db.insert(schema.tests).values([
      fixtures.test('h-1', { id: 'ht-1', stableId: 'sid-hist', status: 'passed' }),
      fixtures.test('h-2', { id: 'ht-2', stableId: 'sid-hist', status: 'failed' }),
      fixtures.test('h-3', { id: 'ht-3', stableId: 'sid-hist', status: 'flaky' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/tests/history/sid-hist' });
    const body = res.json() as Array<{ runId: string; runBranch: string | null; runCommitSha: string | null }>;
    expect(res.statusCode).toBe(200);
    expect(body.map((r) => r.runId)).toEqual(['h-3', 'h-2', 'h-1']);
    expect(body[0]).toMatchObject({ runBranch: 'release', runCommitSha: 'sha-3' });
  });

  it('GET /api/tests/history/:stableId respects explicit limit', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'hl-1', startedAt: '2026-02-01T00:00:00.000Z' }),
      fixtures.run({ id: 'hl-2', startedAt: '2026-02-02T00:00:00.000Z' }),
      fixtures.run({ id: 'hl-3', startedAt: '2026-02-03T00:00:00.000Z' }),
    ]).run();
    testApp.db.insert(schema.tests).values([
      fixtures.test('hl-1', { id: 'hlt-1', stableId: 'sid-limit' }),
      fixtures.test('hl-2', { id: 'hlt-2', stableId: 'sid-limit' }),
      fixtures.test('hl-3', { id: 'hlt-3', stableId: 'sid-limit' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/tests/history/sid-limit?limit=2' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[])).toHaveLength(2);
  });

  it('POST /api/tests/history/batch returns grouped statuses (max 7 per stableId)', async () => {
    const runRows = Array.from({ length: 9 }, (_, i) =>
      fixtures.run({
        id: `bh-run-${i}`,
        startedAt: `2026-03-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    testApp.db.insert(schema.runs).values(runRows).run();
    testApp.db.insert(schema.tests).values(
      runRows.map((r, i) =>
        fixtures.test(r.id, {
          id: `bh-test-${i}`,
          stableId: 'sid-batch',
          status: i % 2 === 0 ? 'passed' : 'failed',
        }),
      ),
    ).run();

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tests/history/batch',
      payload: { stableIds: ['sid-batch'] },
    });
    const body = res.json() as Record<string, Array<{ status: string }>>;
    expect(res.statusCode).toBe(200);
    expect(body['sid-batch']).toHaveLength(7);
  });

  it('POST /api/tests/history/batch returns 400 for invalid request', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tests/history/batch',
      payload: { ids: ['sid-a'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid request body');
  });
});
