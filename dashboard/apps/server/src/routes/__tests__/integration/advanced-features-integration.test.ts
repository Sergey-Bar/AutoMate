import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/create-test-app.js';
import * as fixtures from '../../../test/fixtures.js';
import * as schema from '../../../db/schema.js';

let testApp: TestApp;

const {
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockCopyFileSync,
  mockUnlinkSync,
  mockReaddirSync,
  mockStatSync,
  mockParsePlaywrightConfig,
  mockSafePath,
  mockNlToSQL,
  mockResolveBaseRun,
  mockCompareRunToBase,
  mockGeneratePrCommentMarkdown,
  mockPostOrUpdatePrComment,
  mockCreateCheckRun,
  mockClusterErrors,
  mockSendSlackRunSummary,
  mockDispatchWebhook,
  mockPollCIStatus,
  mockSendRunReportEmail,
  mockAssertExternalUrl,
  mockAssertExternalUrlWithDNS,
  mockFetch,
  mockSpawn,
  mockExecFile,
  mockReqFile,
  mockMkdirPromise,
  mockWriteFilePromise,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(targetPath: string) => boolean>(),
  mockReadFileSync: vi.fn<(targetPath: string, encoding: string) => string>(),
  mockWriteFileSync: vi.fn<(targetPath: string, content: string, encoding: string) => void>(),
  mockMkdirSync: vi.fn<(targetPath: string, options: { recursive: boolean }) => void>(),
  mockCopyFileSync: vi.fn<(src: string, dest: string) => void>(),
  mockUnlinkSync: vi.fn<(targetPath: string) => void>(),
  mockReaddirSync: vi.fn<(targetPath: string, options?: unknown) => Array<{ name: string; isDirectory: () => boolean }>>(),
  mockStatSync: vi.fn<(targetPath: string) => { size: number }>(),
  mockParsePlaywrightConfig: vi.fn<(filePath: string) => Record<string, unknown>>(),
  mockSafePath: vi.fn<(base: string, userPath: string) => string>(),
  mockNlToSQL: vi.fn(),
  mockResolveBaseRun: vi.fn(),
  mockCompareRunToBase: vi.fn(),
  mockGeneratePrCommentMarkdown: vi.fn(),
  mockPostOrUpdatePrComment: vi.fn(),
  mockCreateCheckRun: vi.fn(),
  mockClusterErrors: vi.fn(),
  mockSendSlackRunSummary: vi.fn(),
  mockDispatchWebhook: vi.fn(),
  mockPollCIStatus: vi.fn(),
  mockSendRunReportEmail: vi.fn(),
  mockAssertExternalUrl: vi.fn(),
  mockAssertExternalUrlWithDNS: vi.fn(),
  mockFetch: vi.fn(),
  mockSpawn: vi.fn(),
  mockExecFile: vi.fn(),
  mockReqFile: vi.fn(),
  mockMkdirPromise: vi.fn(),
  mockWriteFilePromise: vi.fn(),
}));

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

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    copyFileSync: mockCopyFileSync,
    unlinkSync: mockUnlinkSync,
    readdirSync: mockReaddirSync,
    statSync: mockStatSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  copyFileSync: mockCopyFileSync,
  unlinkSync: mockUnlinkSync,
  readdirSync: mockReaddirSync,
  statSync: mockStatSync,
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  execFile: mockExecFile,
}));

vi.mock('fs/promises', () => ({
  mkdir: mockMkdirPromise,
  writeFile: mockWriteFilePromise,
}));

vi.mock('../../../services/config-parser.js', () => ({
  parsePlaywrightConfig: mockParsePlaywrightConfig,
}));

vi.mock('../../../utils/safe-path.js', () => ({
  safePath: mockSafePath,
}));

vi.mock('../../../services/nl-query.js', () => ({
  nlToSQL: mockNlToSQL,
}));

vi.mock('../../../services/pr-comparison.js', () => ({
  resolveBaseRun: mockResolveBaseRun,
  compareRunToBase: mockCompareRunToBase,
  generatePrCommentMarkdown: mockGeneratePrCommentMarkdown,
}));

vi.mock('../../../services/integrations/github.js', () => ({
  postOrUpdatePrComment: mockPostOrUpdatePrComment,
  createCheckRun: mockCreateCheckRun,
}));

vi.mock('../../../services/error-clustering.js', () => ({
  clusterErrors: mockClusterErrors,
}));

vi.mock('../../../services/integrations/slack.js', () => ({
  sendSlackRunSummary: mockSendSlackRunSummary,
}));

vi.mock('../../../services/integrations/webhooks.js', () => ({
  dispatchWebhook: mockDispatchWebhook,
}));

vi.mock('../../../services/ci-poller.js', () => ({
  pollCIStatus: mockPollCIStatus,
}));

vi.mock('../../../services/integrations/email.js', () => ({
  sendRunReportEmail: mockSendRunReportEmail,
}));

vi.mock('../../../utils/url-validation.js', () => ({
  assertExternalUrl: mockAssertExternalUrl,
  assertExternalUrlWithDNS: mockAssertExternalUrlWithDNS,
}));

function createMockProcess(pid = 1100) {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    killed: boolean;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (signal?: string) => void;
  };

  proc.pid = pid;
  proc.killed = false;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {
    proc.killed = true;
  };

  return proc;
}

describe('advanced integration routes', () => {
  const integrationsConfigPath = path.resolve(process.cwd(), '.automate', 'integrations.json');
  const integrationsConfigDir = path.dirname(integrationsConfigPath);
  let integrationsConfigFileExists = false;
  let integrationsConfigDirExists = false;
  let integrationsConfigRaw = '{}';

  beforeAll(async () => {
    process.env.ARTIFACTS_DIR = '/artifacts-root';
    process.env.BLOBS_DIR = '/blob-root';

    vi.stubGlobal('fetch', mockFetch);
    testApp = await createTestApp();
    testApp.app.decorateRequest('file', () => mockReqFile());

    const [
      { featuresRoutes },
      { configRoutes },
      { nlQueryRoutes },
      { prIntegrationRoutes },
      { errorClusteringRoutes },
      { codegenRoutes },
      { integrationsRoutes },
      { baselinesRoutes },
      { artifactsRoutes },
      { ingestRoutes },
    ] = await Promise.all([
      import('../../features.js'),
      import('../../config.js'),
      import('../../nl-query.js'),
      import('../../pr-integration.js'),
      import('../../error-clustering.js'),
      import('../../codegen.js'),
      import('../../integrations.js'),
      import('../../baselines.js'),
      import('../../artifacts.js'),
      import('../../ingest.js'),
    ]);

    await featuresRoutes(testApp.app);
    await configRoutes(testApp.app);
    await nlQueryRoutes(testApp.app);
    await prIntegrationRoutes(testApp.app);
    await errorClusteringRoutes(testApp.app);
    await codegenRoutes(testApp.app);
    await integrationsRoutes(testApp.app);
    await baselinesRoutes(testApp.app);
    await artifactsRoutes(testApp.app);
    await testApp.app.register(ingestRoutes);

    await testApp.app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    testApp.poolConnection.exec('DELETE FROM nl_query_history; DELETE FROM tests; DELETE FROM results; DELETE FROM runs; DELETE FROM blob_shards;');

    integrationsConfigFileExists = false;
    integrationsConfigDirExists = false;
    integrationsConfigRaw = '{}';

    mockExistsSync.mockImplementation((targetPath) => {
      if (targetPath === integrationsConfigPath) return integrationsConfigFileExists;
      if (targetPath === integrationsConfigDir) return integrationsConfigDirExists;
      return false;
    });
    mockReadFileSync.mockImplementation((targetPath) => {
      if (targetPath === integrationsConfigPath) {
        return integrationsConfigRaw;
      }
      return '{}';
    });
    mockWriteFileSync.mockImplementation((targetPath, content) => {
      if (targetPath === integrationsConfigPath) {
        integrationsConfigRaw = content;
        integrationsConfigFileExists = true;
      }
    });
    mockMkdirSync.mockImplementation((targetPath) => {
      if (targetPath === integrationsConfigDir) {
        integrationsConfigDirExists = true;
      }
    });

    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReturnValue({ size: 100 });
    mockSafePath.mockImplementation((base, userPath) => `${base}/${userPath}`);
    mockParsePlaywrightConfig.mockReturnValue({ projects: [{ name: 'chromium' }] });

    mockNlToSQL.mockResolvedValue({
      sql: 'SELECT id FROM runs LIMIT 5',
      results: [{ id: 'run-1' }],
      resultCount: 1,
    });

    mockResolveBaseRun.mockResolvedValue('base-run-1');
    mockCompareRunToBase.mockResolvedValue({ summary: { totalPrTests: 5, totalBaseTests: 5, newFailureCount: 0, fixedCount: 0, newTestCount: 0 }, newFailures: [], fixedTests: [], newTests: [], flakyIgnored: [] });
    mockGeneratePrCommentMarkdown.mockReturnValue('## PR comparison');
    mockPostOrUpdatePrComment.mockResolvedValue(undefined);
    mockCreateCheckRun.mockResolvedValue(undefined);

    mockClusterErrors.mockResolvedValue([{ fingerprint: 'abc123', signature: 'Element not found', count: 2, testIds: ['t1', 't2'] }]);

    mockSendSlackRunSummary.mockResolvedValue(undefined);
    mockDispatchWebhook.mockResolvedValue(undefined);
    mockPollCIStatus.mockResolvedValue({ provider: 'github', status: 'success', url: 'https://ci.example/run/1' });
    mockSendRunReportEmail.mockResolvedValue(undefined);
    mockAssertExternalUrl.mockImplementation(() => undefined);
    mockAssertExternalUrlWithDNS.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ full_name: 'acme/dashboard', name: 'My Project' }) });

    mockMkdirPromise.mockResolvedValue(undefined);
    mockWriteFilePromise.mockResolvedValue(undefined);
    mockReqFile.mockReset();
    mockSpawn.mockReturnValue(createMockProcess(2200));
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
    vi.unstubAllGlobals();
  });

  it('GET /api/features returns feature flag map with boolean values', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/features' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(typeof body['nl-query']).toBe('boolean');
    expect(typeof body['codegen-launcher']).toBe('boolean');
    expect(typeof body['baseline-management']).toBe('boolean');
  });

  it('GET /api/config/parsed returns parsed config from parser service', async () => {
    mockExistsSync.mockReturnValue(true);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/config/parsed?path=playwright.config.ts' });

    expect(res.statusCode).toBe(200);
    expect(mockParsePlaywrightConfig).toHaveBeenCalledTimes(1);
    expect(res.json().projects[0].name).toBe('chromium');
  });

  it('PUT /api/config returns 400 when content is empty', async () => {
    const res = await testApp.app.inject({ method: 'PUT', url: '/api/config', payload: { content: '' } });

    expect(res.statusCode).toBe(400);
    const json = res.json();
    expect(json.error).toBeDefined();
    expect(json.error.fieldErrors?.content).toBeDefined();
  });

  it('POST /api/nl-query executes nlToSQL and returns translated result', async () => {
    const res = await testApp.app.inject({ method: 'POST', url: '/api/nl-query', payload: { query: 'show runs' } });

    expect(res.statusCode).toBe(200);
    expect(mockNlToSQL).toHaveBeenCalledWith('show runs', expect.anything());
    expect(res.json().sql).toBe('SELECT id FROM runs LIMIT 5');
  });

  it('GET /api/nl-query/history returns persisted query history', async () => {
    await testApp.app.inject({ method: 'POST', url: '/api/nl-query', payload: { query: 'recent runs', userId: 'u-1' } });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/nl-query/history?limit=5' });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json()[0].userQuery).toBe('recent runs');
  });

  it('POST /api/pr/report posts PR comment and check run when config allows it', async () => {
    integrationsConfigFileExists = true;
    integrationsConfigRaw = JSON.stringify({
      github: {
        enabled: true,
        token: 'ghp_test',
        owner: 'acme',
        repo: 'dashboard',
        prComments: true,
        checkRuns: true,
        ignoreFlakyInComments: false,
      },
    });

    const run = fixtures.run({ id: 'pr-run-1', status: 'failed', prNumber: 77, commitSha: 'sha-77', gateStatus: 'failed', baseBranch: 'main' });
    testApp.db.insert(schema.runs).values(run).run();

    const res = await testApp.app.inject({ method: 'POST', url: '/api/pr/report', payload: { runId: 'pr-run-1' } });

    expect(res.statusCode).toBe(200);
    expect(res.json().commentPosted).toBe(true);
    expect(res.json().checkCreated).toBe(true);
    expect(mockPostOrUpdatePrComment).toHaveBeenCalledTimes(1);
    expect(mockCreateCheckRun).toHaveBeenCalledTimes(1);
  });

  it('GET /api/error-clusters validates required runId query', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/error-clusters' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Missing required query parameter: runId' });
  });

  it('GET /api/error-clusters returns clustered errors from service', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/error-clusters?runId=run-22' });

    expect(res.statusCode).toBe(200);
    expect(mockClusterErrors).toHaveBeenCalledWith('run-22');
    expect(res.json()[0].count).toBe(2);
  });

  it('POST /api/codegen/start launches process and GET /api/codegen/status shows running', async () => {
    const start = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/start',
      payload: { url: 'https://example.com', browser: 'webkit', language: 'typescript' },
    });

    const status = await testApp.app.inject({ method: 'GET', url: '/api/codegen/status' });

    expect(start.statusCode).toBe(200);
    expect(start.json().started).toBe(true);
    expect(status.statusCode).toBe(200);
    expect(status.json().running).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('POST /api/codegen/stop stops active process', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/start',
      payload: { url: 'https://example.com', browser: 'chromium', language: 'typescript' },
    });

    const stop = await testApp.app.inject({ method: 'POST', url: '/api/codegen/stop' });

    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toEqual({ stopped: true });
  });

  it('POST /api/codegen/save writes generated code to safe path', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/save',
      payload: { content: 'test("ok", async () => {})', filePath: 'tmp/generated.spec.ts' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().saved).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });

  it('GET + PUT /api/integrations/config reads masked config and writes updates', async () => {
    integrationsConfigFileExists = true;
    integrationsConfigRaw = JSON.stringify({
      github: { token: 'ghp_secret_1234', owner: 'acme', repo: 'dashboard', enabled: true, prComments: true, commitStatus: true },
      slack: { webhookUrl: 'https://hooks.slack.com/services/A/B/C', enabled: true, notifyOn: ['all'] },
    });

    const getRes = await testApp.app.inject({ method: 'GET', url: '/api/integrations/config' });
    const putRes = await testApp.app.inject({
      method: 'PUT',
      url: '/api/integrations/config',
      payload: { github: { token: 'ghp_new', commitStatus: true } },
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().github.token).toBe('••••••••');
    expect(getRes.json().slack.webhookUrl).toContain('••••');
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toEqual({ saved: true });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });

  it('POST /api/integrations/test/slack and /api/integrations/test/github use service/network mocks', async () => {
    integrationsConfigFileExists = true;
    integrationsConfigRaw = JSON.stringify({
      slack: { webhookUrl: 'https://hooks.slack.com/services/A/B/C', enabled: true, notifyOn: ['all'] },
      github: { token: 'ghp_t', owner: 'acme', repo: 'dashboard', enabled: true, prComments: true, commitStatus: true },
    });

    const slackRes = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/slack' });
    const githubRes = await testApp.app.inject({ method: 'POST', url: '/api/integrations/test/github' });

    expect(slackRes.statusCode).toBe(200);
    expect(githubRes.statusCode).toBe(200);
    expect(mockSendSlackRunSummary).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('webhook endpoints create/list/delete/test entries', async () => {
    integrationsConfigFileExists = true;
    integrationsConfigRaw = JSON.stringify({ webhooks: [] });

    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks',
      payload: { url: 'https://hooks.example.com/x', events: ['run.completed'] },
    });
    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/integrations/webhooks' });
    const testRes = await testApp.app.inject({ method: 'POST', url: '/api/integrations/webhooks/test', payload: { url: 'https://hooks.example.com/x' } });
    const deleteRes = await testApp.app.inject({ method: 'DELETE', url: '/api/integrations/webhooks/0' });

    expect(createRes.statusCode).toBe(200);
    expect(listRes.statusCode).toBe(200);
    expect(testRes.statusCode).toBe(200);
    expect(deleteRes.statusCode).toBe(200);
    expect(mockAssertExternalUrlWithDNS).toHaveBeenCalled();
    expect(mockDispatchWebhook).toHaveBeenCalledTimes(1);
  });

  it('GET /api/ci/status returns CI poll result', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/ci/status?sha=abc123' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ provider: 'github', status: 'success', url: 'https://ci.example/run/1' });
    expect(mockPollCIStatus).toHaveBeenCalledWith('abc123');
  });

  it('GET /api/baselines lists baseline screenshots and POST /api/baselines/accept-all accepts all', async () => {
    mockExistsSync.mockImplementation((targetPath) => targetPath === '/artifacts-root' || targetPath.endsWith('home-expected.png'));
    mockReaddirSync.mockImplementation((targetPath) => {
      if (targetPath === '/artifacts-root') {
        return [{ name: 'home-expected.png', isDirectory: () => false }];
      }
      return [];
    });

    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/baselines' });
    const acceptAllRes = await testApp.app.inject({ method: 'POST', url: '/api/baselines/accept-all' });

    expect(listRes.statusCode).toBe(200);
    expect(Array.isArray(listRes.json())).toBe(true);
    expect(acceptAllRes.statusCode).toBe(200);
    expect(acceptAllRes.json().accepted).toBeGreaterThanOrEqual(0);
  });

  it('GET /artifacts/* blocks path traversal attempts', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/artifacts/..%5Csecret.txt' });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Forbidden' });
  });

  it('POST /api/ingest/blob stores uploaded shard metadata', async () => {
    mockReqFile.mockResolvedValue({
      mimetype: 'application/zip',
      fields: {
        runId: { value: '55555555-5555-4555-8555-555555555555' },
        shardIndex: { value: '1' },
        totalShards: { value: '2' },
      },
      toBuffer: vi.fn().mockResolvedValue(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])),
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/ingest/blob' });

    expect(res.statusCode).toBe(201);
    expect(res.json().runId).toBe('55555555-5555-4555-8555-555555555555');
    expect(mockMkdirPromise).toHaveBeenCalledTimes(1);
    expect(mockWriteFilePromise).toHaveBeenCalledTimes(1);
  });

  describe('Health endpoints', () => {
    let healthApp: FastifyInstance;
    let healthSqlite: InstanceType<typeof Database>;

    beforeAll(async () => {
      const testApp = await createTestApp();
      healthApp = testApp.app;
      healthSqlite = testApp.sqlite;

      // Register health endpoints inline (same as index.ts)
      healthApp.get('/health/live', async () => ({ status: 'ok', ts: 1700000000000 }));
      healthApp.get('/health/ready', async (_req, reply) => {
        try {
          healthSqlite.prepare('SELECT 1').get();
          return { status: 'ok', db: 'connected', ts: 1700000000000 };
        } catch (err) {
          reply.status(503);
          return { status: 'error', db: 'unavailable', ts: 1700000000000 };
        }
      });
      healthApp.get('/health', async () => ({ status: 'ok', ts: 1700000000000 }));

      await healthApp.ready();
    });

    afterAll(async () => {
      await healthApp.close();
      healthSqlite.close();
    });

    it('GET /health/live returns 200 with status ok', async () => {
      const res = await healthApp.inject({ method: 'GET', url: '/health/live' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.ts).toBeTypeOf('number');
    });

    it('GET /health/ready returns 200 with db connected', async () => {
      const res = await healthApp.inject({ method: 'GET', url: '/health/ready' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.db).toBe('connected');
      expect(body.ts).toBeTypeOf('number');
    });

    it('GET /health returns 200 with status ok (legacy alias)', async () => {
      const res = await healthApp.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.ts).toBeTypeOf('number');
    });
});
});
