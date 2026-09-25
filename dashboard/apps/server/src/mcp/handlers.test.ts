import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MCP_ERROR_CODES } from './contract.js';
import { createToolHandlers } from './handlers.js';

type QueryBuilder<T> = Promise<T> & {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
};

const selectMock = vi.hoisted(() => vi.fn());
const clusterErrorsMock = vi.hoisted(() => vi.fn());
const predictiveCandidatesMock = vi.hoisted(() => vi.fn());

vi.mock('../db/client.js', () => ({
  db: {
    select: selectMock,
  },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

vi.mock('../services/error-clustering.js', () => ({
  clusterErrors: clusterErrorsMock,
}));

vi.mock('../services/predictive-selection.js', () => ({
  getPredictiveCandidates: predictiveCandidatesMock,
}));

function createQueryBuilder<T>(rows: T): QueryBuilder<T> {
  const builder = Promise.resolve(rows) as QueryBuilder<T>;
  builder.from = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.groupBy = vi.fn(() => builder);
  builder.innerJoin = vi.fn(() => builder);
  return builder;
}

function parseResult(result: Awaited<ReturnType<ReturnType<typeof createToolHandlers>[string]>>) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('createToolHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs.list_recent returns mapped run objects with correct field names', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([
      {
        id: 'run-1',
        branch: 'main',
        status: 'passed',
        startedAt: '2026-03-20T00:00:00.000Z',
        durationMs: 1234,
        total: 15,
        passed: 14,
        failed: 1,
      },
    ]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['runs.list_recent']({}));

    expect(parsed).toEqual({
      runs: [
        {
          id: 'run-1',
          name: 'main',
          status: 'passed',
          startedAt: '2026-03-20T00:00:00.000Z',
          duration: 1234,
          totalTests: 15,
          passed: 14,
          failed: 1,
        },
      ],
    });
  });

  it('runs.list_recent respects limit parameter', async () => {
    const query = createQueryBuilder([]);
    selectMock.mockReturnValueOnce(query);

    const handlers = createToolHandlers();
    await handlers['runs.list_recent']({ limit: 7 });

    expect(query.limit).toHaveBeenCalledWith(7);
  });

  it('runs.get_summary_by_id returns run details with suite count', async () => {
    selectMock
      .mockReturnValueOnce(createQueryBuilder([
        {
          id: 'run-42',
          branch: null,
          status: 'failed',
          startedAt: '2026-03-21T00:00:00.000Z',
          durationMs: null,
          total: 10,
          passed: 7,
          failed: 3,
          skipped: 1,
          config: JSON.stringify({ environment: 'ci' }),
        },
      ]))
      .mockReturnValueOnce(createQueryBuilder([{ count: 4 }]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['runs.get_summary_by_id']({ runId: 'run-42' }));

    expect(parsed).toEqual({
      run: {
        id: 'run-42',
        name: 'Run run-42',
        status: 'failed',
        startedAt: '2026-03-21T00:00:00.000Z',
        duration: 0,
        totalTests: 10,
        passed: 7,
        failed: 3,
        skipped: 1,
        suites: 4,
        environment: 'ci',
      },
    });
  });

  it('runs.get_summary_by_id returns error for non-existent run', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['runs.get_summary_by_id']({ runId: 'missing' }));

    expect(parsed).toMatchObject({
      error: MCP_ERROR_CODES.INVALID_INPUT,
    });
  });

  it('tests.get_failures_by_run returns mapped failure objects', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([
      {
        testId: 'test-1',
        title: 'should fail',
        file: 'suite/a.spec.ts',
        errorMessage: null,
        errorStack: null,
        durationMs: null,
      },
    ]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['tests.get_failures_by_run']({ runId: 'run-1' }));

    expect(parsed).toEqual({
      failures: [
        {
          testId: 'test-1',
          name: 'should fail',
          suiteName: 'suite/a.spec.ts',
          errorMessage: 'Unknown error',
          duration: 0,
        },
      ],
    });
  });

  it('analytics.get_pass_rate computes correct pass rate ratio (0-1)', async () => {
    selectMock
      .mockReturnValueOnce(createQueryBuilder([
        { date: '2026-03-20', passed: 8, total: 10 },
        { date: '2026-03-21', passed: 12, total: 20 },
      ]))
      .mockReturnValueOnce(createQueryBuilder([{ value: 3 }]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['analytics.get_pass_rate']({ days: 7 }));

    expect(parsed).toMatchObject({
      passRate: 20 / 30,
      totalRuns: 3,
      period: {
        from: expect.any(String),
        to: expect.any(String),
      },
    });
  });

  it('analytics.get_duration_trend returns daily averages', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([
      { date: '2026-03-20', durationMs: 100 },
      { date: '2026-03-20', durationMs: 300 },
      { date: '2026-03-21', durationMs: 200 },
    ]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['analytics.get_duration_trend']({ days: 7 }));

    expect(parsed).toEqual({
      trend: [
        { date: '2026-03-20', avgDuration: 200, runCount: 2 },
        { date: '2026-03-21', avgDuration: 200, runCount: 1 },
      ],
    });
  });

  it('tests.get_error_clusters maps cluster output to contract shape', async () => {
    clusterErrorsMock.mockResolvedValueOnce([
      {
        clusterId: 'c1',
        sampleError: 'Timeout 5000ms exceeded',
        sampleStack: 'stack',
        testIds: ['t1', 't2', 't3', 't4'],
        count: 4,
      },
    ]);

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['tests.get_error_clusters']({ runId: 'run-1' }));

    expect(parsed).toEqual({
      clusters: [
        {
          clusterId: 'c1',
          pattern: 'Timeout 5000ms exceeded',
          count: 4,
          severity: 'medium',
          examples: ['t1', 't2', 't3'],
        },
      ],
    });
  });

  it('tests.get_error_clusters severity mapping correct (count thresholds)', async () => {
    clusterErrorsMock.mockResolvedValueOnce([
      { clusterId: 'c-low', sampleError: 'a', sampleStack: null, testIds: ['1'], count: 1 },
      { clusterId: 'c-medium', sampleError: 'b', sampleStack: null, testIds: ['1', '2'], count: 2 },
      { clusterId: 'c-high', sampleError: 'c', sampleStack: null, testIds: ['1', '2', '3', '4', '5'], count: 5 },
      { clusterId: 'c-critical', sampleError: 'd', sampleStack: null, testIds: ['1', '2', '3'], count: 10 },
    ]);

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['tests.get_error_clusters']({ runId: 'run-2', limit: 10 }));

    expect(parsed).toEqual({
      clusters: [
        expect.objectContaining({ clusterId: 'c-low', severity: 'low' }),
        expect.objectContaining({ clusterId: 'c-medium', severity: 'medium' }),
        expect.objectContaining({ clusterId: 'c-high', severity: 'high' }),
        expect.objectContaining({ clusterId: 'c-critical', severity: 'critical' }),
      ],
    });
  });

  it('tests.get_predictive_candidates returns candidates or empty fallback', async () => {
    predictiveCandidatesMock.mockResolvedValueOnce({
      candidates: [
        { testFile: 'a.spec.ts', title: 'A', score: 0.9, reason: 'changed import' },
      ],
      mode: 'full',
      totalHistoricalRuns: 100,
      coldStartThreshold: 20,
    });

    const handlers = createToolHandlers();
    const full = parseResult(await handlers['tests.get_predictive_candidates']({ changedFiles: ['src/a.ts'] }));
    expect(full).toEqual({
      candidates: [
        { testId: 'a.spec.ts', testName: 'A', score: 0.9, reason: 'changed import' },
      ],
      mode: 'full',
    });

    predictiveCandidatesMock.mockRejectedValueOnce(new Error('service unavailable'));
    const fallback = parseResult(await handlers['tests.get_predictive_candidates']({ changedFiles: ['src/a.ts'] }));
    expect(fallback).toEqual({ candidates: [], mode: 'static_only' });
  });

  it('returns internal error content on DB failure', async () => {
    selectMock.mockImplementationOnce(() => {
      throw new Error('db exploded');
    });

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['runs.list_recent']({}));

    expect(parsed).toEqual({
      error: MCP_ERROR_CODES.INTERNAL_ERROR,
      message: 'db exploded',
    });
  });

  // --- Quarantine tools ---
  it('quarantine.list_quarantined returns quarantined tests', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([
      {
        id: 'q-1',
        testTitle: 'flaky login test',
        testFile: 'auth.spec.ts',
        reason: 'Flaky on CI',
        quarantinedAt: '2026-03-20T00:00:00.000Z',
        quarantinedBy: 'auto',
      },
    ]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['quarantine.list_quarantined']({}));

    expect(parsed).toEqual({
      tests: [
        {
          id: 'q-1',
          testTitle: 'flaky login test',
          testFile: 'auth.spec.ts',
          reason: 'Flaky on CI',
          quarantinedAt: '2026-03-20T00:00:00.000Z',
          quarantinedBy: 'auto',
        },
      ],
    });
  });

  it('quarantine.list_quarantined returns empty array for no quarantined tests', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['quarantine.list_quarantined']({}));

    expect(parsed).toEqual({ tests: [] });
  });

  it('quarantine.get_details returns quarantine record for known test', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([
      {
        id: 'q-1',
        testTitle: 'flaky login test',
        testFile: 'auth.spec.ts',
        reason: 'Flaky on CI',
        quarantinedAt: '2026-03-20T00:00:00.000Z',
        quarantinedBy: 'auto',
      },
    ]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['quarantine.get_details']({ testTitle: 'flaky login test' }));

    expect(parsed).toEqual({
      quarantine: {
        id: 'q-1',
        testTitle: 'flaky login test',
        testFile: 'auth.spec.ts',
        reason: 'Flaky on CI',
        quarantinedAt: '2026-03-20T00:00:00.000Z',
        quarantinedBy: 'auto',
      },
    });
  });

  it('quarantine.get_details returns null for unknown test', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['quarantine.get_details']({ testTitle: 'nonexistent' }));

    expect(parsed).toEqual({ quarantine: null });
  });

  it('quarantine.get_details returns error when testTitle missing', async () => {
    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['quarantine.get_details']({}));

    expect(parsed).toMatchObject({
      error: MCP_ERROR_CODES.INVALID_INPUT,
    });
  });

  // --- Run comparison ---
  it('runs.compare identifies new failures, fixed, and regressions', async () => {
    // Base run results
    selectMock.mockReturnValueOnce(createQueryBuilder([
      { stableId: 'test-a', title: 'Test A', status: 'passed', errorMessage: null },
      { stableId: 'test-b', title: 'Test B', status: 'failed', errorMessage: 'old error' },
      { stableId: 'test-c', title: 'Test C', status: 'passed', errorMessage: null },
    ]));
    // Head run results
    selectMock.mockReturnValueOnce(createQueryBuilder([
      { stableId: 'test-a', title: 'Test A', status: 'failed', errorMessage: 'new error' },
      { stableId: 'test-b', title: 'Test B', status: 'passed', errorMessage: null },
      { stableId: 'test-c', title: 'Test C', status: 'passed', errorMessage: null },
    ]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['runs.compare']({ baseRunId: 'run-1', headRunId: 'run-2' }));

    expect(parsed).toEqual({
      newFailures: [
        { testId: 'test-a', testName: 'Test A', errorMessage: 'new error' },
      ],
      fixed: [
        { testId: 'test-b', testName: 'Test B' },
      ],
      regressions: [],
      summary: {
        baseTotal: 3,
        headTotal: 3,
        basePassed: 2,
        headPassed: 2,
      },
    });
  });

  it('runs.compare returns error when baseRunId is missing', async () => {
    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['runs.compare']({ headRunId: 'run-2' }));

    expect(parsed).toMatchObject({
      error: MCP_ERROR_CODES.INVALID_INPUT,
    });
  });

  // --- Flaky tests ---
  it('tests.get_flaky returns flaky tests above threshold', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([
      { stableId: 'stable-1', title: 'Flaky Test', file: 'flaky.spec.ts', flakyCount: 5, totalRuns: 10, lastSeen: '2026-03-25' },
      { stableId: 'stable-2', title: 'Stable Test', file: 'stable.spec.ts', flakyCount: 1, totalRuns: 10, lastSeen: '2026-03-25' },
    ]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['tests.get_flaky']({ days: 14, minFlipCount: 3 }));

    expect(parsed).toEqual({
      flakyTests: [
        { stableId: 'stable-1', testName: 'Flaky Test', testFile: 'flaky.spec.ts', flakyCount: 5, totalRuns: 10, lastSeen: '2026-03-25' },
      ],
    });
  });

  it('tests.get_flaky returns empty array when no flaky tests', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['tests.get_flaky']({}));

    expect(parsed).toEqual({ flakyTests: [] });
  });

  // --- Schedules ---
  it('schedules.list returns all schedules', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([
      { id: 'sched-1', cronExpr: '0 0 * * *', enabled: true, lastRunAt: '2026-03-24', createdAt: '2026-01-01', runOptions: null },
    ]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['schedules.list']({}));

    expect(parsed).toEqual({
      schedules: [
        { id: 'sched-1', cronExpr: '0 0 * * *', enabled: true, lastRunAt: '2026-03-24', createdAt: '2026-01-01' },
      ],
    });
  });

  it('schedules.get_by_id returns schedule for known id', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([
      { id: 'sched-1', cronExpr: '0 0 * * *', enabled: true, lastRunAt: null, createdAt: '2026-01-01', runOptions: '{"suite":"smoke"}' },
    ]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['schedules.get_by_id']({ scheduleId: 'sched-1' }));

    expect(parsed).toEqual({
      schedule: {
        id: 'sched-1',
        cronExpr: '0 0 * * *',
        runOptions: '{"suite":"smoke"}',
        enabled: true,
        createdAt: '2026-01-01',
      },
    });
  });

  it('schedules.get_by_id returns null for unknown id', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['schedules.get_by_id']({ scheduleId: 'missing' }));

    expect(parsed).toEqual({ schedule: null });
  });

  it('schedules.get_by_id returns error when scheduleId missing', async () => {
    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['schedules.get_by_id']({}));

    expect(parsed).toMatchObject({
      error: MCP_ERROR_CODES.INVALID_INPUT,
    });
  });

  // --- Integration status ---
  it('integrations.get_status returns integration types with configured status', async () => {
    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['integrations.get_status']({}));

    const integrations = parsed.integrations as Array<{ type: string; configured: boolean }>;
    expect(integrations).toBeInstanceOf(Array);
    expect(integrations.length).toBe(6);
    expect(integrations.map((i) => i.type)).toEqual(['slack', 'jira', 'github', 'gitlab', 'email', 'webhooks']);
    for (const integration of integrations) {
      expect(typeof integration.configured).toBe('boolean');
    }
  });

  // --- Gate status ---
  it('runs.get_gate_status returns gate status for a run with gate evaluated', async () => {
    selectMock
      .mockReturnValueOnce(createQueryBuilder([{
        id: 'run-gate-1',
        gateStatus: 'passed',
        total: 10,
        passed: 9,
        failed: 1,
      }]))
      .mockReturnValueOnce(createQueryBuilder([{ passRateThreshold: 95, id: 'global' }]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['runs.get_gate_status']({ runId: 'run-gate-1' }));

    expect(parsed).toEqual({
      gateStatus: 'passed',
      passed: true,
      passRate: 90,
      threshold: 95,
      failedTests: 1,
      totalTests: 10,
    });
  });

  it('runs.get_gate_status returns skipped gate for run without gate evaluation', async () => {
    selectMock
      .mockReturnValueOnce(createQueryBuilder([{
        id: 'run-no-gate',
        gateStatus: null,
        total: 5,
        passed: 5,
        failed: 0,
      }]))
      .mockReturnValueOnce(createQueryBuilder([]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['runs.get_gate_status']({ runId: 'run-no-gate' }));

    expect(parsed).toMatchObject({
      gateStatus: 'skipped',
      passed: false,
      passRate: 100,
      threshold: 100,
      failedTests: 0,
      totalTests: 5,
    });
  });

  it('runs.get_gate_status returns invalid input when runId missing', async () => {
    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['runs.get_gate_status']({}));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INVALID_INPUT });
  });

  it('runs.get_gate_status returns invalid input for unknown run', async () => {
    selectMock.mockReturnValueOnce(createQueryBuilder([]));

    const handlers = createToolHandlers();
    const parsed = parseResult(await handlers['runs.get_gate_status']({ runId: 'no-such-run' }));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INVALID_INPUT });
  });
});
