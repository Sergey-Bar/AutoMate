/**
 * handlers-branches.test.ts
 *
 * Additional branch coverage for createToolHandlers().
 * Covers: error paths, workspaceId filters, null-coalescing edges,
 * runs.compare regressions, tests.get_flaky null stableId,
 * integrations.get_status config file present, parseEnvironment edge cases,
 * analytics pass-rate zero total, predictive candidates non-array changedFiles.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MCP_ERROR_CODES } from './contract.js';
import { createToolHandlers } from './handlers.js';

// ── fs mock (for integrations.get_status) ────────────────────────────────────
const { fsMock } = vi.hoisted(() => ({
  fsMock: {
    readFileSync: vi.fn<(p: string, enc: string) => string>(),
  },
}));

vi.mock('node:fs', () => ({
  readFileSync: fsMock.readFileSync,
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
const selectMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());

vi.mock('../db/client.js', () => ({
  db: {
    select: selectMock,
    update: updateMock,
  },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

// ── Cluster / predictive mocks ────────────────────────────────────────────────
const clusterErrorsMock = vi.hoisted(() => vi.fn());
const predictiveCandidatesMock = vi.hoisted(() => vi.fn());

vi.mock('../services/error-clustering.js', () => ({
  clusterErrors: clusterErrorsMock,
}));

vi.mock('../services/predictive-selection.js', () => ({
  getPredictiveCandidates: predictiveCandidatesMock,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

type QueryBuilder<T> = Promise<T> & {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
};

function qb<T>(rows: T): QueryBuilder<T> {
  const builder = Promise.resolve(rows) as QueryBuilder<T>;
  builder.from = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.groupBy = vi.fn(() => builder);
  builder.innerJoin = vi.fn(() => builder);
  return builder;
}

function parse(result: Awaited<ReturnType<ReturnType<typeof createToolHandlers>[string]>>) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('handlers — additional branch coverage', () => {

  // ── workspaceId filter branch ─────────────────────────────────────────────

  it('runs.list_recent passes workspaceId eq-filter to DB query', async () => {
    const q = qb([]);
    selectMock.mockReturnValueOnce(q);

    const handlers = createToolHandlers();
    await handlers['runs.list_recent']({ workspaceId: 'ws-abc' });

    // where() should have been called (with workspaceId eq filter)
    expect(q.where).toHaveBeenCalled();
  });

  it('analytics.get_pass_rate with workspaceId calls where with filter', async () => {
    selectMock
      .mockReturnValueOnce(qb([{ date: '2026-01-01', passed: 5, total: 10 }]))
      .mockReturnValueOnce(qb([{ value: 1 }]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['analytics.get_pass_rate']({ workspaceId: 'ws-x', days: 7 }));

    expect(parsed).toMatchObject({ passRate: 0.5, totalRuns: 1 });
  });

  it('analytics.get_pass_rate passRate is 0 when total is 0', async () => {
    selectMock
      .mockReturnValueOnce(qb([{ date: '2026-01-01', passed: 0, total: 0 }]))
      .mockReturnValueOnce(qb([{ value: 1 }]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['analytics.get_pass_rate']({}));

    expect((parsed as { passRate: number }).passRate).toBe(0);
  });

  it('analytics.get_duration_trend with workspaceId executes without error', async () => {
    selectMock.mockReturnValueOnce(qb([{ date: '2026-01-01', durationMs: 500 }]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['analytics.get_duration_trend']({ workspaceId: 'ws-dur' }));

    expect(parsed).toHaveProperty('trend');
  });

  // ── parseEnvironment branches ─────────────────────────────────────────────

  it('runs.get_summary_by_id environment is undefined when config has invalid JSON', async () => {
    selectMock
      .mockReturnValueOnce(qb([{
        id: 'run-bad-cfg',
        branch: 'main',
        status: 'passed',
        startedAt: '2026-01-01T00:00:00Z',
        durationMs: 100,
        total: 5,
        passed: 5,
        failed: 0,
        skipped: 0,
        config: 'not-valid-json',
      }]))
      .mockReturnValueOnce(qb([{ count: 0 }]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['runs.get_summary_by_id']({ runId: 'run-bad-cfg' }));

    const run = (parsed as { run: { environment?: unknown } }).run;
    expect(run.environment).toBeUndefined();
  });

  it('runs.get_summary_by_id environment is undefined when config.environment is not a string', async () => {
    selectMock
      .mockReturnValueOnce(qb([{
        id: 'run-num-env',
        branch: null,
        status: 'passed',
        startedAt: '2026-01-01T00:00:00Z',
        durationMs: 100,
        total: 3,
        passed: 3,
        failed: 0,
        skipped: 0,
        config: JSON.stringify({ environment: 42 }),
      }]))
      .mockReturnValueOnce(qb([{ count: 0 }]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['runs.get_summary_by_id']({ runId: 'run-num-env' }));

    const run = (parsed as { run: { environment?: unknown } }).run;
    expect(run.environment).toBeUndefined();
  });

  it('runs.get_summary_by_id environment is undefined when config.environment is empty string', async () => {
    selectMock
      .mockReturnValueOnce(qb([{
        id: 'run-empty-env',
        branch: null,
        status: 'passed',
        startedAt: '2026-01-01T00:00:00Z',
        durationMs: 0,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        config: JSON.stringify({ environment: '' }),
      }]))
      .mockReturnValueOnce(qb([{ count: 0 }]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['runs.get_summary_by_id']({ runId: 'run-empty-env' }));

    expect((parsed as { run: { environment?: unknown } }).run.environment).toBeUndefined();
  });

  it('runs.get_summary_by_id environment is undefined when config is null', async () => {
    selectMock
      .mockReturnValueOnce(qb([{
        id: 'run-null-cfg',
        branch: null,
        status: 'passed',
        startedAt: '2026-01-01T00:00:00Z',
        durationMs: 0,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        config: null,
      }]))
      .mockReturnValueOnce(qb([{ count: 0 }]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['runs.get_summary_by_id']({ runId: 'run-null-cfg' }));

    expect((parsed as { run: { environment?: unknown } }).run.environment).toBeUndefined();
  });

  // ── Missing required args ─────────────────────────────────────────────────

  it('tests.get_failures_by_run returns INVALID_INPUT when runId is missing', async () => {
    const handlers = createToolHandlers();
    const parsed = parse(await handlers['tests.get_failures_by_run']({}));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INVALID_INPUT });
  });

  it('runs.compare returns INVALID_INPUT when headRunId is missing', async () => {
    const handlers = createToolHandlers();
    const parsed = parse(await handlers['runs.compare']({ baseRunId: 'run-1' }));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INVALID_INPUT });
  });

  // ── Error handling (catch branches) ──────────────────────────────────────

  it('runs.get_summary_by_id returns INTERNAL_ERROR on DB failure', async () => {
    selectMock.mockImplementationOnce(() => { throw new Error('db dead'); });

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['runs.get_summary_by_id']({ runId: 'run-x' }));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INTERNAL_ERROR, message: 'db dead' });
  });

  it('tests.get_failures_by_run returns INTERNAL_ERROR on DB failure', async () => {
    selectMock.mockImplementationOnce(() => { throw new Error('db oops'); });

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['tests.get_failures_by_run']({ runId: 'run-x' }));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INTERNAL_ERROR });
  });

  it('analytics.get_pass_rate returns INTERNAL_ERROR on DB failure', async () => {
    selectMock.mockImplementationOnce(() => { throw new Error('db fail'); });

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['analytics.get_pass_rate']({}));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INTERNAL_ERROR });
  });

  it('analytics.get_duration_trend returns INTERNAL_ERROR on DB failure', async () => {
    selectMock.mockImplementationOnce(() => { throw new Error('db fail'); });

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['analytics.get_duration_trend']({}));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INTERNAL_ERROR });
  });

  it('tests.get_error_clusters returns INTERNAL_ERROR on cluster service failure', async () => {
    clusterErrorsMock.mockRejectedValueOnce(new Error('cluster fail'));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['tests.get_error_clusters']({ runId: 'run-x' }));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INTERNAL_ERROR });
  });

  it('quarantine.list_quarantined returns INTERNAL_ERROR on DB failure', async () => {
    selectMock.mockImplementationOnce(() => { throw new Error('db fail'); });

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['quarantine.list_quarantined']({}));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INTERNAL_ERROR });
  });

  it('quarantine.get_details returns INTERNAL_ERROR on DB failure', async () => {
    selectMock.mockImplementationOnce(() => { throw new Error('db fail'); });

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['quarantine.get_details']({ testTitle: 'some-test' }));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INTERNAL_ERROR });
  });

  it('runs.compare returns INTERNAL_ERROR on DB failure', async () => {
    selectMock.mockImplementationOnce(() => { throw new Error('db fail'); });

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['runs.compare']({ baseRunId: 'r1', headRunId: 'r2' }));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INTERNAL_ERROR });
  });

  it('tests.get_flaky returns INTERNAL_ERROR on DB failure', async () => {
    selectMock.mockImplementationOnce(() => { throw new Error('db fail'); });

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['tests.get_flaky']({}));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INTERNAL_ERROR });
  });

  it('schedules.list returns INTERNAL_ERROR on DB failure', async () => {
    selectMock.mockImplementationOnce(() => { throw new Error('db fail'); });

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['schedules.list']({}));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INTERNAL_ERROR });
  });

  it('schedules.get_by_id returns INTERNAL_ERROR on DB failure', async () => {
    selectMock.mockImplementationOnce(() => { throw new Error('db fail'); });

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['schedules.get_by_id']({ scheduleId: 'sched-x' }));

    expect(parsed).toMatchObject({ error: MCP_ERROR_CODES.INTERNAL_ERROR });
  });

  // ── null-coalescing branches ──────────────────────────────────────────────

  it('quarantine.list_quarantined uses default reason when reason is null', async () => {
    selectMock.mockReturnValueOnce(qb([{
      id: 'q-2',
      testTitle: 'some test',
      testFile: null,
      reason: null,
      quarantinedAt: '2026-01-01T00:00:00Z',
      quarantinedBy: null,
    }]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['quarantine.list_quarantined']({}));

    const tests = (parsed as { tests: Array<{ reason: string; quarantinedBy: string; testFile: unknown }> }).tests;
    expect(tests[0].reason).toBe('No reason provided');
    expect(tests[0].quarantinedBy).toBe('manual');
    expect(tests[0].testFile).toBeUndefined();
  });

  it('schedules.list returns enabled:true when enabled is null in DB', async () => {
    selectMock.mockReturnValueOnce(qb([{
      id: 'sched-null-enabled',
      cronExpr: '0 0 * * *',
      enabled: null,
      lastRunAt: null,
      createdAt: '2026-01-01',
    }]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['schedules.list']({}));

    const scheds = (parsed as { schedules: Array<{ enabled: boolean; lastRunAt: unknown }> }).schedules;
    expect(scheds[0].enabled).toBe(true);
    expect(scheds[0].lastRunAt).toBeUndefined();
  });

  it('schedules.get_by_id returns runOptions:undefined when runOptions is null', async () => {
    selectMock.mockReturnValueOnce(qb([{
      id: 'sched-no-opts',
      cronExpr: '* * * * *',
      runOptions: null,
      enabled: null,
      lastRunAt: '2026-01-01T00:00:00Z',
      createdAt: '2026-01-01',
    }]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['schedules.get_by_id']({ scheduleId: 'sched-no-opts' }));

    const sched = (parsed as { schedule: { runOptions?: unknown; enabled: boolean } }).schedule;
    expect(sched?.runOptions).toBeUndefined();
    expect(sched?.enabled).toBe(true);
  });

  it('runs.list_recent uses "Run {id}" as name when branch is null', async () => {
    selectMock.mockReturnValueOnce(qb([{
      id: 'run-nobranch',
      branch: null,
      status: 'passed',
      startedAt: '2026-01-01T00:00:00Z',
      durationMs: null,
      total: 0,
      passed: 0,
      failed: 0,
    }]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['runs.list_recent']({}));

    const runs = (parsed as { runs: Array<{ name: string; duration: number }> }).runs;
    expect(runs[0].name).toBe('Run run-nobranch');
    expect(runs[0].duration).toBe(0);
  });

  // ── runs.compare regression case ─────────────────────────────────────────

  it('runs.compare identifies regressions (base=skipped, head=failed)', async () => {
    // Base run: test-a was skipped
    selectMock.mockReturnValueOnce(qb([
      { stableId: 'test-a', title: 'Test A', status: 'skipped', errorMessage: null },
    ]));
    // Head run: test-a is now failed
    selectMock.mockReturnValueOnce(qb([
      { stableId: 'test-a', title: 'Test A', status: 'failed', errorMessage: 'new err' },
    ]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['runs.compare']({ baseRunId: 'base-1', headRunId: 'head-1' }));

    const result = parsed as { regressions: Array<{ baseStatus: string; headStatus: string }> };
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0].baseStatus).toBe('skipped');
    expect(result.regressions[0].headStatus).toBe('failed');
  });

  it('runs.compare uses title as testId when stableId is null', async () => {
    selectMock.mockReturnValueOnce(qb([
      { stableId: null, title: 'Unstable Test', status: 'passed', errorMessage: null },
    ]));
    selectMock.mockReturnValueOnce(qb([
      { stableId: null, title: 'Unstable Test', status: 'failed', errorMessage: 'broken' },
    ]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['runs.compare']({ baseRunId: 'b', headRunId: 'h' }));

    const result = parsed as { newFailures: Array<{ testId: string }> };
    expect(result.newFailures[0].testId).toBe('Unstable Test');
  });

  // ── tests.get_flaky: filter out null stableId ─────────────────────────────

  it('tests.get_flaky filters out rows where stableId is null', async () => {
    selectMock.mockReturnValueOnce(qb([
      { stableId: null, title: 'No-stable', file: 'a.spec.ts', flakyCount: 5, totalRuns: 10, lastSeen: '2026-01-01' },
      { stableId: 'stable-x', title: 'Has-stable', file: 'b.spec.ts', flakyCount: 5, totalRuns: 10, lastSeen: '2026-01-01' },
    ]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['tests.get_flaky']({ minFlipCount: 1 }));

    const result = parsed as { flakyTests: Array<{ stableId: string }> };
    // null stableId row should be filtered out
    expect(result.flakyTests).toHaveLength(1);
    expect(result.flakyTests[0].stableId).toBe('stable-x');
  });

  // ── tests.get_predictive_candidates: non-array changedFiles ──────────────

  it('tests.get_predictive_candidates defaults changedFiles to [] for non-array input', async () => {
    predictiveCandidatesMock.mockResolvedValueOnce({
      candidates: [],
      mode: 'static_only',
      totalHistoricalRuns: 0,
      coldStartThreshold: 20,
    });

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['tests.get_predictive_candidates']({ changedFiles: 'not-an-array' }));

    expect(parsed).toEqual({ candidates: [], mode: 'static_only' });
    expect(predictiveCandidatesMock).toHaveBeenCalledWith([], expect.any(String));
  });

  // ── integrations.get_status: config file present ─────────────────────────

  it('integrations.get_status reads config file and reports configured integrations', async () => {
    fsMock.readFileSync.mockReturnValueOnce(JSON.stringify({ slack: { webhook: 'url' }, jira: null }));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['integrations.get_status']({}));

    const integrations = (parsed as { integrations: Array<{ type: string; configured: boolean }> }).integrations;
    const slack = integrations.find((i) => i.type === 'slack');
    const jira = integrations.find((i) => i.type === 'jira');
    const github = integrations.find((i) => i.type === 'github');

    expect(slack?.configured).toBe(true);  // has a value
    expect(jira?.configured).toBe(false);  // null → not configured
    expect(github?.configured).toBe(false); // missing → not configured
  });

  // ── tests.get_error_clusters: returns empty when no runId ────────────────

  it('tests.get_error_clusters returns empty clusters array when runId is falsy', async () => {
    const handlers = createToolHandlers();

    // Pass args without runId — asString returns undefined → ok({ clusters: [] })
    const parsed = parse(await handlers['tests.get_error_clusters']({}));

    expect(parsed).toEqual({ clusters: [] });
  });

  // ── quarantine.get_details: null row ─────────────────────────────────────

  it('quarantine.get_details returns null quarantine when testTitle matches nothing', async () => {
    selectMock.mockReturnValueOnce(qb([]));

    const handlers = createToolHandlers();
    const parsed = parse(await handlers['quarantine.get_details']({ testTitle: 'missing' }));

    expect(parsed).toEqual({ quarantine: null });
  });
});
