/// <reference types="vitest" />
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import { createHash } from 'crypto';
import * as path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';

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
`);

const testDb = drizzle(testSqlite, { schema });
// Polyfill .transaction() to support async callbacks (better-sqlite3 only supports sync)
(testDb as unknown as Record<string, unknown>).transaction = async (callback: (tx: typeof testDb) => Promise<unknown>) => callback(testDb);

vi.mock('../../db/client.js', () => ({
  get db() { return testDb; },
  get sqlite() { return testSqlite; },
  get poolConnection() {
    return {
      query: async (sql: string, params: any[] = []) => {
        const sqliteSql = sql.replace(/\$(\d+)/g, '?');
        const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
        const stmt = testSqlite.prepare(sqliteSql);
        if (isSelect) return { rows: stmt.all(params) };
        const info = stmt.run(params);
        return { rows: [], rowCount: info.changes };
      }
    };
  },
  isPostgres: false,
}));

vi.mock('../integrations/slack.js', () => ({ sendSlackRunSummary: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../integrations/jira.js', () => ({ createJiraBug: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../integrations/github.js', () => ({
  postPrComment: vi.fn().mockResolvedValue(undefined),
  createCommitStatus: vi.fn().mockResolvedValue(undefined),
  postOrUpdatePrComment: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../integrations/webhooks.js', () => ({ dispatchAllWebhooks: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../integrations/email.js', () => ({ sendRunReportEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../integrations/teams.js', () => ({ sendTeamsRunSummary: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../trend-backfill.js', () => ({ updateTrendsForDate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../auto-quarantine.js', () => ({ autoQuarantineCheck: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../pr-comparison.js', () => ({
  resolveBaseRun: vi.fn().mockResolvedValue(null),
  compareRunToBase: vi.fn().mockResolvedValue({}),
  generatePrCommentMarkdown: vi.fn().mockReturnValue(''),
}));
vi.mock('../fingerprint.js', () => ({ fingerprintError: vi.fn().mockReturnValue('fp-test') }));
vi.mock('fs', () => ({
  default: { existsSync: vi.fn().mockReturnValue(false), readFileSync: vi.fn() },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));
vi.mock('node:fs', () => ({
  default: { existsSync: vi.fn().mockReturnValue(false), readFileSync: vi.fn() },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import { ReporterBridge } from '../reporter-bridge.js';
import { dispatchAllWebhooks } from '../integrations/webhooks.js';
import { updateTrendsForDate } from '../trend-backfill.js';
import { autoQuarantineCheck } from '../auto-quarantine.js';
import { fingerprintError } from '../fingerprint.js';

type MockLogger = FastifyBaseLogger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
  level: string;
  silent: ReturnType<typeof vi.fn>;
};

function createMockLogger(): MockLogger {
  const log: MockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as MockLogger;
  log.child.mockReturnValue(log);
  return log;
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

async function emit(bridge: ReporterBridge, event: { type: string; runId: string; payload: Record<string, unknown> }) {
  await bridge.handleReporterEvent(JSON.stringify(event));
}

beforeEach(() => {
  testSqlite.exec('DELETE FROM results');
  testSqlite.exec('DELETE FROM tests');
  testSqlite.exec('DELETE FROM runs');
  testSqlite.exec('DELETE FROM quality_gate_config');
  vi.clearAllMocks();
  delete process.env.ARTIFACTS_DIR;
});

afterAll(() => {
  testSqlite.close();
});

describe('ReporterBridge full coverage', () => {
  describe('Client management (addClient/broadcast)', () => {
    it('addClient adds a client and broadcast sends to it', () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);
      const client = createFakeWs(1);

      bridge.addClient(client.ws);
      bridge.broadcast({ type: 'stdout', runId: 'run-1', payload: { text: 'hello' } });

      expect(client.sent).toHaveLength(1);
      expect(JSON.parse(client.sent[0])).toEqual({ type: 'stdout', runId: 'run-1', payload: { text: 'hello' } });
    });

    it('broadcast sends only to OPEN clients', () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);
      const open = createFakeWs(1);
      const closed = createFakeWs(3);

      bridge.addClient(open.ws);
      bridge.addClient(closed.ws);
      bridge.broadcast({ type: 'stderr', runId: 'run-1', payload: { text: 'err' } });

      expect(open.sent).toHaveLength(1);
      expect(closed.sent).toHaveLength(0);
    });

    it('broadcast respects runId subscriptions and global subscriptions', () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);
      const specific = createFakeWs(1);
      const otherRun = createFakeWs(1);
      const allRuns = createFakeWs(1);

      bridge.addClient(specific.ws, 'run-1');
      bridge.addClient(otherRun.ws, 'run-2');
      bridge.addClient(allRuns.ws);

      bridge.broadcast({ type: 'step:begin', runId: 'run-1', payload: { title: 'setup' } });

      expect(specific.sent).toHaveLength(1);
      expect(otherRun.sent).toHaveLength(0);
      expect(allRuns.sent).toHaveLength(1);
    });

    it('removes client on ws close', () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);
      const client = createFakeWs(1);

      bridge.addClient(client.ws);
      client.triggerClose();
      bridge.broadcast({ type: 'stdout', runId: 'run-1', payload: { text: 'x' } });

      expect(client.sent).toHaveLength(0);
    });

    it('broadcast reaches multiple clients simultaneously', () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);
      const c1 = createFakeWs(1);
      const c2 = createFakeWs(1);
      const c3 = createFakeWs(1);

      bridge.addClient(c1.ws);
      bridge.addClient(c2.ws);
      bridge.addClient(c3.ws);
      bridge.broadcast({ type: 'step:end', runId: 'run-multi', payload: { ok: true } });

      expect(c1.sent).toHaveLength(1);
      expect(c2.sent).toHaveLength(1);
      expect(c3.sent).toHaveLength(1);
    });
  });

  describe('handleReporterEvent parsing', () => {
    it('invalid JSON logs warning and does not crash', async () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);

      await bridge.handleReporterEvent('{bad-json');

      expect(log.warn).toHaveBeenCalledWith('[bridge] Failed to parse reporter event');
    });

    it('valid JSON persists and broadcasts', async () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);
      const client = createFakeWs(1);
      bridge.addClient(client.ws);

      await emit(bridge, {
        type: 'run:start',
        runId: 'run-parse-ok',
        payload: { total: 3, config: {}, rawArgs: '' },
      });

      const [run] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-parse-ok'));
      expect(run).toBeDefined();
      expect(client.sent).toHaveLength(1);
    });
  });

  describe('run:start', () => {
    it('inserts run, tolerates duplicates, broadcasts, and dispatches run:start webhook', async () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);
      const client = createFakeWs(1);
      bridge.addClient(client.ws, 'run-start-1');

      const event = {
        type: 'run:start',
        runId: 'run-start-1',
        payload: {
          total: 10,
          config: { workers: 2 },
          rawArgs: '--grep smoke',
          branch: 'feat/reporter',
          commitSha: 'abc123',
          pr: { prNumber: 42, prBranch: 'feat/reporter', baseBranch: 'main', commitAuthor: 'alice' },
        },
      };

      await emit(bridge, event);
      await emit(bridge, event);

      const rows = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-start-1'));
      expect(rows).toHaveLength(1);
      expect(rows[0].total).toBe(10);
      expect(rows[0].prNumber).toBe(42);
      expect(client.sent).toHaveLength(2);
      expect(dispatchAllWebhooks).toHaveBeenCalledWith('run:start', { runId: 'run-start-1', total: 10 });
    });
  });

  describe('test:begin', () => {
    it('inserts test row with computed stableId and onConflictDoNothing semantics', async () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-begin-1', payload: { total: 1, config: {} } });

      const file = 'tests/auth/login.spec.ts';
      const title = 'should login successfully';
      const expectedStableId = createHash('sha256').update(file + '\0' + title).digest('hex').slice(0, 16);

      const event = {
        type: 'test:begin',
        runId: 'run-begin-1',
        payload: {
          testId: 'test-begin-1',
          title,
          file,
          line: 12,
          column: 5,
          tags: ['smoke'],
          annotations: [{ type: 'owner', description: 'qa' }],
          workerIndex: 0,
        },
      };

      await emit(bridge, event);
      await emit(bridge, event);

      const rows = await testDb.select().from(schema.tests).where(eq(schema.tests.runId, 'run-begin-1'));
      expect(rows).toHaveLength(1);
      expect(rows[0].stableId).toBe(expectedStableId);
      expect(rows[0].status).toBe('running');
    });
  });

  describe('test:end', () => {
    it('updates test status, inserts result, increments counters, normalizes attachments, fingerprints errors, and dispatches fail webhook', async () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);

      process.env.ARTIFACTS_DIR = path.resolve(process.cwd(), 'tmp-artifacts');
      const insideArtifact = path.join(process.env.ARTIFACTS_DIR, 'run-a', 'trace.zip');
      const outsideArtifact = path.resolve(process.cwd(), 'other', 'video.webm');

      await emit(bridge, { type: 'run:start', runId: 'run-end-1', payload: { total: 4, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-end-1',
        payload: { testId: 't-fail', title: 'fails', file: 'a.spec.ts', workerIndex: 0 },
      });

      await emit(bridge, {
        type: 'test:end',
        runId: 'run-end-1',
        payload: {
          testId: 't-fail',
          status: 'failed',
          durationMs: 123,
          retry: 1,
          workerIndex: 2,
          parallelIndex: 1,
          title: 'fails',
          file: 'a.spec.ts',
          error: { message: 'AssertionError: expected 1 to equal 2', stack: 'stack-here' },
          stdout: ['out'],
          stderr: ['err'],
          steps: [{ title: 'click', duration: 10 }],
          attachments: [
            { name: 'trace', contentType: 'application/zip', path: insideArtifact },
            { name: 'video', contentType: 'video/webm', path: outsideArtifact },
          ],
        },
      });

      const [testRow] = await testDb
        .select()
        .from(schema.tests)
        .where(eq(schema.tests.id, 't-fail'));
      expect(testRow.status).toBe('failed');
      expect(testRow.durationMs).toBe(123);

      const resultRows = await testDb
        .select()
        .from(schema.results)
        .where(eq(schema.results.testId, 't-fail'));
      expect(resultRows).toHaveLength(1);
      expect(resultRows[0].status).toBe('failed');
      expect(resultRows[0].fingerprint).toBe('fp-test');

      const normalized = JSON.parse(resultRows[0].attachments ?? '[]') as Array<{ path?: string }>;
      expect(normalized[0].path).toBe(path.join('run-a', 'trace.zip'));
      expect(normalized[1].path).toBe(outsideArtifact);

      const [runRow] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-end-1'));
      expect(runRow.failed).toBe(1);
      expect(fingerprintError).toHaveBeenCalledWith('AssertionError: expected 1 to equal 2');
      expect(dispatchAllWebhooks).toHaveBeenCalledWith('test:fail', {
        runId: 'run-end-1',
        testId: 't-fail',
        title: 'fails',
        file: 'a.spec.ts',
        error: 'AssertionError: expected 1 to equal 2',
      });
    });

    it('increments passed/flaky/skipped counters correctly', async () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-end-2', payload: { total: 3, config: {} } });

      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-end-2',
        payload: { testId: 't-pass', title: 'passes', file: 'a.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-end-2',
        payload: { testId: 't-flaky', title: 'flaky', file: 'b.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-end-2',
        payload: { testId: 't-skip', title: 'skipped', file: 'c.spec.ts' },
      });

      await emit(bridge, {
        type: 'test:end',
        runId: 'run-end-2',
        payload: { testId: 't-pass', status: 'passed', durationMs: 10 },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-end-2',
        payload: { testId: 't-flaky', status: 'flaky', durationMs: 20 },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-end-2',
        payload: { testId: 't-skip', status: 'skipped', durationMs: 1 },
      });

      const [runRow] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-end-2'));
      expect(runRow.passed).toBe(1);
      expect(runRow.flaky).toBe(1);
      expect(runRow.skipped).toBe(1);
    });
  });

  describe('run:end and gate status', () => {
    it('updates run status/finishedAt, computes gate status, and triggers fire-and-forget services', async () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-final-1', payload: { total: 1, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-final-1',
        payload: { testId: 't1', title: 'ok', file: 'ok.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-final-1',
        payload: { testId: 't1', status: 'passed', durationMs: 10 },
      });

      const dispatchSpy = vi.spyOn(
        ReporterBridge.prototype as unknown as { dispatchIntegrations: (runId: string) => Promise<void> },
        'dispatchIntegrations',
      ).mockResolvedValue(undefined);

      await emit(bridge, { type: 'run:end', runId: 'run-final-1', payload: { status: 'passed', durationMs: 1000 } });
      await Promise.resolve();

      const [runRow] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-final-1'));
      expect(runRow.status).toBe('passed');
      expect(runRow.durationMs).toBe(1000);
      expect(runRow.finishedAt).toBeTruthy();
      expect(runRow.gateStatus).toBe('passed');

      expect(dispatchSpy).toHaveBeenCalledWith('run-final-1');
      expect(updateTrendsForDate).toHaveBeenCalledTimes(1);
      expect(autoQuarantineCheck).toHaveBeenCalledTimes(1);

      dispatchSpy.mockRestore();
    });

    it('fails gate when pass rate is below configured threshold', async () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);

      await testDb.insert(schema.qualityGateConfig).values({
        id: 'global',
        passRateThreshold: 80,
        maxDurationMs: null,
        maxFlakyCount: null,
        updatedAt: '2023-11-14T22:13:20.000Z',
      });

      await emit(bridge, { type: 'run:start', runId: 'run-gate-1', payload: { total: 2, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-gate-1',
        payload: { testId: 'gt-1', title: 'pass', file: 'p.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-gate-1',
        payload: { testId: 'gt-2', title: 'fail', file: 'f.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-gate-1',
        payload: { testId: 'gt-1', status: 'passed', durationMs: 1 },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-gate-1',
        payload: { testId: 'gt-2', status: 'failed', durationMs: 1, error: { message: 'boom' } },
      });

      await emit(bridge, { type: 'run:end', runId: 'run-gate-1', payload: { status: 'failed', durationMs: 2 } });

      const [runRow] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-gate-1'));
      expect(runRow.gateStatus).toBe('failed');
    });

    it('defaults to threshold 100 when quality gate config is absent', async () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-gate-2', payload: { total: 2, config: {} } });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-gate-2',
        payload: { testId: 'd-1', title: 'pass', file: 'p.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:begin',
        runId: 'run-gate-2',
        payload: { testId: 'd-2', title: 'fail', file: 'f.spec.ts' },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-gate-2',
        payload: { testId: 'd-1', status: 'passed', durationMs: 1 },
      });
      await emit(bridge, {
        type: 'test:end',
        runId: 'run-gate-2',
        payload: { testId: 'd-2', status: 'failed', durationMs: 1, error: { message: 'boom' } },
      });

      await emit(bridge, { type: 'run:end', runId: 'run-gate-2', payload: { status: 'failed', durationMs: 2 } });

      const [runRow] = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-gate-2'));
      expect(runRow.gateStatus).toBe('failed');
    });
  });

  describe('default broadcast-only events', () => {
    it('broadcasts step/stdout/stderr events without DB writes', async () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);
      const client = createFakeWs(1);
      bridge.addClient(client.ws);

      await emit(bridge, { type: 'stdout', runId: 'run-default-1', payload: { text: 'hello' } });
      await emit(bridge, { type: 'stderr', runId: 'run-default-1', payload: { text: 'oops' } });
      await emit(bridge, { type: 'step:begin', runId: 'run-default-1', payload: { title: 'setup' } });
      await emit(bridge, { type: 'step:end', runId: 'run-default-1', payload: { title: 'setup' } });

      const runRows = await testDb.select().from(schema.runs).where(eq(schema.runs.id, 'run-default-1'));
      const testRows = await testDb.select().from(schema.tests);
      const resultRows = await testDb.select().from(schema.results);

      expect(client.sent).toHaveLength(4);
      expect(runRows).toHaveLength(0);
      expect(testRows).toHaveLength(0);
      expect(resultRows).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('logs DB persist error but still broadcasts event', async () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);
      const client = createFakeWs(1);
      bridge.addClient(client.ws);

      await emit(bridge, {
        type: 'test:begin',
        runId: 'missing-run-for-fk',
        payload: { testId: 'fk-1', title: 'fk fail', file: 'fk.spec.ts' },
      });

      expect(log.error).toHaveBeenCalled();
      expect(client.sent).toHaveLength(1);
      expect(JSON.parse(client.sent[0]).type).toBe('test:begin');
    });

    it('logs integration dispatch error on run:end and does not crash', async () => {
      const log = createMockLogger();
      const bridge = new ReporterBridge(log);

      await emit(bridge, { type: 'run:start', runId: 'run-int-err', payload: { total: 1, config: {} } });

      const dispatchSpy = vi.spyOn(
        ReporterBridge.prototype as unknown as { dispatchIntegrations: (runId: string) => Promise<void> },
        'dispatchIntegrations',
      ).mockRejectedValue(new Error('integration exploded'));

      await emit(bridge, { type: 'run:end', runId: 'run-int-err', payload: { status: 'failed', durationMs: 1 } });
      await Promise.resolve();

      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[bridge] Integration dispatch error',
      );

      dispatchSpy.mockRestore();
    });
  });
});
