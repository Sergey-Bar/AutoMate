/// <reference types="vitest" />
/**
 * reporter-bridge-locator.test.ts
 *
 * Covers the locator intelligence fire-and-forget path in reporter-bridge.ts
 * (Phase 3B — Self-Healing Selectors).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

// ── In-memory SQLite ──────────────────────────────────────────────────────────

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

  CREATE TABLE IF NOT EXISTS locator_suggestions (
    id TEXT PRIMARY KEY,
    test_id TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    original_selector TEXT NOT NULL,
    suggested_selector TEXT NOT NULL,
    confidence REAL NOT NULL,
    rationale TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
`);

const testDb = drizzle(testSqlite, { schema });

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAnalyzeAndPersist, mockIsSelectorFailure, mockDispatchAllWebhooks, mockClassifyFailure } = vi.hoisted(() => ({
  mockAnalyzeAndPersist: vi.fn().mockResolvedValue(undefined),
  mockIsSelectorFailure: vi.fn().mockReturnValue(false),
  mockDispatchAllWebhooks: vi.fn().mockResolvedValue(undefined),
  mockClassifyFailure: vi.fn().mockReturnValue({ category: 'unknown', confidence: 0.5, matchedRuleId: null, evidence: '' }),
}));

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

vi.mock('../locator-intelligence.js', () => ({
  analyzeAndPersist: mockAnalyzeAndPersist,
  isSelectorFailure: mockIsSelectorFailure,
}));

vi.mock('../integrations/webhooks.js', () => ({ dispatchAllWebhooks: mockDispatchAllWebhooks }));
vi.mock('../failure-taxonomy.js', () => ({ classifyFailure: mockClassifyFailure }));
vi.mock('../fingerprint.js', () => ({ fingerprintError: vi.fn().mockReturnValue('abc123') }));
vi.mock('../trend-backfill.js', () => ({ updateTrendsForDate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../auto-quarantine.js', () => ({ autoQuarantineCheck: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../failure-cluster-persistence.js', () => ({ updateCrossRunClusters: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../pr-comparison.js', () => ({
  resolveBaseRun: vi.fn().mockResolvedValue(null),
  compareRunToBase: vi.fn(),
  generatePrCommentMarkdown: vi.fn(),
}));
vi.mock('../integrations/config.js', () => ({
  readConfig: vi.fn().mockReturnValue({}),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { ReporterBridge } from '../reporter-bridge.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function mockLog(): FastifyBaseLogger {
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

describe('reporter-bridge — locator intelligence', () => {
  let bridge: ReporterBridge;
  const runId = 'loc-run-1';
  const testId = 'loc-test-1';

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore mock defaults
    mockAnalyzeAndPersist.mockResolvedValue(undefined);
    mockDispatchAllWebhooks.mockResolvedValue(undefined);
    mockClassifyFailure.mockReturnValue({ category: 'unknown', confidence: 0.5, matchedRuleId: null, evidence: '' });

    bridge = new ReporterBridge(mockLog());

    testSqlite.exec(`DELETE FROM failure_classifications`);
    testSqlite.exec(`DELETE FROM results`);
    testSqlite.exec(`DELETE FROM tests`);
    testSqlite.exec(`DELETE FROM locator_suggestions`);
    testSqlite.exec(`DELETE FROM runs`);

    testSqlite.exec(`
      INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped)
      VALUES ('${runId}', '2024-01-01T00:00:00.000Z', 'running', 1, 0, 0, 0, 0)
    `);
    testSqlite.exec(`
      INSERT INTO tests (id, run_id, title, file, status)
      VALUES ('${testId}', '${runId}', 'test with selector failure', 'test.spec.ts', 'running')
    `);
  });

  afterAll(() => {
    testSqlite.close();
  });

  it('calls analyzeAndPersist when locator-intelligence flag is enabled and error is selector failure', async () => {
    process.env['FEATURE_LOCATOR_INTELLIGENCE'] = 'true';
    mockIsSelectorFailure.mockReturnValue(true);

    const errorMsg = 'locator.click: Timeout waiting for selector ".submit-btn"';
    await bridge.handleReporterEvent(JSON.stringify({
      type: 'test:end',
      runId,
      payload: {
        testId,
        status: 'failed',
        durationMs: 1000,
        retry: 0,
        error: { message: errorMsg, stack: '' },
        attachments: [],
        steps: [],
        stdout: [],
        stderr: [],
      },
    }));

    // Give fire-and-forget a tick to run
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockIsSelectorFailure).toHaveBeenCalledWith(errorMsg);
    expect(mockAnalyzeAndPersist).toHaveBeenCalled();

    delete process.env['FEATURE_LOCATOR_INTELLIGENCE'];
  });

  it('does not call analyzeAndPersist when locator-intelligence flag is disabled', async () => {
    process.env['FEATURE_LOCATOR_INTELLIGENCE'] = 'false';
    mockIsSelectorFailure.mockReturnValue(true);

    await bridge.handleReporterEvent(JSON.stringify({
      type: 'test:end',
      runId,
      payload: {
        testId,
        status: 'failed',
        durationMs: 1000,
        retry: 0,
        error: { message: 'locator.click: ".btn"', stack: '' },
        attachments: [],
        steps: [],
        stdout: [],
        stderr: [],
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockAnalyzeAndPersist).not.toHaveBeenCalled();
  });

  it('does not call analyzeAndPersist when test passes', async () => {
    process.env['FEATURE_LOCATOR_INTELLIGENCE'] = 'true';
    mockIsSelectorFailure.mockReturnValue(true);

    await bridge.handleReporterEvent(JSON.stringify({
      type: 'test:end',
      runId,
      payload: {
        testId,
        status: 'passed',
        durationMs: 100,
        retry: 0,
        attachments: [],
        steps: [],
        stdout: [],
        stderr: [],
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockAnalyzeAndPersist).not.toHaveBeenCalled();

    delete process.env['FEATURE_LOCATOR_INTELLIGENCE'];
  });

  it('does not call analyzeAndPersist when error is not a selector failure', async () => {
    process.env['FEATURE_LOCATOR_INTELLIGENCE'] = 'true';
    mockIsSelectorFailure.mockReturnValue(false);

    await bridge.handleReporterEvent(JSON.stringify({
      type: 'test:end',
      runId,
      payload: {
        testId,
        status: 'failed',
        durationMs: 500,
        retry: 0,
        error: { message: 'Expected 200 but got 404', stack: '' },
        attachments: [],
        steps: [],
        stdout: [],
        stderr: [],
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockAnalyzeAndPersist).not.toHaveBeenCalled();

    delete process.env['FEATURE_LOCATOR_INTELLIGENCE'];
  });

  it('does not call analyzeAndPersist when no quoted selector found in error', async () => {
    process.env['FEATURE_LOCATOR_INTELLIGENCE'] = 'true';
    mockIsSelectorFailure.mockReturnValue(true);

    await bridge.handleReporterEvent(JSON.stringify({
      type: 'test:end',
      runId,
      payload: {
        testId,
        status: 'failed',
        durationMs: 500,
        retry: 0,
        error: { message: 'locator.click timed out with no selector quoted', stack: '' },
        attachments: [],
        steps: [],
        stdout: [],
        stderr: [],
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockAnalyzeAndPersist).not.toHaveBeenCalled();

    delete process.env['FEATURE_LOCATOR_INTELLIGENCE'];
  });
});
