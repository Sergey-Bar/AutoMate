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
    });

    expect(report.dryRun).toBe(false);
    expect(report.tables).toEqual([
      { table: 'runs', rowCount: 1, inserted: 1, failed: 0 },
      { table: 'suites', rowCount: 1, inserted: 1, failed: 0 },
      { table: 'tests', rowCount: 1, inserted: 1, failed: 0 },
    ]);
    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(mocks.query.mock.calls.map((call) => String(call[0]).match(/INSERT INTO "([^"]+)"/)?.[1])).toEqual([
      'runs',
      'suites',
      'tests',
    ]);
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
    });

    expect(mocks.query.mock.calls.every((call) => String(call[0]).includes('ON CONFLICT DO NOTHING'))).toBe(true);
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
    });

    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[0]?.[1]).toHaveLength(600);
    expect(mocks.query.mock.calls[1]?.[1]).toHaveLength(6);
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
    });

    expect(String(mocks.query.mock.calls[0]?.[0])).toBe(
      'INSERT INTO "model_config" ("id", "provider", "model", "endpoint", "updated_at") VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
    );
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([
      'default',
      'ollama',
      'llama3.1',
      'http://localhost:11434',
      '2026-01-01T00:00:00.000Z',
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

    await expect(migrateToPostgres({
      from,
      to: 'postgres://user:pass@localhost:5432/automate',
      dryRun: true,
    })).rejects.toThrow('Schema mismatch for runs: unknown columns unexpected_column');
  });
});
