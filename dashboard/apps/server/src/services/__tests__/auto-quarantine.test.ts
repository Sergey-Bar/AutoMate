import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  sqlite: undefined as Database.Database | undefined,
  config: {
    enabled: true,
    flakyThreshold: 3,
    lookbackRuns: 5,
  },
}));

vi.mock('../../routes/settings.js', () => ({
  getAutoQuarantineConfig: vi.fn(() => state.config),
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

    CREATE TABLE suites (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      parent_id TEXT,
      title TEXT NOT NULL,
      file TEXT,
      project TEXT
    );

    CREATE TABLE tests (
      id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      suite_id TEXT REFERENCES suites(id),
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

    CREATE TABLE quarantine (
      id TEXT PRIMARY KEY,
      test_title TEXT NOT NULL,
      test_file TEXT NOT NULL,
      reason TEXT,
      quarantined_at TEXT NOT NULL,
      quarantined_by TEXT DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'approved',
      flakiness_category TEXT,
      category_confidence REAL,
      category_evidence TEXT,
      resolved_at TEXT,
      resolution_type TEXT,
      ttf_ms INTEGER
    );

    CREATE TABLE results (
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
  `);
}

function insertRun(sqlite: Database.Database, id: string, startedAt: string): void {
  sqlite
    .prepare(`INSERT INTO runs (id, started_at, status, finished_at) VALUES (?, ?, 'passed', ?)`)
    .run(id, startedAt, startedAt);
}

function insertTest(
  sqlite: Database.Database,
  runId: string,
  id: string,
  stableId: string,
  title: string,
  file: string,
  status: 'flaky' | 'passed' | 'failed',
): void {
  sqlite
    .prepare(`
      INSERT INTO tests (id, run_id, title, file, stable_id, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(id, runId, title, file, stableId, status);
}

async function loadModule() {
  vi.resetModules();
  return import('../auto-quarantine.js');
}

describe('autoQuarantineCheck', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    pushSchema(sqlite);

    state.sqlite = sqlite;
    state.db = drizzle(sqlite, { schema });
    state.config = { enabled: true, flakyThreshold: 3, lookbackRuns: 5 };
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns [] when no runs exist', async () => {
    const { autoQuarantineCheck } = await loadModule();
    await expect(autoQuarantineCheck()).resolves.toEqual([]);
  });

  it('returns [] when no flaky tests exist', async () => {
    insertRun(sqlite, 'run-1', '2026-01-01T10:00:00.000Z');
    insertRun(sqlite, 'run-2', '2026-01-02T10:00:00.000Z');
    insertRun(sqlite, 'run-3', '2026-01-03T10:00:00.000Z');

    insertTest(sqlite, 'run-1', 't-1', 'stable-login', 'login works', 'tests/auth.spec.ts', 'passed');
    insertTest(sqlite, 'run-2', 't-2', 'stable-login', 'login works', 'tests/auth.spec.ts', 'failed');
    insertTest(sqlite, 'run-3', 't-3', 'stable-login', 'login works', 'tests/auth.spec.ts', 'passed');

    const { autoQuarantineCheck } = await loadModule();
    await expect(autoQuarantineCheck()).resolves.toEqual([]);
  });

  it('returns [] when flaky count is below threshold', async () => {
    insertRun(sqlite, 'run-1', '2026-01-01T10:00:00.000Z');
    insertRun(sqlite, 'run-2', '2026-01-02T10:00:00.000Z');
    insertRun(sqlite, 'run-3', '2026-01-03T10:00:00.000Z');

    insertTest(sqlite, 'run-1', 't-1', 'stable-search', 'search works', 'tests/search.spec.ts', 'flaky');
    insertTest(sqlite, 'run-2', 't-2', 'stable-search', 'search works', 'tests/search.spec.ts', 'passed');
    insertTest(sqlite, 'run-3', 't-3', 'stable-search', 'search works', 'tests/search.spec.ts', 'flaky');

    const { autoQuarantineCheck } = await loadModule();
    await expect(autoQuarantineCheck()).resolves.toEqual([]);
  });

  it('returns quarantined test titles when flaky count meets threshold', async () => {
    for (let i = 1; i <= 5; i += 1) {
      insertRun(sqlite, `run-${i}`, `2026-01-0${i}T10:00:00.000Z`);
    }

    insertTest(sqlite, 'run-1', 't-1', 'stable-checkout', 'checkout flow', 'tests/checkout.spec.ts', 'flaky');
    insertTest(sqlite, 'run-2', 't-2', 'stable-checkout', 'checkout flow', 'tests/checkout.spec.ts', 'flaky');
    insertTest(sqlite, 'run-3', 't-3', 'stable-checkout', 'checkout flow', 'tests/checkout.spec.ts', 'flaky');

    const { autoQuarantineCheck } = await loadModule();
    await expect(autoQuarantineCheck()).resolves.toEqual(['checkout flow']);
  });

  it('does not re-quarantine already quarantined test titles', async () => {
    insertRun(sqlite, 'run-1', '2026-01-01T10:00:00.000Z');
    insertRun(sqlite, 'run-2', '2026-01-02T10:00:00.000Z');
    insertRun(sqlite, 'run-3', '2026-01-03T10:00:00.000Z');

    insertTest(sqlite, 'run-1', 't-1', 'stable-cart', 'cart updates', 'tests/cart.spec.ts', 'flaky');
    insertTest(sqlite, 'run-2', 't-2', 'stable-cart', 'cart updates', 'tests/cart.spec.ts', 'flaky');
    insertTest(sqlite, 'run-3', 't-3', 'stable-cart', 'cart updates', 'tests/cart.spec.ts', 'flaky');

    sqlite
      .prepare(
        'INSERT INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        randomUUID(),
        'cart updates',
        'tests/cart.spec.ts',
        'previous quarantine',
        '2023-11-14T22:13:20.000Z',
        'manual',
      );

    const { autoQuarantineCheck } = await loadModule();
    await expect(autoQuarantineCheck()).resolves.toEqual([]);

    const count = sqlite.prepare('SELECT COUNT(*) as c FROM quarantine WHERE test_title = ?').get('cart updates') as {
      c: number;
    };
    expect(count.c).toBe(1);
  });

  it('inserts quarantine record with expected reason and quarantinedBy=system', async () => {
    insertRun(sqlite, 'run-1', '2026-01-01T10:00:00.000Z');
    insertRun(sqlite, 'run-2', '2026-01-02T10:00:00.000Z');
    insertRun(sqlite, 'run-3', '2026-01-03T10:00:00.000Z');
    insertRun(sqlite, 'run-4', '2026-01-04T10:00:00.000Z');
    insertRun(sqlite, 'run-5', '2026-01-05T10:00:00.000Z');

    insertTest(sqlite, 'run-1', 't-1', 'stable-payment', 'payment retries', 'tests/payments.spec.ts', 'flaky');
    insertTest(sqlite, 'run-2', 't-2', 'stable-payment', 'payment retries', 'tests/payments.spec.ts', 'flaky');
    insertTest(sqlite, 'run-3', 't-3', 'stable-payment', 'payment retries', 'tests/payments.spec.ts', 'flaky');

    const { autoQuarantineCheck } = await loadModule();
    await autoQuarantineCheck();

    const row = sqlite
      .prepare('SELECT test_title, test_file, reason, quarantined_by FROM quarantine WHERE test_title = ?')
      .get('payment retries') as {
      test_title: string;
      test_file: string;
      reason: string;
      quarantined_by: string;
    };

    expect(row.test_title).toBe('payment retries');
    expect(row.test_file).toBe('tests/payments.spec.ts');
    expect(row.reason).toContain('flaked 3/5 recent runs');
    expect(row.quarantined_by).toBe('system');
  });

  it('handles multiple flaky tests in a single run of the checker', async () => {
    insertRun(sqlite, 'run-1', '2026-01-01T10:00:00.000Z');
    insertRun(sqlite, 'run-2', '2026-01-02T10:00:00.000Z');
    insertRun(sqlite, 'run-3', '2026-01-03T10:00:00.000Z');

    insertTest(sqlite, 'run-1', 'a-1', 'stable-a', 'a title', 'tests/a.spec.ts', 'flaky');
    insertTest(sqlite, 'run-2', 'a-2', 'stable-a', 'a title', 'tests/a.spec.ts', 'flaky');
    insertTest(sqlite, 'run-3', 'a-3', 'stable-a', 'a title', 'tests/a.spec.ts', 'flaky');

    insertTest(sqlite, 'run-1', 'b-1', 'stable-b', 'b title', 'tests/b.spec.ts', 'flaky');
    insertTest(sqlite, 'run-2', 'b-2', 'stable-b', 'b title', 'tests/b.spec.ts', 'flaky');
    insertTest(sqlite, 'run-3', 'b-3', 'stable-b', 'b title', 'tests/b.spec.ts', 'flaky');

    const { autoQuarantineCheck } = await loadModule();
    const quarantined = await autoQuarantineCheck();

    expect(new Set(quarantined)).toEqual(new Set(['a title', 'b title']));
  });

  it('only evaluates flaky counts within the configured last N runs', async () => {
    state.config = { enabled: true, flakyThreshold: 2, lookbackRuns: 3 };

    insertRun(sqlite, 'run-1', '2026-01-01T10:00:00.000Z');
    insertRun(sqlite, 'run-2', '2026-01-02T10:00:00.000Z');
    insertRun(sqlite, 'run-3', '2026-01-03T10:00:00.000Z');
    insertRun(sqlite, 'run-4', '2026-01-04T10:00:00.000Z');
    insertRun(sqlite, 'run-5', '2026-01-05T10:00:00.000Z');

    // Older than lookback (run-1, run-2): should be ignored
    insertTest(sqlite, 'run-1', 'old-1', 'stable-old', 'old flaky test', 'tests/old.spec.ts', 'flaky');
    insertTest(sqlite, 'run-2', 'old-2', 'stable-old', 'old flaky test', 'tests/old.spec.ts', 'flaky');

    // Inside lookback (run-3, run-4, run-5): should be considered
    insertTest(sqlite, 'run-4', 'new-1', 'stable-new', 'new flaky test', 'tests/new.spec.ts', 'flaky');
    insertTest(sqlite, 'run-5', 'new-2', 'stable-new', 'new flaky test', 'tests/new.spec.ts', 'flaky');

    const { autoQuarantineCheck } = await loadModule();
    const quarantined = await autoQuarantineCheck();

    expect(quarantined).toEqual(['new flaky test']);
  });

  it('classifies quarantined test using recent error messages', async () => {
    insertRun(sqlite, 'run-1', '2026-01-01T10:00:00.000Z');
    insertRun(sqlite, 'run-2', '2026-01-02T10:00:00.000Z');
    insertRun(sqlite, 'run-3', '2026-01-03T10:00:00.000Z');

    insertTest(sqlite, 'run-1', 'cls-1', 'stable-cls', 'classified test', 'tests/cls.spec.ts', 'flaky');
    insertTest(sqlite, 'run-2', 'cls-2', 'stable-cls', 'classified test', 'tests/cls.spec.ts', 'flaky');
    insertTest(sqlite, 'run-3', 'cls-3', 'stable-cls', 'classified test', 'tests/cls.spec.ts', 'flaky');

    // Insert a result with a timing error message for this test
    sqlite
      .prepare(
        `INSERT INTO results (id, test_id, run_id, retry, status, started_at, error_message)
         VALUES (?, ?, ?, 0, 'failed', ?, ?)`,
      )
      .run('res-1', 'cls-1', 'run-1', '2026-01-01T10:00:00.000Z', 'Element timed out waiting');

    const { autoQuarantineCheck } = await loadModule();
    await autoQuarantineCheck();

    const row = sqlite
      .prepare('SELECT flakiness_category, category_confidence FROM quarantine WHERE test_title = ?')
      .get('classified test') as { flakiness_category: string | null; category_confidence: number | null };

    expect(row.flakiness_category).toBe('timing');
    expect(row.category_confidence).toBeGreaterThan(0);
  });
});

describe('autoRecoveryCheck', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    pushSchema(sqlite);

    state.sqlite = sqlite;
    state.db = drizzle(sqlite, { schema });
    state.config = { enabled: true, flakyThreshold: 3, lookbackRuns: 5 };
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns [] when no quarantine entries exist', async () => {
    const { autoRecoveryCheck } = await loadModule();
    await expect(autoRecoveryCheck()).resolves.toEqual([]);
  });

  it('returns [] when no tests have recent results', async () => {
    sqlite
      .prepare(
        'INSERT INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), 'orphan test', 'tests/orphan.spec.ts', 'flaky', '2026-01-01T00:00:00.000Z', 'system', 'approved');

    const { autoRecoveryCheck } = await loadModule();
    await expect(autoRecoveryCheck()).resolves.toEqual([]);
  });

  it('returns [] when test has fewer than 5 recent runs', async () => {
    sqlite
      .prepare(
        'INSERT INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), 'sparse test', 'tests/sparse.spec.ts', 'flaky', '2026-01-01T00:00:00.000Z', 'system', 'approved');

    insertRun(sqlite, 'run-1', '2026-01-02T10:00:00.000Z');
    insertRun(sqlite, 'run-2', '2026-01-03T10:00:00.000Z');
    insertRun(sqlite, 'run-3', '2026-01-04T10:00:00.000Z');

    insertTest(sqlite, 'run-1', 't-1', 'stable-sparse', 'sparse test', 'tests/sparse.spec.ts', 'passed');
    insertTest(sqlite, 'run-2', 't-2', 'stable-sparse', 'sparse test', 'tests/sparse.spec.ts', 'passed');
    insertTest(sqlite, 'run-3', 't-3', 'stable-sparse', 'sparse test', 'tests/sparse.spec.ts', 'passed');

    const { autoRecoveryCheck } = await loadModule();
    await expect(autoRecoveryCheck()).resolves.toEqual([]);
  });

  it('returns [] when test has 5 runs but not all passed', async () => {
    sqlite
      .prepare(
        'INSERT INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), 'partial test', 'tests/partial.spec.ts', 'flaky', '2026-01-01T00:00:00.000Z', 'system', 'approved');

    for (let i = 1; i <= 5; i++) {
      insertRun(sqlite, `run-${i}`, `2026-01-0${i}T10:00:00.000Z`);
    }
    insertTest(sqlite, 'run-1', 'p-1', 'stable-partial', 'partial test', 'tests/partial.spec.ts', 'passed');
    insertTest(sqlite, 'run-2', 'p-2', 'stable-partial', 'partial test', 'tests/partial.spec.ts', 'passed');
    insertTest(sqlite, 'run-3', 'p-3', 'stable-partial', 'partial test', 'tests/partial.spec.ts', 'passed');
    insertTest(sqlite, 'run-4', 'p-4', 'stable-partial', 'partial test', 'tests/partial.spec.ts', 'passed');
    insertTest(sqlite, 'run-5', 'p-5', 'stable-partial', 'partial test', 'tests/partial.spec.ts', 'failed');

    const { autoRecoveryCheck } = await loadModule();
    await expect(autoRecoveryCheck()).resolves.toEqual([]);
  });

  it('resolves test after 5 consecutive passes', async () => {
    const quarantineId = randomUUID();
    const quarantinedAt = '2026-01-01T00:00:00.000Z';
    sqlite
      .prepare(
        'INSERT INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(quarantineId, 'recovered test', 'tests/recovered.spec.ts', 'flaky', quarantinedAt, 'system', 'approved');

    for (let i = 1; i <= 5; i++) {
      insertRun(sqlite, `rec-run-${i}`, `2026-01-0${i}T10:00:00.000Z`);
    }
    for (let i = 1; i <= 5; i++) {
      insertTest(sqlite, `rec-run-${i}`, `rec-t-${i}`, 'stable-recovered', 'recovered test', 'tests/recovered.spec.ts', 'passed');
    }

    const { autoRecoveryCheck } = await loadModule();
    const result = await autoRecoveryCheck();

    expect(result).toEqual(['recovered test']);

    const row = sqlite
      .prepare('SELECT resolved_at, resolution_type, ttf_ms FROM quarantine WHERE id = ?')
      .get(quarantineId) as { resolved_at: string | null; resolution_type: string | null; ttf_ms: number | null };

    expect(row.resolved_at).not.toBeNull();
    expect(row.resolution_type).toBe('auto_recovery');
    expect(row.ttf_ms).toBeGreaterThan(0);
  });

  it('does not re-resolve already-resolved entries', async () => {
    const resolvedAt = '2026-01-10T00:00:00.000Z';
    sqlite
      .prepare(
        'INSERT INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by, status, resolved_at, resolution_type, ttf_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        randomUUID(),
        'already resolved test',
        'tests/resolved.spec.ts',
        'flaky',
        '2026-01-01T00:00:00.000Z',
        'system',
        'approved',
        resolvedAt,
        'auto_recovery',
        100000,
      );

    for (let i = 1; i <= 5; i++) {
      insertRun(sqlite, `ar-run-${i}`, `2026-01-1${i}T10:00:00.000Z`);
    }
    for (let i = 1; i <= 5; i++) {
      insertTest(sqlite, `ar-run-${i}`, `ar-t-${i}`, 'stable-ar', 'already resolved test', 'tests/resolved.spec.ts', 'passed');
    }

    const { autoRecoveryCheck } = await loadModule();
    const result = await autoRecoveryCheck();

    expect(result).not.toContain('already resolved test');
  });

  it('resolves multiple quarantined tests independently', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    sqlite
      .prepare(
        'INSERT INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id1, 'multi test A', 'tests/multi-a.spec.ts', 'flaky', '2026-01-01T00:00:00.000Z', 'system', 'approved');
    sqlite
      .prepare(
        'INSERT INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id2, 'multi test B', 'tests/multi-b.spec.ts', 'flaky', '2026-01-01T00:00:00.000Z', 'system', 'approved');

    for (let i = 1; i <= 5; i++) {
      insertRun(sqlite, `multi-run-${i}`, `2026-01-0${i}T10:00:00.000Z`);
    }
    // test A: all 5 passed — should recover
    for (let i = 1; i <= 5; i++) {
      insertTest(sqlite, `multi-run-${i}`, `ma-t-${i}`, 'stable-ma', 'multi test A', 'tests/multi-a.spec.ts', 'passed');
    }
    // test B: only 3 runs — should NOT recover
    insertTest(sqlite, 'multi-run-1', 'mb-t-1', 'stable-mb', 'multi test B', 'tests/multi-b.spec.ts', 'passed');
    insertTest(sqlite, 'multi-run-2', 'mb-t-2', 'stable-mb', 'multi test B', 'tests/multi-b.spec.ts', 'passed');
    insertTest(sqlite, 'multi-run-3', 'mb-t-3', 'stable-mb', 'multi test B', 'tests/multi-b.spec.ts', 'passed');

    const { autoRecoveryCheck } = await loadModule();
    const result = await autoRecoveryCheck();

    expect(result).toContain('multi test A');
    expect(result).not.toContain('multi test B');
  });
});
