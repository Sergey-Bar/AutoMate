import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateToPostgres } from './migrate.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function Pool() {
    return {
      query: mocks.query,
      end: mocks.end,
    };
  }),
}));

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'automate-migrate-'));
  mocks.query.mockReset();
  mocks.end.mockReset();
  mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
  mocks.end.mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function createFixtureDatabase(): string {
  const filePath = join(tempDir, 'fixture.sqlite');
  const db = new Database(filePath);

  db.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      total INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      failed INTEGER NOT NULL,
      flaky INTEGER NOT NULL,
      skipped INTEGER NOT NULL,
      duration_ms INTEGER,
      branch TEXT,
      commit_sha TEXT,
      commit_message TEXT,
      triggered_by TEXT,
      config TEXT,
      raw_args TEXT,
      source TEXT NOT NULL,
      gate_status TEXT,
      workspace_id TEXT,
      pr_number INTEGER,
      pr_branch TEXT,
      base_branch TEXT,
      commit_author TEXT
    );

    CREATE TABLE suites (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      parent_id TEXT,
      title TEXT NOT NULL,
      file TEXT,
      project TEXT
    );

    CREATE TABLE tests (
      id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      suite_id TEXT,
      title TEXT NOT NULL,
      file TEXT NOT NULL,
      line INTEGER,
      column INTEGER,
      stable_id TEXT,
      status TEXT NOT NULL,
      duration_ms INTEGER,
      tags TEXT,
      annotations TEXT,
      retry_count INTEGER,
      expected_status TEXT,
      worker_index INTEGER,
      PRIMARY KEY (id, run_id)
    );

    INSERT INTO runs VALUES (
      '11111111-1111-4111-8111-111111111111',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:02.000Z',
      'passed',
      1,
      1,
      0,
      0,
      0,
      2000,
      'main',
      'abc123',
      'initial',
      'manual',
      '{"retries":0}',
      '--project chromium',
      'live',
      'passed',
      'workspace-1',
      12,
      'feature/pr',
      'main',
      'Dev User'
    );

    INSERT INTO suites VALUES (
      'suite-1',
      '11111111-1111-4111-8111-111111111111',
      NULL,
      'checkout',
      'checkout.spec.ts',
      'chromium'
    );

    INSERT INTO tests VALUES (
      'test-1',
      '11111111-1111-4111-8111-111111111111',
      'suite-1',
      'can checkout',
      'checkout.spec.ts',
      10,
      2,
      'checkout-can-checkout',
      'passed',
      120,
      '["smoke"]',
      '[]',
      0,
      'passed',
      1
    );
  `);

  db.close();
  return filePath;
}

describe('migrateToPostgres', () => {
  it('imports SQLite fixture rows in foreign-key order', async () => {
    const from = createFixtureDatabase();

    const report = await migrateToPostgres({
      from,
      to: 'postgres://user:pass@localhost:5432/automate',
      dryRun: false,
      workspaceId: 'workspace-1',
    });

    expect(report.dryRun).toBe(false);
    expect(report.tables).toEqual([
      { table: 'runs', rowCount: 1, inserted: 1, failed: 0 },
      { table: 'suites', rowCount: 1, inserted: 1, failed: 0 },
      { table: 'tests', rowCount: 1, inserted: 1, failed: 0 },
    ]);
    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(
      mocks.query.mock.calls.map((call) => String(call[0]).match(/INSERT INTO "([^"]+)"/)?.[1]),
    ).toEqual(['runs', 'suites', 'tests']);
    expect(mocks.query.mock.calls[0]?.[1]).toContain('11111111-1111-4111-8111-111111111111');
    expect(mocks.query.mock.calls[0]?.[1]).toContainEqual({ retries: 0 });
    expect(mocks.query.mock.calls[2]?.[1]).toContainEqual(['smoke']);
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('prints a dry-run plan without writing to Postgres', async () => {
    const from = createFixtureDatabase();
    const log = vi.fn();

    const report = await migrateToPostgres({
      from,
      to: 'postgres://user:pass@localhost:5432/automate',
      dryRun: true,
      log,
    });

    expect(report.dryRun).toBe(true);
    expect(report.tables.map((table) => [table.table, table.rowCount])).toEqual([
      ['runs', 1],
      ['suites', 1],
      ['tests', 1],
    ]);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.end).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Dry run migration plan:');
    expect(log).toHaveBeenCalledWith('runs: 1 row');
  });

  it('uses ON CONFLICT DO NOTHING for idempotent inserts', async () => {
    const from = createFixtureDatabase();

    await migrateToPostgres({
      from,
      to: 'postgres://user:pass@localhost:5432/automate',
      dryRun: false,
      workspaceId: 'workspace-1',
    });

    expect(
      mocks.query.mock.calls.every((call) => String(call[0]).includes('ON CONFLICT DO NOTHING')),
    ).toBe(true);
  });

  it('batches inserts in groups of 100 rows', async () => {
    const from = join(tempDir, 'batch.sqlite');
    const db = new Database(from);
    db.exec(`
      CREATE TABLE known_failures (
        id TEXT PRIMARY KEY,
        test_title TEXT NOT NULL,
        test_file TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT
      );
    `);
    const insert = db.prepare('INSERT INTO known_failures VALUES (?, ?, ?, ?, ?, ?)');
    const transaction = db.transaction(() => {
      for (let index = 1; index <= 101; index += 1) {
        insert.run(
          `known-${index}`,
          `test ${index}`,
          'checkout.spec.ts',
          null,
          '2026-01-01T00:00:00.000Z',
          'qa',
        );
      }
    });
    transaction();
    db.close();

    await migrateToPostgres({
      from,
      to: 'postgres://user:pass@localhost:5432/automate',
      dryRun: false,
      workspaceId: 'workspace-1',
    });

    expect(mocks.query).toHaveBeenCalledTimes(2);
    // Seven columns since 0028: the six the source has, and the workspace.
    expect(mocks.query.mock.calls[0]?.[1]).toHaveLength(700);
    expect(mocks.query.mock.calls[1]?.[1]).toHaveLength(7);
  });

  it('omits absent optional source columns so PostgreSQL defaults can apply', async () => {
    const from = join(tempDir, 'partial.sqlite');
    const db = new Database(from);
    db.exec(`
      CREATE TABLE model_config (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO model_config VALUES (
        'default',
        'ollama',
        'llama3.1',
        'http://localhost:11434',
        '2026-01-01T00:00:00.000Z'
      );
    `);
    db.close();

    await migrateToPostgres({
      from,
      to: 'postgres://user:pass@localhost:5432/automate',
      dryRun: false,
      workspaceId: 'workspace-1',
    });

    expect(String(mocks.query.mock.calls[0]?.[0])).toBe(
      'INSERT INTO "model_config" ("id", "provider", "model", "endpoint", "updated_at", "workspace_id") VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
    );
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([
      'default',
      'ollama',
      'llama3.1',
      'http://localhost:11434',
      '2026-01-01T00:00:00.000Z',
      'workspace-1',
    ]);
  });

  it('fails loudly when SQLite source has unknown columns', async () => {
    const from = join(tempDir, 'bad.sqlite');
    const db = new Database(from);
    db.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        unexpected_column TEXT
      );
    `);
    db.close();

    await expect(
      migrateToPostgres({
        from,
        to: 'postgres://user:pass@localhost:5432/automate',
        dryRun: true,
      }),
    ).rejects.toThrow('Schema mismatch for runs: unknown columns unexpected_column');
  });
});

describe('migrateToPostgres refusals and row-level failures', () => {
  const TARGET = 'postgres://user:pass@localhost:5432/automate';

  function sqlite(name: string, sql: string): string {
    const filePath = join(tempDir, name);
    const db = new Database(filePath);
    db.exec(sql);
    db.close();
    return filePath;
  }

  const CONNECTOR_SQL = `
    CREATE TABLE connector_configs (
      id TEXT PRIMARY KEY, connector_name TEXT, enabled, credential_ref TEXT,
      settings, updated_at TEXT
    );
  `;

  it('refuses a source file that does not exist instead of creating one', async () => {
    const missing = join(tempDir, 'missing.sqlite');
    await expect(migrateToPostgres({ from: missing, to: TARGET, dryRun: true })).rejects.toThrow();
    expect(existsSync(missing)).toBe(false);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('refuses every blocked identity table by name before reading anything', async () => {
    const from = sqlite(
      'blocked.sqlite',
      'CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE saml_config (id TEXT PRIMARY KEY); CREATE TABLE runs (id TEXT PRIMARY KEY);',
    );
    await expect(migrateToPostgres({ from, to: TARGET, dryRun: false })).rejects.toThrow(
      'Blocked source tables require an approved transformation: users, saml_config',
    );
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.end).not.toHaveBeenCalled();
  });

  it('refuses a table that lacks one of its identity columns', async () => {
    const from = sqlite(
      'no-id.sqlite',
      'CREATE TABLE tests (id TEXT, title TEXT, file TEXT, status TEXT);',
    );
    await expect(migrateToPostgres({ from, to: TARGET, dryRun: true })).rejects.toThrow(
      'Schema mismatch for tests: missing id columns run_id',
    );
  });

  it('ignores source tables it has no mapping for', async () => {
    const from = sqlite(
      'unmapped.sqlite',
      `CREATE TABLE something_else (x TEXT); INSERT INTO something_else VALUES ('a');
       CREATE TABLE defect_categories (id TEXT PRIMARY KEY, name TEXT, color TEXT, created_at TEXT);`,
    );
    const log = vi.fn();
    const report = await migrateToPostgres({ from, to: TARGET, dryRun: true, log });
    expect(report.tables).toEqual([
      { table: 'defect_categories', rowCount: 0, inserted: 0, failed: 0 },
    ]);
    expect(log).toHaveBeenCalledWith('defect_categories: 0 rows');
  });

  it('reports a populated superseded table as skipped, rather than ignoring it silently', async () => {
    // 0030 dropped `results`, `blob_shards` and `api_keys`, so there is nowhere to write
    // them. A legacy file that holds rows in them must say so: an import that quietly
    // returns a clean report over rows it discarded is a data loss nobody was told of.
    const from = sqlite(
      'superseded.sqlite',
      `CREATE TABLE results (id TEXT PRIMARY KEY, test_id TEXT, run_id TEXT, status TEXT);
       INSERT INTO results VALUES ('r-1', 't-1', 'run-1', 'passed'), ('r-2', 't-1', 'run-1', 'failed');
       CREATE TABLE api_keys (id TEXT PRIMARY KEY, name TEXT, key_hash TEXT);
       INSERT INTO api_keys VALUES ('k-1', 'legacy', 'hash');
       CREATE TABLE blob_shards (id TEXT PRIMARY KEY);
       CREATE TABLE defect_categories (id TEXT PRIMARY KEY, name TEXT, color TEXT, created_at TEXT);`,
    );
    const log = vi.fn();
    const report = await migrateToPostgres({ from, to: TARGET, dryRun: true, log });

    expect(report.tables.map((entry) => entry.table)).toEqual(['defect_categories']);
    expect(report.skipped).toEqual([
      expect.objectContaining({ table: 'results', rowCount: 2 }),
      expect.objectContaining({ table: 'blob_shards', rowCount: 0 }),
      expect.objectContaining({ table: 'api_keys', rowCount: 1 }),
    ]);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^Skipped results: 2 rows .*canonical_run_results/),
    );
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('adds no skipped entry when the source has none of the superseded tables', async () => {
    const report = await migrateToPostgres({
      from: createFixtureDatabase(),
      to: TARGET,
      dryRun: true,
      log: vi.fn(),
    });
    expect(report.skipped).toBeUndefined();
  });

  it('logs through console.info when no log function is supplied', async () => {
    const from = createFixtureDatabase();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await migrateToPostgres({ from, to: TARGET, dryRun: true });
      expect(info.mock.calls.map((call) => call[0])).toEqual([
        'Dry run migration plan:',
        'runs: 1 row',
        'suites: 1 row',
        'tests: 1 row',
      ]);
    } finally {
      info.mockRestore();
    }
  });

  it('converts SQLite boolean encodings to booleans and keeps NULL as null', async () => {
    const from = sqlite(
      'booleans.sqlite',
      `${CONNECTOR_SQL}
       INSERT INTO connector_configs VALUES ('a', 'github', 1, NULL, NULL, 't');
       INSERT INTO connector_configs VALUES ('b', 'jira', 0, NULL, NULL, 't');
       INSERT INTO connector_configs VALUES ('c', 'slack', 'true', NULL, NULL, 't');
       INSERT INTO connector_configs VALUES ('d', 'x', '1', NULL, NULL, 't');
       INSERT INTO connector_configs VALUES ('e', 'y', 'yes', NULL, NULL, 't');
       INSERT INTO connector_configs VALUES ('f', 'z', NULL, NULL, '{"a":1}', 't');`,
    );
    await migrateToPostgres({
      from,
      to: TARGET,
      dryRun: false,
      workspaceId: 'workspace-1',
      log: vi.fn(),
    });

    const values = mocks.query.mock.calls[0]?.[1];
    expect(Array.isArray(values)).toBe(true);
    const rows: unknown[][] = [];
    for (let index = 0; index < 6; index += 1) {
      // Seven per row: the six source columns, then the workspace the import supplies.
      rows.push((values as unknown[]).slice(index * 7, index * 7 + 7));
    }
    // `enabled` is the third column, `settings` the fifth.
    expect(rows.map((row) => row[2])).toEqual([true, false, true, true, false, null]);
    expect(rows.map((row) => row[4])).toEqual([null, null, null, null, null, { a: 1 }]);
  });

  it('retries a failed batch row by row and records only the rows that fail', async () => {
    const from = sqlite(
      'partial-failure.sqlite',
      `CREATE TABLE defect_categories (id TEXT PRIMARY KEY, name TEXT, color TEXT, created_at TEXT);
       INSERT INTO defect_categories VALUES ('ok-1', 'a', '#fff', 't');
       INSERT INTO defect_categories VALUES ('bad', 'b', '#fff', 't');
       INSERT INTO defect_categories VALUES ('ok-2', 'c', '#fff', 't');`,
    );
    mocks.query.mockImplementation((_sql: string, values: unknown[]) => {
      if (values.length > 4) return Promise.reject(new Error('batch failed'));
      if (values[0] === 'bad') return Promise.reject(new Error('duplicate key value'));
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const log = vi.fn();

    const report = await migrateToPostgres({
      from,
      to: TARGET,
      dryRun: false,
      workspaceId: 'workspace-1',
      log,
    });

    expect(report.tables).toEqual([
      { table: 'defect_categories', rowCount: 3, inserted: 2, failed: 1 },
    ]);
    expect(report.errors).toEqual([
      { table: 'defect_categories', id: 'bad', error: 'duplicate key value' },
    ]);
    // One batch attempt, then one attempt per row.
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(log).toHaveBeenCalledWith('Migration completed with row errors:');
    expect(log).toHaveBeenCalledWith('defect_categories:bad duplicate key value');
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('records a row whose JSON column holds a blob, with a composite id', async () => {
    const from = sqlite(
      'blob.sqlite',
      `CREATE TABLE tests (id TEXT, run_id TEXT, title TEXT, file TEXT, status TEXT, tags);
       INSERT INTO tests VALUES ('t1', 'r1', 'x', 'f', 'passed', X'00FF');`,
    );
    const report = await migrateToPostgres({
      from,
      to: TARGET,
      dryRun: false,
      workspaceId: 'workspace-1',
      log: vi.fn(),
    });

    expect(report.errors).toEqual([
      { table: 'tests', id: 't1:r1', error: 'Expected JSON text in tags' },
    ]);
    expect(report.tables).toEqual([{ table: 'tests', rowCount: 1, inserted: 0, failed: 1 }]);
    // The value is rejected while building the statement, so nothing is sent.
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('records malformed JSON text as a row error', async () => {
    const from = sqlite(
      'bad-json.sqlite',
      `${CONNECTOR_SQL}
       INSERT INTO connector_configs VALUES ('c1', 'github', 1, NULL, '{not json', 't');`,
    );
    const report = await migrateToPostgres({
      from,
      to: TARGET,
      dryRun: false,
      workspaceId: 'workspace-1',
      log: vi.fn(),
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ table: 'connector_configs', id: 'c1' });
    expect(report.errors[0]?.error).toMatch(/JSON/);
  });

  it('names a NULL identity column as <null> in the error report', async () => {
    const from = sqlite(
      'null-id.sqlite',
      `CREATE TABLE trends (date TEXT, project TEXT, branch TEXT, total INTEGER);
       INSERT INTO trends VALUES ('2026-01-01', 'web', NULL, 3);`,
    );
    mocks.query.mockRejectedValue(new Error('null value in column "branch"'));
    const report = await migrateToPostgres({
      from,
      to: TARGET,
      dryRun: false,
      workspaceId: 'workspace-1',
      log: vi.fn(),
    });
    expect(report.errors).toEqual([
      { table: 'trends', id: '2026-01-01:web:<null>', error: 'null value in column "branch"' },
    ]);
  });

  it('counts a row skipped by ON CONFLICT as not inserted', async () => {
    const from = createFixtureDatabase();
    mocks.query.mockResolvedValue({ rows: [], rowCount: null });
    const report = await migrateToPostgres({
      from,
      to: TARGET,
      dryRun: false,
      workspaceId: 'workspace-1',
      log: vi.fn(),
    });
    expect(report.tables.map((entry) => entry.inserted)).toEqual([0, 0, 0]);
    expect(report.errors).toEqual([]);
  });

  it('records a non-Error rejection by its string form', async () => {
    const from = sqlite(
      'string-error.sqlite',
      `CREATE TABLE defect_categories (id TEXT PRIMARY KEY, name TEXT, color TEXT, created_at TEXT);
       INSERT INTO defect_categories VALUES ('d1', 'a', '#fff', 't');`,
    );
    mocks.query.mockRejectedValue('connection reset');
    const report = await migrateToPostgres({
      from,
      to: TARGET,
      dryRun: false,
      workspaceId: 'workspace-1',
      log: vi.fn(),
    });
    expect(report.errors).toEqual([
      { table: 'defect_categories', id: 'd1', error: 'connection reset' },
    ]);
  });

  it('keeps going table by table when every insert fails, then closes the pool', async () => {
    const from = createFixtureDatabase();
    mocks.query.mockRejectedValue(new Error('down'));
    const report = await migrateToPostgres({
      from,
      to: TARGET,
      dryRun: false,
      workspaceId: 'workspace-1',
      log: vi.fn(),
    });
    expect(report.errors.map((error) => error.table)).toEqual(['runs', 'suites', 'tests']);
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});

describe('migrateToPostgres and the workspace boundary (ledger MNT-17)', () => {
  const TARGET = 'postgres://user:pass@localhost:5432/automate';

  function sqlite(name: string, sql: string): string {
    const filePath = join(tempDir, name);
    const db = new Database(filePath);
    db.exec(sql);
    db.close();
    return filePath;
  }

  const KNOWN_FAILURE = `
    CREATE TABLE known_failures (
      id TEXT PRIMARY KEY, test_title TEXT NOT NULL, test_file TEXT NOT NULL,
      comment TEXT, created_at TEXT NOT NULL, created_by TEXT
    );
    INSERT INTO known_failures VALUES ('k1', 't', 'f', NULL, '2026-01-01T00:00:00.000Z', 'qa');
  `;

  it('stamps a workspace-scoped row the source never scoped with the target workspace', async () => {
    // The legacy SQLite schema has no `workspace_id` on most tables, and since 0028 every
    // one of them is NOT NULL with a key onto `workspaces`. Copying the source columns
    // alone would have failed every row of every such table on a real apply.
    const from = sqlite('scoped.sqlite', KNOWN_FAILURE);
    const report = await migrateToPostgres({
      from,
      to: TARGET,
      dryRun: false,
      workspaceId: 'ws-target',
      log: vi.fn(),
    });
    expect(report.errors).toEqual([]);
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain('"workspace_id"');
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([
      'k1',
      't',
      'f',
      null,
      '2026-01-01T00:00:00.000Z',
      'qa',
      'ws-target',
    ]);
  });

  it('copies a source workspace_id that already names the target, and refuses one that does not', async () => {
    // A legacy source that did scope a table keeps its own column, read rather than
    // replaced, so the same rule decides it: equal is copied, different is an error.
    const from = sqlite(
      'scoped-source.sqlite',
      `CREATE TABLE quarantine (
         id TEXT PRIMARY KEY, test_title TEXT, test_file TEXT, quarantined_at TEXT, workspace_id TEXT
       );
       INSERT INTO quarantine VALUES ('q1', 't', 'f', 't', 'ws-target');
       INSERT INTO quarantine VALUES ('q2', 't', 'f', 't', 'ws-other');`,
    );
    const report = await migrateToPostgres({
      from,
      to: TARGET,
      dryRun: false,
      workspaceId: 'ws-target',
      log: vi.fn(),
    });
    expect(report.errors).toEqual([
      { table: 'quarantine', id: 'q2', error: expect.stringMatching(/ws-other/) },
    ]);
    expect(report.tables).toEqual([{ table: 'quarantine', rowCount: 2, inserted: 1, failed: 1 }]);
  });

  it('refuses to write a workspace-scoped table with no target workspace', async () => {
    const from = sqlite('unscoped.sqlite', KNOWN_FAILURE);
    await expect(
      migrateToPostgres({ from, to: TARGET, dryRun: false, log: vi.fn() }),
    ).rejects.toThrow(/workspace/);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('records a run whose legacy workspace is not the target, rather than moving it', async () => {
    const from = createFixtureDatabase();
    const report = await migrateToPostgres({
      from,
      to: TARGET,
      dryRun: false,
      workspaceId: 'someone-else',
      log: vi.fn(),
    });
    expect(report.errors).toContainEqual({
      table: 'runs',
      id: '11111111-1111-4111-8111-111111111111',
      error: expect.stringMatching(/workspace-1/),
    });
  });

  it('folds a legacy audit tenant_id into workspace_id, and refuses one that disagrees', async () => {
    const from = sqlite(
      'audit.sqlite',
      `CREATE TABLE audit_events (
         id TEXT PRIMARY KEY, timestamp TEXT, actor_id TEXT, action TEXT, tenant_id TEXT,
         created_at TEXT
       );
       INSERT INTO audit_events VALUES ('a1', 't', 'u', 'x', NULL, 't');
       INSERT INTO audit_events VALUES ('a2', 't', 'u', 'x', 'ws-target', 't');
       INSERT INTO audit_events VALUES ('a3', 't', 'u', 'x', 'elsewhere', 't');`,
    );
    const report = await migrateToPostgres({
      from,
      to: TARGET,
      dryRun: false,
      workspaceId: 'ws-target',
      log: vi.fn(),
    });
    expect(String(mocks.query.mock.calls[0]?.[0])).not.toContain('"tenant_id"');
    expect(report.errors).toEqual([
      { table: 'audit_events', id: 'a3', error: expect.stringMatching(/elsewhere/) },
    ]);
  });
});
