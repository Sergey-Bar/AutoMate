import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

type SelectChain = {
  from: ReturnType<typeof vi.fn>;
};

type FromChain = {
  where: ReturnType<typeof vi.fn>;
};

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  sqlite: undefined as Database.Database | undefined,
}));

vi.mock('../../db/client.js', () => ({
  get db() { return state.db; },
  get sqlite() { return state.sqlite; },
  get poolConnection() {
    return {
      query: async (sql: string, params: any[] = []) => {
        const sqliteSql = sql.replace(/\$(\d+)/g, '?');
        const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
        const stmt = state.sqlite.prepare(sqliteSql);
        if (isSelect) return { rows: stmt.all(params) };
        const info = stmt.run(params);
        return { rows: [], rowCount: info.changes };
      }
    };
  },
  isPostgres: false,
}));

function pushSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE runs (
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

    CREATE TABLE trends (
      date TEXT NOT NULL,
      project TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      total INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      flaky INTEGER NOT NULL DEFAULT 0,
      avg_duration_ms REAL,
      p95_duration_ms REAL,
      PRIMARY KEY (date, project, branch)
    );
  `);
}

function insertRun(
  sqlite: Database.Database,
  args: {
    id: string;
    finishedAt: string;
    total: number;
    passed: number;
    failed: number;
    flaky: number;
    durationMs: number | null;
    branch: string;
  },
): void {
  sqlite
    .prepare(`
      INSERT INTO runs (
        id, started_at, finished_at, status, total, passed, failed, flaky, duration_ms, branch
      ) VALUES (?, ?, ?, 'passed', ?, ?, ?, ?, ?, ?)
    `)
    .run(
      args.id,
      args.finishedAt,
      args.finishedAt,
      args.total,
      args.passed,
      args.failed,
      args.flaky,
      args.durationMs,
      args.branch,
    );
}

async function loadModule() {
  vi.resetModules();
  return import('../trend-backfill.js');
}

describe('trend-backfill service', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    pushSchema(sqlite);

    state.sqlite = sqlite;
    state.db = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('updateTrendsForDate', () => {
    it('sets avgDurationMs and p95DurationMs to null when all runs have null durationMs', async () => {
      insertRun(sqlite, {
        id: 'run-nodur',
        finishedAt: '2026-03-01T01:00:00.000Z',
        total: 5,
        passed: 5,
        failed: 0,
        flaky: 0,
        durationMs: null,
        branch: 'main',
      });

      const { updateTrendsForDate } = await loadModule();
      await updateTrendsForDate('2026-03-01', 'proj-nodur', 'main');

      const row = sqlite
        .prepare('SELECT avg_duration_ms, p95_duration_ms FROM trends WHERE date = ?')
        .get('2026-03-01') as { avg_duration_ms: number | null; p95_duration_ms: number | null };

      expect(row.avg_duration_ms).toBeNull();
      expect(row.p95_duration_ms).toBeNull();
    });

    it('falls back to main when branch is omitted and first run has null branch', async () => {
      // Insert a run with null branch
      sqlite
        .prepare(`INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, duration_ms, branch) VALUES (?, ?, ?, 'passed', ?, ?, ?, ?, ?, NULL)`)
        .run('run-nullbranch', '2026-03-02T01:00:00.000Z', '2026-03-02T01:00:00.000Z', 5, 5, 0, 0, 100);

      const { updateTrendsForDate } = await loadModule();
      await updateTrendsForDate('2026-03-02');

      const row = sqlite
        .prepare('SELECT branch FROM trends WHERE date = ?')
        .get('2026-03-02') as { branch: string };

      expect(row.branch).toBe('main');
    });

    it('returns without inserting when no runs finished on the date', async () => {
      const { updateTrendsForDate } = await loadModule();

      await updateTrendsForDate('2026-02-10');

      const rowCount = sqlite.prepare('SELECT COUNT(*) as c FROM trends').get() as { c: number };
      expect(rowCount.c).toBe(0);
    });

    it('aggregates totals and computes avg + p95 duration', async () => {
      insertRun(sqlite, {
        id: 'run-1',
        finishedAt: '2026-02-10T01:00:00.000Z',
        total: 10,
        passed: 9,
        failed: 1,
        flaky: 0,
        durationMs: 100,
        branch: 'feat/alpha',
      });
      insertRun(sqlite, {
        id: 'run-2',
        finishedAt: '2026-02-10T02:00:00.000Z',
        total: 20,
        passed: 18,
        failed: 1,
        flaky: 1,
        durationMs: 200,
        branch: 'feat/alpha',
      });
      insertRun(sqlite, {
        id: 'run-3',
        finishedAt: '2026-02-10T03:00:00.000Z',
        total: 30,
        passed: 25,
        failed: 4,
        flaky: 1,
        durationMs: 300,
        branch: 'feat/alpha',
      });
      insertRun(sqlite, {
        id: 'run-4',
        finishedAt: '2026-02-10T04:00:00.000Z',
        total: 40,
        passed: 39,
        failed: 0,
        flaky: 1,
        durationMs: 1000,
        branch: 'feat/alpha',
      });

      const { updateTrendsForDate } = await loadModule();
      await updateTrendsForDate('2026-02-10', 'proj-a', 'feat/alpha');

      const row = sqlite
        .prepare(
          'SELECT date, project, branch, total, passed, failed, flaky, avg_duration_ms, p95_duration_ms FROM trends WHERE date = ? AND project = ? AND branch = ?',
        )
        .get('2026-02-10', 'proj-a', 'feat/alpha') as {
        date: string;
        project: string;
        branch: string;
        total: number;
        passed: number;
        failed: number;
        flaky: number;
        avg_duration_ms: number;
        p95_duration_ms: number;
      };

      expect(row.total).toBe(100);
      expect(row.passed).toBe(91);
      expect(row.failed).toBe(6);
      expect(row.flaky).toBe(3);
      expect(row.avg_duration_ms).toBe(400);
      expect(row.p95_duration_ms).toBe(1000);
    });

    it('uses default project and first run branch when optional args are omitted', async () => {
      insertRun(sqlite, {
        id: 'run-main',
        finishedAt: '2026-02-11T01:00:00.000Z',
        total: 5,
        passed: 5,
        failed: 0,
        flaky: 0,
        durationMs: 80,
        branch: 'release/1.2.3',
      });

      const { updateTrendsForDate } = await loadModule();
      await updateTrendsForDate('2026-02-11');

      const row = sqlite
        .prepare('SELECT project, branch FROM trends WHERE date = ?')
        .get('2026-02-11') as { project: string; branch: string };

      expect(row.project).toBe('default');
      expect(row.branch).toBe('release/1.2.3');
    });

    it('upserts existing trend row on subsequent calls', async () => {
      insertRun(sqlite, {
        id: 'run-1',
        finishedAt: '2026-02-12T01:00:00.000Z',
        total: 10,
        passed: 8,
        failed: 2,
        flaky: 0,
        durationMs: 100,
        branch: 'main',
      });

      const { updateTrendsForDate } = await loadModule();
      await updateTrendsForDate('2026-02-12', 'proj-b', 'main');

      sqlite.prepare('UPDATE runs SET total = 50, passed = 49, failed = 1, flaky = 0, duration_ms = 900 WHERE id = ?').run('run-1');
      await updateTrendsForDate('2026-02-12', 'proj-b', 'main');

      const rows = sqlite
        .prepare('SELECT total, passed, failed, avg_duration_ms, p95_duration_ms FROM trends WHERE date = ? AND project = ? AND branch = ?')
        .all('2026-02-12', 'proj-b', 'main') as Array<{
        total: number;
        passed: number;
        failed: number;
        avg_duration_ms: number;
        p95_duration_ms: number;
      }>;

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ total: 50, passed: 49, failed: 1, avg_duration_ms: 900, p95_duration_ms: 900 });
    });
  });

  describe('backfillTrends', () => {
    it('calls date processing for each of the last N days', async () => {
      const whereMock = vi.fn().mockResolvedValue([]);
      const fromChain: FromChain = { where: whereMock };
      const fromMock = vi.fn().mockReturnValue(fromChain);
      const selectChain: SelectChain = { from: fromMock };
      const selectMock = vi.fn().mockReturnValue(selectChain);

      state.db = { select: selectMock };

      const { backfillTrends } = await loadModule();
      await backfillTrends(7);

      expect(whereMock).toHaveBeenCalledTimes(7);
    });

    it('defaults to 90 days when days argument is omitted', async () => {
      const whereMock = vi.fn().mockResolvedValue([]);
      const fromChain: FromChain = { where: whereMock };
      const fromMock = vi.fn().mockReturnValue(fromChain);
      const selectChain: SelectChain = { from: fromMock };
      const selectMock = vi.fn().mockReturnValue(selectChain);

      state.db = { select: selectMock };

      const { backfillTrends } = await loadModule();
      await backfillTrends();

      expect(whereMock).toHaveBeenCalledTimes(90);
    });

    it('continues processing dates even when an individual date throws', async () => {
      let call = 0;
      const whereMock = vi.fn().mockImplementation(async () => {
        call += 1;
        if (call === 3) {
          throw new Error('simulated per-date failure');
        }
        return [];
      });
      const fromChain: FromChain = { where: whereMock };
      const fromMock = vi.fn().mockReturnValue(fromChain);
      const selectChain: SelectChain = { from: fromMock };
      const selectMock = vi.fn().mockReturnValue(selectChain);

      state.db = { select: selectMock };

      const { backfillTrends } = await loadModule();
      await backfillTrends(5);

      expect(whereMock).toHaveBeenCalledTimes(5);
    });
  });
});
