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

describe('ci-gate routes', () => {
  beforeAll(async () => {
    // Speed up polling so wait-timeout tests run in <200ms
    process.env.CI_GATE_POLL_MS = '20';
    testApp = await createTestApp();
    const { ciGateRoutes } = await import('../ci-gate.js');
    await ciGateRoutes(testApp.app);
    await testApp.app.ready();
  });

  afterAll(async () => {
    delete process.env.CI_GATE_POLL_MS;
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM runs');
    testApp.poolConnection.exec('DELETE FROM quality_gate_config');
    testApp.poolConnection.exec('DELETE FROM quarantine');
  });

  // ── GET /api/ci/gate/:runId ──────────────────────────────────────────────

  it('GET /api/ci/gate/:runId returns 404 for unknown run', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/nonexistent-run',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Run not found' });
  });

  it('GET /api/ci/gate/:runId returns exitCode 0 for a passed run', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, gate_status)
      VALUES ('run-pass-1', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z', 'passed', 100, 95, 5, 0, 0, 'passed')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/run-pass-1',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runId).toBe('run-pass-1');
    expect(body.passed).toBe(true);
    expect(body.gateStatus).toBe('passed');
    expect(body.passRate).toBe(95);
    expect(body.failedTests).toBe(5);
    expect(body.totalTests).toBe(100);
    expect(body.exitCode).toBe(0);
  });

  it('GET /api/ci/gate/:runId returns exitCode 1 for a failed run', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, gate_status)
      VALUES ('run-fail-1', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z', 'failed', 100, 70, 30, 0, 0, 'failed')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/run-fail-1',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.passed).toBe(false);
    expect(body.gateStatus).toBe('failed');
    expect(body.exitCode).toBe(1);
  });

  it('GET /api/ci/gate/:runId returns gateStatus=skipped when no gate was evaluated', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, gate_status)
      VALUES ('run-nogateStatus', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z', 'passed', 50, 50, 0, 0, 0, NULL)
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/run-nogateStatus',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gateStatus).toBe('skipped');
    expect(body.passed).toBe(false);
    expect(body.exitCode).toBe(1);
  });

  it('GET /api/ci/gate/:runId uses workspace-specific gate threshold when available', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, gate_status, workspace_id)
      VALUES ('run-ws-1', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z', 'passed', 100, 90, 10, 0, 0, 'passed', 'ws-alpha')
    `);
    testApp.poolConnection.exec(`
      INSERT INTO quality_gate_config (id, workspace_id, pass_rate_threshold, updated_at)
      VALUES ('ws-alpha-cfg', 'ws-alpha', 85, '2024-01-01T00:00:00Z')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/run-ws-1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().threshold).toBe(85);
  });

  it('GET /api/ci/gate/:runId falls back to global gate threshold', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, gate_status)
      VALUES ('run-global-1', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z', 'passed', 100, 90, 10, 0, 0, 'passed')
    `);
    testApp.poolConnection.exec(`
      INSERT INTO quality_gate_config (id, pass_rate_threshold, updated_at)
      VALUES ('global', 80, '2024-01-01T00:00:00Z')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/run-global-1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().threshold).toBe(80);
  });

  it('GET /api/ci/gate/:runId includes quarantinedTests count', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, gate_status)
      VALUES ('run-q-1', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z', 'passed', 100, 95, 5, 0, 0, 'passed')
    `);
    testApp.poolConnection.exec(`
      INSERT INTO quarantine (id, test_title, test_file, quarantined_at, status)
      VALUES ('q1', 'flaky test 1', 'tests/flaky.spec.ts', '2024-01-01T00:00:00Z', 'approved'),
             ('q2', 'flaky test 2', 'tests/flaky.spec.ts', '2024-01-01T00:00:00Z', 'approved'),
             ('q3', 'pending test', 'tests/flaky.spec.ts', '2024-01-01T00:00:00Z', 'pending')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/run-q-1',
    });

    expect(res.statusCode).toBe(200);
    // Only the 2 approved items should be counted
    expect(res.json().quarantinedTests).toBe(2);
  });

  // ── POST /api/ci/gate/wait/:runId ───────────────────────────────────────

  it('POST /api/ci/gate/wait/:runId returns 404 for unknown run', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/ci/gate/wait/nonexistent-wait',
      query: { timeout: '1' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Run not found' });
  });

  it('POST /api/ci/gate/wait/:runId returns immediately for a completed run', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, gate_status)
      VALUES ('run-done-1', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z', 'passed', 80, 80, 0, 0, 0, 'passed')
    `);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/ci/gate/wait/run-done-1',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runId).toBe('run-done-1');
    expect(body.exitCode).toBe(0);
    expect(body.passed).toBe(true);
  });

  it('POST /api/ci/gate/wait/:runId times out (408) for a still-running run', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped)
      VALUES ('run-running-1', '2024-01-01T10:00:00Z', 'running', 0, 0, 0, 0, 0)
    `);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/ci/gate/wait/run-running-1',
      query: { timeout: '1' },
    });

    expect(res.statusCode).toBe(408);
    const body = res.json();
    expect(body).toMatchObject({
      error: 'Timeout waiting for run to complete',
      runId: 'run-running-1',
      status: 'running',
    });
  }, 5000);

  it('POST /api/ci/gate/wait/:runId returns 400 for invalid timeout', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/ci/gate/wait/any-run',
      query: { timeout: '0' },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /api/ci/gate/latest ─────────────────────────────────────────────

  it('GET /api/ci/gate/latest returns 404 when no runs exist', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/latest',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/ci/gate/latest returns the most recent run overall', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, gate_status)
      VALUES
        ('run-old', '2024-01-01T09:00:00Z', '2024-01-01T09:05:00Z', 'passed', 50, 50, 0, 0, 0, 'passed'),
        ('run-new', '2024-01-02T09:00:00Z', '2024-01-02T09:05:00Z', 'failed', 50, 40, 10, 0, 0, 'failed')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/latest',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runId).toBe('run-new');
    expect(res.json().exitCode).toBe(1);
  });

  it('GET /api/ci/gate/latest filters by workspace', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, gate_status, workspace_id)
      VALUES
        ('run-ws-a', '2024-01-01T09:00:00Z', '2024-01-01T09:05:00Z', 'passed', 50, 50, 0, 0, 0, 'passed', 'workspace-a'),
        ('run-ws-b', '2024-01-02T09:00:00Z', '2024-01-02T09:05:00Z', 'passed', 50, 50, 0, 0, 0, 'passed', 'workspace-b')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/latest',
      query: { workspace: 'workspace-a' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runId).toBe('run-ws-a');
  });

  it('GET /api/ci/gate/latest filters by branch', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, gate_status, branch)
      VALUES
        ('run-main', '2024-01-01T09:00:00Z', '2024-01-01T09:05:00Z', 'passed', 50, 50, 0, 0, 0, 'passed', 'main'),
        ('run-feat', '2024-01-02T09:00:00Z', '2024-01-02T09:05:00Z', 'failed', 50, 40, 10, 0, 0, 'failed', 'feature/x')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/latest',
      query: { branch: 'main' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runId).toBe('run-main');
    expect(res.json().exitCode).toBe(0);
  });

  it('GET /api/ci/gate/latest returns 404 when no run matches the filter', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, gate_status, workspace_id)
      VALUES ('run-ws-only', '2024-01-01T09:00:00Z', '2024-01-01T09:05:00Z', 'passed', 50, 50, 0, 0, 0, 'passed', 'ws-x')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/latest',
      query: { workspace: 'ws-not-found' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('GET /api/ci/gate/latest response includes all required fields', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, gate_status)
      VALUES ('run-fields', '2024-01-01T09:00:00Z', '2024-01-01T09:05:00Z', 'passed', 60, 55, 5, 0, 0, 'passed')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/ci/gate/latest',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('runId');
    expect(body).toHaveProperty('passed');
    expect(body).toHaveProperty('gateStatus');
    expect(body).toHaveProperty('passRate');
    expect(body).toHaveProperty('threshold');
    expect(body).toHaveProperty('failedTests');
    expect(body).toHaveProperty('totalTests');
    expect(body).toHaveProperty('quarantinedTests');
    expect(body).toHaveProperty('exitCode');
  });
});
