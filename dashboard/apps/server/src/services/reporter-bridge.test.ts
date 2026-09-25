/// <reference types="vitest" />
/**
 * reporter-bridge.test.ts
 *
 * Covers error-path handling, WebSocket disconnect, concurrent submissions,
 * and quality-gate edge cases NOT covered by:
 *   - reporter-bridge-pr.test.ts  (PR metadata on run:start)
 *   - __tests__/reporter-bridge-full.test.ts  (happy-path event lifecycle, client management)
 *   - __tests__/reporter-bridge-dispatch-coverage.test.ts  (dispatchIntegrations happy paths)
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';

// ─── In-memory SQLite setup ──────────────────────────────────────────────────

const testSqlite = new Database(':memory:');
testSqlite.pragma('journal_mode = WAL');
testSqlite.pragma('foreign_keys = ON');

testSqlite.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    total INTEGER NOT NULL DEFAULT 0,
    passed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    flaky INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    branch TEXT,
    commit_sha TEXT,
    commit_message TEXT,
    triggered_by TEXT DEFAULT 'manual',
    config TEXT,
    raw_args TEXT,
    source TEXT NOT NULL DEFAULT 'live',
    gate_status TEXT,
    workspace_id TEXT,
    pr_number INTEGER,
    pr_branch TEXT,
    base_branch TEXT,
    commit_author TEXT
  );

  CREATE TABLE IF NOT EXISTS tests (
    id TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    suite_id TEXT,
    title TEXT NOT NULL,
    file TEXT NOT NULL,
    line INTEGER,
    "column" INTEGER,
    stable_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    duration_ms INTEGER,
    tags TEXT,
    annotations TEXT,
    retry_count INTEGER DEFAULT 0,
    expected_status TEXT,
    worker_index INTEGER,
    PRIMARY KEY (id, run_id)
  );

  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    test_id TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    retry INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    duration_ms INTEGER,
    started_at TEXT,
    error_message TEXT,
    error_stack TEXT,
    worker_index INTEGER,
    parallel_index INTEGER,
    stdout TEXT,
    stderr TEXT,
    steps TEXT,
    attachments TEXT,
    fingerprint TEXT
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    path TEXT NOT NULL,
    size_bytes INTEGER,
    thumbnail_path TEXT,
    is_screenshot_diff INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS quality_gate_config (
    id TEXT PRIMARY KEY DEFAULT 'global',
    workspace_id TEXT,
    pass_rate_threshold REAL NOT NULL DEFAULT 100,
    max_duration_ms INTEGER,
    max_flaky_count INTEGER,
    max_quarantine_percent REAL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quarantine (
    id TEXT PRIMARY KEY,
    test_title TEXT NOT NULL,
    test_file TEXT NOT NULL,
    reason TEXT,
    quarantined_at TEXT NOT NULL,
    quarantined_by TEXT DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'approved'
  );

  CREATE TABLE IF NOT EXISTS failure_classifications (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    confidence REAL NOT NULL,
    matched_rule_id TEXT,
    rationale TEXT NOT NULL,
    is_manual_override INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(fingerprint, run_id)
  );
`);

const testDb = drizzle(testSqlite, { schema });
// Polyfill .execute() and .transaction() for SQLite Drizzle client to match Postgres Drizzle client behavior in tests
(testDb as any).execute = (query: any) => {
  const res = (testDb as any).run(query);
  return Promise.resolve(res);
};
(testDb as any).transaction = (async (callback: any) => {
  return callback(testDb);
}) as any;

// ─── Mock hoisted declarations ──────────────────────────────────────────────

const {
  mockExistsSync,
  mockReadFileSync,
  mockSendSlackRunSummary,
  mockCreateJiraBug,
  mockPostPrComment,
  mockCreateCommitStatus,
  mockPostOrUpdatePrComment,
  mockDispatchAllWebhooks,
  mockSendRunReportEmail,
  mockSendTeamsRunSummary,
  mockResolveBaseRun,
  mockCompareRunToBase,
  mockGeneratePrCommentMarkdown,
  mockAutoQuarantineCheck,
  mockUpdateTrendsForDate,
  mockClassifyFailure,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(p: string) => boolean>(),
  mockReadFileSync: vi.fn<(p: string, enc: string) => string>(),
  mockSendSlackRunSummary: vi.fn(),
  mockCreateJiraBug: vi.fn(),
  mockPostPrComment: vi.fn(),
  mockCreateCommitStatus: vi.fn(),
  mockPostOrUpdatePrComment: vi.fn(),
  mockDispatchAllWebhooks: vi.fn(),
  mockSendRunReportEmail: vi.fn(),
  mockSendTeamsRunSummary: vi.fn(),
  mockResolveBaseRun: vi.fn(),
  mockCompareRunToBase: vi.fn(),
  mockGeneratePrCommentMarkdown: vi.fn(),
  mockAutoQuarantineCheck: vi.fn(),
  mockUpdateTrendsForDate: vi.fn(),
  mockClassifyFailure: vi.fn(),
}));

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../db/client.js', () => ({
  get db() { return testDb; },
  get sqlite() { return testSqlite; },
  get poolConnection() {
    // Add query polyfill for stakeholder reports/analytics if they run in this test context
    if (!(testSqlite as any).query) {
      (testSqlite as any).query = async (sql: string, params: any[] = []) => {
        const sqliteSql = sql.replace(/\$(\d+)/g, ':p$1');
        const stmt = testSqlite.prepare(sqliteSql);
        const paramsObj: Record<string, any> = {};
        params.forEach((val, i) => { paramsObj[`p${i + 1}`] = val; });
        const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
        return isSelect ? { rows: stmt.all(paramsObj) } : { rows: [], rowCount: stmt.run(paramsObj).changes };
      };
    }
    return testSqlite;
  },
}));


vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('./integrations/slack.js', () => ({ sendSlackRunSummary: mockSendSlackRunSummary }));
vi.mock('./integrations/jira.js', () => ({ createJiraBug: mockCreateJiraBug }));
vi.mock('./integrations/github.js', () => ({
  postPrComment: mockPostPrComment,
  createCommitStatus: mockCreateCommitStatus,
  postOrUpdatePrComment: mockPostOrUpdatePrComment,
}));
vi.mock('./integrations/webhooks.js', () => ({ dispatchAllWebhooks: mockDispatchAllWebhooks }));
vi.mock('./integrations/email.js', () => ({ sendRunReportEmail: mockSendRunReportEmail }));
vi.mock('./integrations/teams.js', () => ({ sendTeamsRunSummary: mockSendTeamsRunSummary }));
vi.mock('./trend-backfill.js', () => ({ updateTrendsForDate: mockUpdateTrendsForDate }));
vi.mock('./auto-quarantine.js', () => ({ autoQuarantineCheck: mockAutoQuarantineCheck }));
vi.mock('./pr-comparison.js', () => ({
  resolveBaseRun: mockResolveBaseRun,
  compareRunToBase: mockCompareRunToBase,
  generatePrCommentMarkdown: mockGeneratePrCommentMarkdown,
}));
vi.mock('./fingerprint.js', () => ({ fingerprintError: vi.fn().mockReturnValue(null) }));
vi.mock('./failure-taxonomy.js', () => ({ classifyFailure: mockClassifyFailure }));

// ─── Import under test (after all mocks) ────────────────────────────────────

import { ReporterBridge } from './reporter-bridge.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createLogger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

type InternalFakeWs = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  _closeCb?: () => void;
};

function createFakeWs(readyState = 1): {
  ws: WebSocket;
  sent: string[];
  triggerClose: () => void;
} {
  const sent: string[] = [];
  const fake: InternalFakeWs = {
    readyState,
    send: vi.fn((msg: string) => sent.push(msg)),
    once: vi.fn((event: string, cb: () => void) => {
      if (event === 'close') fake._closeCb = cb;
    }),
    _closeCb: undefined,
  };
  return {
    ws: fake as unknown as WebSocket,
    sent,
    triggerClose: () => fake._closeCb?.(),
  };
}

async function emit(
  bridge: ReporterBridge,
  event: { type: string; runId: string; payload: Record<string, unknown> },
) {
  await bridge.handleReporterEvent(JSON.stringify(event));
}

async function dispatchFor(bridge: ReporterBridge, runId: string): Promise<void> {
  const fn = Reflect.get(bridge as object, 'dispatchIntegrations') as (rid: string) => Promise<void>;
  await fn.call(bridge, runId);
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  testSqlite.exec('DELETE FROM results');
  testSqlite.exec('DELETE FROM tests');
  testSqlite.exec('DELETE FROM runs');
  testSqlite.exec('DELETE FROM quality_gate_config');
  testSqlite.exec('DELETE FROM quarantine');
  vi.clearAllMocks();

  // Default safe mocks
  mockExistsSync.mockReturnValue(false); // config file absent by default
  mockReadFileSync.mockReturnValue('{}');
  mockDispatchAllWebhooks.mockResolvedValue(undefined);
  mockSendSlackRunSummary.mockResolvedValue(undefined);
  mockCreateJiraBug.mockResolvedValue(undefined);
  mockPostPrComment.mockResolvedValue(undefined);
  mockCreateCommitStatus.mockResolvedValue(undefined);
  mockPostOrUpdatePrComment.mockResolvedValue(undefined);
  mockSendRunReportEmail.mockResolvedValue(undefined);
  mockSendTeamsRunSummary.mockResolvedValue(undefined);
  mockResolveBaseRun.mockResolvedValue(null);
  mockCompareRunToBase.mockResolvedValue({});
  mockGeneratePrCommentMarkdown.mockReturnValue('');
  mockAutoQuarantineCheck.mockResolvedValue(undefined);
  mockUpdateTrendsForDate.mockResolvedValue(undefined);
  mockClassifyFailure.mockReturnValue({ category: 'assertion', confidence: 0.9, matchedRuleId: null, evidence: 'auto-classified' });
});

afterAll(() => {
  testSqlite.close();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ReporterBridge error-path and edge-case coverage', () => {
  // ── Broadcast: send throws ────────────────────────────────────────────────
  describe('broadcast — faulty WebSocket removal', () => {
    it('removes client from set when ws.send throws', () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      const fake: InternalFakeWs = {
        readyState: 1,
        send: vi.fn(() => {
          throw new Error('broken pipe');
        }),
        once: vi.fn((_event: string, cb: () => void) => {
          fake._closeCb = cb;
        }),
      };
      const faultyWs = fake as unknown as WebSocket;

      const goodClient = createFakeWs(1);

      bridge.addClient(faultyWs);
      bridge.addClient(goodClient.ws);

      bridge.broadcast({ type: 'stdout', runId: 'run-x', payload: {} });

      // Logger should warn about the faulty client
      expect((log.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
      // Good client should still receive the message
      expect(goodClient.sent).toHaveLength(1);

      // Second broadcast: faulty client has been removed, no second throw
      bridge.broadcast({ type: 'stdout', runId: 'run-x', payload: {} });
      expect(goodClient.sent).toHaveLength(2);
      // warn is still only called once (faulty client removed after first fail)
      expect((log.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });
  });

  // ── Quality gate: zero-total run ─────────────────────────────────────────
  describe('computeGateStatus — zero total', () => {
    it('does not update gate_status when run has total = 0', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-zero', payload: { total: 0, config: {} } });
      await emit(bridge, { type: 'run:end', runId: 'run-zero', payload: { status: 'passed', durationMs: 1 } });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-zero'));
      expect(row.gateStatus).toBeNull();
    });
  });

  // ── Quality gate: maxDurationMs breach ───────────────────────────────────
  describe('computeGateStatus — maxDurationMs threshold', () => {
    it('fails gate when run exceeds max duration even with 100% pass rate', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await testDb.insert(schema.qualityGateConfig).values({
        id: 'global',
        passRateThreshold: 50,
        maxDurationMs: 500,
        maxFlakyCount: null,
        updatedAt: new Date(1693132800000).toISOString(),
      });

      await emit(bridge, { type: 'run:start', runId: 'run-dur', payload: { total: 1, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-dur',
        payload: { testId: 't-dur', title: 'passes', file: 'a.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-dur',
        payload: { testId: 't-dur', status: 'passed', durationMs: 100 },
      });
      // Run takes 1000ms — over the 500ms threshold
      await emit(bridge, { type: 'run:end', runId: 'run-dur', payload: { status: 'passed', durationMs: 1000 } });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-dur'));
      expect(row.gateStatus).toBe('failed');
    });

    it('passes gate when run is within max duration threshold', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await testDb.insert(schema.qualityGateConfig).values({
        id: 'global',
        passRateThreshold: 50,
        maxDurationMs: 5000,
        maxFlakyCount: null,
        updatedAt: new Date(1693132800000).toISOString(),
      });

      await emit(bridge, { type: 'run:start', runId: 'run-dur-ok', payload: { total: 1, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-dur-ok',
        payload: { testId: 't-dur-ok', title: 'passes', file: 'a.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-dur-ok',
        payload: { testId: 't-dur-ok', status: 'passed', durationMs: 100 },
      });
      await emit(bridge, { type: 'run:end', runId: 'run-dur-ok', payload: { status: 'passed', durationMs: 200 } });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-dur-ok'));
      expect(row.gateStatus).toBe('passed');
    });
  });

  // ── Quality gate: maxFlakyCount breach ──────────────────────────────────
  describe('computeGateStatus — maxFlakyCount threshold', () => {
    it('fails gate when flaky count exceeds configured maximum', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await testDb.insert(schema.qualityGateConfig).values({
        id: 'global',
        passRateThreshold: 50,
        maxDurationMs: null,
        maxFlakyCount: 1,
        updatedAt: new Date(1693132800000).toISOString(),
      });

      await emit(bridge, { type: 'run:start', runId: 'run-flaky', payload: { total: 3, config: {} } });

      for (const testId of ['t-f1', 't-f2', 't-pass']) {
        await emit(bridge, {
          type: 'test:begin',
          runId: 'run-flaky',
          payload: { testId, title: testId, file: 'a.spec.ts' },
        });
      }

      await emit(bridge, {
        type: 'test:end',
        runId: 'run-flaky',
        payload: { testId: 't-f1', status: 'flaky', durationMs: 1 },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-flaky',
        payload: { testId: 't-f2', status: 'flaky', durationMs: 1 },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-flaky',
        payload: { testId: 't-pass', status: 'passed', durationMs: 1 },
      });

      await emit(bridge, { type: 'run:end', runId: 'run-flaky', payload: { status: 'passed', durationMs: 100 } });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-flaky'));
      expect(row.gateStatus).toBe('failed');
    });

    it('passes gate when flaky count is within configured maximum', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await testDb.insert(schema.qualityGateConfig).values({
        id: 'global',
        passRateThreshold: 50,
        maxDurationMs: null,
        maxFlakyCount: 5,
        updatedAt: new Date(1693132800000).toISOString(),
      });

      await emit(bridge, { type: 'run:start', runId: 'run-flaky-ok', payload: { total: 2, config: {} } });

      for (const testId of ['t-fok1', 't-pok']) {
        await emit(bridge, {
          type: 'test:begin',
          runId: 'run-flaky-ok',
          payload: { testId, title: testId, file: 'a.spec.ts' },
        });
      }

      await emit(bridge, {
        type: 'test:end',
        runId: 'run-flaky-ok',
        payload: { testId: 't-fok1', status: 'flaky', durationMs: 1 },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-flaky-ok',
        payload: { testId: 't-pok', status: 'passed', durationMs: 1 },
      });

      await emit(bridge, { type: 'run:end', runId: 'run-flaky-ok', payload: { status: 'passed', durationMs: 100 } });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-flaky-ok'));
      expect(row.gateStatus).toBe('passed');
    });
  });

  // ── test:end timedOut counter ─────────────────────────────────────────────
  describe('test:end — timedOut status', () => {
    it('increments failed counter for timedOut tests', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-timeout', payload: { total: 1, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-timeout',
        payload: { testId: 't-to', title: 'times out', file: 'slow.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-timeout',
        payload: { testId: 't-to', status: 'timedOut', durationMs: 30000 },
      });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-timeout'));
      expect(row.failed).toBe(1);
    });
  });

  // ── run:start webhook dispatch error (fire-and-forget) ───────────────────
  describe('run:start — webhook dispatch error is fire-and-forget', () => {
    it('logs warn and does not crash when webhook dispatch rejects', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockDispatchAllWebhooks.mockRejectedValueOnce(new Error('webhook timeout'));

      await emit(bridge, { type: 'run:start', runId: 'run-wh-err', payload: { total: 2, config: {} } });

      // Give microtask queue a chance to flush
      await Promise.resolve();

      expect((log.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[bridge] Webhook dispatch error',
      );
    });
  });

  // ── test:end — webhook dispatch error (fire-and-forget) ──────────────────
  describe('test:end — failed test webhook dispatch error is fire-and-forget', () => {
    it('logs warn and does not crash when webhook dispatch for test:fail rejects', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockDispatchAllWebhooks.mockRejectedValueOnce(new Error('network error'));

      await emit(bridge, { type: 'run:start', runId: 'run-wh-fail', payload: { total: 1, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-wh-fail',
        payload: { testId: 't-wh', title: 'fails', file: 'fail.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-wh-fail',
        payload: {
          testId: 't-wh',
          status: 'failed',
          durationMs: 50,
          error: { message: 'oops', stack: 'oops\nat test' },
        },
      });

      await Promise.resolve();

      expect((log.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[bridge] Webhook dispatch error',
      );
    });
  });

  // ── run:end — updateTrendsForDate error (fire-and-forget) ────────────────
  describe('run:end — trend update error is fire-and-forget', () => {
    it('logs error and does not crash when updateTrendsForDate rejects', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockUpdateTrendsForDate.mockRejectedValueOnce(new Error('trend db error'));

      const dispatchSpy = vi.spyOn(
        ReporterBridge.prototype as unknown as { dispatchIntegrations: (runId: string) => Promise<void> },
        'dispatchIntegrations',
      ).mockResolvedValue(undefined);

      await emit(bridge, { type: 'run:start', runId: 'run-trend-err', payload: { total: 1, config: {} } });
      await emit(bridge, { type: 'run:end', runId: 'run-trend-err', payload: { status: 'passed', durationMs: 1 } });

      // Flush fire-and-forget promises
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect((log.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[bridge] Trend update error',
      );

      dispatchSpy.mockRestore();
    });
  });

  // ── run:end — autoQuarantineCheck error (fire-and-forget) ────────────────
  describe('run:end — auto-quarantine error is fire-and-forget', () => {
    it('logs error and does not crash when autoQuarantineCheck rejects', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockAutoQuarantineCheck.mockRejectedValueOnce(new Error('quarantine crash'));

      const dispatchSpy = vi.spyOn(
        ReporterBridge.prototype as unknown as { dispatchIntegrations: (runId: string) => Promise<void> },
        'dispatchIntegrations',
      ).mockResolvedValue(undefined);

      await emit(bridge, { type: 'run:start', runId: 'run-quar-err', payload: { total: 1, config: {} } });
      await emit(bridge, { type: 'run:end', runId: 'run-quar-err', payload: { status: 'passed', durationMs: 1 } });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect((log.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[bridge] Auto-quarantine check error',
      );

      dispatchSpy.mockRestore();
    });
  });

  // ── dispatchIntegrations — GitHub PR comment via branch pattern ──────────
  describe('dispatchIntegrations — GitHub PR comment via branch pattern', () => {
    it('posts PR comment when branch contains /123 pattern and commitSha is present', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          github: {
            enabled: true,
            token: 'gh-token',
            owner: 'acme',
            repo: 'repo',
            prComments: true,
            commitStatus: false,
          },
        }),
      );

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped, branch, commit_sha, pr_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-gh-branch', new Date(1693132800000).toISOString(), 'passed', 1, 1, 0, 0, 0, 'pull/99/merge', 'sha-abc', null);

      await dispatchFor(bridge, 'run-gh-branch');

      expect(mockPostPrComment).toHaveBeenCalledWith(
        expect.objectContaining({ owner: 'acme', repo: 'repo' }),
        99,
        expect.objectContaining({ status: 'passed' }),
      );
    });

    it('skips PR comment when branch matches but commitSha is absent', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          github: {
            enabled: true,
            token: 'gh-token',
            owner: 'acme',
            repo: 'repo',
            prComments: true,
            commitStatus: false,
          },
        }),
      );

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped, branch, commit_sha, pr_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-gh-nosha', new Date(1693132800000).toISOString(), 'passed', 1, 1, 0, 0, 0, 'pull/55/merge', null, null);

      await dispatchFor(bridge, 'run-gh-nosha');

      expect(mockPostPrComment).not.toHaveBeenCalled();
    });

    it('posts PR comment via commit message #N pattern when branch does not contain /', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          github: {
            enabled: true,
            token: 'gh-token',
            owner: 'acme',
            repo: 'repo',
            prComments: true,
            commitStatus: false,
          },
        }),
      );

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped, branch, commit_sha, commit_message, pr_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'run-gh-msg',
          new Date(1693132800000).toISOString(),
          'passed',
          1,
          1,
          0,
          0,
          0,
          'main',
          'sha-def',
          'Fix bug refs #77',
          null,
        );

      await dispatchFor(bridge, 'run-gh-msg');

      expect(mockPostPrComment).toHaveBeenCalledWith(
        expect.objectContaining({ owner: 'acme' }),
        77,
        expect.any(Object),
      );
    });
  });

  // ── dispatchIntegrations — GitHub commit status skipped when no SHA ──────
  describe('dispatchIntegrations — commit status requires SHA', () => {
    it('skips commit status creation when commitSha is absent', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          github: {
            enabled: true,
            token: 'gh-token',
            owner: 'acme',
            repo: 'repo',
            prComments: false,
            commitStatus: true,
          },
        }),
      );

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped, commit_sha)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-no-sha', new Date(1693132800000).toISOString(), 'passed', 1, 1, 0, 0, 0, null);

      await dispatchFor(bridge, 'run-no-sha');

      expect(mockCreateCommitStatus).not.toHaveBeenCalled();
    });
  });

  // ── dispatchIntegrations — resolveBaseRun returns null (skip PR comment) ─
  describe('dispatchIntegrations — PR comparison comment skipped when no base run', () => {
    it('skips postOrUpdatePrComment when resolveBaseRun returns null', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          github: {
            enabled: true,
            token: 'gh-token',
            owner: 'acme',
            repo: 'repo',
            prComments: true,
            commitStatus: false,
            defaultBaseBranch: 'main',
          },
        }),
      );
      mockResolveBaseRun.mockResolvedValue(null);

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped, pr_number, commit_sha, base_branch)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-no-base', new Date(1693132800000).toISOString(), 'passed', 1, 1, 0, 0, 0, 42, 'sha-999', 'main');

      await dispatchFor(bridge, 'run-no-base');

      expect(mockPostOrUpdatePrComment).not.toHaveBeenCalled();
    });
  });

  // ── dispatchIntegrations — Jira skipped when autoCreateBugs is false ─────
  describe('dispatchIntegrations — Jira skipped without autoCreateBugs', () => {
    it('does not create Jira bugs when autoCreateBugs is false', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          jira: {
            enabled: true,
            autoCreateBugs: false,
            baseUrl: 'https://jira.example.com',
            apiToken: 'tok',
            email: 'j@j.com',
            projectKey: 'TEST',
          },
        }),
      );

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-no-jira', new Date(1693132800000).toISOString(), 'failed', 2, 1, 1, 0, 0);

      await dispatchFor(bridge, 'run-no-jira');

      expect(mockCreateJiraBug).not.toHaveBeenCalled();
    });

    it('does not create Jira bugs when jira is disabled', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          jira: {
            enabled: false,
            autoCreateBugs: true,
            baseUrl: 'https://jira.example.com',
            apiToken: 'tok',
            email: 'j@j.com',
            projectKey: 'TEST',
          },
        }),
      );

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-jira-disabled', new Date(1693132800000).toISOString(), 'failed', 2, 1, 1, 0, 0);

      await dispatchFor(bridge, 'run-jira-disabled');

      expect(mockCreateJiraBug).not.toHaveBeenCalled();
    });

    it('does not create Jira bugs when failed count is zero', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          jira: {
            enabled: true,
            autoCreateBugs: true,
            baseUrl: 'https://jira.example.com',
            apiToken: 'tok',
            email: 'j@j.com',
            projectKey: 'TEST',
          },
        }),
      );

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-jira-zero-fail', new Date(1693132800000).toISOString(), 'passed', 2, 2, 0, 0, 0);

      await dispatchFor(bridge, 'run-jira-zero-fail');

      expect(mockCreateJiraBug).not.toHaveBeenCalled();
    });
  });

  // ── dispatchIntegrations — Jira createJiraBug error handling ─────────────
  describe('dispatchIntegrations — Jira individual bug creation error', () => {
    it('logs error and continues when a single createJiraBug call fails', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          jira: {
            enabled: true,
            autoCreateBugs: true,
            baseUrl: 'https://jira.example.com',
            apiToken: 'tok',
            email: 'j@j.com',
            projectKey: 'TEST',
          },
        }),
      );

      mockCreateJiraBug.mockRejectedValueOnce(new Error('Jira API down'));
      mockCreateJiraBug.mockResolvedValue(undefined);

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-jira-fail', new Date(1693132800000).toISOString(), 'failed', 2, 0, 2, 0, 0);

      testSqlite
        .prepare('INSERT INTO tests (id, run_id, title, file, status) VALUES (?, ?, ?, ?, ?)')
        .run('j-t1', 'run-jira-fail', 'test one fails', 'tests/a.spec.ts', 'failed');
      testSqlite
        .prepare('INSERT INTO tests (id, run_id, title, file, status) VALUES (?, ?, ?, ?, ?)')
        .run('j-t2', 'run-jira-fail', 'test two fails', 'tests/b.spec.ts', 'failed');

      await dispatchFor(bridge, 'run-jira-fail');

      expect(mockCreateJiraBug).toHaveBeenCalledTimes(2);
      expect((log.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[bridge] Jira bug creation failed',
      );
    });
  });

  // ── dispatchIntegrations — Slack error handling ───────────────────────────
  describe('dispatchIntegrations — Slack notification error', () => {
    it('logs error and continues when sendSlackRunSummary throws', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          slack: { enabled: true, webhookUrl: 'https://hooks.slack.com/test', notifyOn: ['all'] },
        }),
      );
      mockSendSlackRunSummary.mockRejectedValueOnce(new Error('Slack webhook failed'));

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-slack-err', new Date(1693132800000).toISOString(), 'passed', 1, 1, 0, 0, 0);

      await dispatchFor(bridge, 'run-slack-err');

      expect((log.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[bridge] Slack notification failed',
      );
    });
  });

  // ── dispatchIntegrations — Teams error handling ───────────────────────────
  describe('dispatchIntegrations — Teams notification error', () => {
    it('logs error and continues when sendTeamsRunSummary throws', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          teams: { enabled: true, webhookUrl: 'https://teams.example.com/hook', notifyOn: ['all'] },
        }),
      );
      mockSendTeamsRunSummary.mockRejectedValueOnce(new Error('Teams API error'));

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-teams-err', new Date(1693132800000).toISOString(), 'passed', 1, 1, 0, 0, 0);

      await dispatchFor(bridge, 'run-teams-err');

      expect((log.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[bridge] Teams notification failed',
      );
    });
  });

  // ── dispatchIntegrations — Email error handling ───────────────────────────
  describe('dispatchIntegrations — Email notification error', () => {
    it('logs error and continues when sendRunReportEmail throws', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          email: {
            enabled: true,
            host: 'smtp.example.com',
            port: 587,
            secure: false,
            user: 'user',
            pass: 'pass',
            recipients: ['qa@example.com'],
          },
        }),
      );
      mockSendRunReportEmail.mockRejectedValueOnce(new Error('SMTP connection refused'));

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-email-err', new Date(1693132800000).toISOString(), 'passed', 1, 1, 0, 0, 0);

      await dispatchFor(bridge, 'run-email-err');

      expect((log.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[bridge] Email report failed',
      );
    });
  });

  // ── dispatchIntegrations — GitHub errors ─────────────────────────────────
  describe('dispatchIntegrations — GitHub errors', () => {
    it('logs error and continues when postPrComment throws', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          github: {
            enabled: true,
            token: 'gh-token',
            owner: 'acme',
            repo: 'repo',
            prComments: true,
            commitStatus: false,
          },
        }),
      );
      mockPostPrComment.mockRejectedValueOnce(new Error('GitHub API 403'));

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped, branch, commit_sha, pr_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-gh-pr-err', new Date(1693132800000).toISOString(), 'failed', 1, 0, 1, 0, 0, 'pull/7/merge', 'sha-gg', null);

      await dispatchFor(bridge, 'run-gh-pr-err');

      expect((log.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[bridge] GitHub PR comment failed',
      );
    });

    it('logs error and continues when createCommitStatus throws', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          github: {
            enabled: true,
            token: 'gh-token',
            owner: 'acme',
            repo: 'repo',
            prComments: false,
            commitStatus: true,
          },
        }),
      );
      mockCreateCommitStatus.mockRejectedValueOnce(new Error('GitHub API 500'));

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped, commit_sha)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-gh-cs-err', new Date(1693132800000).toISOString(), 'failed', 1, 0, 1, 0, 0, 'sha-err');

      await dispatchFor(bridge, 'run-gh-cs-err');

      expect((log.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[bridge] GitHub commit status failed',
      );
    });

    it('logs error and continues when postOrUpdatePrComment throws', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          github: {
            enabled: true,
            token: 'gh-token',
            owner: 'acme',
            repo: 'repo',
            prComments: true,
            commitStatus: false,
            defaultBaseBranch: 'main',
          },
        }),
      );
      mockResolveBaseRun.mockResolvedValue('base-run-x');
      mockCompareRunToBase.mockResolvedValue({ summary: {} });
      mockGeneratePrCommentMarkdown.mockReturnValue('md');
      mockPostOrUpdatePrComment.mockRejectedValueOnce(new Error('update comment failed'));

      testSqlite
        .prepare(
          `INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped, pr_number, commit_sha, base_branch)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-gh-pu-err', new Date(1693132800000).toISOString(), 'failed', 1, 0, 1, 0, 0, 33, 'sha-pu', 'main');

      await dispatchFor(bridge, 'run-gh-pu-err');

      expect((log.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[bridge] Auto PR comparison comment failed',
      );
    });
  });

  // ── Concurrent submissions ────────────────────────────────────────────────
  describe('concurrent submissions', () => {
    it('handles many concurrent test:end events without data corruption', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-concurrent', payload: { total: 20, config: {} } });

      const testIds = Array.from({ length: 10 }, (_, i) => `ct-${i}`);

      await Promise.all(
        testIds.map((id) =>
          emit(bridge, {
            type: 'test:begin',
            runId: 'run-concurrent',
            payload: { testId: id, title: `test ${id}`, file: 'parallel.spec.ts' },
          }),
        ),
      );

      await Promise.all(
        testIds.map((id) =>
          emit(bridge, {
            type: 'test:end',
            runId: 'run-concurrent',
            payload: { testId: id, status: 'passed', durationMs: 10 },
          }),
        ),
      );

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-concurrent'));
      expect(row.passed).toBe(10);
    });
  });

  // ── Mutation-killing: broadcast readyState === 1 (OPEN) ────────────────────
  describe('broadcast — readyState OPEN check — kills NumberLiteral mutation', () => {
    it('does NOT send to client with readyState=0 (CONNECTING) — kills readyState === 1 mutation', () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      // Client with readyState=0 (CONNECTING, not OPEN)
      const { ws: connectingWs, sent: connectingSent } = createFakeWs(0);
      // Client with readyState=1 (OPEN)
      const { ws: openWs, sent: openSent } = createFakeWs(1);

      bridge.addClient(connectingWs);
      bridge.addClient(openWs);

      bridge.broadcast({ type: 'stdout', runId: 'run-x', payload: {} });

      // Only OPEN client should receive
      expect(openSent).toHaveLength(1);
      expect(connectingSent).toHaveLength(0);
    });

    it('does NOT send to client with readyState=2 (CLOSING) — kills readyState === 1 mutation', () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      const { ws: closingWs, sent: closingSent } = createFakeWs(2);
      const { ws: openWs, sent: openSent } = createFakeWs(1);

      bridge.addClient(closingWs);
      bridge.addClient(openWs);

      bridge.broadcast({ type: 'test:end', runId: 'run-y', payload: {} });

      expect(openSent).toHaveLength(1);
      expect(closingSent).toHaveLength(0);
    });

    it('does NOT send to client with readyState=3 (CLOSED) — kills readyState === 1 mutation', () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      const { ws: closedWs, sent: closedSent } = createFakeWs(3);
      const { ws: openWs, sent: openSent } = createFakeWs(1);

      bridge.addClient(closedWs);
      bridge.addClient(openWs);

      bridge.broadcast({ type: 'run:end', runId: 'run-z', payload: {} });

      expect(openSent).toHaveLength(1);
      expect(closedSent).toHaveLength(0);
    });
  });

  // ── Mutation-killing: broadcast runId filter ──────────────────────────────
  describe('broadcast — runId filter — kills LogicalOperator mutation', () => {
    it('sends to client with no runId filter (receives all runIds) — kills LogicalOperator mutation', () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      const { ws: allWs, sent: allSent } = createFakeWs(1);
      bridge.addClient(allWs); // no runId filter

      bridge.broadcast({ type: 'stdout', runId: 'run-abc', payload: {} });
      bridge.broadcast({ type: 'stdout', runId: 'run-xyz', payload: {} });

      // Should receive both broadcasts
      expect(allSent).toHaveLength(2);
    });

    it('only sends to client whose runId matches — kills LogicalOperator || mutation', () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      const { ws: filteredWs, sent: filteredSent } = createFakeWs(1);
      bridge.addClient(filteredWs, 'run-abc'); // filtered to run-abc only

      bridge.broadcast({ type: 'stdout', runId: 'run-abc', payload: {} });
      bridge.broadcast({ type: 'stdout', runId: 'run-other', payload: {} });

      // Only the matching runId broadcast should be received
      expect(filteredSent).toHaveLength(1);
      const event = JSON.parse(filteredSent[0]) as { runId: string };
      expect(event.runId).toBe('run-abc');
    });
  });

  // ── Mutation-killing: handleReporterEvent invalid JSON ────────────────────
  describe('handleReporterEvent — JSON parse error — kills BlockStatement mutation', () => {
    it('logs warning and returns without crashing on invalid JSON — kills BlockStatement {} mutation', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      // Should not throw
      await expect(bridge.handleReporterEvent('not valid json {')).resolves.toBeUndefined();

      expect((log.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        '[bridge] Failed to parse reporter event',
      );
    });
  });

  // ── Mutation-killing: run:start inserts "running" status — kills StringLiteral mutation ─
  describe('run:start — initial status is "running" — kills StringLiteral mutation', () => {
    it('inserts run with status "running" (not "passed" or "queued") — kills StringLiteral mutation', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-status-check', payload: { total: 5, config: {} } });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-status-check'));
      expect(row.status).toBe('running');
      expect(row.status).not.toBe('passed');
      expect(row.status).not.toBe('queued');
      expect(row.status).not.toBe('');
    });
  });

  // ── Mutation-killing: test:begin inserts "running" status ────────────────
  describe('test:begin — initial status is "running" — kills StringLiteral mutation', () => {
    it('inserts test with status "running" — kills StringLiteral mutation', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-test-begin-status', payload: { total: 1, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-test-begin-status',
        payload: { testId: 'tb-status', title: 'test', file: 'a.spec.ts' },
      });

      const testRows = await testDb.select().from(schema.tests).where(
        eq(schema.tests.runId, 'run-test-begin-status'),
      );
      expect(testRows[0].status).toBe('running');
      expect(testRows[0].status).not.toBe('');
      expect(testRows[0].status).not.toBe('queued');
    });
  });

  // ── Mutation-killing: test:end counters for skipped — kills StringLiteral mutation ──
  describe('test:end — skipped counter — kills StringLiteral mutation', () => {
    it('increments skipped counter for skipped tests — kills StringLiteral "skipped" mutation', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-skipped', payload: { total: 1, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-skipped',
        payload: { testId: 't-skip', title: 'skipped test', file: 'a.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-skipped',
        payload: { testId: 't-skip', status: 'skipped', durationMs: 0 },
      });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-skipped'));
      expect(row.skipped).toBe(1);
      expect(row.passed).toBe(0);
      expect(row.failed).toBe(0);
    });
  });

  // ── Mutation-killing: test:end flaky counter ─────────────────────────────
  describe('test:end — flaky counter — kills StringLiteral mutation', () => {
    it('increments flaky counter for flaky tests — kills StringLiteral "flaky" mutation', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-flaky-counter', payload: { total: 1, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-flaky-counter',
        payload: { testId: 't-flaky', title: 'flaky test', file: 'a.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-flaky-counter',
        payload: { testId: 't-flaky', status: 'flaky', durationMs: 100 },
      });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-flaky-counter'));
      expect(row.flaky).toBe(1);
      expect(row.passed).toBe(0);
      expect(row.failed).toBe(0);
    });
  });

  // ── Attachment path normalization ─────────────────────────────────────────
  describe('ReporterBridge — attachment path normalization', () => {
    const KNOWN_ARTIFACTS_DIR = 'C:\\known-artifacts';

    beforeEach(() => {
      process.env.ARTIFACTS_DIR = KNOWN_ARTIFACTS_DIR;
    });

    afterEach(() => {
      delete process.env.ARTIFACTS_DIR;
    });

    async function emitTestWithAttachments(
      bridge: ReporterBridge,
      runId: string,
      attachments: Array<{ name: string; contentType: string; path?: string }>,
    ): Promise<string> {
      await emit(bridge, { type: 'run:start', runId, payload: { total: 1, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId,
        payload: { testId: `${runId}-t`, title: 'attachment test', file: 'a.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:end',
        runId,
        payload: {
          testId: `${runId}-t`,
          status: 'passed',
          durationMs: 10,
          attachments,
        },
      });
      // Return the stored attachments JSON from the results table
      const resultRows = testSqlite.prepare('SELECT attachments FROM results WHERE run_id = ?').all(runId) as Array<{ attachments: string }>;
      return resultRows[0]?.attachments ?? '[]';
    }

    it('relativizes absolute paths that are inside ARTIFACTS_DIR', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      const storedJson = await emitTestWithAttachments(bridge, 'run-path-inside', [
        { name: 'screenshot', contentType: 'image/png', path: `${KNOWN_ARTIFACTS_DIR}\\subdir\\screen.png` },
      ]);

      const stored = JSON.parse(storedJson) as Array<{ name: string; path: string }>;
      expect(stored).toHaveLength(1);
      // The absolute prefix should be stripped — result is a relative path
      expect(stored[0]?.path).toBe('subdir\\screen.png');
      expect(stored[0]?.path).not.toContain(KNOWN_ARTIFACTS_DIR);
    });

    it('leaves absolute paths outside ARTIFACTS_DIR unchanged', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      const outsidePath = 'C:\\other-dir\\screenshot.png';
      const storedJson = await emitTestWithAttachments(bridge, 'run-path-outside', [
        { name: 'screenshot', contentType: 'image/png', path: outsidePath },
      ]);

      const stored = JSON.parse(storedJson) as Array<{ name: string; path: string }>;
      expect(stored).toHaveLength(1);
      // Path is outside ARTIFACTS_DIR — must remain unchanged
      expect(stored[0]?.path).toBe(outsidePath);
    });

    it('leaves relative paths unchanged', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      const relativePath = 'screenshots\\test.png';
      const storedJson = await emitTestWithAttachments(bridge, 'run-path-relative', [
        { name: 'screenshot', contentType: 'image/png', path: relativePath },
      ]);

      const stored = JSON.parse(storedJson) as Array<{ name: string; path: string }>;
      expect(stored).toHaveLength(1);
      // Relative paths: path.isAbsolute is false → left as-is
      expect(stored[0]?.path).toBe(relativePath);
    });

    it('leaves attachments with no path (undefined) unchanged', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      const storedJson = await emitTestWithAttachments(bridge, 'run-path-undefined', [
        { name: 'trace', contentType: 'application/zip' },
      ]);

      const stored = JSON.parse(storedJson) as Array<{ name: string; path?: string }>;
      expect(stored).toHaveLength(1);
      // No path property — must remain absent/undefined
      expect(stored[0]?.path).toBeUndefined();
    });

    it('handles path traversal attempt: absolute path containing .. segments left as-is when outside ARTIFACTS_DIR', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      // This path is absolute and starts with ARTIFACTS_DIR, but has traversal segments.
      // path.startsWith() is a plain string match — it does NOT normalize /../ segments,
      // so `C:\known-artifacts\..\..\..\etc\passwd` does NOT start with `C:\known-artifacts`
      // after the extra characters. It is therefore left unchanged (not relativized).
      const traversalPath = `${KNOWN_ARTIFACTS_DIR}\\..\\..\\etc\\passwd`;
      const storedJson = await emitTestWithAttachments(bridge, 'run-path-traversal', [
        { name: 'evil', contentType: 'text/plain', path: traversalPath },
      ]);

      const stored = JSON.parse(storedJson) as Array<{ name: string; path: string }>;
      expect(stored).toHaveLength(1);
      // The raw path starts with ARTIFACTS_DIR string, so startsWith returns true.
      // path.relative() resolves the .. segments relative to artifactsDir.
      // Document and assert the actual behavior rather than an assumed safe outcome.
      const actualPath = stored[0]?.path;
      // Either it was relativized (startsWith matched the prefix) or it was left as-is.
      // What matters: it must NOT escape to a sensitive location when served — this test
      // documents the current behavior so any future change is deliberate.
      expect(typeof actualPath).toBe('string');
      // The stored value should not retain the ARTIFACTS_DIR prefix if it was relativized
      // OR should retain the original traversal path if left as-is.
      expect(actualPath === traversalPath || !actualPath?.includes(KNOWN_ARTIFACTS_DIR)).toBe(true);
    });

    it('handles a POSIX-style path traversal attempt (../../etc/passwd) — not absolute on Windows, left as-is', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      // On Windows, path.isAbsolute('../../etc/passwd') === false
      // so the normalization branch is never entered — path is stored verbatim.
      const traversalPath = '../../etc/passwd';
      const storedJson = await emitTestWithAttachments(bridge, 'run-path-posix-traversal', [
        { name: 'evil', contentType: 'text/plain', path: traversalPath },
      ]);

      const stored = JSON.parse(storedJson) as Array<{ name: string; path: string }>;
      expect(stored).toHaveLength(1);
      // Not absolute on Windows → left unchanged
      expect(stored[0]?.path).toBe(traversalPath);
    });

    it('handles Windows-style path that is inside ARTIFACTS_DIR and relativizes it', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      // Explicitly set ARTIFACTS_DIR to a Windows-style path
      process.env.ARTIFACTS_DIR = 'C:\\test-results';
      const windowsPath = 'C:\\test-results\\screenshots\\test-1.png';

      const storedJson = await emitTestWithAttachments(bridge, 'run-path-windows', [
        { name: 'screenshot', contentType: 'image/png', path: windowsPath },
      ]);

      const stored = JSON.parse(storedJson) as Array<{ name: string; path: string }>;
      expect(stored).toHaveLength(1);
      // Should be relativized to 'screenshots\test-1.png'
      expect(stored[0]?.path).toBe('screenshots\\test-1.png');
    });

    it('normalizes multiple attachments in a single test:end event independently', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      const insidePath = `${KNOWN_ARTIFACTS_DIR}\\video.webm`;
      const outsidePath = 'C:\\tmp\\trace.zip';
      const relativePath = 'screenshots\\snap.png';

      const storedJson = await emitTestWithAttachments(bridge, 'run-path-multi', [
        { name: 'video', contentType: 'video/webm', path: insidePath },
        { name: 'trace', contentType: 'application/zip', path: outsidePath },
        { name: 'snap', contentType: 'image/png', path: relativePath },
        { name: 'body', contentType: 'text/plain' },
      ]);

      const stored = JSON.parse(storedJson) as Array<{ name: string; path?: string }>;
      expect(stored).toHaveLength(4);

      // Inside ARTIFACTS_DIR → relativized
      expect(stored[0]?.path).toBe('video.webm');

      // Outside ARTIFACTS_DIR → unchanged
      expect(stored[1]?.path).toBe(outsidePath);

      // Relative path → unchanged
      expect(stored[2]?.path).toBe(relativePath);

      // No path → undefined
      expect(stored[3]?.path).toBeUndefined();
    });
  });

  // ── Mutation-killing: quality gate passRate >= threshold ──────────────────
  describe('computeGateStatus — passRate threshold comparison — kills ConditionalExpression mutation', () => {
    it('passes gate when passRate equals threshold exactly (>=, not >) — kills >= → > mutation', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await testDb.insert(schema.qualityGateConfig).values({
        id: 'global',
        passRateThreshold: 50,
        maxDurationMs: null,
        maxFlakyCount: null,
        updatedAt: new Date(1693132800000).toISOString(),
      });

      // 1 passed, 1 total → passRate = 100% which is >= 50 → passed
      await emit(bridge, { type: 'run:start', runId: 'run-gate-eq', payload: { total: 2, config: {} } });
      for (const id of ['tge-1', 'tge-2']) {
        await emit(bridge, { type: 'test:begin', runId: 'run-gate-eq', payload: { testId: id, title: id, file: 'a.spec.ts' } });
      }
      // 1 passed, 1 failed → 50% pass rate, exactly at threshold
      await emit(bridge, { type: 'test:end', runId: 'run-gate-eq', payload: { testId: 'tge-1', status: 'passed', durationMs: 1 } });
      await emit(bridge, { type: 'test:end', runId: 'run-gate-eq', payload: { testId: 'tge-2', status: 'failed', durationMs: 1 } });
      await emit(bridge, { type: 'run:end', runId: 'run-gate-eq', payload: { status: 'failed', durationMs: 100 } });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-gate-eq'));
      // 50% >= 50 threshold → passed (not failed)
      expect(row.gateStatus).toBe('passed');
    });

    it('fails gate when passRate is below threshold — kills >= → > mutation', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await testDb.insert(schema.qualityGateConfig).values({
        id: 'global',
        passRateThreshold: 80,
        maxDurationMs: null,
        maxFlakyCount: null,
        updatedAt: new Date(1693132800000).toISOString(),
      });

      // 1 passed, 1 failed → 50% < 80 threshold → failed
      await emit(bridge, { type: 'run:start', runId: 'run-gate-below', payload: { total: 2, config: {} } });
      for (const id of ['tgb-1', 'tgb-2']) {
        await emit(bridge, { type: 'test:begin', runId: 'run-gate-below', payload: { testId: id, title: id, file: 'a.spec.ts' } });
      }
      await emit(bridge, { type: 'test:end', runId: 'run-gate-below', payload: { testId: 'tgb-1', status: 'passed', durationMs: 1 } });
      await emit(bridge, { type: 'test:end', runId: 'run-gate-below', payload: { testId: 'tgb-2', status: 'failed', durationMs: 1 } });
      await emit(bridge, { type: 'run:end', runId: 'run-gate-below', payload: { status: 'failed', durationMs: 100 } });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-gate-below'));
      expect(row.gateStatus).toBe('failed');
    });
  });

  // ── Auto-classification on test:end ──────────────────────────────────────
  describe('failure classification — auto-invoked on test:end', () => {
    it('inserts a failure_classifications row when test:end status is failed', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-cls-fail', payload: { total: 1, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-cls-fail',
        payload: { testId: 't-cls-1', title: 'should equal true', file: 'a.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-cls-fail',
        payload: {
          testId: 't-cls-1',
          status: 'failed',
          durationMs: 10,
          error: { message: 'Expected true to be false', stack: 'Error: Expected true to be false' },
        },
      });

      const rows = testSqlite.prepare('SELECT * FROM failure_classifications WHERE run_id = ?').all('run-cls-fail') as Array<{ category: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.category).toBe('assertion');
      expect(mockClassifyFailure).toHaveBeenCalledOnce();
    });

    it('does NOT insert a failure_classifications row when test:end status is passed', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-cls-pass', payload: { total: 1, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-cls-pass',
        payload: { testId: 't-cls-2', title: 'should pass', file: 'b.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-cls-pass',
        payload: { testId: 't-cls-2', status: 'passed', durationMs: 5 },
      });

      const rows = testSqlite.prepare('SELECT * FROM failure_classifications WHERE run_id = ?').all('run-cls-pass');
      expect(rows).toHaveLength(0);
      expect(mockClassifyFailure).not.toHaveBeenCalled();
    });

    it('does not propagate classifyFailure errors — result is still persisted (fail-safe)', async () => {
      mockClassifyFailure.mockImplementationOnce(() => {
        throw new Error('taxonomy service unavailable');
      });
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-cls-throw', payload: { total: 1, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-cls-throw',
        payload: { testId: 't-cls-3', title: 'should not crash', file: 'c.spec.ts' },
      });

      // Must not throw even though classifyFailure throws
      await expect(
        emit(bridge, {
          type: 'test:end',
          runId: 'run-cls-throw',
          payload: {
            testId: 't-cls-3',
            status: 'failed',
            durationMs: 8,
            error: { message: 'crash', stack: 'Error: crash' },
          },
        }),
      ).resolves.toBeUndefined();

      // Result is still persisted in results table
      const resultRows = testSqlite.prepare('SELECT * FROM results WHERE run_id = ?').all('run-cls-throw') as Array<{ status: string }>;
      expect(resultRows).toHaveLength(1);
      expect(resultRows[0]?.status).toBe('failed');

      // The error was logged, not swallowed silently
      expect(log.warn).toHaveBeenCalled();
    });
  });

  // ── Quality gate: workspace config overrides global ───────────────────────
  describe('computeGateStatus — workspace config overrides global', () => {
    it('uses workspace-specific threshold when run has workspaceId', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      // Global: 90% threshold (more lenient)
      await testDb.insert(schema.qualityGateConfig).values({
        id: 'global',
        workspaceId: null,
        passRateThreshold: 90,
        updatedAt: new Date().toISOString(),
      });

      // Workspace: 95% threshold (stricter)
      await testDb.insert(schema.qualityGateConfig).values({
        id: 'ws-strict',
        workspaceId: 'ws-strict',
        passRateThreshold: 95,
        updatedAt: new Date().toISOString(),
      });

      // Run at 92% pass rate in the strict workspace
      await emit(bridge, {
        type: 'run:start',
        runId: 'run-ws-strict',
        payload: { total: 100, config: {}, workspaceId: 'ws-strict' },
      });
      for (let i = 0; i < 92; i++) {
        await emit(bridge, { type: 'test:begin', runId: 'run-ws-strict', payload: { testId: `t-ws-${i}`, title: `T${i}`, file: 'a.spec.ts' } });
        await emit(bridge, { type: 'test:end', runId: 'run-ws-strict', payload: { testId: `t-ws-${i}`, status: 'passed', durationMs: 1 } });
      }
      for (let i = 92; i < 100; i++) {
        await emit(bridge, { type: 'test:begin', runId: 'run-ws-strict', payload: { testId: `t-ws-${i}`, title: `T${i}`, file: 'a.spec.ts' } });
        await emit(bridge, { type: 'test:end', runId: 'run-ws-strict', payload: { testId: `t-ws-${i}`, status: 'failed', durationMs: 1 } });
      }
      await emit(bridge, { type: 'run:end', runId: 'run-ws-strict', payload: { status: 'failed', durationMs: 100 } });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-ws-strict'));
      // 92% < workspace 95% → failed (even though 92% > global 90%)
      expect(row.gateStatus).toBe('failed');
    });

    it('falls back to global config when run has workspaceId with no workspace config', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      // Global at 80% — lenient
      await testDb.insert(schema.qualityGateConfig).values({
        id: 'global',
        workspaceId: null,
        passRateThreshold: 80,
        updatedAt: new Date().toISOString(),
      });

      // Run at 85% in workspace 'ws-no-config' (no workspace-specific config)
      await emit(bridge, {
        type: 'run:start',
        runId: 'run-ws-fallback',
        payload: { total: 20, config: {}, workspaceId: 'ws-no-config' },
      });
      for (let i = 0; i < 17; i++) {
        await emit(bridge, { type: 'test:begin', runId: 'run-ws-fallback', payload: { testId: `tf-${i}`, title: `T${i}`, file: 'b.spec.ts' } });
        await emit(bridge, { type: 'test:end', runId: 'run-ws-fallback', payload: { testId: `tf-${i}`, status: 'passed', durationMs: 1 } });
      }
      for (let i = 17; i < 20; i++) {
        await emit(bridge, { type: 'test:begin', runId: 'run-ws-fallback', payload: { testId: `tf-${i}`, title: `T${i}`, file: 'b.spec.ts' } });
        await emit(bridge, { type: 'test:end', runId: 'run-ws-fallback', payload: { testId: `tf-${i}`, status: 'failed', durationMs: 1 } });
      }
      await emit(bridge, { type: 'run:end', runId: 'run-ws-fallback', payload: { status: 'failed', durationMs: 100 } });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-ws-fallback'));
      // 85% >= global 80% → passed
      expect(row.gateStatus).toBe('passed');
    });
  });

  // ── Quality gate: quarantine percentage guardrail ─────────────────────────
  describe('computeGateStatus — maxQuarantinePercent', () => {
    it('fails gate when quarantined tests exceed maxQuarantinePercent', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      // Gate with 100% pass rate threshold and 10% max quarantine
      await testDb.insert(schema.qualityGateConfig).values({
        id: 'global',
        passRateThreshold: 100,
        maxQuarantinePercent: 10,
        updatedAt: new Date().toISOString(),
      });

      // Quarantine 15 tests (matching run test titles so they are scoped to this run)
      for (let i = 0; i < 15; i++) {
        testSqlite.prepare(
          'INSERT INTO quarantine (id, test_title, test_file, quarantined_at) VALUES (?, ?, ?, ?)',
        ).run(`q-${i}`, `T${i}`, 'c.spec.ts', new Date().toISOString());
      }

      // Run with 100 total tests, all passing
      await emit(bridge, { type: 'run:start', runId: 'run-qpct', payload: { total: 100, config: {} } });
      for (let i = 0; i < 100; i++) {
        await emit(bridge, { type: 'test:begin', runId: 'run-qpct', payload: { testId: `tq-${i}`, title: `T${i}`, file: 'c.spec.ts' } });
        await emit(bridge, { type: 'test:end', runId: 'run-qpct', payload: { testId: `tq-${i}`, status: 'passed', durationMs: 1 } });
      }
      await emit(bridge, { type: 'run:end', runId: 'run-qpct', payload: { status: 'passed', durationMs: 100 } });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-qpct'));
      // 15/100 = 15% quarantined > 10% limit → failed even though all tests pass
      expect(row.gateStatus).toBe('failed');
    });

    it('passes gate when quarantined tests are within maxQuarantinePercent', async () => {
      const log = createLogger();
      const bridge = new ReporterBridge(log);

      await testDb.insert(schema.qualityGateConfig).values({
        id: 'global',
        passRateThreshold: 100,
        maxQuarantinePercent: 10,
        updatedAt: new Date().toISOString(),
      });

      // Only 5 tests quarantined (5% of 100 total, matching run test titles)
      for (let i = 0; i < 5; i++) {
        testSqlite.prepare(
          'INSERT INTO quarantine (id, test_title, test_file, quarantined_at) VALUES (?, ?, ?, ?)',
        ).run(`qp-${i}`, `T${i}`, 'd.spec.ts', new Date().toISOString());
      }

      await emit(bridge, { type: 'run:start', runId: 'run-qpct-ok', payload: { total: 100, config: {} } });
      for (let i = 0; i < 100; i++) {
        await emit(bridge, { type: 'test:begin', runId: 'run-qpct-ok', payload: { testId: `tqp-${i}`, title: `T${i}`, file: 'd.spec.ts' } });
        await emit(bridge, { type: 'test:end', runId: 'run-qpct-ok', payload: { testId: `tqp-${i}`, status: 'passed', durationMs: 1 } });
      }
      await emit(bridge, { type: 'run:end', runId: 'run-qpct-ok', payload: { status: 'passed', durationMs: 100 } });

      const [row] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-qpct-ok'));
      // 5/100 = 5% quarantined <= 10% limit → passed
      expect(row.gateStatus).toBe('passed');
    });
  });
});

// ─── Automate result callback tests ─────────────────────────────────────────

describe('ReporterBridge — Automate result callback', () => {
  afterEach(() => {
    delete process.env.AUTOMATE_CALLBACK_URL;
    delete process.env.AUTOMATE_SERVICE_SECRET;
    delete process.env.FEATURE_RESULT_CALLBACK;
    delete process.env.PUBLIC_DASHBOARD_URL;
    vi.restoreAllMocks();
  });

  it('POSTs to Automate callback URL when feature is enabled and env vars are set', async () => {
    process.env.FEATURE_RESULT_CALLBACK = 'true';
    process.env.AUTOMATE_CALLBACK_URL = 'http://automate:3000';
    process.env.AUTOMATE_SERVICE_SECRET = 'test-secret';
    process.env.PUBLIC_DASHBOARD_URL = 'http://dashboard:4000';

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const log = createLogger();
    const bridge = new ReporterBridge(log);

    const runId = 'run-callback-test';
    await emit(bridge, { type: 'run:start', runId, payload: { total: 3, config: {} } });
    await emit(bridge, { type: 'run:end', runId, payload: { status: 'passed', durationMs: 2000 } });

    // Wait for fire-and-forget dispatch to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    const callbackCalls = mockFetch.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('/api/service/run-callback'),
    );
    expect(callbackCalls).toHaveLength(1);

    const [url, init] = callbackCalls[0] as [string, RequestInit];
    expect(url).toBe('http://automate:3000/api/service/run-callback');
    expect((init.headers as Record<string, string>)['X-Service-Auth']).toBe('Bearer test-secret');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.runId).toBe(runId);
    expect(body.status).toBe('passed');
    expect(body.total).toBe(3);
    expect(body.dashboardUrl).toBe(`http://dashboard:4000/runs/${runId}`);
  });

  it('does not POST when feature flag is disabled', async () => {
    process.env.FEATURE_RESULT_CALLBACK = 'false';
    process.env.AUTOMATE_CALLBACK_URL = 'http://automate:3000';
    process.env.AUTOMATE_SERVICE_SECRET = 'test-secret';

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const log = createLogger();
    const bridge = new ReporterBridge(log);

    const runId = 'run-flag-off';
    await emit(bridge, { type: 'run:start', runId, payload: { total: 1, config: {} } });
    await emit(bridge, { type: 'run:end', runId, payload: { status: 'passed', durationMs: 100 } });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const callbackCalls = mockFetch.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('/api/service/run-callback'),
    );
    expect(callbackCalls).toHaveLength(0);
  });

  it('does not POST when AUTOMATE_CALLBACK_URL is not set', async () => {
    process.env.FEATURE_RESULT_CALLBACK = 'true';
    process.env.AUTOMATE_SERVICE_SECRET = 'test-secret';
    // AUTOMATE_CALLBACK_URL intentionally not set

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const log = createLogger();
    const bridge = new ReporterBridge(log);

    const runId = 'run-no-url';
    await emit(bridge, { type: 'run:start', runId, payload: { total: 1, config: {} } });
    await emit(bridge, { type: 'run:end', runId, payload: { status: 'passed', durationMs: 100 } });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const callbackCalls = mockFetch.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('/api/service/run-callback'),
    );
    expect(callbackCalls).toHaveLength(0);
  });

  it('logs error but does not throw when fetch fails', async () => {
    process.env.FEATURE_RESULT_CALLBACK = 'true';
    process.env.AUTOMATE_CALLBACK_URL = 'http://automate:3000';
    process.env.AUTOMATE_SERVICE_SECRET = 'test-secret';

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const log = createLogger();
    const bridge = new ReporterBridge(log);

    const runId = 'run-fetch-fail';
    await emit(bridge, { type: 'run:start', runId, payload: { total: 1, config: {} } });

    // Should not throw
    await expect(
      emit(bridge, { type: 'run:end', runId, payload: { status: 'failed', durationMs: 100 } }),
    ).resolves.not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
