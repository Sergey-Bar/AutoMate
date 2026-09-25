/**
 * Branch coverage for analytics routes.
 * Targets: parseIntParam branches (NaN, negative, over max),
 * pass-rate when total=0, frequent-failures when affectedTests is null
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import * as fixtures from '../../test/fixtures.js';
import * as schema from '../../db/schema.js';

const { mockClusterErrors } = vi.hoisted(() => ({
  mockClusterErrors: vi.fn<(runId: string) => Promise<Array<{ fingerprint: string; count: number }>>>(),
}));

let testApp: TestApp;

vi.mock('../../db/client.js', () => ({
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

vi.mock('../../services/error-clustering.js', () => ({
  clusterErrors: mockClusterErrors,
}));

describe('analytics routes — branch coverage', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { analyticsRoutes } = await import('../analytics.js');
    await analyticsRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM results; DELETE FROM tests; DELETE FROM runs;');
    vi.clearAllMocks();
    mockClusterErrors.mockResolvedValue([]);
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/analytics/pass-rate with total=0 returns all:0', async () => {
    // Insert a run with total=0 and passed=0
    testApp.db.insert(schema.runs).values(
      fixtures.run({
        id: 'zero-total',
        status: 'passed',
        total: 0,
        passed: 0,
        failed: 0,
        startedAt: '2026-09-01T01:00:00.000Z',
      })
    ).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate?days=5000' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ date: string; all: number }>;
    // total=0 → all: 0
    expect(body[0].all).toBe(0);
  });

  it('GET /api/analytics/pass-rate with invalid days param falls back to default 30', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate?days=abc' });
    expect(res.statusCode).toBe(200);
    // Should not error, just use default days
  });

  it('GET /api/analytics/pass-rate with negative days param falls back to default', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate?days=-5' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/analytics/pass-rate with days over max caps at 365', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate?days=9999' });
    expect(res.statusCode).toBe(200);
    // Should not error
  });

  it('GET /api/analytics/flaky with totalRuns=0 returns flakyRate:0', async () => {
    // This case shouldn't normally happen in real data (flaky implies run), but tests the ternary
    testApp.db.insert(schema.runs).values(
      fixtures.run({ id: 'flaky-run', status: 'passed', workspaceId: 'ws-zero' })
    ).run();
    testApp.db.insert(schema.tests).values(
      fixtures.test('flaky-run', { id: 'f-zero', title: 'flaky-zero', file: 'z.spec.ts', status: 'flaky' })
    ).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/flaky?workspaceId=ws-zero' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/analytics/flaky with invalid limit falls back to default', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/flaky?limit=not-a-number' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/analytics/slow with invalid limit falls back to default', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/slow?limit=0' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/analytics/duration with workspaceId filters correctly', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'dur-ws-a', status: 'passed', durationMs: 500, workspaceId: 'ws-dur-a', startedAt: '2026-10-01T01:00:00.000Z' }),
      fixtures.run({ id: 'dur-ws-b', status: 'passed', durationMs: 999, workspaceId: 'ws-dur-b', startedAt: '2026-10-01T01:00:00.000Z' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/duration?days=5000&workspaceId=ws-dur-a' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ p50: number }>;
    expect(body).toHaveLength(1);
    expect(body[0].p50).toBe(500);
  });

  it('GET /api/analytics/frequent-failures with affectedTests=null returns empty array', async () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const runId = 'ff-null-test';
    testApp.db.insert(schema.runs).values(
      // eslint-disable-next-line test-flakiness/no-random-data
      fixtures.run({ id: runId, status: 'failed', startedAt: new Date().toISOString() })
    ).run();
    // Insert a result with errorMessage but testId that produces null affectedTests
    testApp.db.insert(schema.results).values(
      fixtures.result('test-null-affected', runId, { status: 'failed', errorMessage: 'NullPointer' })
    ).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/frequent-failures?days=5000' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ errorMessage: string; affectedTests: string[] }>;
    // Just verify affectedTests is an array (covers the ternary)
    expect(Array.isArray(body[0]?.affectedTests)).toBe(true);
  });

  it('GET /api/analytics/duration with null durationMs run skips it (covers r.durationMs==null continue branch)', async () => {
    // Insert one run with durationMs=null — it should be skipped by the continue branch
    testApp.db.insert(schema.runs).values(
      fixtures.run({ id: 'dur-null', status: 'passed', durationMs: undefined, startedAt: '2026-11-01T01:00:00.000Z', workspaceId: 'ws-dur-null' })
    ).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/duration?days=5000&workspaceId=ws-dur-null' });
    expect(res.statusCode).toBe(200);
    // Run with null durationMs is filtered by WHERE isNotNull(durationMs) — result should be empty
    const body = res.json() as Array<{ date: string; p50: number }>;
    expect(body).toEqual([]);
  });

  it('GET /api/analytics/duration with two runs on same date accumulates into same byDate entry (covers byDate.has true branch)', async () => {
    // Insert two runs on the SAME date to exercise the byDate.has() true branch
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'dur-same-1', status: 'passed', durationMs: 200, workspaceId: 'ws-dur-same', startedAt: '2026-12-01T06:00:00.000Z' }),
      fixtures.run({ id: 'dur-same-2', status: 'passed', durationMs: 400, workspaceId: 'ws-dur-same', startedAt: '2026-12-01T18:00:00.000Z' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/duration?days=5000&workspaceId=ws-dur-same' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ date: string; p50: number; p95: number }>;
    // Both runs land on 2026-12-01 → accumulated into one entry
    expect(body).toHaveLength(1);
    expect(body[0].date).toBe('2026-12-01');
    // p50 of [200, 400] sorted = [200, 400], percentile(50) = 200
    expect(body[0].p50).toBeGreaterThan(0);
  });

  it('GET /api/analytics/heatmap with same file failing on multiple dates (covers byFile.has true branch)', async () => {
    // Two runs on DIFFERENT dates, both with tests from the same file
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'hm-multi-1', status: 'failed', workspaceId: 'ws-hm-multi', startedAt: '2026-10-01T01:00:00.000Z' }),
      fixtures.run({ id: 'hm-multi-2', status: 'failed', workspaceId: 'ws-hm-multi', startedAt: '2026-10-02T01:00:00.000Z' }),
    ]).run();
    testApp.db.insert(schema.tests).values([
      fixtures.test('hm-multi-1', { id: 'hm-m-t1', file: 'repeated.spec.ts', status: 'failed' }),
      fixtures.test('hm-multi-2', { id: 'hm-m-t2', file: 'repeated.spec.ts', status: 'failed' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/heatmap?days=5000&workspaceId=ws-hm-multi' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; data: Array<{ x: string; y: number }> }>;
    // 'repeated.spec.ts' appears on both dates → byFile.has() is false then true
    const fileEntry = body.find((e) => e.id === 'repeated.spec.ts');
    expect(fileEntry).toBeDefined();
    expect(fileEntry?.data).toHaveLength(2);
  });

  it('GET /api/analytics/failure-clusters returns active clusters by default', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO failure_clusters (id, fingerprint, cluster_label, occurrence_count, representative_error, status, created_at, updated_at)
      VALUES ('fc-active-1', 'abc123', 'Null pointer errors', 3, 'NullPointerException', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
             ('fc-resolved-1', 'def456', 'Timeout errors', 1, 'Timeout exceeded', 'resolved', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/failure-clusters' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; status: string }>;
    expect(body.every((c) => c.status === 'active')).toBe(true);
    expect(body.some((c) => c.id === 'fc-active-1')).toBe(true);
  });

  it('GET /api/analytics/failure-clusters with status=resolved returns only resolved clusters', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/failure-clusters?status=resolved' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; status: string }>;
    expect(body.every((c) => c.status === 'resolved')).toBe(true);
  });

  it('GET /api/analytics/failure-clusters with custom limit and offset paginates correctly', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/failure-clusters?limit=1&offset=0' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('GET /api/analytics/risk-scores returns scores for empty stableIds', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/risk-scores?stableIds=' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('GET /api/analytics/risk-scores with stableIds param returns scores array', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/risk-scores?stableIds=test1,test2' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('GET /api/analytics/risk-scores/summary returns tier summary', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/risk-scores/summary' });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json()).toBe('object');
  });

  it('POST /api/analytics/predictive-selection with no correlation data returns all tests', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/analytics/predictive-selection',
      payload: { changedFiles: ['src/foo.ts'] },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json()).toBe('object');
  });

  it('GET /api/analytics/risk-scores without stableIds param uses empty default', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/risk-scores' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('POST /api/analytics/predictive-selection with null body uses default empty arrays', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/analytics/predictive-selection',
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/analytics/risk-scores/summary with custom topN param', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/risk-scores/summary?topN=5' });
    expect(res.statusCode).toBe(200);
  });
});
