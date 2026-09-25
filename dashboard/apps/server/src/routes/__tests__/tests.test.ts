import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import * as fixtures from '../../test/fixtures.js';
import * as schema from '../../db/schema.js';

const {
  mockAnalyzeImpact,
  mockComputeStabilityGrade,
  mockComputeStabilityGradesBatch,
  mockExecSync,
  mockExistsSync,
  mockReadFileSync,
} = vi.hoisted(() => ({
  mockAnalyzeImpact: vi.fn<(changedFiles: string[]) => Promise<Array<{ stableId: string }>>>(),
  mockComputeStabilityGrade: vi.fn<(stableId: string, lookback?: number) => Promise<{ grade: string; passRate: number; totalRuns: number }>>(),
  mockComputeStabilityGradesBatch: vi.fn<(stableIds: string[], lookback?: number) => Promise<Record<string, { grade: string; passRate: number; totalRuns: number }>>>(),
  mockExecSync: vi.fn<(command: string, options?: unknown) => string>(),
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockReadFileSync: vi.fn<(path: string, encoding: string) => string>(),
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

vi.mock('../../services/impact-analysis.js', () => ({
  analyzeImpact: mockAnalyzeImpact,
}));

vi.mock('../../services/stability-grades.js', () => ({
  computeStabilityGrade: mockComputeStabilityGrade,
  computeStabilityGradesBatch: mockComputeStabilityGradesBatch,
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

describe('tests routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { testsRoutes } = await import('../tests.js');
    await testsRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM results; DELETE FROM tests; DELETE FROM runs;');
    vi.clearAllMocks();

    mockAnalyzeImpact.mockResolvedValue([]);
    mockComputeStabilityGrade.mockResolvedValue({ grade: 'A', passRate: 0.95, totalRuns: 20 });
    mockExecSync.mockReturnValue('');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('line1\nline2\nline3');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/runs/:runId/tests returns tests matching runId', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'run-a', status: 'passed' }),
      fixtures.run({ id: 'run-b', status: 'passed' }),
    ]).run();

    testApp.db.insert(schema.tests).values([
      fixtures.test('run-a', { id: 'test-a1', title: 'A1' }),
      fixtures.test('run-a', { id: 'test-a2', title: 'A2' }),
      fixtures.test('run-b', { id: 'test-b1', title: 'B1' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-a/tests' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; runId: string }>;
    expect(body).toHaveLength(2);
    expect(body.map((t) => t.id).sort()).toEqual(['test-a1', 'test-a2']);
    expect(body.every((t) => t.runId === 'run-a')).toBe(true);
  });

  it('GET /api/runs/:runId/tests returns empty array when run has no tests', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'run-empty', status: 'passed' })).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-empty/tests' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/runs/:runId/tests/:testId returns test with results array', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'run-single', status: 'failed' })).run();
    testApp.db.insert(schema.tests).values(
      fixtures.test('run-single', { id: 'test-1', title: 'single test', status: 'failed' }),
    ).run();
    testApp.db.insert(schema.results).values([
      fixtures.result('test-1', 'run-single', { id: 'res-1', retry: 0, status: 'failed' }),
      fixtures.result('test-1', 'run-single', { id: 'res-2', retry: 1, status: 'passed' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-single/tests/test-1' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; results: Array<{ id: string; retry: number; status: string }> };
    expect(body.id).toBe('test-1');
    expect(body.results).toHaveLength(2);
    expect(body.results.map((r) => r.id).sort()).toEqual(['res-1', 'res-2']);
  });

  it('GET /api/runs/:runId/tests/:testId returns 404 when not found', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'run-missing', status: 'passed' })).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/run-missing/tests/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Test not found' });
  });

  it('GET /api/tests/history/:stableId returns cross-run history ordered by run date', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'run-1', status: 'passed', startedAt: '2026-01-01T10:00:00.000Z', branch: 'main', commitSha: 'sha-1' }),
      fixtures.run({ id: 'run-2', status: 'failed', startedAt: '2026-01-02T10:00:00.000Z', branch: 'main', commitSha: 'sha-2' }),
      fixtures.run({ id: 'run-3', status: 'passed', startedAt: '2026-01-03T10:00:00.000Z', branch: 'main', commitSha: 'sha-3' }),
    ]).run();

    testApp.db.insert(schema.tests).values([
      fixtures.test('run-1', { id: 't1', stableId: 'sid-1', status: 'passed', durationMs: 1200, retryCount: 0 }),
      fixtures.test('run-2', { id: 't2', stableId: 'sid-1', status: 'failed', durationMs: 2200, retryCount: 1 }),
      fixtures.test('run-3', { id: 't3', stableId: 'sid-1', status: 'passed', durationMs: 1100, retryCount: 0 }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/tests/history/sid-1' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ runId: string; runCommitSha: string }>;
    expect(body.map((r) => r.runId)).toEqual(['run-3', 'run-2', 'run-1']);
    expect(body.map((r) => r.runCommitSha)).toEqual(['sha-3', 'sha-2', 'sha-1']);
  });

  it('GET /api/tests/history/:stableId respects limit query parameter', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'limit-1', status: 'passed', startedAt: '2026-02-01T00:00:00.000Z' }),
      fixtures.run({ id: 'limit-2', status: 'passed', startedAt: '2026-02-02T00:00:00.000Z' }),
    ]).run();
    testApp.db.insert(schema.tests).values([
      fixtures.test('limit-1', { id: 'l1', stableId: 'sid-limit', status: 'passed' }),
      fixtures.test('limit-2', { id: 'l2', stableId: 'sid-limit', status: 'failed' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/tests/history/sid-limit?limit=1' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ runId: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].runId).toBe('limit-2');
  });

  it('GET /api/tests/history/:stableId caps limit at 100', async () => {
    const runsRows = Array.from({ length: 120 }, (_, i) =>
      fixtures.run({
        id: `cap-run-${i}`,
        status: 'passed',
        startedAt: `2026-03-${String((i % 28) + 1).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
      }),
    );
    testApp.db.insert(schema.runs).values(runsRows).run();
    testApp.db.insert(schema.tests).values(
      runsRows.map((r, i) => fixtures.test(r.id, { id: `cap-test-${i}`, stableId: 'sid-cap', status: 'passed' })),
    ).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/tests/history/sid-cap?limit=999' });

    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[])).toHaveLength(100);
  });

  it('GET /api/tests/history/:stableId uses default limit of 20 when limit is NaN', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/tests/history/sid-nan?limit=abc' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/tests/stability/:stableId uses default lookback of 20 when lookback is NaN', async () => {
    mockComputeStabilityGrade.mockResolvedValue({ grade: 'B', passRate: 0.8, totalRuns: 20 });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/tests/stability/sid-nan?lookback=abc' });

    expect(res.statusCode).toBe(200);
    expect(mockComputeStabilityGrade).toHaveBeenCalledWith('sid-nan', 20);
  });

  it('POST /api/tests/history/batch returns grouped statuses per stableId', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'bh-1', status: 'passed', startedAt: '2026-01-01T00:00:00.000Z' }),
      fixtures.run({ id: 'bh-2', status: 'passed', startedAt: '2026-01-02T00:00:00.000Z' }),
      fixtures.run({ id: 'bh-3', status: 'passed', startedAt: '2026-01-03T00:00:00.000Z' }),
    ]).run();
    testApp.db.insert(schema.tests).values([
      fixtures.test('bh-1', { id: 'bha-1', stableId: 'sid-a', status: 'failed' }),
      fixtures.test('bh-2', { id: 'bha-2', stableId: 'sid-a', status: 'passed' }),
      fixtures.test('bh-3', { id: 'bhb-1', stableId: 'sid-b', status: 'flaky' }),
    ]).run();

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tests/history/batch',
      payload: { stableIds: ['sid-a', 'sid-b'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      'sid-a': [{ status: 'passed' }, { status: 'failed' }],
      'sid-b': [{ status: 'flaky' }],
    });
  });

  it('POST /api/tests/history/batch returns {} for empty stableIds', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tests/history/batch',
      payload: { stableIds: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('POST /api/tests/history/batch returns 400 for invalid body', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tests/history/batch',
      payload: { ids: ['sid-a'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid request body');
  });

  it('POST /api/tests/history/batch limits each stableId to 7 entries', async () => {
    const runsRows = Array.from({ length: 9 }, (_, i) =>
      fixtures.run({
        id: `bh-limit-run-${i}`,
        status: 'passed',
        startedAt: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    testApp.db.insert(schema.runs).values(runsRows).run();
    testApp.db.insert(schema.tests).values(
      runsRows.map((r, i) =>
        fixtures.test(r.id, {
          id: `bh-limit-test-${i}`,
          stableId: 'sid-batch-limit',
          status: i % 2 === 0 ? 'passed' : 'failed',
        }),
      ),
    ).run();

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tests/history/batch',
      payload: { stableIds: ['sid-batch-limit'] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, Array<{ status: string }>>;
    expect(body['sid-batch-limit']).toHaveLength(7);
  });

  it('POST /api/tests/impacted calls analyzeImpact with changedFiles', async () => {
    mockAnalyzeImpact.mockResolvedValueOnce([{ stableId: 'sid-imp-1' }]);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tests/impacted',
      payload: { changedFiles: ['apps/server/src/routes/tests.ts'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ stableId: 'sid-imp-1' }]);
    expect(mockAnalyzeImpact).toHaveBeenCalledWith(['apps/server/src/routes/tests.ts']);
  });

  it('POST /api/tests/impacted returns 400 for invalid body', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tests/impacted',
      payload: { changed: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid request body');
  });

  it('GET /api/tests/git-diff returns changed files from git output', async () => {
    mockExecSync
      .mockImplementationOnce(() => 'a.ts\nb.ts\n')
      .mockImplementationOnce(() => 'b.ts\nc.ts\n');

    const res = await testApp.app.inject({ method: 'GET', url: '/api/tests/git-diff' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ changedFiles: ['a.ts', 'b.ts', 'c.ts'] });
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it('GET /api/tests/git-diff returns empty list when git command throws', async () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('git failed');
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/tests/git-diff' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ changedFiles: [] });
  });

  it('GET /api/tests/source returns file content and inferred language', async () => {
    mockExistsSync.mockReturnValueOnce(true);
    mockReadFileSync.mockReturnValueOnce('const a = 1;\nconst b = 2;');

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/tests/source?file=apps/server/src/routes/tests.ts',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      content: 'const a = 1;\nconst b = 2;',
      language: 'typescript',
      file: 'apps/server/src/routes/tests.ts',
      line: undefined,
      startLine: 1,
    });
  });

  it('GET /api/tests/source returns 400 when file query is missing', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/tests/source' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Missing file query parameter' });
  });

  it('GET /api/tests/source returns 404 when target file does not exist', async () => {
    mockExistsSync.mockReturnValueOnce(false);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/tests/source?file=missing/file.ts' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'File not found' });
  });

  it('GET /api/tests/source returns windowed content for a targeted line in long file', async () => {
    const longContent = Array.from({ length: 600 }, (_, i) => `line-${i + 1}`).join('\n');
    mockExistsSync.mockReturnValueOnce(true);
    mockReadFileSync.mockReturnValueOnce(longContent);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/tests/source?file=apps/server/src/routes/tests.ts&line=550',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { line: number; startLine: number; content: string };
    expect(body.line).toBe(550);
    expect(body.startLine).toBe(301);
    expect(body.content.startsWith('line-301')).toBe(true);
    expect(body.content.includes('line-550')).toBe(true);
  });

  it('GET /api/tests/stability/:stableId returns grade for stableId with lookback cap', async () => {
    mockComputeStabilityGrade.mockResolvedValueOnce({ grade: 'B', passRate: 0.8, totalRuns: 10 });

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/tests/stability/sid-stable?lookback=999',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ grade: 'B', passRate: 0.8, totalRuns: 10 });
    expect(mockComputeStabilityGrade).toHaveBeenCalledWith('sid-stable', 100);
  });

  it('GET /api/tests/stability/:stableId uses default lookback of 20 when no query param given', async () => {
    mockComputeStabilityGrade.mockResolvedValueOnce({ grade: 'A', passRate: 0.95, totalRuns: 20 });

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/tests/stability/sid-default',
    });

    expect(res.statusCode).toBe(200);
    expect(mockComputeStabilityGrade).toHaveBeenCalledWith('sid-default', 20);
  });

  it('POST /api/tests/stability/batch returns grades for multiple stableIds', async () => {
    mockComputeStabilityGradesBatch.mockResolvedValue({
      'sid-1': { grade: 'A', passRate: 0.95, totalRuns: 20 },
      'sid-2': { grade: 'C', passRate: 0.6, totalRuns: 8 },
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tests/stability/batch',
      payload: { stableIds: ['sid-1', 'sid-2'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      'sid-1': { grade: 'A', passRate: 0.95, totalRuns: 20 },
      'sid-2': { grade: 'C', passRate: 0.6, totalRuns: 8 },
    });
  });

  it('POST /api/tests/stability/batch returns {} for empty stableIds', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tests/stability/batch',
      payload: { stableIds: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('POST /api/tests/stability/batch returns 400 for invalid body', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/tests/stability/batch',
      payload: { ids: ['sid-1'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid request body');
  });
});
