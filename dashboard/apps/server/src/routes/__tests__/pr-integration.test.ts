import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import * as fixtures from '../../test/fixtures.js';
import * as schema from '../../db/schema.js';

const {
  mockReadConfig,
  mockResolveBaseRun,
  mockCompareRunToBase,
  mockGeneratePrCommentMarkdown,
  mockPostOrUpdatePrComment,
  mockCreateCheckRun,
} = vi.hoisted(() => ({
  mockReadConfig: vi.fn(),
  mockResolveBaseRun: vi.fn(),
  mockCompareRunToBase: vi.fn(),
  mockGeneratePrCommentMarkdown: vi.fn(),
  mockPostOrUpdatePrComment: vi.fn(),
  mockCreateCheckRun: vi.fn(),
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

vi.mock('../../services/integrations/config.js', () => ({
  readConfig: mockReadConfig,
}));

vi.mock('../../services/pr-comparison.js', () => ({
  resolveBaseRun: mockResolveBaseRun,
  compareRunToBase: mockCompareRunToBase,
  generatePrCommentMarkdown: mockGeneratePrCommentMarkdown,
}));

vi.mock('../../services/integrations/github.js', () => ({
  postOrUpdatePrComment: mockPostOrUpdatePrComment,
  createCheckRun: mockCreateCheckRun,
}));

describe('pr-integration routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { prIntegrationRoutes } = await import('../pr-integration.js');
    await prIntegrationRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    testApp.poolConnection.exec('DELETE FROM runs;');

    mockReadConfig.mockReturnValue({
      github: {
        enabled: true,
        token: 'ghp_test_token',
        owner: 'acme',
        repo: 'dashboard',
        prComments: true,
        commitStatus: true,
        checkRuns: true,
        ignoreFlakyInComments: true,
      },
    });
    mockResolveBaseRun.mockResolvedValue('base-run-id');
    mockCompareRunToBase.mockResolvedValue({
      newFailures: [],
      fixedTests: [],
      newTests: [],
      flakyIgnored: [],
      summary: { totalPrTests: 10, totalBaseTests: 10, newFailureCount: 0, fixedCount: 0, newTestCount: 0 },
    });
    mockGeneratePrCommentMarkdown.mockReturnValue('## PR Report');
    mockPostOrUpdatePrComment.mockResolvedValue(undefined);
    mockCreateCheckRun.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('POST /api/pr/report succeeds for valid run and posts comment/check run', async () => {
    testApp.db.insert(schema.runs).values(
      fixtures.run({
        id: 'run-pr-1',
        status: 'failed',
        prNumber: 42,
        commitSha: 'abc123',
        gateStatus: 'passed',
        baseBranch: 'main',
        workspaceId: 'ws-1',
      }),
    ).run();

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/pr/report',
      payload: { runId: 'run-pr-1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { comparison: unknown; commentPosted: boolean; checkCreated: boolean };
    expect(body.commentPosted).toBe(true);
    expect(body.checkCreated).toBe(true);
    expect(body.comparison).toEqual({
      newFailures: [],
      fixedTests: [],
      newTests: [],
      flakyIgnored: [],
      summary: { totalPrTests: 10, totalBaseTests: 10, newFailureCount: 0, fixedCount: 0, newTestCount: 0 },
    });

    expect(mockResolveBaseRun).toHaveBeenCalledWith('main', 'ws-1');
    expect(mockCompareRunToBase).toHaveBeenCalledWith('run-pr-1', 'base-run-id', { ignoreQuarantined: true });
    expect(mockGeneratePrCommentMarkdown).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ prNumber: 42, runId: 'run-pr-1' }),
    );
    expect(mockPostOrUpdatePrComment).toHaveBeenCalledWith(
      { token: 'ghp_test_token', owner: 'acme', repo: 'dashboard' },
      42,
      '## PR Report',
    );
    expect(mockCreateCheckRun).toHaveBeenCalledWith(
      { token: 'ghp_test_token', owner: 'acme', repo: 'dashboard' },
      'abc123',
      'success',
      '## PR Report',
    );
  });

  it('POST /api/pr/report returns 400 for invalid body', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/pr/report',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid request body');
  });

  it('POST /api/pr/report returns 404 when run does not exist', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/pr/report',
      payload: { runId: 'missing-run-id' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Run not found' });
  });

  it('POST /api/pr/report returns 400 when run has no PR metadata', async () => {
    testApp.db.insert(schema.runs).values(
      fixtures.run({ id: 'run-no-pr', status: 'passed', prNumber: null, commitSha: 'abc123' }),
    ).run();

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/pr/report',
      payload: { runId: 'run-no-pr' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Run has no PR metadata' });
  });

  it('POST /api/pr/report handles missing base run gracefully', async () => {
    testApp.db.insert(schema.runs).values(
      fixtures.run({ id: 'run-no-base', status: 'passed', prNumber: 7, commitSha: 'def456', baseBranch: 'main' }),
    ).run();
    mockResolveBaseRun.mockResolvedValue(null);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/pr/report',
      payload: { runId: 'run-no-base' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ comparison: null, message: 'No base run found for comparison' });
    expect(mockCompareRunToBase).not.toHaveBeenCalled();
    expect(mockPostOrUpdatePrComment).not.toHaveBeenCalled();
    expect(mockCreateCheckRun).not.toHaveBeenCalled();
  });

  it('POST /api/pr/report skips comment/check when github integration is disabled', async () => {
    testApp.db.insert(schema.runs).values(
      fixtures.run({ id: 'run-config-off', status: 'failed', prNumber: 99, commitSha: 'sha999', gateStatus: 'failed' }),
    ).run();
    mockReadConfig.mockReturnValue({
      github: {
        enabled: false,
        token: 'ghp_test_token',
        owner: 'acme',
        repo: 'dashboard',
        prComments: true,
        commitStatus: true,
        checkRuns: true,
      },
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/pr/report',
      payload: { runId: 'run-config-off', baseRunId: 'explicit-base' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      comparison: {
        newFailures: [],
        fixedTests: [],
        newTests: [],
        flakyIgnored: [],
        summary: { totalPrTests: 10, totalBaseTests: 10, newFailureCount: 0, fixedCount: 0, newTestCount: 0 },
      },
      commentPosted: false,
      checkCreated: false,
    });
    expect(mockResolveBaseRun).not.toHaveBeenCalled();
    expect(mockCompareRunToBase).toHaveBeenCalledWith('run-config-off', 'explicit-base', { ignoreQuarantined: false });
    expect(mockPostOrUpdatePrComment).not.toHaveBeenCalled();
    expect(mockCreateCheckRun).not.toHaveBeenCalled();
  });
});
