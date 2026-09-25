import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import type { PredictiveResult } from '../../services/predictive-selection.js';

const { mockGetPredictiveCandidates } = vi.hoisted(() => ({
  mockGetPredictiveCandidates: vi.fn<() => Promise<PredictiveResult>>(),
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

vi.mock('../../services/predictive-selection.js', () => ({
  getPredictiveCandidates: mockGetPredictiveCandidates,
}));

const emptyResult: PredictiveResult = {
  candidates: [],
  mode: 'static_only',
  totalHistoricalRuns: 0,
  coldStartThreshold: 20,
};

describe('POST /api/analytics/predictive-selection', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { analyticsRoutes } = await import('../analytics.js');
    await analyticsRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM test_failure_correlations');
    vi.clearAllMocks();
    mockGetPredictiveCandidates.mockResolvedValue(emptyResult);
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('returns mapped tests when candidates are found', async () => {
    mockGetPredictiveCandidates.mockResolvedValue({
      candidates: [
        {
          testFile: 'tests/auth.test.ts',
          title: 'Login test',
          score: 0.87,
          staticImpact: 1,
          historicalRisk: 0.6,
          reason: 'Imports src/auth/login.ts; static=1.00, historical=0.60, score=0.870',
        },
        {
          testFile: 'tests/session.test.ts',
          title: 'Session test',
          score: 0.65,
          staticImpact: 1,
          historicalRisk: 0,
          reason: 'Imports src/auth/session.ts; static=1.00, historical=0.00, score=0.650',
        },
      ],
      mode: 'full',
      totalHistoricalRuns: 25,
      coldStartThreshold: 20,
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/analytics/predictive-selection',
      payload: { changedFiles: ['src/auth/login.ts'] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { tests: Array<{ stableId: string; score: number; reason: string }> };
    expect(body.tests).toHaveLength(2);
    expect(body.tests[0]).toMatchObject({ stableId: 'tests/auth.test.ts', score: 0.87 });
    expect(body.tests[1]).toMatchObject({ stableId: 'tests/session.test.ts', score: 0.65 });
    expect(mockGetPredictiveCandidates).toHaveBeenCalledWith(['src/auth/login.ts'], 'tests');
  });

  it('defaults testDir to "tests" when not provided', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: '/api/analytics/predictive-selection',
      payload: { changedFiles: ['src/a.ts'] },
    });

    expect(mockGetPredictiveCandidates).toHaveBeenCalledWith(['src/a.ts'], 'tests');
  });

  it('passes custom testDir to getPredictiveCandidates', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: '/api/analytics/predictive-selection',
      payload: { changedFiles: ['src/a.ts'], testDir: 'e2e' },
    });

    expect(mockGetPredictiveCandidates).toHaveBeenCalledWith(['src/a.ts'], 'e2e');
  });

  it('returns empty tests when changedFiles is empty', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/analytics/predictive-selection',
      payload: { changedFiles: [] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { tests: Array<unknown> };
    expect(body.tests).toEqual([]);
  });

  it('falls back to all known tests with equal score when no correlations found for changed files', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO test_failure_correlations
        (id, test_stable_id, source_file_path, failure_count, total_occurrences, window_start_date, created_at, updated_at)
      VALUES
        ('c1', 'tests/a.test.ts', 'src/a.ts', 2, 5, '2026-01-01', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        ('c2', 'tests/b.test.ts', 'src/b.ts', 1, 3, '2026-01-01', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/analytics/predictive-selection',
      payload: { changedFiles: ['src/unknown.ts'] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { tests: Array<{ stableId: string; score: number; reason: string }> };
    expect(body.tests).toHaveLength(2);
    for (const t of body.tests) {
      expect(t.score).toBe(1.0);
      expect(t.reason).toBe('no_correlation_data');
      expect(['tests/a.test.ts', 'tests/b.test.ts']).toContain(t.stableId);
    }
  });

  it('deduplicates test stable IDs in fallback when a test has multiple source correlations', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO test_failure_correlations
        (id, test_stable_id, source_file_path, failure_count, total_occurrences, window_start_date, created_at, updated_at)
      VALUES
        ('c1', 'tests/multi.test.ts', 'src/a.ts', 2, 5, '2026-01-01', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        ('c2', 'tests/multi.test.ts', 'src/b.ts', 1, 3, '2026-01-01', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/analytics/predictive-selection',
      payload: { changedFiles: ['src/unknown.ts'] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { tests: Array<{ stableId: string }> };
    expect(body.tests).toHaveLength(1);
    expect(body.tests[0].stableId).toBe('tests/multi.test.ts');
  });

  it('returns empty fallback when correlation table is empty and changed files provided', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/analytics/predictive-selection',
      payload: { changedFiles: ['src/never-seen.ts'] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { tests: Array<unknown> };
    expect(body.tests).toEqual([]);
  });

  it('handles missing body gracefully (defaults to empty changedFiles)', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/analytics/predictive-selection',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetPredictiveCandidates).toHaveBeenCalledWith([], 'tests');
  });
});
