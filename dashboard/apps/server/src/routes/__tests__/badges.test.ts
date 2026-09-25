import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import * as fixtures from '../../test/fixtures.js';

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

describe('badge routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { badgeRoutes } = await import('../badges.js');
    await badgeRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM tests');
    testApp.poolConnection.exec('DELETE FROM runs');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/badges/pass-rate.svg returns N/A SVG when no runs', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/pass-rate.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['cache-control']).toBe('no-cache, no-store');
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('pass rate');
    expect(res.body).toContain('N/A');
  });

  it('GET /api/badges/pass-rate.svg returns percentage SVG when run exists', async () => {
    const run = fixtures.run({
      status: 'passed',
      total: 20,
      passed: 17,
      startedAt: '2026-01-01T10:00:00.000Z',
    });
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

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/pass-rate.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['cache-control']).toBe('max-age=60');
    expect(res.body).toContain('pass rate');
    expect(res.body).toContain('85.0%');
  });

  it('GET /api/badges/status.svg returns unknown when no runs', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/status.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['cache-control']).toBe('max-age=60');
    expect(res.body).toContain('tests');
    expect(res.body).toContain('unknown');
  });

  it('GET /api/badges/status.svg returns latest run status', async () => {
    const older = fixtures.run({
      id: 'run-older',
      status: 'passed',
      startedAt: '2026-01-01T10:00:00.000Z',
      total: 10,
      passed: 10,
    });
    const latest = fixtures.run({
      id: 'run-latest',
      status: 'failed',
      startedAt: '2026-01-02T10:00:00.000Z',
      total: 10,
      passed: 7,
      failed: 3,
    });

    testApp.sqlite
      .prepare(
        'INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, duration_ms, branch, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        older.id,
        older.startedAt,
        older.finishedAt,
        older.status,
        older.total,
        older.passed,
        older.failed,
        older.flaky,
        older.skipped,
        older.durationMs,
        older.branch,
        older.source,
      );
    testApp.sqlite
      .prepare(
        'INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, duration_ms, branch, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        latest.id,
        latest.startedAt,
        latest.finishedAt,
        latest.status,
        latest.total,
        latest.passed,
        latest.failed,
        latest.flaky,
        latest.skipped,
        latest.durationMs,
        latest.branch,
        latest.source,
      );

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/status.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['cache-control']).toBe('max-age=60');
    expect(res.body).toContain('tests');
    expect(res.body).toContain('failed');
  });

  it('GET /api/badges/flaky.svg returns 0 when no runs', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/flaky.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['cache-control']).toBe('no-cache, no-store');
    expect(res.body).toContain('flaky');
    expect(res.body).toContain('0');
  });

  it('GET /api/badges/flaky.svg returns flaky count from latest run tests', async () => {
    const run = fixtures.run({ id: 'run-for-flaky', startedAt: '2026-01-03T10:00:00.000Z' });
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

    const flakyA = fixtures.test(run.id, { id: 't1', status: 'flaky' });
    const flakyB = fixtures.test(run.id, { id: 't2', status: 'flaky' });
    const passed = fixtures.test(run.id, { id: 't3', status: 'passed' });

    testApp.sqlite
      .prepare('INSERT INTO tests (id, run_id, suite_id, title, file, line, "column", stable_id, status, duration_ms, tags, annotations, retry_count, expected_status, worker_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(flakyA.id, run.id, flakyA.suiteId, flakyA.title, flakyA.file, flakyA.line, flakyA.column, flakyA.stableId, flakyA.status, flakyA.durationMs, flakyA.tags, flakyA.annotations, flakyA.retryCount, flakyA.expectedStatus, flakyA.workerIndex);
    testApp.sqlite
      .prepare('INSERT INTO tests (id, run_id, suite_id, title, file, line, "column", stable_id, status, duration_ms, tags, annotations, retry_count, expected_status, worker_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(flakyB.id, run.id, flakyB.suiteId, flakyB.title, flakyB.file, flakyB.line, flakyB.column, flakyB.stableId, flakyB.status, flakyB.durationMs, flakyB.tags, flakyB.annotations, flakyB.retryCount, flakyB.expectedStatus, flakyB.workerIndex);
    testApp.sqlite
      .prepare('INSERT INTO tests (id, run_id, suite_id, title, file, line, "column", stable_id, status, duration_ms, tags, annotations, retry_count, expected_status, worker_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(passed.id, run.id, passed.suiteId, passed.title, passed.file, passed.line, passed.column, passed.stableId, passed.status, passed.durationMs, passed.tags, passed.annotations, passed.retryCount, passed.expectedStatus, passed.workerIndex);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/flaky.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['cache-control']).toBe('max-age=60');
    expect(res.body).toContain('flaky');
    expect(res.body).toContain('2');
  });

  it('GET /api/badges/status.svg returns blue color for running status', async () => {
    const run = fixtures.run({
      id: 'run-running',
      status: 'running',
      startedAt: '2026-01-04T10:00:00.000Z',
      total: 10,
      passed: 5,
    });
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

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/status.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('running');
    expect(res.body).toContain('#2196f3');
  });

  it('GET /api/badges/pass-rate.svg returns yellow-green color for 80-94% pass rate', async () => {
    // 17/20 = 85% → pickColor returns '#a3c51c'
    const run = fixtures.run({
      id: 'run-85pct',
      status: 'passed',
      total: 20,
      passed: 17,
      startedAt: '2026-01-05T10:00:00.000Z',
    });
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

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/pass-rate.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('#a3c51c');
  });

  it('GET /api/badges/pass-rate.svg returns yellow color for 60-79% pass rate', async () => {
    // 14/20 = 70% → pickColor returns '#dfb317'
    const run = fixtures.run({
      id: 'run-70pct',
      status: 'passed',
      total: 20,
      passed: 14,
      startedAt: '2026-01-06T10:00:00.000Z',
    });
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

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/pass-rate.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('#dfb317');
  });

  it('GET /api/badges/pass-rate.svg returns red color for <60% pass rate', async () => {
    // 10/20 = 50% → pickColor returns '#e05d44'
    const run = fixtures.run({
      id: 'run-50pct',
      status: 'passed',
      total: 20,
      passed: 10,
      startedAt: '2026-01-07T10:00:00.000Z',
    });
    testApp.sqlite
      .prepare(
        'INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, duration_ms, branch, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        run.id, run.startedAt, run.finishedAt, run.status,
        run.total, run.passed, run.failed, run.flaky, run.skipped,
        run.durationMs, run.branch, run.source,
      );

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/pass-rate.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('#e05d44');
  });

  it('GET /api/badges/pass-rate.svg returns bright green color for >=95% pass rate', async () => {
    // 20/20 = 100% → pickColor returns '#4c1'
    const run = fixtures.run({
      id: 'run-100pct',
      status: 'passed',
      total: 20,
      passed: 20,
      startedAt: '2026-01-08T10:00:00.000Z',
    });
    testApp.sqlite
      .prepare(
        'INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, duration_ms, branch, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        run.id, run.startedAt, run.finishedAt, run.status,
        run.total, run.passed, run.failed, run.flaky, run.skipped,
        run.durationMs, run.branch, run.source,
      );

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/pass-rate.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('#4c1');
  });

  it('GET /api/badges/status.svg returns green color for passed status', async () => {
    const run = fixtures.run({
      id: 'run-passed-status',
      status: 'passed',
      startedAt: '2026-01-09T10:00:00.000Z',
      total: 10,
      passed: 10,
    });
    testApp.sqlite
      .prepare(
        'INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, duration_ms, branch, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        run.id, run.startedAt, run.finishedAt, run.status,
        run.total, run.passed, run.failed, run.flaky, run.skipped,
        run.durationMs, run.branch, run.source,
      );

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/status.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('passed');
    expect(res.body).toContain('#4c1');
  });

  it('GET /api/badges/flaky.svg returns red color for >3 flaky tests', async () => {
    const run = fixtures.run({ id: 'run-very-flaky', startedAt: '2026-01-10T10:00:00.000Z' });
    testApp.sqlite
      .prepare(
        'INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, duration_ms, branch, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        run.id, run.startedAt, run.finishedAt, run.status,
        run.total, run.passed, run.failed, run.flaky, run.skipped,
        run.durationMs, run.branch, run.source,
      );

    for (let i = 1; i <= 4; i++) {
      const t = fixtures.test(run.id, { id: `very-flaky-t${i}`, status: 'flaky' });
      testApp.sqlite
        .prepare('INSERT INTO tests (id, run_id, suite_id, title, file, line, "column", stable_id, status, duration_ms, tags, annotations, retry_count, expected_status, worker_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(t.id, run.id, t.suiteId, t.title, t.file, t.line, t.column, t.stableId, t.status, t.durationMs, t.tags, t.annotations, t.retryCount, t.expectedStatus, t.workerIndex);
    }

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/flaky.svg' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('flaky');
    expect(res.body).toContain('#e05d44');
  });
});
