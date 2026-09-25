import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

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

describe('metrics routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { metricsRoutes } = await import('../metrics.js');
    await metricsRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM quarantine');
    testApp.poolConnection.exec('DELETE FROM runs');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /metrics returns Prometheus text format and default statuses on empty DB', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/metrics' });

    if (res.statusCode === 500) {
      console.log('500 Error Body:', res.body);
    }
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain; version=0.0.4; charset=utf-8');

    const body = res.body;
    expect(body).toContain('# HELP automate_dashboard_runs_total Total number of test runs by status');
    expect(body).toContain('automate_dashboard_runs_total{status="running"} 0');
    expect(body).toContain('automate_dashboard_runs_total{status="passed"} 0');
    expect(body).toContain('automate_dashboard_runs_total{status="failed"} 0');
    expect(body).toContain('automate_dashboard_runs_total{status="interrupted"} 0');
    expect(body).toContain('automate_dashboard_pass_rate 0.0000');
    expect(body).toContain('automate_dashboard_avg_duration_seconds 0.000');
    expect(body).toContain('automate_dashboard_flaky_tests_count 0');
    expect(body).toContain('automate_dashboard_active_runs 0');
    expect(body).not.toContain('automate_latest_run_tests{type="total"}');
  });

  it('GET /metrics reports run totals by status labels', async () => {
    testApp.sqlite
      .prepare(`INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('run-1', '2026-01-01T00:00:00.000Z', 'passed', 10, 10, 0, 0, 0);
    testApp.sqlite
      .prepare(`INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('run-2', '2026-01-02T00:00:00.000Z', 'passed', 10, 9, 1, 0, 0);
    testApp.sqlite
      .prepare(`INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('run-3', '2026-01-03T00:00:00.000Z', 'failed', 10, 5, 5, 0, 0);
    testApp.sqlite
      .prepare(`INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('run-4', '2026-01-04T00:00:00.000Z', 'running', 10, 0, 0, 0, 0);

    const res = await testApp.app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('automate_dashboard_runs_total{status="passed"} 2');
    expect(res.body).toContain('automate_dashboard_runs_total{status="failed"} 1');
    expect(res.body).toContain('automate_dashboard_runs_total{status="running"} 1');
    expect(res.body).toContain('automate_dashboard_runs_total{status="interrupted"} 0');
  });

  it('GET /metrics shows pass rate, average duration, flaky count, active runs, and latest run info', async () => {
    testApp.sqlite
      .prepare(`INSERT INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('q-1', 'flaky test 1', 'tests/a.spec.ts', 'flaky', '2023-11-14T22:13:20.000Z', 'manual');
    testApp.sqlite
      .prepare(`INSERT INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('q-2', 'flaky test 2', 'tests/b.spec.ts', 'flaky', '2023-11-14T22:13:20.000Z', 'manual');

    testApp.sqlite
      .prepare(`INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped, duration_ms) VALUES (?, datetime('now','-2 days'), ?, ?, ?, ?, ?, ?, ?)`)
      .run('run-a', 'passed', 10, 8, 2, 0, 0, 4000);
    testApp.sqlite
      .prepare(`INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped, duration_ms) VALUES (?, datetime('now','-1 day'), ?, ?, ?, ?, ?, ?, ?)`)
      .run('run-b', 'failed', 20, 10, 10, 0, 0, 6000);
    testApp.sqlite
      .prepare(`INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped, duration_ms) VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`)
      .run('run-c', 'running', 30, 5, 1, 2, 3, 9000);

    const res = await testApp.app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('automate_dashboard_pass_rate 0.6000');
    expect(res.body).toContain('automate_dashboard_avg_duration_seconds 5.000');
    expect(res.body).toContain('automate_dashboard_flaky_tests_count 2');
    expect(res.body).toContain('automate_dashboard_active_runs 1');
    expect(res.body).toContain('automate_latest_run_tests{type="total"} 30');
    expect(res.body).toContain('automate_latest_run_tests{type="passed"} 5');
    expect(res.body).toContain('automate_latest_run_tests{type="failed"} 1');
    expect(res.body).toContain('automate_latest_run_tests{type="flaky"} 2');
    expect(res.body).toContain('automate_latest_run_tests{type="skipped"} 3');
  });
});
