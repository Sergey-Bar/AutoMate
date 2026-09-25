import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/create-test-app.js';
import * as fixtures from '../../../test/fixtures.js';

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

function insertRun(run: ReturnType<typeof fixtures.run>) {
  testApp.sqlite
    .prepare(
      'INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, duration_ms, branch, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      run.id,
      run.startedAt,
      run.finishedAt,
      run.status,
      run.total,
      run.passed,
      run.failed,
      run.flaky,
      run.skipped,
      run.durationMs,
      run.branch,
      run.source,
    );
}

describe('badges + metrics integration routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const [{ badgeRoutes }, { metricsRoutes }] = await Promise.all([
      import('../../badges.js'),
      import('../../metrics.js'),
    ]);
    await badgeRoutes(testApp.app);
    await metricsRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM tests; DELETE FROM quarantine; DELETE FROM runs;');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/badges/pass-rate.svg shows computed pass rate from latest run', async () => {
    insertRun(fixtures.run({ id: 'run-badge-pass', status: 'passed', total: 40, passed: 30, failed: 10 }));

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/pass-rate.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('pass rate');
    expect(res.body).toContain('75.0%');
  });

  it('GET /api/badges/flaky.svg counts flaky tests in latest run', async () => {
    const run = fixtures.run({ id: 'run-flaky-count' });
    insertRun(run);

    const flaky1 = fixtures.test(run.id, { id: 'flaky-1', status: 'flaky' });
    const flaky2 = fixtures.test(run.id, { id: 'flaky-2', status: 'flaky' });
    const passed = fixtures.test(run.id, { id: 'pass-1', status: 'passed' });

    const insertTest = testApp.poolConnection.prepare(
      'INSERT INTO tests (id, run_id, suite_id, title, file, line, "column", stable_id, status, duration_ms, tags, annotations, retry_count, expected_status, worker_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );

    insertTest.run(flaky1.id, run.id, flaky1.suiteId, flaky1.title, flaky1.file, flaky1.line, flaky1.column, flaky1.stableId, flaky1.status, flaky1.durationMs, flaky1.tags, flaky1.annotations, flaky1.retryCount, flaky1.expectedStatus, flaky1.workerIndex);
    insertTest.run(flaky2.id, run.id, flaky2.suiteId, flaky2.title, flaky2.file, flaky2.line, flaky2.column, flaky2.stableId, flaky2.status, flaky2.durationMs, flaky2.tags, flaky2.annotations, flaky2.retryCount, flaky2.expectedStatus, flaky2.workerIndex);
    insertTest.run(passed.id, run.id, passed.suiteId, passed.title, passed.file, passed.line, passed.column, passed.stableId, passed.status, passed.durationMs, passed.tags, passed.annotations, passed.retryCount, passed.expectedStatus, passed.workerIndex);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/flaky.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('flaky');
    expect(res.body).toContain('2');
  });

  it('GET /api/badges/status.svg reflects latest run status', async () => {
    insertRun(fixtures.run({ id: 'run-older-status', status: 'passed', startedAt: '2026-01-01T00:00:00.000Z' }));
    insertRun(fixtures.run({ id: 'run-latest-status', status: 'failed', startedAt: '2026-01-02T00:00:00.000Z' }));

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/status.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('tests');
    expect(res.body).toContain('failed');
  });

  it('GET /metrics emits automate_* prometheus metrics', async () => {
    insertRun(fixtures.run({ id: 'metric-passed', status: 'passed', total: 10, passed: 8, failed: 2, durationMs: 4000, startedAt: '2026-02-01T00:00:00.000Z' }));
    insertRun(fixtures.run({ id: 'metric-running', status: 'running', total: 12, passed: 0, failed: 0, durationMs: null, startedAt: '2026-02-02T00:00:00.000Z' }));

    const res = await testApp.app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain; version=0.0.4; charset=utf-8');
    expect(res.body).toContain('automate_dashboard_runs_total{status="passed"}');
    expect(res.body).toContain('automate_dashboard_runs_total{status="running"}');
    expect(res.body).toContain('automate_dashboard_pass_rate');
    expect(res.body).toContain('automate_dashboard_avg_duration_seconds');
    expect(res.body).toContain('automate_dashboard_flaky_tests_count');
    expect(res.body).toContain('automate_dashboard_active_runs');
  });
});
