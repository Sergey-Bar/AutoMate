/**
 * API contract validation tests for Automate server.
 *
 * These tests verify that every major API endpoint returns responses that
 * conform to the canonical shared Zod schemas, catching any drift between
 * the server implementation and the client-side type expectations.
 *
 * Strategy:
 *  - Each test calls an endpoint via Fastify.inject() and parses the body
 *    through the matching Zod schema using safeParse().
 *  - `expect(parsed.success, parsed.error?.message).toBe(true)` causes an
 *    informative failure message when the schema does not match.
 *  - Both success (2xx) and error (4xx) response shapes are validated.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { z } from 'zod';
import {
  RunSchema,
  TestSchema,
  ResultSchema,
  CompareRowSchema,
} from '@automate/dashboard-shared';
import { createTestApp, type TestApp } from '../test/create-test-app.js';
import * as fixtures from '../test/fixtures.js';
import * as schema from '../db/schema.js';

// ─── Additional mocks for new route sections ──────────────────────────────────
const {
  mockAuthLoadConfig,
  mockAuthSaveConfig,
  mockAuthListApiKeys,
  mockAuthGenerateApiKey,
  mockAuthRevokeApiKey,
  mockAuthValidateApiKey,
  mockAuthGenerateSessionToken,
  mockAuthValidateSessionToken,
  mockNlToSQL,
  mockRetentionLoadConfig,
  mockRetentionSaveConfig,
  mockRetentionRunCleanup,
  mockRetentionGetDbStats,
  mockReadIntegrationConfig,
  mockWriteIntegrationConfig,
  mockPollCIStatus,
} = vi.hoisted(() => ({
  mockAuthLoadConfig: vi.fn(),
  mockAuthSaveConfig: vi.fn(),
  mockAuthListApiKeys: vi.fn(),
  mockAuthGenerateApiKey: vi.fn(),
  mockAuthRevokeApiKey: vi.fn(),
  mockAuthValidateApiKey: vi.fn<(key: string) => boolean>(),
  mockAuthGenerateSessionToken: vi.fn<(keyId: string) => string>(),
  mockAuthValidateSessionToken: vi.fn<(token: string) => boolean>(),
  mockNlToSQL: vi.fn<(query: string) => Promise<{
    sql: string;
    results: unknown[];
    resultCount: number;
    rejected?: boolean;
    error?: string;
  }>>(),
  mockRetentionLoadConfig: vi.fn(),
  mockRetentionSaveConfig: vi.fn(),
  mockRetentionRunCleanup: vi.fn(),
  mockRetentionGetDbStats: vi.fn(),
  mockReadIntegrationConfig: vi.fn(),
  mockWriteIntegrationConfig: vi.fn(),
  mockPollCIStatus: vi.fn(),
}));

vi.mock('../services/auth.js', () => ({
  SESSION_COOKIE_NAME: 'automate_dashboard_session',
  generateApiKey: mockAuthGenerateApiKey,
  listApiKeys: mockAuthListApiKeys,
  loadAuthConfig: mockAuthLoadConfig,
  revokeApiKey: mockAuthRevokeApiKey,
  saveAuthConfig: mockAuthSaveConfig,
  validateApiKey: mockAuthValidateApiKey,
  generateSessionToken: mockAuthGenerateSessionToken,
  validateSessionToken: mockAuthValidateSessionToken,
}));

vi.mock('../services/nl-query.js', () => ({
  nlToSQL: mockNlToSQL,
}));

vi.mock('../services/data-retention.js', () => ({
  loadRetentionConfig: mockRetentionLoadConfig,
  saveRetentionConfig: mockRetentionSaveConfig,
  runRetentionCleanup: mockRetentionRunCleanup,
  getDbStats: mockRetentionGetDbStats,
}));

vi.mock('../services/integrations/config.js', () => ({
  readConfig: mockReadIntegrationConfig,
  writeConfig: mockWriteIntegrationConfig,
  IntegrationConfigSchema: z.object({}).passthrough(),
}));

vi.mock('../services/ci-poller.js', () => ({
  pollCIStatus: mockPollCIStatus,
}));

// ─── Shared error envelope ──────────────────────────────────────────────────
// Some routes return { error: string } and others return { error: object } (Zod flatten).
const ErrorResponseSchema = z.object({ error: z.union([z.string(), z.record(z.unknown())]) });

// ─── Analytics response schemas ─────────────────────────────────────────────
const PassRatePointSchema = z.object({ date: z.string(), all: z.number() });

const DurationPointSchema = z.object({
  date: z.string(),
  p50: z.number(),
  p95: z.number(),
});

const FlakyTestSchema = z.object({
  title: z.string(),
  file: z.string(),
  flakyCount: z.number(),
  totalRuns: z.number(),
  flakyRate: z.number(),
});

const SlowTestSchema = z.object({
  title: z.string(),
  file: z.string(),
  avgDurationMs: z.number(),
  p95DurationMs: z.number(),
  runCount: z.number(),
});

const HeatmapSerieSchema = z.object({
  id: z.string(),
  data: z.array(z.object({ x: z.string(), y: z.number() })),
});

const GanttRowSchema = z.object({
  title: z.string(),
  file: z.string(),
  status: z.string(),
  workerIndex: z.number().nullable(),
  durationMs: z.number().nullable(),
});

// ─── Health schemas ──────────────────────────────────────────────────────────
const LivenessSchema = z.object({ status: z.string() });

const ReadinessSchema = z.object({
  status: z.string(),
  uptime: z.number(),
  version: z.string(),
  db: z.object({
    connected: z.boolean(),
    tables: z.number().optional(),
    error: z.string().optional(),
  }),
});

// ─── Gate schemas ────────────────────────────────────────────────────────────
const GateConfigSchema = z.object({
  id: z.string(),
  passRateThreshold: z.number(),
  maxDurationMs: z.number().nullable().optional(),
  maxFlakyCount: z.number().nullable().optional(),
});

const GateStatusSchema = z.object({
  runId: z.string(),
  passed: z.boolean(),
  gateStatus: z.string(),
  passRate: z.number(),
  threshold: z.number(),
});

// ─── Workspace schema ────────────────────────────────────────────────────────
const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  configPath: z.string(),
  testResultsDir: z.string().nullable(),
  createdAt: z.string(),
});

// ─── Quarantine schema ───────────────────────────────────────────────────────
const QuarantineEntrySchema = z.object({
  id: z.string(),
  testTitle: z.string(),
  testFile: z.string(),
  reason: z.string().nullable(),
  quarantinedAt: z.string(),
  quarantinedBy: z.string().optional().nullable(),
});

// ─── Known failure schema ────────────────────────────────────────────────────
const KnownFailureSchema = z.object({
  id: z.string(),
  testTitle: z.string(),
  testFile: z.string(),
  comment: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().optional().nullable(),
});

// ─── Schedule schema ─────────────────────────────────────────────────────────
const ScheduleSchema = z.object({
  id: z.string(),
  cronExpr: z.string(),
  runOptions: z.string().nullable(),
  enabled: z.union([z.boolean(), z.number()]),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
});

// ─── Fingerprint group schema ────────────────────────────────────────────────
const FingerprintGroupSchema = z.object({
  fingerprint: z.string(),
  count: z.number(),
  errorMessage: z.string(),
  testIds: z.array(z.string()),
});

// ─── Module mocks ────────────────────────────────────────────────────────────

const {
  mockRunner,
  mockClusterErrors,
  mockGenerateHtmlReport,
  mockGenerateRunPdf,
} = vi.hoisted(() => ({
  mockRunner: {
    startRun: vi.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue('new-run-id'),
    abortRun: vi.fn<(runId: string) => boolean>().mockReturnValue(true),
    listTests: vi.fn<(configPath?: string) => Promise<object>>().mockResolvedValue({ suites: [] }),
  },
  mockClusterErrors: vi
    .fn<(runId: string) => Promise<Array<{ fingerprint: string; count: number }>>>()
    .mockResolvedValue([]),
  mockGenerateHtmlReport: vi
    .fn<(runId: string) => string>()
    .mockReturnValue('<html>report</html>'),
  mockGenerateRunPdf: vi
    .fn<(runId: string) => Promise<Buffer>>()
    .mockResolvedValue(Buffer.from('pdf')),
}));

let testApp: TestApp;

vi.mock('../db/client.js', () => ({
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

vi.mock('../services/runner.js', () => ({ runner: mockRunner }));
vi.mock('../services/error-clustering.js', () => ({ clusterErrors: mockClusterErrors }));
vi.mock('../services/html-report.js', () => ({ generateHtmlReport: mockGenerateHtmlReport }));
vi.mock('../services/pdf-report.js', () => ({ generateRunPdf: mockGenerateRunPdf }));
vi.mock('../services/scheduler.js', () => ({
  scheduler: { reload: vi.fn().mockResolvedValue(undefined) },
}));

const mockBridge = {
  runner: {
    startRun: vi.fn(),
    abortRun: vi.fn(),
  },
  computeGateStatus: vi.fn(),
};

// ─── App lifecycle ───────────────────────────────────────────────────────────

beforeAll(async () => {
  testApp = await createTestApp();

  const { runsRoutes } = await import('./runs.js');
  const { testsRoutes } = await import('./tests.js');
  const { analyticsRoutes } = await import('./analytics.js');
  const { healthRoutes } = await import('./health.js');
  const { gateRoutes } = await import('./gate.js');
  const { workspacesRoutes } = await import('./workspaces.js');
  const { quarantineRoutes } = await import('./quarantine.js');
  const { knownFailureRoutes } = await import('./known-failures.js');
  const { schedulesRoutes } = await import('./schedules.js');
  const { categoriesRoutes } = await import('./categories.js');
  const { badgeRoutes } = await import('./badges.js');
  const { metricsRoutes } = await import('./metrics.js');
  const { featuresRoutes } = await import('./features.js');
  const { nlQueryRoutes } = await import('./nl-query.js');
  const { ingestRoutes } = await import('./ingest.js');

  await healthRoutes(testApp.app, { sqlite: testApp.sqlite, version: '2.0.0' });

  await runsRoutes(testApp.app, { bridge: mockBridge as unknown as import('../services/reporter-bridge.js').ReporterBridge });
  await testsRoutes(testApp.app);
  await analyticsRoutes(testApp.app);
  await gateRoutes(testApp.app);
  await workspacesRoutes(testApp.app);
  await quarantineRoutes(testApp.app);
  await knownFailureRoutes(testApp.app);
  await schedulesRoutes(testApp.app);
  await categoriesRoutes(testApp.app);
  await badgeRoutes(testApp.app);
  await metricsRoutes(testApp.app);
  await featuresRoutes(testApp.app);
  await nlQueryRoutes(testApp.app);
  // ingest routes: mock req.file() so multipart plugin isn't required
  testApp.app.decorateRequest('file', async function () { return null; });
  await ingestRoutes(testApp.app);

  await testApp.app.ready();
});

beforeEach(() => {
  testApp.poolConnection.exec(`
    DELETE FROM results;
    DELETE FROM tests;
    DELETE FROM suites;
    DELETE FROM runs;
    DELETE FROM quarantine;
    DELETE FROM known_failures;
    DELETE FROM schedules;
    DELETE FROM workspaces;
    DELETE FROM quality_gate_config;
    DELETE FROM fingerprint_categories;
    DELETE FROM defect_categories;
    DELETE FROM blob_shards;
    DELETE FROM nl_query_history;
  `);
  vi.clearAllMocks();
  mockRunner.startRun.mockResolvedValue('new-run-id');
  mockRunner.abortRun.mockReturnValue(true);
  mockRunner.listTests.mockResolvedValue({ suites: [] });
  mockClusterErrors.mockResolvedValue([]);
  mockGenerateHtmlReport.mockReturnValue('<html>report</html>');
  mockGenerateRunPdf.mockResolvedValue(Buffer.from('pdf'));
  // auth defaults
  mockAuthLoadConfig.mockReturnValue({ enabled: true, keys: [] });
  mockAuthListApiKeys.mockReturnValue([]);
  mockAuthValidateApiKey.mockReturnValue(false);
  mockAuthGenerateApiKey.mockReturnValue({ id: 'key-1', name: 'test', key: 'ak_test', createdAt: new Date(1693132800000).toISOString() });
  mockAuthRevokeApiKey.mockReturnValue(true);
  mockAuthGenerateSessionToken.mockReturnValue('session-token');
  mockAuthValidateSessionToken.mockReturnValue(false);
  // nl-query defaults
  mockNlToSQL.mockResolvedValue({ sql: 'SELECT 1', results: [], resultCount: 0 });
  // retention defaults
  mockRetentionLoadConfig.mockReturnValue({ testResultDays: 90, nlQueryHistoryDays: 30, attachmentDays: 60, trendsDays: -1, enabled: false });
  mockRetentionSaveConfig.mockReturnValue(undefined);
  mockRetentionRunCleanup.mockResolvedValue({ deletedRuns: 0, deletedResults: 0, deletedNlQueries: 0, deletedAttachments: 0, durationMs: 0 });
  mockRetentionGetDbStats.mockReturnValue({ sizeBytes: 4096, sizeMB: '0.00', pageCount: 1, pageSize: 4096 });
  // integrations defaults
  mockReadIntegrationConfig.mockReturnValue({});
  mockWriteIntegrationConfig.mockReturnValue(undefined);
  mockPollCIStatus.mockResolvedValue(null);
});

afterAll(async () => {
  await testApp.app.close();
    testApp.poolConnection.close();

});

// ═══════════════════════════════════════════════════════════════════════════════
// RUNS CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/runs', () => {
  it('empty list matches z.array(RunSchema)', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(RunSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('populated list — each item matches RunSchema', async () => {
    testApp.db
      .insert(schema.runs)
      .values([
        fixtures.run({ id: 'r1', status: 'passed', total: 5, passed: 5 }),
        fixtures.run({ id: 'r2', status: 'failed', total: 3, failed: 2 }),
      ])
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs' });
    expect(res.statusCode).toBe(200);
    const items = res.json() as unknown[];
    expect(items).toHaveLength(2);

    for (const item of items) {
      const parsed = RunSchema.safeParse(item);
      expect(parsed.success, parsed.error?.message).toBe(true);
    }
  });

  it('run with all nullable fields populated — matches RunSchema', async () => {
    testApp.db
      .insert(schema.runs)
      .values(
        fixtures.run({
          id: 'r-full',
          status: 'passed',
          total: 10,
          passed: 10,
          durationMs: 4500,
          branch: 'main',
          commitSha: 'abc123',
          commitMessage: 'fix: something',
          triggeredBy: 'ci',
          gateStatus: 'passed',
          source: 'live',
        }),
      )
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs' });
    expect(res.statusCode).toBe(200);
    const parsed = RunSchema.safeParse((res.json() as unknown[])[0]);
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/runs/:id', () => {
  it('existing run matches RunSchema', async () => {
    testApp.db
      .insert(schema.runs)
      .values(fixtures.run({ id: 'single-run', status: 'running' }))
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/single-run' });
    expect(res.statusCode).toBe(200);
    const parsed = RunSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('missing run returns 404 with error shape', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/does-not-exist' });
    expect(res.statusCode).toBe(404);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: POST /api/runs', () => {
  it('valid body returns 201 with { runId: string }', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { projects: ['chromium'] },
    });
    expect(res.statusCode).toBe(201);
    const parsed = z.object({ runId: z.string() }).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('invalid body (workers below min) returns 400 with error shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { workers: -1 },
    });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/runs/compare', () => {
  it('valid comparison returns array matching CompareRowSchema[]', async () => {
    testApp.db
      .insert(schema.runs)
      .values([fixtures.run({ id: 'cmp-a' }), fixtures.run({ id: 'cmp-b' })])
      .run();
    testApp.db
      .insert(schema.tests)
      .values([
        fixtures.test('cmp-a', { id: 't-a', stableId: 'sid-1', title: 'test 1', file: 'a.spec.ts', status: 'passed' }),
        fixtures.test('cmp-b', { id: 't-b', stableId: 'sid-1', title: 'test 1', file: 'a.spec.ts', status: 'failed' }),
      ])
      .run();

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/runs/compare?a=cmp-a&b=cmp-b',
    });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(CompareRowSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('missing required params returns 400 with error shape', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/compare?a=only-a' });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/runs/:id/gate-status', () => {
  it('existing run returns shape matching GateStatusSchema', async () => {
    testApp.db
      .insert(schema.runs)
      .values(fixtures.run({ id: 'gate-run', total: 10, passed: 8, gateStatus: 'passed' }))
      .run();
    testApp.db
      .insert(schema.qualityGateConfig)
      .values({
        id: 'global',
        passRateThreshold: 80,
        maxDurationMs: null,
        maxFlakyCount: null,
        updatedAt: new Date(1693132800000).toISOString(),
      })
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/gate-run/gate-status' });
    expect(res.statusCode).toBe(200);
    const parsed = GateStatusSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('missing run returns 404 with error shape', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/missing/gate-status' });
    expect(res.statusCode).toBe(404);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/runs/:id/fingerprints', () => {
  it('run with failing results returns array matching FingerprintGroupSchema[]', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'fp-run' })).run();
    testApp.db
      .insert(schema.results)
      .values([
        fixtures.result('t-1', 'fp-run', { id: 'res-1', status: 'failed', errorMessage: 'TimeoutError: timeout' }),
        fixtures.result('t-2', 'fp-run', { id: 'res-2', status: 'failed', errorMessage: 'TimeoutError: timeout' }),
      ])
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/fp-run/fingerprints' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(FingerprintGroupSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('run with no failures returns empty array', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'fp-empty' })).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/fp-empty/fingerprints' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(FingerprintGroupSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/runs/:runId/tests', () => {
  it('empty run returns array matching z.array(TestSchema)', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'tests-run' })).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/tests-run/tests' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(TestSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('populated run — each item matches TestSchema', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'tests-pop' })).run();
    testApp.db
      .insert(schema.tests)
      .values([
        fixtures.test('tests-pop', { id: 'tc-1', status: 'passed', title: 'passes', file: 'a.spec.ts' }),
        fixtures.test('tests-pop', { id: 'tc-2', status: 'failed', title: 'fails', file: 'b.spec.ts' }),
      ])
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/runs/tests-pop/tests' });
    expect(res.statusCode).toBe(200);
    for (const item of res.json() as unknown[]) {
      const parsed = TestSchema.safeParse(item);
      expect(parsed.success, parsed.error?.message).toBe(true);
    }
  });
});

describe('contract: GET /api/runs/:runId/tests/:testId', () => {
  it('existing test returns shape matching TestSchema + results array', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'single-test-run' })).run();
    testApp.db
      .insert(schema.tests)
      .values(fixtures.test('single-test-run', { id: 'tc-detail', title: 'detail test', file: 'c.spec.ts' }))
      .run();
    testApp.db
      .insert(schema.results)
      .values(fixtures.result('tc-detail', 'single-test-run', { id: 'r-detail' }))
      .run();

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/runs/single-test-run/tests/tc-detail',
    });
    expect(res.statusCode).toBe(200);

    const TestWithResultsSchema = TestSchema.extend({
      results: z.array(ResultSchema),
    });
    const parsed = TestWithResultsSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('missing test returns 404 with error shape', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'run-for-404-test' })).run();

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/runs/run-for-404-test/tests/no-such-test',
    });
    expect(res.statusCode).toBe(404);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/analytics/pass-rate', () => {
  it('empty DB returns empty array matching PassRatePointSchema[]', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(PassRatePointSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('with run data returns populated PassRatePoint array', async () => {
    testApp.db
      .insert(schema.runs)
      .values(
        fixtures.run({
          id: 'pr-c1',
          status: 'passed',
          total: 10,
          passed: 9,
          startedAt: '2026-01-10T10:00:00.000Z',
          finishedAt: '2026-01-10T10:01:00.000Z',
        }),
      )
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/pass-rate?days=5000' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(PassRatePointSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data!.length).toBeGreaterThan(0);
    expect(typeof parsed.data![0].all).toBe('number');
  });
});

describe('contract: GET /api/analytics/duration', () => {
  it('empty DB returns empty array matching DurationPointSchema[]', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/duration' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(DurationPointSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('with run data returns DurationPoint with p50 and p95', async () => {
    testApp.db
      .insert(schema.runs)
      .values(
        fixtures.run({
          id: 'dur-c1',
          status: 'passed',
          durationMs: 3000,
          startedAt: '2026-02-01T10:00:00.000Z',
          finishedAt: '2026-02-01T10:05:00.000Z',
        }),
      )
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/duration?days=5000' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(DurationPointSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/analytics/flaky', () => {
  it('empty DB returns empty array matching FlakyTestSchema[]', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/flaky' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(FlakyTestSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('with flaky test each item matches FlakyTestSchema', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'flaky-run' })).run();
    testApp.db
      .insert(schema.tests)
      .values(
        fixtures.test('flaky-run', { id: 'flaky-tc', status: 'flaky', title: 'sometimes fails', file: 'f.spec.ts' }),
      )
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/flaky' });
    expect(res.statusCode).toBe(200);
    const items = res.json() as unknown[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const parsed = FlakyTestSchema.safeParse(item);
      expect(parsed.success, parsed.error?.message).toBe(true);
    }
  });
});

describe('contract: GET /api/analytics/slow', () => {
  it('empty DB returns empty array matching SlowTestSchema[]', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/slow' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(SlowTestSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('with slow test each item matches SlowTestSchema', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'slow-run' })).run();
    testApp.db
      .insert(schema.tests)
      .values(
        fixtures.test('slow-run', { id: 'slow-tc', status: 'passed', durationMs: 12000, title: 'heavy test', file: 's.spec.ts' }),
      )
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/slow' });
    expect(res.statusCode).toBe(200);
    for (const item of res.json() as unknown[]) {
      const parsed = SlowTestSchema.safeParse(item);
      expect(parsed.success, parsed.error?.message).toBe(true);
    }
  });
});

describe('contract: GET /api/analytics/heatmap', () => {
  it('empty DB returns empty array matching HeatmapSerieSchema[]', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/heatmap' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(HeatmapSerieSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('with failing tests returns populated HeatmapSerie array', async () => {
    testApp.db
      .insert(schema.runs)
      .values(fixtures.run({ id: 'hm-run', startedAt: '2026-03-01T10:00:00.000Z' }))
      .run();
    testApp.db
      .insert(schema.tests)
      .values(fixtures.test('hm-run', { id: 'hm-tc', status: 'failed', file: 'heat.spec.ts' }))
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/heatmap?days=5000' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(HeatmapSerieSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/analytics/gantt', () => {
  it('missing runId returns 400 with error shape', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/gantt' });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('with runId returns array matching GanttRowSchema[]', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'gantt-run' })).run();
    testApp.db
      .insert(schema.tests)
      .values([
        fixtures.test('gantt-run', { id: 'gantt-tc1', title: 't1', file: 'g.spec.ts', status: 'passed', durationMs: 500, workerIndex: 0 }),
        fixtures.test('gantt-run', { id: 'gantt-tc2', title: 't2', file: 'g.spec.ts', status: 'failed', durationMs: 200, workerIndex: 1 }),
      ])
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/gantt?runId=gantt-run' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(GanttRowSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/analytics/error-clusters', () => {
  it('missing runId returns 400 with error shape', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/error-clusters' });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('with runId returns array from service (mocked)', async () => {
    const ClusterSchema = z.array(z.object({ fingerprint: z.string(), count: z.number() }));
    mockClusterErrors.mockResolvedValueOnce([{ fingerprint: 'TimeoutError', count: 3 }]);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/analytics/error-clusters?runId=any-run' });
    expect(res.statusCode).toBe(200);
    const parsed = ClusterSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /health/live', () => {
  it('returns 200 matching LivenessSchema with status "ok"', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    const parsed = LivenessSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data?.status).toBe('ok');
  });
});

describe('contract: GET /health/ready', () => {
  it('returns 200 matching ReadinessSchema when DB is healthy', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    const parsed = ReadinessSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data?.status).toBe('ok');
    expect(parsed.data?.db.connected).toBe(true);
  });
});

describe('contract: GET /health/startup', () => {
  it('returns 200 with { status: "ok", started: true }', async () => {
    const StartupSchema = z.object({ status: z.string(), started: z.boolean() });
    const res = await testApp.app.inject({ method: 'GET', url: '/health/startup' });
    expect(res.statusCode).toBe(200);
    const parsed = StartupSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /health (legacy alias)', () => {
  it('returns 200 with { status: string, ts: number }', async () => {
    const LegacyHealthSchema = z.object({ status: z.string(), ts: z.number() });
    const res = await testApp.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const parsed = LegacyHealthSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GATE CONFIG CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/gate-config', () => {
  it('returns default config matching GateConfigSchema when none stored', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/gate-config' });
    expect(res.statusCode).toBe(200);
    const parsed = GateConfigSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('returns persisted config matching GateConfigSchema', async () => {
    testApp.db
      .insert(schema.qualityGateConfig)
      .values({
        id: 'global',
        passRateThreshold: 85,
        maxDurationMs: 60000,
        maxFlakyCount: 3,
        updatedAt: new Date(1693132800000).toISOString(),
      })
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/gate-config' });
    expect(res.statusCode).toBe(200);
    const parsed = GateConfigSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data?.passRateThreshold).toBe(85);
  });
});

describe('contract: PUT /api/gate-config', () => {
  it('valid body returns { ok: true }', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/gate-config',
      payload: { passRateThreshold: 90 },
    });
    expect(res.statusCode).toBe(200);
    const parsed = z.object({ ok: z.literal(true) }).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('invalid body (threshold > 100) returns 400 with error shape', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/gate-config',
      payload: { passRateThreshold: 150 },
    });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACES CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/workspaces', () => {
  it('returns empty array matching WorkspaceSchema[]', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(WorkspaceSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('populated list — each item matches WorkspaceSchema', async () => {
    testApp.db.insert(schema.workspaces).values(fixtures.workspace({ id: 'ws-1', name: 'Main' })).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(WorkspaceSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data).toHaveLength(1);
  });
});

describe('contract: POST /api/workspaces', () => {
  it('valid body returns 201 with workspace creation response', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: 'E2E Suite', configPath: './playwright.config.ts' },
    });
    expect(res.statusCode).toBe(201);
    const parsed = z.object({ id: z.string(), name: z.string(), configPath: z.string() }).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('empty name returns 400 with error shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '', configPath: './playwright.config.ts' },
    });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QUARANTINE CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/quarantine', () => {
  it('returns empty array matching QuarantineEntrySchema[]', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/quarantine' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(QuarantineEntrySchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('populated list — each item matches QuarantineEntrySchema', async () => {
    testApp.db
      .insert(schema.quarantine)
      .values(fixtures.quarantineEntry({ id: 'q-1', testTitle: 'flaky login', testFile: 'login.spec.ts' }))
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/quarantine' });
    expect(res.statusCode).toBe(200);
    for (const item of res.json() as unknown[]) {
      const parsed = QuarantineEntrySchema.safeParse(item);
      expect(parsed.success, parsed.error?.message).toBe(true);
    }
  });
});

describe('contract: POST /api/quarantine', () => {
  it('valid body returns 201 with quarantine entry shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/quarantine',
      payload: { testTitle: 'my flaky test', testFile: 'flaky.spec.ts', reason: 'timeout' },
    });
    expect(res.statusCode).toBe(201);
    const parsed = z.object({ id: z.string(), testTitle: z.string(), testFile: z.string() }).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('empty testTitle returns 400 with error shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/quarantine',
      payload: { testTitle: '', testFile: 'flaky.spec.ts' },
    });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// KNOWN FAILURES CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/known-failures', () => {
  it('returns empty array matching KnownFailureSchema[]', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/known-failures' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(KnownFailureSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('populated list — each item matches KnownFailureSchema', async () => {
    testApp.db
      .insert(schema.knownFailures)
      .values(fixtures.knownFailure({ id: 'kf-1', testTitle: 'broken test', testFile: 'broken.spec.ts' }))
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/known-failures' });
    expect(res.statusCode).toBe(200);
    for (const item of res.json() as unknown[]) {
      const parsed = KnownFailureSchema.safeParse(item);
      expect(parsed.success, parsed.error?.message).toBe(true);
    }
  });
});

describe('contract: POST /api/known-failures', () => {
  it('valid body returns 201 with known failure entry shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/known-failures',
      payload: { testTitle: 'expected failure', testFile: 'expected.spec.ts', comment: 'JIRA-42' },
    });
    expect(res.statusCode).toBe(201);
    const parsed = z.object({ id: z.string(), testTitle: z.string(), testFile: z.string() }).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('empty testTitle returns 400 with error shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/known-failures',
      payload: { testTitle: '', testFile: 'broken.spec.ts' },
    });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULES CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/schedules', () => {
  it('fixtures.schedule() uses randomUUID and default cronExpr when no overrides given', () => {
    // Covers the ?? fallback branches in fixtures.ts lines 197-198
    const s = fixtures.schedule();
    expect(typeof s.id).toBe('string');
    expect(s.cronExpr).toBe('0 */6 * * *');
  });

  it('returns empty array matching ScheduleSchema[]', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/schedules' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(ScheduleSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('populated list — each item matches ScheduleSchema', async () => {
    testApp.db
      .insert(schema.schedules)
      .values(fixtures.schedule({ id: 'sched-1', cronExpr: '0 * * * *' }))
      .run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/schedules' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(ScheduleSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data).toHaveLength(1);
  });
});

describe('contract: POST /api/schedules', () => {
  it('valid body returns 201 with schedule entry shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedules',
      payload: { cronExpr: '*/30 * * * *', enabled: true },
    });
    expect(res.statusCode).toBe(201);
    const parsed = z
      .object({ id: z.string(), cronExpr: z.string(), enabled: z.union([z.boolean(), z.number()]) })
      .safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('empty cronExpr returns 400 with error shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedules',
      payload: { cronExpr: '' },
    });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORIES CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.string(),
});

describe('contract: GET /api/categories', () => {
  it('empty list returns array matching CategorySchema[]', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/categories' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(CategorySchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('populated list — each item matches CategorySchema', async () => {
    testApp.sqlite
      .prepare('INSERT INTO defect_categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run('cat-1', 'network', '#ff0000', new Date(1693132800000).toISOString());

    const res = await testApp.app.inject({ method: 'GET', url: '/api/categories' });
    expect(res.statusCode).toBe(200);
    for (const item of res.json() as unknown[]) {
      const parsed = CategorySchema.safeParse(item);
      expect(parsed.success, parsed.error?.message).toBe(true);
    }
  });
});

describe('contract: POST /api/categories', () => {
  it('valid body returns 201 with CategorySchema shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'infrastructure', color: '#3b82f6' },
    });
    expect(res.statusCode).toBe(201);
    const parsed = CategorySchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('empty name returns 400 with error shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: PUT /api/categories/:id', () => {
  it('valid body returns { ok: true }', async () => {
    testApp.sqlite
      .prepare('INSERT INTO defect_categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run('cat-upd', 'old-name', '#000000', new Date(1693132800000).toISOString());

    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/categories/cat-upd',
      payload: { name: 'new-name', color: '#ffffff' },
    });
    expect(res.statusCode).toBe(200);
    const parsed = z.object({ ok: z.literal(true) }).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: DELETE /api/categories/:id', () => {
  it('existing category returns { ok: true }', async () => {
    testApp.sqlite
      .prepare('INSERT INTO defect_categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run('cat-del', 'to-delete', '#000000', new Date(1693132800000).toISOString());

    const res = await testApp.app.inject({ method: 'DELETE', url: '/api/categories/cat-del' });
    expect(res.statusCode).toBe(200);
    const parsed = z.object({ ok: z.literal(true) }).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('missing category returns 404 with error shape', async () => {
    const res = await testApp.app.inject({ method: 'DELETE', url: '/api/categories/does-not-exist' });
    expect(res.statusCode).toBe(404);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/fingerprint-categories', () => {
  it('returns empty array when none assigned', async () => {
    const FingerprintCategorySchema = z.object({
      fingerprint: z.string(),
      categoryId: z.string(),
      assignedAt: z.string(),
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/fingerprint-categories' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(FingerprintCategorySchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BADGES CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/badges/pass-rate.svg', () => {
  it('no runs returns SVG with N/A', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/pass-rate.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('pass rate');
  });

  it('with passing run returns SVG with percentage', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'badge-run', status: 'passed', total: 10, passed: 9 })).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/pass-rate.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('%');
  });
});

describe('contract: GET /api/badges/status.svg', () => {
  it('no runs returns SVG with "unknown" status', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/status.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('unknown');
  });

  it('with run returns SVG with run status', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'badge-stat', status: 'passed' })).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/status.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('passed');
  });
});

describe('contract: GET /api/badges/flaky.svg', () => {
  it('no runs returns SVG with "0" flaky count', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/flaky.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('flaky');
  });

  it('with run containing flaky tests returns correct count in SVG', async () => {
    testApp.db.insert(schema.runs).values(fixtures.run({ id: 'badge-flaky' })).run();
    testApp.db.insert(schema.tests).values([
      fixtures.test('badge-flaky', { id: 'ft-1', status: 'flaky', title: 'flaky 1', file: 'f.spec.ts' }),
      fixtures.test('badge-flaky', { id: 'ft-2', status: 'flaky', title: 'flaky 2', file: 'f.spec.ts' }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/api/badges/flaky.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<svg');
    // flaky count is embedded as text node
    expect(res.body).toContain('2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// METRICS CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /metrics', () => {
  it('returns Prometheus text exposition with expected metric names', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    // Core metrics must be present
    expect(res.body).toContain('automate_dashboard_runs_total');
    expect(res.body).toContain('automate_dashboard_pass_rate');
    expect(res.body).toContain('automate_dashboard_avg_duration_seconds');
    expect(res.body).toContain('automate_dashboard_flaky_tests_count');
    expect(res.body).toContain('automate_dashboard_active_runs');
  });

  it('with runs in DB reflects counts in metrics output', async () => {
    testApp.db.insert(schema.runs).values([
      fixtures.run({ id: 'met-1', status: 'passed', total: 10, passed: 10 }),
      fixtures.run({ id: 'met-2', status: 'failed', total: 5, failed: 3 }),
    ]).run();

    const res = await testApp.app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    // passed and failed status labels appear in the output
    expect(res.body).toContain('status="passed"');
    expect(res.body).toContain('status="failed"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FEATURES CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/features', () => {
  it('returns object with all expected feature flag keys', async () => {
    const FeatureFlagsSchema = z.record(z.boolean());
    const res = await testApp.app.inject({ method: 'GET', url: '/api/features' });
    expect(res.statusCode).toBe(200);
    const parsed = FeatureFlagsSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
    // Verify some well-known flags are present
    const flags = res.json() as Record<string, boolean>;
    expect(typeof flags['live-run-monitoring']).toBe('boolean');
    expect(typeof flags['auto-quarantine']).toBe('boolean');
    expect(typeof flags['nl-query']).toBe('boolean');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NL-QUERY CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

const NlQueryResultSchema = z.object({
  query: z.string(),
  sql: z.string().nullable().optional(),
  results: z.array(z.unknown()),
  resultCount: z.number().optional(),
});

const NlQueryHistoryEntrySchema = z.object({
  id: z.number(),
  userQuery: z.string(),
  generatedSql: z.string(),
  resultCount: z.number().nullable(),
  userId: z.string().nullable(),
  createdAt: z.string(),
});

describe('contract: POST /api/nl-query', () => {
  it('valid query returns result matching NlQueryResultSchema', async () => {
    mockNlToSQL.mockResolvedValueOnce({ sql: 'SELECT * FROM runs', results: [{ id: 'r1' }], resultCount: 1 });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/nl-query',
      payload: { query: 'show me all runs' },
    });
    expect(res.statusCode).toBe(200);
    const parsed = NlQueryResultSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('empty query returns 400 with error shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/nl-query',
      payload: { query: '   ' },
    });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('rejected query returns 422 with error shape', async () => {
    mockNlToSQL.mockResolvedValueOnce({
      sql: null as unknown as string,
      results: [],
      resultCount: 0,
      rejected: true,
      error: 'Query cannot be translated to SQL',
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/nl-query',
      payload: { query: 'drop the database' },
    });
    expect(res.statusCode).toBe(422);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/nl-query/history', () => {
  it('empty history returns empty array', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/nl-query/history' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(NlQueryHistoryEntrySchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data).toHaveLength(0);
  });

  it('with history entries — each matches NlQueryHistoryEntrySchema', async () => {
    testApp.sqlite
      .prepare(`INSERT INTO nl_query_history (user_query, generated_sql, result_count, user_id, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('show failed runs', 'SELECT * FROM runs WHERE status = "failed"', 3, null, new Date(1693132800000).toISOString());

    const res = await testApp.app.inject({ method: 'GET', url: '/api/nl-query/history' });
    expect(res.statusCode).toBe(200);
    const items = res.json() as unknown[];
    expect(items).toHaveLength(1);
    const parsed = NlQueryHistoryEntrySchema.safeParse(items[0]);
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INGEST (BLOB) CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

const BlobGroupSchema = z.object({
  runId: z.string(),
  shards: z.number(),
  totalShards: z.number(),
  allUploaded: z.boolean(),
  merged: z.boolean(),
});

describe('contract: GET /api/ingest/blobs', () => {
  it('empty list returns empty array matching BlobGroupSchema[]', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/ingest/blobs' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(BlobGroupSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data).toHaveLength(0);
  });

  it('with blob shards returns grouped entries', async () => {
    const runId = '22222222-2222-4222-8222-222222222222';
    testApp.sqlite
      .prepare(`INSERT INTO blob_shards (id, run_id, shard_index, total_shards, file_path, uploaded_at, merged) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('shard-1', runId, 1, 2, '/blobs/shard-1.zip', new Date(1693132800000).toISOString(), 0);
    testApp.sqlite
      .prepare(`INSERT INTO blob_shards (id, run_id, shard_index, total_shards, file_path, uploaded_at, merged) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('shard-2', runId, 2, 2, '/blobs/shard-2.zip', new Date(1693132800000).toISOString(), 0);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/ingest/blobs' });
    expect(res.statusCode).toBe(200);
    const items = res.json() as unknown[];
    expect(items).toHaveLength(1);
    const parsed = BlobGroupSchema.safeParse(items[0]);
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data?.shards).toBe(2);
    expect(parsed.data?.totalShards).toBe(2);
    expect(parsed.data?.allUploaded).toBe(true);
  });
});

describe('contract: POST /api/ingest/blob/merge', () => {
  it('invalid runId returns 400 with error shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/ingest/blob/merge',
      payload: { runId: 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('valid runId with no shards returns 404 with error shape', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/ingest/blob/merge',
      payload: { runId: '33333333-3333-4333-8333-333333333333' },
    });
    expect(res.statusCode).toBe(404);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/auth/status', () => {
  let authTestApp: TestApp;

  beforeAll(async () => {
    authTestApp = await createTestApp();
    const cookie = await import('@fastify/cookie');
    await authTestApp.app.register(cookie.default, { secret: 'test-secret' });
    const { authRoutes } = await import('./auth.js');
    await authRoutes(authTestApp.app);
    await authTestApp.app.ready();
  });

  afterAll(async () => {
    await authTestApp.app.close();
    authTestApp.poolConnection.close();
  });

  beforeEach(() => {
    mockAuthLoadConfig.mockReturnValue({ enabled: true, keys: [{ id: 'k1', name: 'test', key: 'ak_test', createdAt: new Date(1693132800000).toISOString() }] });
    mockAuthValidateSessionToken.mockReturnValue(false);
  });

  it('returns shape matching { enabled, authenticated, keyCount }', async () => {
    const AuthStatusSchema = z.object({
      enabled: z.boolean(),
      authenticated: z.boolean(),
      keyCount: z.number(),
    });
    const res = await authTestApp.app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.statusCode).toBe(200);
    const parsed = AuthStatusSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: POST /api/auth/login', () => {
  let authTestApp: TestApp;

  beforeAll(async () => {
    authTestApp = await createTestApp();
    const cookie = await import('@fastify/cookie');
    await authTestApp.app.register(cookie.default, { secret: 'test-secret' });
    const { authRoutes } = await import('./auth.js');
    await authRoutes(authTestApp.app);
    await authTestApp.app.ready();
  });

  afterAll(async () => {
    await authTestApp.app.close();
    authTestApp.poolConnection.close();
  });

  it('invalid key returns 401 with { authenticated: false }', async () => {
    mockAuthLoadConfig.mockReturnValue({ enabled: true, keys: [] });
    mockAuthValidateApiKey.mockReturnValue(false);

    const res = await authTestApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { apiKey: 'bad-key' },
    });
    expect(res.statusCode).toBe(401);
    const parsed = z.object({ authenticated: z.literal(false) }).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('valid key returns 200 with { authenticated: true }', async () => {
    mockAuthLoadConfig.mockReturnValue({
      enabled: true,
      keys: [{ id: 'k1', name: 'test', key: 'valid-key', createdAt: new Date(1693132800000).toISOString() }],
    });
    mockAuthValidateApiKey.mockReturnValue(true);
    mockAuthGenerateSessionToken.mockReturnValue('sess-token');

    const res = await authTestApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { apiKey: 'valid-key' },
    });
    expect(res.statusCode).toBe(200);
    const parsed = z.object({ authenticated: z.literal(true) }).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('empty apiKey returns 400 with error shape', async () => {
    const res = await authTestApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { apiKey: '' },
    });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/auth/keys', () => {
  let authTestApp: TestApp;

  beforeAll(async () => {
    authTestApp = await createTestApp();
    const cookie = await import('@fastify/cookie');
    await authTestApp.app.register(cookie.default, { secret: 'test-secret' });
    const { authRoutes } = await import('./auth.js');
    await authRoutes(authTestApp.app);
    await authTestApp.app.ready();
  });

  afterAll(async () => {
    await authTestApp.app.close();
    authTestApp.poolConnection.close();
  });

  it('returns array matching ApiKeySchema[]', async () => {
    const ApiKeySchema = z.object({
      id: z.string(),
      name: z.string(),
      key: z.string(),
      createdAt: z.string(),
    });
    mockAuthListApiKeys.mockReturnValue([
      { id: 'k1', name: 'ci', key: 'ak_ci_...', createdAt: new Date(1693132800000).toISOString() },
    ]);

    const res = await authTestApp.app.inject({ method: 'GET', url: '/api/auth/keys' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(ApiKeySchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/settings/auto-quarantine', () => {
  let settingsTestApp: TestApp;

  beforeAll(async () => {
    settingsTestApp = await createTestApp();
    // Mock fs to avoid file-system dependency
    vi.stubEnv('NODE_ENV', 'test');
    const { registerSettingsRoutes } = await import('./settings.js');
    await registerSettingsRoutes(settingsTestApp.app);
    await settingsTestApp.app.ready();
  });

  afterAll(async () => {
    await settingsTestApp.app.close();
    settingsTestApp.poolConnection.close();
  });

  it('returns shape matching { flakyThreshold, lookbackRuns }', async () => {
    const AutoQuarantineConfigSchema = z.object({
      flakyThreshold: z.number(),
      lookbackRuns: z.number(),
    });
    // Default config — no file on disk in test env
    const res = await settingsTestApp.app.inject({ method: 'GET', url: '/api/settings/auto-quarantine' });
    expect(res.statusCode).toBe(200);
    const parsed = AutoQuarantineConfigSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/settings/data-retention', () => {
  let settingsTestApp: TestApp;

  beforeAll(async () => {
    settingsTestApp = await createTestApp();
    const { registerSettingsRoutes } = await import('./settings.js');
    await registerSettingsRoutes(settingsTestApp.app);
    await settingsTestApp.app.ready();
  });

  afterAll(async () => {
    await settingsTestApp.app.close();
    settingsTestApp.poolConnection.close();
  });

  it('returns shape matching RetentionConfigSchema', async () => {
    const RetentionConfigSchema = z.object({
      testResultDays: z.number(),
      nlQueryHistoryDays: z.number(),
      attachmentDays: z.number(),
      trendsDays: z.number(),
      enabled: z.boolean(),
    });
    mockRetentionLoadConfig.mockReturnValue({
      testResultDays: 90,
      nlQueryHistoryDays: 30,
      attachmentDays: 60,
      trendsDays: -1,
      enabled: false,
    });

    const res = await settingsTestApp.app.inject({ method: 'GET', url: '/api/settings/data-retention' });
    expect(res.statusCode).toBe(200);
    const parsed = RetentionConfigSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/settings/db-stats', () => {
  let settingsTestApp: TestApp;

  beforeAll(async () => {
    settingsTestApp = await createTestApp();
    const { registerSettingsRoutes } = await import('./settings.js');
    await registerSettingsRoutes(settingsTestApp.app);
    await settingsTestApp.app.ready();
  });

  afterAll(async () => {
    await settingsTestApp.app.close();
    settingsTestApp.poolConnection.close();
  });

  it('returns shape matching DbStatsSchema', async () => {
    const DbStatsSchema = z.object({
      sizeBytes: z.number(),
      sizeMB: z.string(),
      pageCount: z.number(),
      pageSize: z.number(),
    });
    mockRetentionGetDbStats.mockReturnValue({ sizeBytes: 4096, sizeMB: '0.00', pageCount: 1, pageSize: 4096 });

    const res = await settingsTestApp.app.inject({ method: 'GET', url: '/api/settings/db-stats' });
    expect(res.statusCode).toBe(200);
    const parsed = DbStatsSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: PUT /api/settings/auto-quarantine', () => {
  let settingsTestApp: TestApp;

  beforeAll(async () => {
    settingsTestApp = await createTestApp();
    const { registerSettingsRoutes } = await import('./settings.js');
    await registerSettingsRoutes(settingsTestApp.app);
    await settingsTestApp.app.ready();
  });

  afterAll(async () => {
    await settingsTestApp.app.close();
    settingsTestApp.poolConnection.close();
  });

  it('valid body returns { ok: true }', async () => {
    const res = await settingsTestApp.app.inject({
      method: 'PUT',
      url: '/api/settings/auto-quarantine',
      payload: { flakyThreshold: 5, lookbackRuns: 20 },
    });
    expect(res.statusCode).toBe(200);
    const parsed = z.object({ ok: z.literal(true) }).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('invalid body returns 400 with error shape', async () => {
    const res = await settingsTestApp.app.inject({
      method: 'PUT',
      url: '/api/settings/auto-quarantine',
      payload: { flakyThreshold: 0 },
    });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATIONS CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/integrations/config', () => {
  let intTestApp: TestApp;

  beforeAll(async () => {
    intTestApp = await createTestApp();
    const { integrationsRoutes } = await import('./integrations.js');
    await integrationsRoutes(intTestApp.app);
    await intTestApp.app.ready();
  });

  afterAll(async () => {
    await intTestApp.app.close();
    intTestApp.poolConnection.close();
  });

  it('returns integration config shape (empty defaults)', async () => {
    mockReadIntegrationConfig.mockReturnValue({});
    const IntegrationConfigSchema = z.object({}).passthrough();
    const res = await intTestApp.app.inject({ method: 'GET', url: '/api/integrations/config' });
    expect(res.statusCode).toBe(200);
    const parsed = IntegrationConfigSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/integrations/webhooks', () => {
  let intTestApp: TestApp;

  beforeAll(async () => {
    intTestApp = await createTestApp();
    const { integrationsRoutes } = await import('./integrations.js');
    await integrationsRoutes(intTestApp.app);
    await intTestApp.app.ready();
  });

  afterAll(async () => {
    await intTestApp.app.close();
    intTestApp.poolConnection.close();
  });

  it('returns empty array when no webhooks configured', async () => {
    mockReadIntegrationConfig.mockReturnValue({ webhooks: [] });
    const WebhookSchema = z.object({ url: z.string(), events: z.array(z.string()) });

    const res = await intTestApp.app.inject({ method: 'GET', url: '/api/integrations/webhooks' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(WebhookSchema).safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('returns webhooks from config', async () => {
    mockReadIntegrationConfig.mockReturnValue({
      webhooks: [{ url: 'https://example.com/hook', events: ['run.complete'] }],
    });
    const WebhookSchema = z.object({ url: z.string(), events: z.array(z.string()) });

    const res = await intTestApp.app.inject({ method: 'GET', url: '/api/integrations/webhooks' });
    expect(res.statusCode).toBe(200);
    const items = res.json() as unknown[];
    expect(items).toHaveLength(1);
    const parsed = WebhookSchema.safeParse(items[0]);
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe('contract: GET /api/ci/status', () => {
  let intTestApp: TestApp;

  beforeAll(async () => {
    intTestApp = await createTestApp();
    const { integrationsRoutes } = await import('./integrations.js');
    await integrationsRoutes(intTestApp.app);
    await intTestApp.app.ready();
  });

  afterAll(async () => {
    await intTestApp.app.close();
    intTestApp.poolConnection.close();
  });

  it('missing sha returns 400 with error shape', async () => {
    const res = await intTestApp.app.inject({ method: 'GET', url: '/api/ci/status' });
    expect(res.statusCode).toBe(400);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('with sha returns shape matching CiStatusSchema', async () => {
    const CiStatusSchema = z.object({
      provider: z.string().nullable(),
      status: z.string(),
      url: z.string().nullable(),
    });
    mockPollCIStatus.mockResolvedValueOnce({ provider: 'github', status: 'success', url: 'https://github.com/actions/runs/123' });

    const res = await intTestApp.app.inject({ method: 'GET', url: '/api/ci/status?sha=abc123' });
    expect(res.statusCode).toBe(200);
    const parsed = CiStatusSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('with sha and no CI result returns { provider: null, status: "unknown", url: null }', async () => {
    mockPollCIStatus.mockResolvedValueOnce(null);
    const CiStatusSchema = z.object({
      provider: z.null(),
      status: z.literal('unknown'),
      url: z.null(),
    });

    const res = await intTestApp.app.inject({ method: 'GET', url: '/api/ci/status?sha=xyz000' });
    expect(res.statusCode).toBe(200);
    const parsed = CiStatusSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MCP MANAGEMENT CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /api/mcp/servers', () => {
  it('returns { servers: [] } when registry is empty', async () => {
    const mcpApp = Fastify({ logger: false });
    const { McpServerRegistry } = await import('../mcp/gateway/registry.js');
    const { McpProcessLifecycle } = await import('../mcp/gateway/lifecycle.js');
    const { mcpManagementRoutes } = await import('./mcp-management.js');

    const registry = new McpServerRegistry();
    const lifecycle = new McpProcessLifecycle();
    await mcpApp.register(mcpManagementRoutes, { registry, lifecycle });
    await mcpApp.ready();

    const McpServersSchema = z.object({
      servers: z.array(z.object({
        id: z.string(),
        name: z.string(),
        transport: z.string(),
        enabled: z.boolean(),
        toolPrefix: z.string().optional().nullable(),
        running: z.boolean(),
      })),
    });

    const res = await mcpApp.inject({ method: 'GET', url: '/api/mcp/servers' });
    expect(res.statusCode).toBe(200);
    const parsed = McpServersSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data?.servers).toHaveLength(0);

    await mcpApp.close();
  });
});

describe('contract: GET /api/mcp/servers/:id/status', () => {
  it('missing server id returns 404 with error shape', async () => {
    const mcpApp = Fastify({ logger: false });
    const { McpServerRegistry } = await import('../mcp/gateway/registry.js');
    const { McpProcessLifecycle } = await import('../mcp/gateway/lifecycle.js');
    const { mcpManagementRoutes } = await import('./mcp-management.js');

    const registry = new McpServerRegistry();
    const lifecycle = new McpProcessLifecycle();
    await mcpApp.register(mcpManagementRoutes, { registry, lifecycle });
    await mcpApp.ready();

    const res = await mcpApp.inject({ method: 'GET', url: '/api/mcp/servers/no-such-server/status' });
    expect(res.statusCode).toBe(404);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);

    await mcpApp.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ARTIFACTS CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

describe('contract: GET /artifacts/*', () => {
  let artifactsTestApp: TestApp;

  beforeAll(async () => {
    artifactsTestApp = await createTestApp();
    const { artifactsRoutes } = await import('./artifacts.js');
    await artifactsRoutes(artifactsTestApp.app);
    await artifactsTestApp.app.ready();
  });

  afterAll(async () => {
    await artifactsTestApp.app.close();
    artifactsTestApp.poolConnection.close();
  });

  it('path traversal attempt returns 403 with error shape', async () => {
    const res = await artifactsTestApp.app.inject({ method: 'GET', url: '/artifacts/..%2F..%2Fetc%2Fpasswd' });
    expect(res.statusCode).toBe(403);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it('non-existent artifact returns 404 with error shape', async () => {
    const res = await artifactsTestApp.app.inject({ method: 'GET', url: '/artifacts/nonexistent-file.png' });
    expect(res.statusCode).toBe(404);
    const parsed = ErrorResponseSchema.safeParse(res.json());
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});
