import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/create-test-app.js';
import * as fixtures from '../../../test/fixtures.js';
import * as schema from '../../../db/schema.js';

const { mockClusterErrors } = vi.hoisted(() => ({
  mockClusterErrors: vi.fn<(runId: string) => Promise<Array<{ fingerprint: string; count: number }>>>(),
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

vi.mock('../../../services/error-clustering.js', () => ({ clusterErrors: mockClusterErrors }));

describe('analytics integration routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { analyticsRoutes } = await import('../../analytics.js');
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

  it('GET /api/analytics/pass-rate returns empty array with no runs', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/analytics/pass-rate aggregates by day and excludes running runs', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'pr-1', status: 'passed', total: 10, passed: 8, startedAt: '2026-05-01T10:00:00.000Z' }),
      fixtures.run({ id: 'pr-2', status: 'failed', total: 10, passed: 6, startedAt: '2026-05-01T12:00:00.000Z' }),
      fixtures.run({ id: 'pr-running', status: 'running', total: 10, passed: 10, startedAt: '2026-05-01T14:00:00.000Z' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate?days=5000' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ date: '2026-05-01', all: 70 }]);
  });

  it('GET /api/analytics/pass-rate filters by workspaceId', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'ws-1a', status: 'passed', total: 10, passed: 9, workspaceId: 'ws-1', startedAt: '2026-05-03T10:00:00.000Z' }),
      fixtures.run({ id: 'ws-2a', status: 'passed', total: 10, passed: 1, workspaceId: 'ws-2', startedAt: '2026-05-03T11:00:00.000Z' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate?days=5000&workspaceId=ws-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ date: '2026-05-03', all: 90 }]);
  });

  it('GET /api/analytics/duration returns p50 and p95 per day', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'dur-1', status: 'passed', durationMs: 100, startedAt: '2026-07-01T01:00:00.000Z' }),
      fixtures.run({ id: 'dur-2', status: 'passed', durationMs: 200, startedAt: '2026-07-01T02:00:00.000Z' }),
      fixtures.run({ id: 'dur-3', status: 'passed', durationMs: 400, startedAt: '2026-07-01T03:00:00.000Z' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/duration?days=5000' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ date: '2026-07-01', p50: 200, p95: 400 }]);
  });

  it('GET /api/analytics/flaky returns top flaky tests', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'fl-1', workspaceId: 'ws-fl' }),
      fixtures.run({ id: 'fl-2', workspaceId: 'ws-fl' }),
    ]).run();
    testApp.db.insert(schema.tests).values([
      fixtures.test('fl-1', { id: 'fa-1', title: 'alpha', file: 'a.spec.ts', status: 'flaky' }),
      fixtures.test('fl-2', { id: 'fa-2', title: 'alpha', file: 'a.spec.ts', status: 'flaky' }),
      fixtures.test('fl-1', { id: 'fb-1', title: 'beta', file: 'b.spec.ts', status: 'flaky' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/flaky?workspaceId=ws-fl&limit=1' });
    const body = res.json() as Array<{ title: string; flakyCount: number; totalRuns: number; flakyRate: number }>;
    expect(res.statusCode).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ title: 'alpha', flakyCount: 2, totalRuns: 2, flakyRate: 100 });
  });

  it('GET /api/analytics/slow returns ranked slow tests', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 's-1' }),
      fixtures.run({ id: 's-2' }),
    ]).run();
    testApp.db.insert(schema.tests).values([
      fixtures.test('s-1', { id: 'sa-1', title: 'slow-a', file: 'a.spec.ts', durationMs: 1000 }),
      fixtures.test('s-2', { id: 'sa-2', title: 'slow-a', file: 'a.spec.ts', durationMs: 2000 }),
      fixtures.test('s-1', { id: 'sb-1', title: 'slow-b', file: 'b.spec.ts', durationMs: 3000 }),
      fixtures.test('s-2', { id: 'sb-2', title: 'slow-b', file: 'b.spec.ts', durationMs: 4000 }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/slow?limit=2' });
    const body = res.json() as Array<{ title: string; avgDurationMs: number; p95DurationMs: number; runCount: number }>;
    expect(res.statusCode).toBe(200);
    expect(body[0]).toMatchObject({ title: 'slow-b', avgDurationMs: 3500, p95DurationMs: 4000, runCount: 2 });
    expect(body[1]).toMatchObject({ title: 'slow-a', avgDurationMs: 1500, p95DurationMs: 2000, runCount: 2 });
  });

  it('GET /api/analytics/error-clusters returns 400 when runId is missing', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/error-clusters' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Missing required query parameter: runId' });
  });

  it('GET /api/analytics/error-clusters returns cluster output from service', async () => {
    mockClusterErrors.mockResolvedValueOnce([
      { fingerprint: 'timeout', count: 2 },
      { fingerprint: 'assertion', count: 1 },
    ]);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/error-clusters?runId=run-123' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { fingerprint: 'timeout', count: 2 },
      { fingerprint: 'assertion', count: 1 },
    ]);
    expect(mockClusterErrors).toHaveBeenCalledWith('run-123');
  });
});
