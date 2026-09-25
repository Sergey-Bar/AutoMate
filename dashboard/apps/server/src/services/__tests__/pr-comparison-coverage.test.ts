import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

const sqlite = new Database(':memory:');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    status TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    passed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    flaky INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    workspace_id TEXT,
    branch TEXT
  );

  CREATE TABLE IF NOT EXISTS tests (
    id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    title TEXT NOT NULL,
    file TEXT NOT NULL,
    stable_id TEXT,
    status TEXT NOT NULL,
    PRIMARY KEY (id, run_id)
  );

  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    test_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    error_stack TEXT
  );

  CREATE TABLE IF NOT EXISTS quarantine (
    id TEXT PRIMARY KEY,
    test_title TEXT NOT NULL,
    test_file TEXT NOT NULL,
    quarantined_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'approved'
  );
`);

const testDb = drizzle(sqlite, { schema });

vi.mock('../../db/client.js', () => ({
  get db() {
    return testDb;
  },
  get sqlite() {
    return sqlite;
  },
  get poolConnection() {
    return {
      query: async (sql: string, params: unknown[] = []) => {
        // Convert $1 to ? for SQLite
        const sqliteSql = sql.replace(/\$(\d+)/g, '?');
        const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
        const stmt = sqlite.prepare(sqliteSql);
        if (isSelect) {
          return { rows: stmt.all(params) };
        } else {
          const info = stmt.run(params);
          return { rows: [], rowCount: info.changes };
        }
      },
    };
  },
}));

import { compareRunToBase, generatePrCommentMarkdown, resolveBaseRun } from '../pr-comparison.js';

function insertRun(id: string, startedAt: string, status: string, branch: string, workspaceId: string | null = null) {
  sqlite
    .prepare(
      `INSERT INTO runs (id, started_at, status, branch, workspace_id, total, passed, failed, flaky, skipped)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0)`,
    )
    .run(id, startedAt, status, branch, workspaceId);
}

function insertTest(row: {
  id: string;
  runId: string;
  title: string;
  file: string;
  stableId: string | null;
  status: string;
}) {
  sqlite
    .prepare('INSERT INTO tests (id, run_id, title, file, stable_id, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, row.runId, row.title, row.file, row.stableId, row.status);
}

beforeEach(() => {
  sqlite.exec('DELETE FROM results');
  sqlite.exec('DELETE FROM tests');
  sqlite.exec('DELETE FROM quarantine');
  sqlite.exec('DELETE FROM runs');
});

afterAll(() => {
  sqlite.close();
});

describe('pr-comparison coverage', () => {
  it('resolveBaseRun returns most recent matching run and honors workspace filter', async () => {
    insertRun('run-old', '2026-01-01T00:00:00.000Z', 'passed', 'main', 'ws-1');
    insertRun('run-new', '2026-01-02T00:00:00.000Z', 'failed', 'main', 'ws-1');
    insertRun('run-other-workspace', '2026-01-03T00:00:00.000Z', 'passed', 'main', 'ws-2');
    insertRun('run-running', '2026-01-04T00:00:00.000Z', 'running', 'main', 'ws-1');
    insertRun('run-other-branch', '2026-01-05T00:00:00.000Z', 'passed', 'develop', 'ws-1');

    const withWorkspace = await resolveBaseRun('main', 'ws-1');
    const noWorkspace = await resolveBaseRun('main');
    const noMatch = await resolveBaseRun('release');

    expect(withWorkspace).toBe('run-new');
    expect(noWorkspace).toBe('run-other-workspace');
    expect(noMatch).toBeNull();
  });

  it('compareRunToBase handles fallback key, error lookup, and quarantine ignoring', async () => {
    const prRunId = 'pr-1';
    const baseRunId = 'base-1';

    insertTest({
      id: 'p1',
      runId: prRunId,
      title: 'regression fail',
      file: 'tests/a.spec.ts',
      stableId: 'stable-regress',
      status: 'failed',
    });
    insertTest({
      id: 'p2',
      runId: prRunId,
      title: 'now passing',
      file: 'tests/b.spec.ts',
      stableId: 'stable-fixed',
      status: 'passed',
    });
    insertTest({
      id: 'p3',
      runId: prRunId,
      title: 'brand new test',
      file: 'tests/c.spec.ts',
      stableId: null,
      status: 'skipped',
    });
    insertTest({
      id: 'p4',
      runId: prRunId,
      title: 'quarantined fail',
      file: 'tests/q.spec.ts',
      stableId: 'stable-quarantine',
      status: 'failed',
    });

    insertTest({
      id: 'b1',
      runId: baseRunId,
      title: 'regression fail',
      file: 'tests/a.spec.ts',
      stableId: 'stable-regress',
      status: 'passed',
    });
    insertTest({
      id: 'b2',
      runId: baseRunId,
      title: 'now passing',
      file: 'tests/b.spec.ts',
      stableId: 'stable-fixed',
      status: 'failed',
    });
    insertTest({
      id: 'b3',
      runId: baseRunId,
      title: 'quarantined fail',
      file: 'tests/q.spec.ts',
      stableId: 'stable-quarantine',
      status: 'passed',
    });

    sqlite
      .prepare('INSERT INTO results (id, test_id, run_id, status, error_message, error_stack) VALUES (?, ?, ?, ?, ?, ?)')
      .run('r1', 'p1', prRunId, 'failed', 'assert failed', null);
    sqlite
      .prepare('INSERT INTO results (id, test_id, run_id, status, error_message, error_stack) VALUES (?, ?, ?, ?, ?, ?)')
      .run('r2', 'p1', prRunId, 'failed', 'should be ignored duplicate', null);
    sqlite
      .prepare('INSERT INTO results (id, test_id, run_id, status, error_message, error_stack) VALUES (?, ?, ?, ?, ?, ?)')
      .run('r3', 'p4', prRunId, 'failed', null, null);

    sqlite
      .prepare('INSERT INTO quarantine (id, test_title, test_file, quarantined_at) VALUES (?, ?, ?, ?)')
      .run('q1', 'quarantined fail', 'tests/q.spec.ts', '2023-11-14T22:13:20.000Z');

    const result = await compareRunToBase(prRunId, baseRunId, { ignoreQuarantined: true });

    expect(result.newFailures).toEqual([
      {
        stableId: 'stable-regress',
        title: 'regression fail',
        file: 'tests/a.spec.ts',
        error: 'assert failed',
      },
    ]);
    expect(result.fixedTests).toEqual([
      {
        stableId: 'stable-fixed',
        title: 'now passing',
        file: 'tests/b.spec.ts',
      },
    ]);
    expect(result.newTests).toEqual([
      {
        stableId: 'tests/c.spec.ts::brand new test',
        title: 'brand new test',
        file: 'tests/c.spec.ts',
        status: 'skipped',
      },
    ]);
    expect(result.flakyIgnored).toEqual([
      {
        stableId: 'stable-quarantine',
        title: 'quarantined fail',
        file: 'tests/q.spec.ts',
      },
    ]);
    expect(result.summary).toEqual({
      totalPrTests: 4,
      totalBaseTests: 3,
      newFailureCount: 1,
      fixedCount: 1,
      newTestCount: 1,
    });
  });

  it('generatePrCommentMarkdown includes truncation markers, escaping, and dashboard link', () => {
    const comparison = {
      newFailures: Array.from({ length: 21 }).map((_, i) => ({
        stableId: `f-${i}`,
        title: `failed-${i}`,
        file: `tests/f-${i}.spec.ts`,
        error: i === 0 ? 'bad|pipe\nwith newline' : `error-${i}`,
      })),
      fixedTests: Array.from({ length: 11 }).map((_, i) => ({
        stableId: `x-${i}`,
        title: `fixed-${i}`,
        file: `tests/fixed-${i}.spec.ts`,
      })),
      newTests: Array.from({ length: 11 }).map((_, i) => ({
        stableId: `n-${i}`,
        title: `new-${i}`,
        file: `tests/new-${i}.spec.ts`,
        status: 'passed',
      })),
      flakyIgnored: [{ stableId: 'q-1', title: 'ignored', file: 'tests/ignored.spec.ts' }],
      summary: {
        totalPrTests: 40,
        totalBaseTests: 38,
        newFailureCount: 21,
        fixedCount: 11,
        newTestCount: 11,
      },
    };

    const markdown = generatePrCommentMarkdown(comparison, {
      prNumber: 99,
      runId: 'run-99',
      dashboardUrl: 'http://localhost:4000',
    });

    expect(markdown).toContain('## ❌ Playwright PR Test Report');
    expect(markdown).toContain('_...and 1 more_');
    expect(markdown).toContain('bad\\|pipe with newline');
    expect(markdown).toContain('### ⚠️ Quarantined (Ignored)');
    expect(markdown).toContain('[📊 View in Dashboard](http://localhost:4000/runs/run-99)');
  });

  it('generatePrCommentMarkdown emits no-failure note when there are no regressions', () => {
    const markdown = generatePrCommentMarkdown(
      {
        newFailures: [],
        fixedTests: [],
        newTests: [],
        flakyIgnored: [],
        summary: {
          totalPrTests: 2,
          totalBaseTests: 2,
          newFailureCount: 0,
          fixedCount: 0,
          newTestCount: 0,
        },
      },
      { prNumber: 1, runId: 'run-1' },
    );

    expect(markdown).toContain('## ✅ Playwright PR Test Report');
    expect(markdown).toContain('No new test failures introduced in this PR');
    expect(markdown).not.toContain('View in Dashboard');
  });
});
