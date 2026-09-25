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


describe('analytics routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { analyticsRoutes } = await import('../analytics.js');
    await analyticsRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM tests; DELETE FROM runs;');
    vi.clearAllMocks();
    mockClusterErrors.mockResolvedValue([]);
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/analytics/pass-rate returns empty array when no runs', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/analytics/pass-rate returns pass rate aggregated by day', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({
        id: 'pr-1',
        status: 'passed',
        total: 10,
        passed: 8,
        failed: 2,
        startedAt: '2026-05-01T10:00:00.000Z',
        finishedAt: '2026-05-01T10:05:00.000Z',
      }),
      fixtures.run({
        id: 'pr-2',
        status: 'failed',
        total: 10,
        passed: 6,
        failed: 4,
        startedAt: '2026-05-01T12:00:00.000Z',
        finishedAt: '2026-05-01T12:05:00.000Z',
      }),
      fixtures.run({
        id: 'pr-3',
        status: 'passed',
        total: 20,
        passed: 15,
        failed: 5,
        startedAt: '2026-05-02T10:00:00.000Z',
        finishedAt: '2026-05-02T10:05:00.000Z',
      }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate?days=5000' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: '2026-05-01', all: 70 },
      { date: '2026-05-02', all: 75 },
    ]);
  });

  it('GET /api/analytics/pass-rate respects days parameter', async () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    // eslint-disable-next-line test-flakiness/no-random-data
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'pr-old', status: 'passed', total: 10, passed: 10, startedAt: oldDate }),
      fixtures.run({ id: 'pr-recent', status: 'passed', total: 10, passed: 5, startedAt: recentDate }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate?days=7' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ date: string; all: number }>;
    expect(body).toHaveLength(1);
    expect(body[0].all).toBe(50);
  });

  it('GET /api/analytics/pass-rate filters by workspaceId', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'pr-ws-a', status: 'passed', total: 10, passed: 9, workspaceId: 'ws-a', startedAt: '2026-06-01T01:00:00.000Z' }),
      fixtures.run({ id: 'pr-ws-b', status: 'passed', total: 10, passed: 1, workspaceId: 'ws-b', startedAt: '2026-06-01T02:00:00.000Z' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate?days=5000&workspaceId=ws-a' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ date: '2026-06-01', all: 90 }]);
  });

  it('GET /api/analytics/duration returns p50 and p95 per day', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'dur-1', status: 'passed', durationMs: 100, startedAt: '2026-07-01T01:00:00.000Z' }),
      fixtures.run({ id: 'dur-2', status: 'passed', durationMs: 200, startedAt: '2026-07-01T02:00:00.000Z' }),
      fixtures.run({ id: 'dur-3', status: 'passed', durationMs: 400, startedAt: '2026-07-01T03:00:00.000Z' }),
      fixtures.run({ id: 'dur-4', status: 'passed', durationMs: 150, startedAt: '2026-07-02T01:00:00.000Z' }),
      fixtures.run({ id: 'dur-running', status: 'running', durationMs: 999, startedAt: '2026-07-02T04:00:00.000Z' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/duration?days=5000' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: '2026-07-01', p50: 200, p95: 400 },
      { date: '2026-07-02', p50: 150, p95: 150 },
    ]);
  });

  it('GET /api/analytics/duration returns empty when no duration rows', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'dur-none', status: 'running', durationMs: null })).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/duration' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/analytics/flaky returns top flaky tests with rates', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'fl-run-1', status: 'passed', workspaceId: 'ws-f' }),
      fixtures.run({ id: 'fl-run-2', status: 'passed', workspaceId: 'ws-f' }),
      fixtures.run({ id: 'fl-run-3', status: 'passed', workspaceId: 'ws-f' }),
    ]).run();

    testApp.db.insert(schema.tests).values([
      fixtures.test('fl-run-1', { id: 'f1', title: 'alpha', file: 'a.spec.ts', status: 'flaky' }),
      fixtures.test('fl-run-2', { id: 'f2', title: 'alpha', file: 'a.spec.ts', status: 'flaky' }),
      fixtures.test('fl-run-3', { id: 'f3', title: 'alpha', file: 'a.spec.ts', status: 'passed' }),
      fixtures.test('fl-run-1', { id: 'f4', title: 'beta', file: 'b.spec.ts', status: 'flaky' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/flaky?workspaceId=ws-f' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ title: string; flakyCount: number; totalRuns: number; flakyRate: number }>;
    expect(body[0]).toMatchObject({ title: 'alpha', flakyCount: 2, totalRuns: 2, flakyRate: 100 });
    expect(body[1]).toMatchObject({ title: 'beta', flakyCount: 1, totalRuns: 1, flakyRate: 100 });
  });

  it('GET /api/analytics/flaky returns empty array when no flaky tests', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'fl-empty-run', status: 'passed' })).run();
    testApp.db.insert(schema.tests).values(fixtures.test('fl-empty-run', { id: 'fl-empty-test', status: 'passed' })).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/flaky' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/analytics/flaky respects limit parameter', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'fl-limit-1', status: 'passed' }),
      fixtures.run({ id: 'fl-limit-2', status: 'passed' }),
      fixtures.run({ id: 'fl-limit-3', status: 'passed' }),
    ]).run();

    testApp.db.insert(schema.tests).values([
      fixtures.test('fl-limit-1', { id: 'fa-1', title: 'alpha', file: 'a.spec.ts', status: 'flaky' }),
      fixtures.test('fl-limit-2', { id: 'fa-2', title: 'alpha', file: 'a.spec.ts', status: 'flaky' }),
      fixtures.test('fl-limit-1', { id: 'fb-1', title: 'beta', file: 'b.spec.ts', status: 'flaky' }),
      fixtures.test('fl-limit-3', { id: 'fc-1', title: 'charlie', file: 'c.spec.ts', status: 'flaky' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/flaky?limit=2' });

    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[])).toHaveLength(2);
  });

  it('GET /api/analytics/slow returns slowest tests by average duration', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'slow-1', status: 'passed' }),
      fixtures.run({ id: 'slow-2', status: 'passed' }),
    ]).run();
    testApp.db.insert(schema.tests).values([
      fixtures.test('slow-1', { id: 's1', title: 'slow-a', file: 'a.spec.ts', durationMs: 1000 }),
      fixtures.test('slow-2', { id: 's2', title: 'slow-a', file: 'a.spec.ts', durationMs: 1500 }),
      fixtures.test('slow-1', { id: 's3', title: 'slow-b', file: 'b.spec.ts', durationMs: 4000 }),
      fixtures.test('slow-2', { id: 's4', title: 'slow-b', file: 'b.spec.ts', durationMs: 3000 }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/slow?limit=5' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ title: string; avgDurationMs: number; p95DurationMs: number; runCount: number }>;
    expect(body[0]).toMatchObject({ title: 'slow-b', avgDurationMs: 3500, p95DurationMs: 4000, runCount: 2 });
    expect(body[1]).toMatchObject({ title: 'slow-a', avgDurationMs: 1250, p95DurationMs: 1500, runCount: 2 });
  });

  it('GET /api/analytics/slow returns empty array when no tests', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/slow' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/analytics/heatmap returns failure counts grouped by file and date', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'hm-1', status: 'passed', startedAt: '2026-08-01T01:00:00.000Z', workspaceId: 'ws-h' }),
      fixtures.run({ id: 'hm-2', status: 'passed', startedAt: '2026-08-02T01:00:00.000Z', workspaceId: 'ws-h' }),
    ]).run();
    testApp.db.insert(schema.tests).values([
      fixtures.test('hm-1', { id: 'hm-a1', file: 'a.spec.ts', status: 'failed' }),
      fixtures.test('hm-1', { id: 'hm-a2', file: 'a.spec.ts', status: 'failed' }),
      fixtures.test('hm-2', { id: 'hm-b1', file: 'b.spec.ts', status: 'failed' }),
      fixtures.test('hm-2', { id: 'hm-b2', file: 'b.spec.ts', status: 'passed' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/heatmap?days=5000&workspaceId=ws-h' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 'a.spec.ts', data: [{ x: '2026-08-01', y: 2 }] },
      { id: 'b.spec.ts', data: [{ x: '2026-08-02', y: 1 }] },
    ]);
  });

  it('GET /api/analytics/heatmap returns empty array when no failures', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'hm-empty-run', status: 'passed' })).run();
    testApp.db.insert(schema.tests).values(fixtures.test('hm-empty-run', { id: 'hm-empty-test', status: 'passed' })).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/heatmap' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/analytics/gantt returns 400 when runId is not provided', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/gantt' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Missing required query parameter: runId' });
  });

  it('GET /api/analytics/gantt returns tests ordered by workerIndex', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'gantt-run', status: 'passed' })).run();
    testApp.db.insert(schema.tests).values([
      fixtures.test('gantt-run', { id: 'g-3', title: 'w2', workerIndex: 2, durationMs: 900 }),
      fixtures.test('gantt-run', { id: 'g-1', title: 'w0', workerIndex: 0, durationMs: 500 }),
      fixtures.test('gantt-run', { id: 'g-2', title: 'w1', workerIndex: 1, durationMs: 700 }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/gantt?runId=gantt-run' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ workerIndex: number; title: string }>;
    expect(body.map((r) => r.workerIndex)).toEqual([0, 1, 2]);
    expect(body.map((r) => r.title)).toEqual(['w0', 'w1', 'w2']);
  });

  it('GET /api/analytics/error-clusters returns 400 when runId is missing', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/error-clusters' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Missing required query parameter: runId' });
  });

  it('GET /api/analytics/error-clusters returns clusters from service', async () => {
    mockClusterErrors.mockResolvedValueOnce([
      { fingerprint: 'timeout', count: 3 },
      { fingerprint: 'assertion', count: 1 },
    ]);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/error-clusters?runId=run-123' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { fingerprint: 'timeout', count: 3 },
      { fingerprint: 'assertion', count: 1 },
    ]);
    expect(mockClusterErrors).toHaveBeenCalledWith('run-123');
  });

  it('GET /api/analytics/frequent-failures returns 200 in test environment (requireFeature bypassed)', async () => {
    // In test mode NODE_ENV='test', requireFeature always passes — route is accessible
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/frequent-failures' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/analytics/frequent-failures returns top failures sorted by count', async () => {
    const origEnv = process.env['FEATURE_FREQUENT_FAILURES'];
    process.env['FEATURE_FREQUENT_FAILURES'] = 'true';

    try {
      const runId = 'ff-run-1';
      testApp.db.insert(schema.runs).values(
        // eslint-disable-next-line test-flakiness/no-random-data
        fixtures.run({ id: runId, status: 'passed', startedAt: new Date().toISOString() }),
      ).run();
      testApp.db.insert(schema.results).values([
        fixtures.result('test-a', runId, { status: 'failed', errorMessage: 'TypeError: cannot read foo' }),
        fixtures.result('test-b', runId, { status: 'failed', errorMessage: 'TypeError: cannot read foo' }),
        fixtures.result('test-c', runId, { status: 'failed', errorMessage: 'Connection refused on port 5432' }),
      ]).run();

      const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/frequent-failures?days=5000' });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ errorMessage: string; count: number; lastSeen: string; affectedTests: string[] }>;
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0].errorMessage).toBe('TypeError: cannot read foo');
      expect(body[0].count).toBe(2);
      expect(body[0].affectedTests).toContain('test-a');
      expect(body[0].affectedTests).toContain('test-b');
    } finally {
      if (origEnv === undefined) {
        delete process.env['FEATURE_FREQUENT_FAILURES'];
      } else {
        process.env['FEATURE_FREQUENT_FAILURES'] = origEnv;
      }
    }
  });

  it('GET /api/analytics/frequent-failures returns empty array when no failures', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/frequent-failures' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/analytics/frequent-failures respects days parameter', async () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    // eslint-disable-next-line test-flakiness/no-random-data
    const recentDate = new Date().toISOString();
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'ff-old', status: 'failed', startedAt: oldDate }),
      fixtures.run({ id: 'ff-new', status: 'failed', startedAt: recentDate }),
    ]).run();
    testApp.db.insert(schema.results).values([
      fixtures.result('old-test', 'ff-old', { status: 'failed', errorMessage: 'old error message' }),
      fixtures.result('new-test', 'ff-new', { status: 'failed', errorMessage: 'new error message' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/frequent-failures?days=7' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ errorMessage: string }>;
    const messages = body.map((r) => r.errorMessage);
    expect(messages).toContain('new error message');
    expect(messages).not.toContain('old error message');
  });

  // ── GET /api/analytics/flakiness-breakdown ─────────────────────────────

  it('GET /api/analytics/flakiness-breakdown returns zero counts when quarantine is empty', async () => {
    testApp.poolConnection.exec('DELETE FROM quarantine');
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/flakiness-breakdown' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { timing: number; environment: number; data: number; assertion_drift: number; unknown: number; total: number };
    expect(body.timing).toBe(0);
    expect(body.environment).toBe(0);
    expect(body.data).toBe(0);
    expect(body.assertion_drift).toBe(0);
    expect(body.unknown).toBe(0);
    expect(body.total).toBe(0);
  });

  it('GET /api/analytics/flakiness-breakdown counts quarantine rows by category', async () => {
    testApp.poolConnection.exec('DELETE FROM quarantine');
    testApp.poolConnection.exec(`
      INSERT INTO quarantine (id, test_title, test_file, quarantined_at, status, flakiness_category)
      VALUES
        ('q1', 'timeout test', 'a.spec.ts', '2026-01-01T00:00:00.000Z', 'approved', 'timing'),
        ('q2', 'timeout test 2', 'b.spec.ts', '2026-01-01T00:00:00.000Z', 'approved', 'timing'),
        ('q3', 'env test', 'c.spec.ts', '2026-01-01T00:00:00.000Z', 'approved', 'environment'),
        ('q4', 'data test', 'd.spec.ts', '2026-01-01T00:00:00.000Z', 'approved', NULL),
        ('q5', 'pending test', 'e.spec.ts', '2026-01-01T00:00:00.000Z', 'pending', 'timing')
    `);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/flakiness-breakdown' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { timing: number; environment: number; data: number; assertion_drift: number; unknown: number; total: number };
    expect(body.timing).toBe(3); // q1, q2, q5 (all statuses counted)
    expect(body.environment).toBe(1); // q3
    expect(body.unknown).toBe(1); // q4 has null category → mapped to unknown
    expect(body.data).toBe(0);
    expect(body.assertion_drift).toBe(0);
    expect(body.total).toBe(5);
  });

  // ── GET /api/analytics/time-to-fix ─────────────────────────────────────

  describe('GET /api/analytics/time-to-fix', () => {
    beforeEach(() => {
      testApp.poolConnection.exec('DELETE FROM quarantine');
    });

    it('returns zeros when quarantine is empty', async () => {
      const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/time-to-fix' });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        avgTtfMs: number; medianTtfMs: number; p95TtfMs: number;
        activeCount: number; resolvedCount: number;
        byCategory: Record<string, unknown>; trend: unknown[];
      };
      expect(body.avgTtfMs).toBe(0);
      expect(body.medianTtfMs).toBe(0);
      expect(body.p95TtfMs).toBe(0);
      expect(body.activeCount).toBe(0);
      expect(body.resolvedCount).toBe(0);
      expect(body.byCategory).toEqual({});
      expect(body.trend).toEqual([]);
    });

    it('returns active count for unresolved entries', async () => {
      testApp.poolConnection.exec(`
        INSERT INTO quarantine (id, test_title, test_file, quarantined_at, status)
        VALUES
          ('ttf-a1', 'active test 1', 'a.spec.ts', '2026-01-01T00:00:00.000Z', 'approved'),
          ('ttf-a2', 'active test 2', 'b.spec.ts', '2026-01-01T00:00:00.000Z', 'approved')
      `);

      const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/time-to-fix' });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { activeCount: number; resolvedCount: number };
      expect(body.activeCount).toBe(2);
      expect(body.resolvedCount).toBe(0);
    });

    it('returns resolved count and TTF stats', async () => {
      testApp.poolConnection.exec(`
        INSERT INTO quarantine (id, test_title, test_file, quarantined_at, status, resolved_at, resolution_type, ttf_ms)
        VALUES
          ('ttf-r1', 'resolved test 1', 'a.spec.ts', '2026-01-01T00:00:00.000Z', 'approved', '2026-01-02T00:00:00.000Z', 'auto_recovery', 3600000),
          ('ttf-r2', 'resolved test 2', 'b.spec.ts', '2026-01-01T00:00:00.000Z', 'approved', '2026-01-03T00:00:00.000Z', 'auto_recovery', 7200000)
      `);

      const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/time-to-fix' });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { avgTtfMs: number; resolvedCount: number };
      expect(body.resolvedCount).toBe(2);
      expect(body.avgTtfMs).toBe(5400000); // (3600000 + 7200000) / 2
    });

    it('byCategory groups TTF by flakiness category', async () => {
      testApp.poolConnection.exec(`
        INSERT INTO quarantine (id, test_title, test_file, quarantined_at, status, resolved_at, resolution_type, ttf_ms, flakiness_category)
        VALUES
          ('ttf-c1', 'timing test', 'a.spec.ts', '2026-01-01T00:00:00.000Z', 'approved', '2026-01-02T00:00:00.000Z', 'auto_recovery', 3600000, 'timing'),
          ('ttf-c2', 'env test', 'b.spec.ts', '2026-01-01T00:00:00.000Z', 'approved', '2026-01-03T00:00:00.000Z', 'auto_recovery', 7200000, 'environment')
      `);

      const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/time-to-fix' });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { byCategory: Record<string, { avgTtfMs: number; count: number }> };
      expect(body.byCategory['timing']).toEqual({ avgTtfMs: 3600000, count: 1 });
      expect(body.byCategory['environment']).toEqual({ avgTtfMs: 7200000, count: 1 });
    });

    it('trend groups by ISO week', async () => {
      testApp.poolConnection.exec(`
        INSERT INTO quarantine (id, test_title, test_file, quarantined_at, status, resolved_at, resolution_type, ttf_ms)
        VALUES
          ('ttf-w1', 'week1 test', 'a.spec.ts', '2026-01-01T00:00:00.000Z', 'approved', '2026-01-05T00:00:00.000Z', 'auto_recovery', 3600000),
          ('ttf-w2', 'week2 test', 'b.spec.ts', '2026-01-01T00:00:00.000Z', 'approved', '2026-01-12T00:00:00.000Z', 'auto_recovery', 7200000)
      `);

      const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/time-to-fix' });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { trend: Array<{ week: string; avgTtfMs: number; resolvedCount: number }> };
      expect(body.trend.length).toBeGreaterThanOrEqual(1);
      // Both dates are in different weeks
      const weeks = body.trend.map((t) => t.week);
      expect(new Set(weeks).size).toBe(weeks.length); // unique weeks
    });
  });
});
