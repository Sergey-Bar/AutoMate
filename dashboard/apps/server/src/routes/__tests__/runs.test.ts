import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import * as fixtures from '../../test/fixtures.js';
import * as schema from '../../db/schema.js';

const {
  mockRunner,
  mockGenerateHtmlReport,
  mockGenerateRunPdf,
} = vi.hoisted(() => ({
  mockRunner: {
    startRun: vi.fn<(...args: unknown[]) => Promise<string>>(),
    abortRun: vi.fn<(runId: string) => boolean>(),
    listTests: vi.fn<(configPath?: string) => Promise<object>>(),
  },
  mockGenerateHtmlReport: vi.fn<(runId: string) => string>(),
  mockGenerateRunPdf: vi.fn<(runId: string) => Promise<Buffer>>(),
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

vi.mock('../../services/runner.js', () => ({
  runner: mockRunner,
}));

vi.mock('../../services/html-report.js', () => ({
  generateHtmlReport: mockGenerateHtmlReport,
}));

vi.mock('../../services/pdf-report.js', () => ({
  generateRunPdf: mockGenerateRunPdf,
}));

const mockBridge = {
  runner: {
    startRun: vi.fn(),
    abortRun: vi.fn(),
  },
  computeGateStatus: vi.fn(),
};

describe('runs routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { runsRoutes } = await import('../runs.js');
    await runsRoutes(testApp.app, { bridge: mockBridge as Parameters<typeof runsRoutes>[1]['bridge'] });
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM results; DELETE FROM tests; DELETE FROM quality_gate_config; DELETE FROM runs;');
    vi.clearAllMocks();
    mockRunner.startRun.mockResolvedValue('run-started-id');
    mockRunner.abortRun.mockReturnValue(true);
    mockRunner.listTests.mockResolvedValue({ suites: [] });
    mockGenerateHtmlReport.mockReturnValue('<html>report</html>');
    mockGenerateRunPdf.mockResolvedValue(Buffer.from('fake-pdf'));
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
    const older = fixtures.run({ id: 'run-old', startedAt: '2025-01-01T00:00:00.000Z' });
    const newer = fixtures.run({ id: 'run-new', startedAt: '2025-01-02T00:00:00.000Z' });

    testApp.db.insert(schema.runs).values(older).run();
    testApp.db.insert(schema.runs).values(newer).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('run-new');
    expect(body[1].id).toBe('run-old');
  });

  it('GET /api/runs filters by workspaceId when provided', async () => {
    const runA = fixtures.run({ id: 'run-a', workspaceId: 'ws-a' });
    const runB = fixtures.run({ id: 'run-b', workspaceId: 'ws-b' });
    testApp.db.insert(schema.runs).values(runA).run();
    testApp.db.insert(schema.runs).values(runB).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs?workspaceId=ws-a' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe('run-a');
  });

  it('GET /api/runs/:id returns run when found', async () => {
    const run = fixtures.run({ id: 'run-1', status: 'passed' });
    testApp.db.insert(schema.runs).values(run).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-1' });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('run-1');
    expect(res.json().status).toBe('passed');
  });

  it('GET /api/runs/:id returns 404 when not found', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/missing' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Run not found' });
  });

  it('GET /api/runs/export.csv returns CSV with run data', async () => {
    const run = fixtures.run({
      id: 'run-csv',
      status: 'failed',
      total: 5,
      passed: 3,
      failed: 2,
      branch: 'main',
      commitSha: 'abc123',
      triggeredBy: 'ci',
    });
    testApp.db.insert(schema.runs).values(run).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/export.csv' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('id,status,startedAt,finishedAt,total,passed,failed,flaky,skipped,durationMs,branch,commitSha,triggeredBy');
    expect(res.body).toContain('"run-csv","failed"');
    expect(res.body).toContain('"5","3","2"');
  });

  it('GET /api/runs/:id/gate-status returns computed gate payload', async () => {
    const run = fixtures.run({
      id: 'run-gate',
      total: 10,
      passed: 8,
      gateStatus: 'failed',
    });
    testApp.db.insert(schema.runs).values(run).run();
    testApp.db.insert(schema.qualityGateConfig).values({
      id: 'global',
      passRateThreshold: 85,
      maxDurationMs: null,
      maxFlakyCount: null,
      updatedAt: '2023-11-14T22:13:20.000Z',
    }).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-gate/gate-status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      runId: 'run-gate',
      passed: false,
      gateStatus: 'failed',
      passRate: 80,
      threshold: 85,
    });
  });

  it('GET /api/runs/:id/gate-status returns 404 when run missing', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/nope/gate-status' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Run not found' });
  });

  it('GET /api/runs/:id/report.html returns html attachment', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/abcdef123456/report.html' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-disposition']).toContain('run-abcdef12-report.html');
    expect(res.body).toContain('<html>report</html>');
    expect(mockGenerateHtmlReport).toHaveBeenCalledWith('abcdef123456');
  });

  it('GET /api/runs/:id/report.html returns 404 on report generation error', async () => {
    mockGenerateHtmlReport.mockImplementationOnce(() => {
      throw new Error('report not found');
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/no-report/report.html' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'report not found' });
  });

  it('GET /api/runs/:id/report.pdf returns pdf attachment', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/abcdef123456/report.pdf' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('run-abcdef12-report.pdf');
    expect(mockGenerateRunPdf).toHaveBeenCalledWith('abcdef123456');
  });

  it('GET /api/runs/:id/report.pdf returns 404 on report generation error', async () => {
    mockGenerateRunPdf.mockRejectedValueOnce(new Error('pdf failed'));

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/no-report/report.pdf' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'pdf failed' });
  });

  it('DELETE /api/runs/:id aborts run through runner', async () => {
    const res = await testApp.app.inject({ method: 'DELETE', url: '/api/runs/run-to-abort' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ aborted: true });
    expect(mockRunner.abortRun).toHaveBeenCalledWith('run-to-abort');
  });

  it('DELETE /api/runs/:id returns 404 when runner cannot abort', async () => {
    mockRunner.abortRun.mockReturnValueOnce(false);

    const res = await testApp.app.inject({ method: 'DELETE', url: '/api/runs/already-done' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Run not found or already complete' });
  });

  it('POST /api/runs validates body, starts run, and returns runId', async () => {
    mockRunner.startRun.mockResolvedValueOnce('run-new-id');

    const payload = {
      projects: ['chromium'],
      grep: 'smoke',
      workers: 2,
      retries: 1,
    };
    const res = await testApp.app.inject({ method: 'POST', url: '/api/runs', payload });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ runId: 'run-new-id' });
    expect(mockRunner.startRun).toHaveBeenCalledWith(payload, mockBridge);
  });

  it('POST /api/runs returns 400 on invalid body', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { workers: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
    expect(mockRunner.startRun).not.toHaveBeenCalled();
  });

  it('POST /api/runs/trigger starts run and returns runId', async () => {
    mockRunner.startRun.mockResolvedValueOnce('trigger-id');

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/runs/trigger',
      payload: { grep: '@critical' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ runId: 'trigger-id' });
    expect(mockRunner.startRun).toHaveBeenCalledWith({ grep: '@critical' }, mockBridge);
  });

  it('GET /api/runs/:id/fingerprints groups failing results by error message', async () => {
    const run = fixtures.run({ id: 'run-fp' });
    testApp.db.insert(schema.runs).values(run).run();

    const result1 = fixtures.result('test-1', 'run-fp', { id: 'res-1', status: 'failed', errorMessage: 'TimeoutError: element not found' });
    const result2 = fixtures.result('test-2', 'run-fp', { id: 'res-2', status: 'failed', errorMessage: 'TimeoutError: element not found' });
    const result3 = fixtures.result('test-3', 'run-fp', { id: 'res-3', status: 'failed', errorMessage: 'AssertionError: expected true to be false' });
    const result4 = fixtures.result('test-4', 'run-fp', { id: 'res-4', status: 'failed', errorMessage: null });

    testApp.db.insert(schema.results).values([result1, result2, result3, result4]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-fp/fingerprints' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      fingerprint: 'TimeoutError: element not found',
      count: 2,
      errorMessage: 'TimeoutError: element not found',
    });
    expect(body[0].testIds).toEqual(expect.arrayContaining(['test-1', 'test-2']));

    const assertionGroup = body.find((g: { errorMessage: string }) => g.errorMessage.includes('AssertionError'));
    expect(assertionGroup).toBeDefined();
    expect(assertionGroup.count).toBe(1);
    expect(assertionGroup.testIds).toEqual(['test-3']);
  });

  it('GET /api/runs/:id/fingerprints returns empty array when no failing results', async () => {
    const run = fixtures.run({ id: 'run-fp-empty' });
    testApp.db.insert(schema.runs).values(run).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-fp-empty/fingerprints' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/runs/:id/tests/export.csv returns CSV with test data joined to first result', async () => {
    const run = fixtures.run({ id: 'run-tests-csv' });
    const test = fixtures.test('run-tests-csv', {
      id: 'test-csv',
      title: 'exports row',
      file: 'tests/export.spec.ts',
      status: 'failed',
      retryCount: 1,
      workerIndex: 2,
      tags: '["@smoke"]',
    });
    const firstResult = fixtures.result('test-csv', 'run-tests-csv', {
      id: 'res-csv-0',
      retry: 0,
      status: 'failed',
      errorMessage: 'boom',
    });
    const retryResult = fixtures.result('test-csv', 'run-tests-csv', {
      id: 'res-csv-1',
      retry: 1,
      status: 'passed',
      errorMessage: null,
    });

    testApp.db.insert(schema.runs).values(run).run();
    testApp.db.insert(schema.tests).values(test).run();
    testApp.db.insert(schema.results).values([firstResult, retryResult]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-tests-csv/tests/export.csv' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('title,file,status,duration_ms,retry_count,tags,worker_index,error_message,result_retry');
    expect(res.body).toContain('"exports row","tests/export.spec.ts","failed"');
    expect(res.body).toContain('"boom","0"');
  });

  it('GET /api/runs/:id/junit.xml returns junit xml with failures and skipped tests', async () => {
    const run = fixtures.run({ id: 'run-junit' });
    const passed = fixtures.test('run-junit', {
      id: 'test-junit-pass',
      title: 'passes',
      file: 'tests/a.spec.ts',
      status: 'passed',
      durationMs: 500,
    });
    const failed = fixtures.test('run-junit', {
      id: 'test-junit-fail',
      title: 'fails',
      file: 'tests/a.spec.ts',
      status: 'failed',
      durationMs: 750,
    });
    const skipped = fixtures.test('run-junit', {
      id: 'test-junit-skip',
      title: 'skips',
      file: 'tests/b.spec.ts',
      status: 'skipped',
      durationMs: 0,
    });
    const failedResult = fixtures.result('test-junit-fail', 'run-junit', {
      id: 'res-junit-fail',
      retry: 0,
      status: 'failed',
      errorMessage: '<bad & "quote">',
      errorStack: 'stack line',
    });

    testApp.db.insert(schema.runs).values(run).run();
    testApp.db.insert(schema.tests).values([passed, failed, skipped]).run();
    testApp.db.insert(schema.results).values(failedResult).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-junit/junit.xml' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(res.body).toContain('<testsuite name="tests/a.spec.ts" tests="2" failures="1" skipped="0"');
    expect(res.body).toContain('<failure message="&lt;bad &amp; &quot;quote&quot;&gt;">stack line</failure>');
    expect(res.body).toContain('<skipped/>');
  });

  it('GET /api/runs/:id/junit.xml returns 404 when run not found', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/missing/junit.xml' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Run not found' });
  });

  it('GET /api/runs/compare returns semantic changes between runs', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'run-a' }),
      fixtures.run({ id: 'run-b' }),
    ]).run();

    const runATests = [
      fixtures.test('run-a', { id: 'a-1', stableId: 'sid-1', title: 'new failure test', file: 'a.spec.ts', status: 'passed' }),
      fixtures.test('run-a', { id: 'a-2', stableId: 'sid-2', title: 'fixed test', file: 'a.spec.ts', status: 'failed' }),
      fixtures.test('run-a', { id: 'a-3', stableId: 'sid-3', title: 'regression test', file: 'a.spec.ts', status: 'failed' }),
      fixtures.test('run-a', { id: 'a-4', stableId: 'sid-4', title: 'unchanged test', file: 'a.spec.ts', status: 'passed' }),
      fixtures.test('run-a', { id: 'a-5', stableId: 'sid-5', title: 'removed test', file: 'a.spec.ts', status: 'passed' }),
    ];
    const runBTests = [
      fixtures.test('run-b', { id: 'b-1', stableId: 'sid-1', title: 'new failure test', file: 'a.spec.ts', status: 'failed' }),
      fixtures.test('run-b', { id: 'b-2', stableId: 'sid-2', title: 'fixed test', file: 'a.spec.ts', status: 'passed' }),
      fixtures.test('run-b', { id: 'b-3', stableId: 'sid-3', title: 'regression test', file: 'a.spec.ts', status: 'timedOut' }),
      fixtures.test('run-b', { id: 'b-4', stableId: 'sid-4', title: 'unchanged test', file: 'a.spec.ts', status: 'passed' }),
      fixtures.test('run-b', { id: 'b-6', stableId: 'sid-6', title: 'added test', file: 'a.spec.ts', status: 'skipped' }),
    ];

    testApp.db.insert(schema.tests).values([...runATests, ...runBTests]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/compare?a=run-a&b=run-b' });
    const body = res.json() as Array<{ title: string; changeType: string }>;

    expect(res.statusCode).toBe(200);
    expect(body[0].changeType).toBe('new_failure');
    expect(body[1].changeType).toBe('regression');
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'new failure test', changeType: 'new_failure' }),
        expect.objectContaining({ title: 'fixed test', changeType: 'fixed' }),
        expect.objectContaining({ title: 'regression test', changeType: 'regression' }),
        expect.objectContaining({ title: 'unchanged test', changeType: 'unchanged' }),
        expect.objectContaining({ title: 'removed test', changeType: 'removed' }),
        expect.objectContaining({ title: 'added test', changeType: 'added' }),
      ]),
    );
  });

  it('GET /api/runs/compare returns 400 when required params are missing', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/compare?a=run-a' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Both ?a= and ?b= are required' });
  });

  it('GET /api/runs/list returns listTests response from runner', async () => {
    mockRunner.listTests.mockResolvedValueOnce({ suites: [{ title: 'suite A' }] });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/list?config=playwright.config.ts' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ suites: [{ title: 'suite A' }] });
    expect(mockRunner.listTests).toHaveBeenCalledWith('playwright.config.ts');
  });
});
