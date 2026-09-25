import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/create-test-app.js';
import * as fixtures from '../../../test/fixtures.js';
import * as schema from '../../../db/schema.js';

const { mockRunner, mockGenerateHtmlReport, mockGenerateRunPdf } = vi.hoisted(() => ({
  mockRunner: {
    startRun: vi.fn<(...args: unknown[]) => Promise<string>>(),
    abortRun: vi.fn<(runId: string) => boolean>(),
    listTests: vi.fn<(configPath?: string) => Promise<object>>(),
  },
  mockGenerateHtmlReport: vi.fn<(runId: string) => string>(),
  mockGenerateRunPdf: vi.fn<(runId: string) => Promise<Buffer>>(),
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

vi.mock('../../../services/runner.js', () => ({ runner: mockRunner }));
vi.mock('../../../services/html-report.js', () => ({ generateHtmlReport: mockGenerateHtmlReport }));
vi.mock('../../../services/pdf-report.js', () => ({ generateRunPdf: mockGenerateRunPdf }));

const mockBridge = {
  runner: { startRun: vi.fn(), abortRun: vi.fn() },
  computeGateStatus: vi.fn(),
};

describe('runs integration routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { runsRoutes } = await import('../../runs.js');
    await runsRoutes(testApp.app, { bridge: mockBridge as Parameters<typeof runsRoutes>[1]['bridge'] });
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM results; DELETE FROM tests; DELETE FROM runs;');
    testApp.poolConnection.exec('DELETE FROM quality_gate_config;');
    vi.clearAllMocks();
    mockRunner.startRun.mockResolvedValue('run-started-id');
    mockRunner.abortRun.mockReturnValue(true);
    mockRunner.listTests.mockResolvedValue({ suites: [] });
    mockGenerateHtmlReport.mockReturnValue('<html>report</html>');
    mockGenerateRunPdf.mockResolvedValue(Buffer.from('pdf'));
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/runs returns empty list initially', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/runs returns runs sorted by startedAt desc', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'r-old', startedAt: '2026-01-01T00:00:00.000Z' }),
      fixtures.run({ id: 'r-new', startedAt: '2026-01-02T00:00:00.000Z' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs' });
    const body = res.json() as Array<{ id: string }>;
    expect(res.statusCode).toBe(200);
    expect(body.map((r) => r.id)).toEqual(['r-new', 'r-old']);
  });

  it('GET /api/runs filters by workspaceId', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'ws-a-1', workspaceId: 'ws-a' }),
      fixtures.run({ id: 'ws-b-1', workspaceId: 'ws-b' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs?workspaceId=ws-a' });
    const body = res.json() as Array<{ id: string }>;
    expect(res.statusCode).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('ws-a-1');
  });

  it('GET /api/runs filters by branch', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'br-main', branch: 'main' }),
      fixtures.run({ id: 'br-release', branch: 'release/1.0' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs?branch=release/1.0' });
    const body = res.json() as Array<{ id: string; branch: string | null }>;
    expect(res.statusCode).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: 'br-release', branch: 'release/1.0' });
  });

  it('GET /api/runs filters by status', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'st-running', status: 'running' }),
      fixtures.run({ id: 'st-failed', status: 'failed' }),
      fixtures.run({ id: 'st-passed', status: 'passed' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs?status=failed' });
    const body = res.json() as Array<{ id: string; status: string }>;
    expect(res.statusCode).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: 'st-failed', status: 'failed' });
  });

  it('GET /api/runs supports combined filters', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'combo-hit', status: 'failed', branch: 'main', workspaceId: 'ws-1' }),
      fixtures.run({ id: 'combo-miss-branch', status: 'failed', branch: 'dev', workspaceId: 'ws-1' }),
      fixtures.run({ id: 'combo-miss-status', status: 'passed', branch: 'main', workspaceId: 'ws-1' }),
      fixtures.run({ id: 'combo-miss-ws', status: 'failed', branch: 'main', workspaceId: 'ws-2' }),
    ]).run();

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/runs?workspaceId=ws-1&branch=main&status=failed',
    });
    const body = res.json() as Array<{ id: string }>;
    expect(res.statusCode).toBe(200);
    expect(body.map((r) => r.id)).toEqual(['combo-hit']);
  });

  it('GET /api/runs supports pagination with limit/offset', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'p1', startedAt: '2026-02-01T00:00:00.000Z' }),
      fixtures.run({ id: 'p2', startedAt: '2026-02-02T00:00:00.000Z' }),
      fixtures.run({ id: 'p3', startedAt: '2026-02-03T00:00:00.000Z' }),
      fixtures.run({ id: 'p4', startedAt: '2026-02-04T00:00:00.000Z' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs?limit=2&offset=1' });
    const body = res.json() as Array<{ id: string }>;
    expect(res.statusCode).toBe(200);
    expect(body.map((r) => r.id)).toEqual(['p3', 'p2']);
  });

  it('GET /api/runs returns 400 for invalid status filter', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs?status=broken' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });

  it('GET /api/runs/:id returns run by id', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'detail-1', status: 'passed' })).run();
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/detail-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'detail-1', status: 'passed' });
  });

  it('GET /api/runs/:id returns 404 for missing run', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/missing-run' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Run not found' });
  });

  it('GET /api/runs/export.csv returns CSV payload', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({
      id: 'csv-1',
      status: 'failed',
      total: 8,
      passed: 6,
      failed: 2,
      branch: 'main',
      commitSha: 'abc123',
    })).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/export.csv' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('id,status,startedAt,finishedAt,total,passed,failed,flaky,skipped,durationMs,branch,commitSha,triggeredBy');
    expect(res.body).toContain('"csv-1","failed"');
  });

  it('GET /api/runs/:id/gate-status returns computed gate payload', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({
      id: 'gate-1',
      total: 20,
      passed: 18,
      gateStatus: 'passed',
    })).run();
    testApp.db.insert(schema.qualityGateConfig).values({
      id: 'global',
      passRateThreshold: 85,
      maxDurationMs: null,
      maxFlakyCount: null,
      updatedAt: '2023-11-14T22:13:20.000Z',
    }).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/gate-1/gate-status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      runId: 'gate-1',
      passed: true,
      gateStatus: 'passed',
      passRate: 90,
      threshold: 85,
    });
  });

  it('POST /api/runs starts run and returns runId', async () => {
    mockRunner.startRun.mockResolvedValueOnce('new-run-id');
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { grep: '@smoke', workers: 2, retries: 1 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ runId: 'new-run-id' });
    expect(mockRunner.startRun).toHaveBeenCalledWith({ grep: '@smoke', workers: 2, retries: 1 }, mockBridge);
  });

  it('POST /api/runs returns 400 for invalid payload', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { workers: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
    expect(mockRunner.startRun).not.toHaveBeenCalled();
  });

  it('DELETE /api/runs/:id aborts active run', async () => {
    const res = await testApp.app.inject({ method: 'DELETE', url: '/api/runs/abort-me' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ aborted: true });
    expect(mockRunner.abortRun).toHaveBeenCalledWith('abort-me');
  });

  it('DELETE /api/runs/:id returns 404 when run cannot be aborted', async () => {
    mockRunner.abortRun.mockReturnValueOnce(false);
    const res = await testApp.app.inject({ method: 'DELETE', url: '/api/runs/already-finished' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Run not found or already complete' });
  });

  it('GET /api/runs/:id/fingerprints groups failures by error message', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'fp-1' })).run();
    testApp.db.insert(schema.results).values([
      fixtures.result('t1', 'fp-1', { id: 'fp-res-1', status: 'failed', errorMessage: 'TimeoutError: element not found' }),
      fixtures.result('t2', 'fp-1', { id: 'fp-res-2', status: 'failed', errorMessage: 'TimeoutError: element not found' }),
      fixtures.result('t3', 'fp-1', { id: 'fp-res-3', status: 'failed', errorMessage: 'AssertionError: expected true to be false' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/fp-1/fingerprints' });
    const body = res.json() as Array<{ errorMessage: string; count: number }>;
    expect(res.statusCode).toBe(200);
    expect(body[0]).toMatchObject({ errorMessage: 'TimeoutError: element not found', count: 2 });
    expect(body[1]).toMatchObject({ errorMessage: 'AssertionError: expected true to be false', count: 1 });
  });
});
