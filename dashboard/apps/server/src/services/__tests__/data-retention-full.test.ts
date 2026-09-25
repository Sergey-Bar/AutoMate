import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn<(filePath: string) => boolean>(),
  readFileSync: vi.fn<(filePath: string, encoding: BufferEncoding) => string>(),
  writeFileSync: vi.fn<(filePath: string, data: string, encoding: BufferEncoding) => void>(),
  mkdirSync: vi.fn<(dirPath: string, options?: { recursive?: boolean }) => void>(),
}));

const dbState = vi.hoisted(() => ({
  db: undefined as unknown,
  sqlite: undefined as unknown,
}));

vi.mock('node:fs', () => ({
  default: fsMocks,
  existsSync: fsMocks.existsSync,
  readFileSync: fsMocks.readFileSync,
  writeFileSync: fsMocks.writeFileSync,
  mkdirSync: fsMocks.mkdirSync,
}));

vi.mock('../../db/client.js', () => ({
  get db() { return dbState.db; },
  get sqlite() { return dbState.sqlite; },
  get poolConnection() {
    return {
      query: async (sql: string, params: any[] = []) => {
        const sqliteSql = sql.replace(/\$(\d+)/g, '?');
        const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
        const stmt = dbState.sqlite.prepare(sqliteSql);
        if (isSelect) return { rows: stmt.all(params) };
        const info = stmt.run(params);
        return { rows: [], rowCount: info.changes };
      }
    };
  },
  isPostgres: false,
}));

import {
  DEFAULT_RETENTION_CONFIG,
  formatCleanupResult,
  getDbSizeBytes,
  getDbStats,
  getRetentionCutoffDate,
  loadRetentionConfig,
  runRetentionCleanup,
  saveRetentionConfig,
  type RetentionConfig,
} from '../data-retention.js';

function isoDaysAgo(days: number): string {
  // eslint-disable-next-line test-flakiness/no-random-data
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function createSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL DEFAULT 'running', total INTEGER NOT NULL DEFAULT 0, passed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, flaky INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER, branch TEXT, commit_sha TEXT, commit_message TEXT, triggered_by TEXT DEFAULT 'manual', config TEXT, raw_args TEXT, source TEXT NOT NULL DEFAULT 'live', gate_status TEXT, workspace_id TEXT, pr_number INTEGER, pr_branch TEXT, base_branch TEXT, commit_author TEXT);
    CREATE TABLE results (id TEXT PRIMARY KEY, test_id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, retry INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, duration_ms INTEGER, started_at TEXT, error_message TEXT, error_stack TEXT, worker_index INTEGER, parallel_index INTEGER, stdout TEXT, stderr TEXT, steps TEXT, attachments TEXT, fingerprint TEXT);
    CREATE TABLE tests (id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, suite_id TEXT, title TEXT NOT NULL, file TEXT NOT NULL, line INTEGER, "column" INTEGER, stable_id TEXT, status TEXT NOT NULL DEFAULT 'queued', duration_ms INTEGER, tags TEXT, annotations TEXT, retry_count INTEGER DEFAULT 0, expected_status TEXT, worker_index INTEGER, PRIMARY KEY (id, run_id));
    CREATE TABLE suites (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, parent_id TEXT, title TEXT NOT NULL, file TEXT, project TEXT);
    CREATE TABLE attachments (id TEXT PRIMARY KEY, result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE, name TEXT NOT NULL, content_type TEXT NOT NULL, path TEXT NOT NULL, size_bytes INTEGER, thumbnail_path TEXT, is_screenshot_diff INTEGER DEFAULT 0);
    CREATE TABLE nl_query_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_query TEXT NOT NULL, generated_sql TEXT NOT NULL, result_count INTEGER, user_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE trends (date TEXT NOT NULL, project TEXT NOT NULL, branch TEXT NOT NULL DEFAULT 'main', total INTEGER NOT NULL DEFAULT 0, passed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, flaky INTEGER NOT NULL DEFAULT 0, avg_duration_ms REAL, p95_duration_ms REAL, PRIMARY KEY (date, project, branch));
  `);
}

function queryCount(sqlite: Database.Database, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe('data-retention full coverage', () => {
  let testSqlite: Database.Database;

  beforeEach(() => {
    vi.clearAllMocks();

    testSqlite = new Database(':memory:');
    testSqlite.pragma('foreign_keys = ON');
    createSchema(testSqlite);

    dbState.sqlite = testSqlite;
    dbState.db = drizzle(testSqlite, { schema });

    fsMocks.existsSync.mockReturnValue(false);
    fsMocks.readFileSync.mockReturnValue('');
  });

  afterEach(() => {
    testSqlite.close();
  });

  describe('DEFAULT_RETENTION_CONFIG', () => {
    it('matches expected defaults exactly', () => {
      expect(DEFAULT_RETENTION_CONFIG).toEqual({
        testResultDays: 90,
        nlQueryHistoryDays: 30,
        attachmentDays: 60,
        trendsDays: -1,
        enabled: false,
      });
    });
  });

  describe('loadRetentionConfig', () => {
    it('returns defaults when config file does not exist', () => {
      fsMocks.existsSync.mockReturnValue(false);

      const config = loadRetentionConfig();

      expect(config).toEqual(DEFAULT_RETENTION_CONFIG);
      expect(fsMocks.readFileSync).not.toHaveBeenCalled();
    });

    it('returns defaults when config file contains invalid json', () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue('this is not json');

      const config = loadRetentionConfig();

      expect(config).toEqual(DEFAULT_RETENTION_CONFIG);
    });

    it('merges partial file config with defaults', () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify({
        testResultDays: 7,
        enabled: true,
      }));

      const config = loadRetentionConfig();

      expect(config).toEqual({
        testResultDays: 7,
        nlQueryHistoryDays: 30,
        attachmentDays: 60,
        trendsDays: -1,
        enabled: true,
      });
    });

    it('returns full override when all fields are provided', () => {
      const override = {
        testResultDays: 14,
        nlQueryHistoryDays: 10,
        attachmentDays: 5,
        trendsDays: 120,
        enabled: true,
      } satisfies RetentionConfig;

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(override));

      const config = loadRetentionConfig();

      expect(config).toEqual(override);
    });
  });

  describe('saveRetentionConfig', () => {
    const config: RetentionConfig = {
      testResultDays: 31,
      nlQueryHistoryDays: 15,
      attachmentDays: 9,
      trendsDays: -1,
      enabled: true,
    };

    it('creates directory when missing and writes formatted json', () => {
      fsMocks.existsSync.mockReturnValue(false);

      saveRetentionConfig(config);

      expect(fsMocks.mkdirSync).toHaveBeenCalledTimes(1);
      expect(fsMocks.mkdirSync).toHaveBeenCalledWith(
        expect.stringMatching(/[\\/]\.automate$/),
        { recursive: true },
      );
      expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1);
      expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/[\\/]\.automate[\\/]data-retention\.json$/),
        JSON.stringify(config, null, 2),
        'utf-8',
      );
    });

    it('does not create directory when it already exists', () => {
      fsMocks.existsSync.mockReturnValue(true);

      saveRetentionConfig(config);

      expect(fsMocks.mkdirSync).not.toHaveBeenCalled();
      expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('getRetentionCutoffDate', () => {
    it('returns iso date around N days in the past', () => {
      const cutoff = getRetentionCutoffDate(90);
      // eslint-disable-next-line test-flakiness/no-random-data
      const diffDays = (Date.now() - new Date(cutoff).getTime()) / (1000 * 60 * 60 * 24);

      expect(diffDays).toBeGreaterThan(89.9);
      expect(diffDays).toBeLessThan(90.1);
    });

    it('handles 0 days as current time', () => {
      // eslint-disable-next-line test-flakiness/no-random-data
      const before = Date.now();
      const cutoff = getRetentionCutoffDate(0);
      // eslint-disable-next-line test-flakiness/no-random-data
      const after = Date.now();
      const cutoffMs = new Date(cutoff).getTime();

      expect(cutoffMs).toBeGreaterThanOrEqual(before - 5);
      expect(cutoffMs).toBeLessThanOrEqual(after + 5);
    });

    it('handles large day values', () => {
      const oneYear = new Date(getRetentionCutoffDate(365)).getTime();
      const tenYears = new Date(getRetentionCutoffDate(3650)).getTime();

      expect(tenYears).toBeLessThan(oneYear);
    });
  });

  describe('formatCleanupResult', () => {
    it('formats all fields correctly', () => {
      const formatted = formatCleanupResult({
        deletedRuns: 3,
        deletedResults: 12,
        deletedNlQueries: 5,
        deletedAttachments: 4,
        durationMs: 77,
      });

      expect(formatted).toBe(
        [
          'Cleanup complete in 77ms:',
          '  3 runs',
          '  12 results',
          '  5 NL queries',
          '  4 attachments',
        ].join('\n'),
      );
    });

    it('formats zero counts correctly', () => {
      const formatted = formatCleanupResult({
        deletedRuns: 0,
        deletedResults: 0,
        deletedNlQueries: 0,
        deletedAttachments: 0,
        durationMs: 1,
      });

      expect(formatted).toBe(
        [
          'Cleanup complete in 1ms:',
          '  0 runs',
          '  0 results',
          '  0 NL queries',
          '  0 attachments',
        ].join('\n'),
      );
    });
  });

  describe('runRetentionCleanup', () => {
    beforeEach(() => {
      const insertRun = testSqlite.prepare(
        `INSERT INTO runs (id, started_at, status, source) VALUES (?, ?, 'passed', 'live')`,
      );
      const insertSuite = testSqlite.prepare(
        `INSERT INTO suites (id, run_id, title) VALUES (?, ?, 'suite title')`,
      );
      const insertTest = testSqlite.prepare(
        `INSERT INTO tests (id, run_id, suite_id, title, file, status) VALUES (?, ?, ?, 'test title', '/tmp/test.spec.ts', 'passed')`,
      );
      const insertResult = testSqlite.prepare(
        `INSERT INTO results (id, test_id, run_id, status) VALUES (?, ?, ?, 'passed')`,
      );
      const insertAttachment = testSqlite.prepare(
        `INSERT INTO attachments (id, result_id, name, content_type, path) VALUES (?, ?, 'screenshot', 'image/png', '/tmp/a.png')`,
      );
      const insertQuery = testSqlite.prepare(
        `INSERT INTO nl_query_history (user_query, generated_sql, created_at) VALUES ('q', 'select 1', ?)`,
      );
      const insertTrend = testSqlite.prepare(
        `INSERT INTO trends (date, project, branch, total, passed, failed, flaky) VALUES (?, 'proj', 'main', 1, 1, 0, 0)`,
      );

      insertRun.run('run-old', isoDaysAgo(120));
      insertSuite.run('suite-old', 'run-old');
      insertTest.run('test-old', 'run-old', 'suite-old');
      insertResult.run('result-old', 'test-old', 'run-old');
      insertAttachment.run('attachment-old', 'result-old');

      insertRun.run('run-new', isoDaysAgo(2));
      insertSuite.run('suite-new', 'run-new');
      insertTest.run('test-new', 'run-new', 'suite-new');
      insertResult.run('result-new', 'test-new', 'run-new');
      insertAttachment.run('attachment-new', 'result-new');

      insertQuery.run(isoDaysAgo(45));
      insertQuery.run(isoDaysAgo(2));

      insertTrend.run(isoDaysAgo(200));
      insertTrend.run(isoDaysAgo(1));
    });

    it('deletes runs older than cutoff and cascades to related rows', async () => {
      const result = await runRetentionCleanup({
        ...DEFAULT_RETENTION_CONFIG,
        enabled: true,
      });

      expect(result.deletedRuns).toBe(1);
      expect(result.deletedResults).toBe(1);
      expect(result.deletedAttachments).toBe(1);
      expect(queryCount(testSqlite, 'runs')).toBe(1);
      expect(queryCount(testSqlite, 'results')).toBe(1);
      expect(queryCount(testSqlite, 'tests')).toBe(1);
      expect(queryCount(testSqlite, 'suites')).toBe(1);
      expect(queryCount(testSqlite, 'attachments')).toBe(1);
    });

    it('preserves runs newer than cutoff', async () => {
      await runRetentionCleanup({
        ...DEFAULT_RETENTION_CONFIG,
        testResultDays: 90,
      });

      const runNew = testSqlite.prepare(`SELECT id FROM runs WHERE id = 'run-new'`).get() as { id: string } | undefined;
      expect(runNew?.id).toBe('run-new');
    });

    it('handles empty database', async () => {
      testSqlite.exec('DELETE FROM attachments; DELETE FROM results; DELETE FROM tests; DELETE FROM suites; DELETE FROM runs; DELETE FROM nl_query_history; DELETE FROM trends;');

      const result = await runRetentionCleanup({
        ...DEFAULT_RETENTION_CONFIG,
        enabled: true,
        trendsDays: 30,
      });

      expect(result.deletedRuns).toBe(0);
      expect(result.deletedResults).toBe(0);
      expect(result.deletedAttachments).toBe(0);
      expect(result.deletedNlQueries).toBe(0);
    });

    it('respects custom testResultDays threshold', async () => {
      const insertRun = testSqlite.prepare(`INSERT INTO runs (id, started_at, status, source) VALUES (?, ?, 'passed', 'live')`);
      insertRun.run('run-8-days', isoDaysAgo(8));
      insertRun.run('run-6-days', isoDaysAgo(6));

      const result = await runRetentionCleanup({
        ...DEFAULT_RETENTION_CONFIG,
        testResultDays: 7,
        nlQueryHistoryDays: 0,
      });

      expect(result.deletedRuns).toBe(2);
      expect(testSqlite.prepare(`SELECT COUNT(*) AS count FROM runs WHERE id = 'run-6-days'`).get() as { count: number }).toEqual({ count: 1 });
      expect(testSqlite.prepare(`SELECT COUNT(*) AS count FROM runs WHERE id = 'run-8-days'`).get() as { count: number }).toEqual({ count: 0 });
    });

    it('deletes NL query history older than nlQueryHistoryDays', async () => {
      const result = await runRetentionCleanup({
        ...DEFAULT_RETENTION_CONFIG,
        testResultDays: 0,
        nlQueryHistoryDays: 30,
      });

      expect(result.deletedNlQueries).toBe(1);
      expect(queryCount(testSqlite, 'nl_query_history')).toBe(1);
    });

    it('deletes trends when trendsDays is greater than 0', async () => {
      await runRetentionCleanup({
        ...DEFAULT_RETENTION_CONFIG,
        testResultDays: 0,
        nlQueryHistoryDays: 0,
        trendsDays: 30,
      });

      expect(queryCount(testSqlite, 'trends')).toBe(1);
    });

    it('does not delete trends when trendsDays is -1', async () => {
      await runRetentionCleanup({
        ...DEFAULT_RETENTION_CONFIG,
        testResultDays: 0,
        nlQueryHistoryDays: 0,
        trendsDays: -1,
      });

      expect(queryCount(testSqlite, 'trends')).toBe(2);
    });

    it('returns accurate cleanup counts with mixed deletions', async () => {
      const result = await runRetentionCleanup({
        testResultDays: 90,
        nlQueryHistoryDays: 30,
        attachmentDays: 60,
        trendsDays: -1,
        enabled: true,
      });

      expect(result).toMatchObject({
        deletedRuns: 1,
        deletedResults: 1,
        deletedNlQueries: 1,
        deletedAttachments: 1,
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('uses config loaded from file when called without parameter', async () => {
      fsMocks.existsSync.mockImplementation((targetPath: string) =>
        targetPath.endsWith(path.join('.automate', 'data-retention.json')),
      );
      fsMocks.readFileSync.mockReturnValue(
        JSON.stringify({
          testResultDays: 90,
          nlQueryHistoryDays: 30,
          attachmentDays: 60,
          trendsDays: -1,
          enabled: true,
        } satisfies RetentionConfig),
      );

      const result = await runRetentionCleanup();

      expect(result.deletedRuns).toBe(1);
      expect(result.deletedNlQueries).toBe(1);
      expect(fsMocks.readFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDbSizeBytes', () => {
    it('returns page_count multiplied by page_size', () => {
      const pageCount = testSqlite.pragma('page_count', { simple: true }) as number;
      const pageSize = testSqlite.pragma('page_size', { simple: true }) as number;

      expect(getDbSizeBytes()).toBe(pageCount * pageSize);
    });

    it('returns 0 when pragma throws', () => {
      testSqlite.close();

      expect(getDbSizeBytes()).toBe(0);

      testSqlite = new Database(':memory:');
      testSqlite.pragma('foreign_keys = ON');
      createSchema(testSqlite);
      dbState.sqlite = testSqlite;
      dbState.db = drizzle(testSqlite, { schema });
    });
  });

  describe('getDbStats', () => {
    it('returns database size stats object', () => {
      const pageCount = testSqlite.pragma('page_count', { simple: true }) as number;
      const pageSize = testSqlite.pragma('page_size', { simple: true }) as number;
      const sizeBytes = pageCount * pageSize;

      expect(getDbStats()).toEqual({
        sizeBytes,
        sizeMB: (sizeBytes / (1024 * 1024)).toFixed(2),
        pageCount,
        pageSize,
      });
    });

    it('falls back to zero stats when pragma returns falsy values', () => {
      const fakeSqlite: { pragma: (name: string, options?: { simple?: boolean }) => unknown } = {
        pragma: vi.fn(() => undefined),
      };

      dbState.sqlite = fakeSqlite;

      expect(getDbStats()).toEqual({
        sizeBytes: 0,
        sizeMB: '0.00',
        pageCount: 0,
        pageSize: 0,
      });

      dbState.sqlite = testSqlite;
    });
  });
});
