import { getTableColumns, getTableName, isTable } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@automate/db';
import { canonicalRunResults, quarantine, runs, workspaces, apiKeys } from '@automate/db';
import {
  applyMigrations,
  assertSchemaBuildIsFresh,
  columnNames,
  constraintNames,
  createMigratedDatabase,
  readMigrations,
  readMigrationStateValues,
  tableNames,
} from './migrations.js';

/**
 * Proves the migration graph and the Drizzle schema are the same thing.
 *
 * The previous integration test hand-wrote three `CREATE TABLE` statements, so
 * none of the seven migrations ran anywhere and this comparison was impossible.
 * A column the Drizzle schema writes but no migration creates, or a constraint
 * the schema declares but the database lacks, now fails here rather than in a
 * deployment.
 */
describe('migration graph', () => {
  // One migrated database shared by every read-only assertion below. Applying
  // seven migrations costs a couple of seconds, and doing it per test made this
  // file the slowest in the workspace for no extra signal.
  let shared: Awaited<ReturnType<typeof createMigratedDatabase>>;
  beforeAll(async () => {
    // `@automate/db` resolves to `dist/`. If the build is stale, every assertion
    // below compares the migrations against yesterday's schema and passes
    // without checking anything, so the staleness is checked first.
    assertSchemaBuildIsFresh();
    shared = await createMigratedDatabase();
  });
  afterAll(async () => {
    // Defensive: when `beforeAll` throws, `shared` is undefined, and a teardown
    // that then throws on `shared.close()` buries the real failure under a
    // second, unrelated one.
    if (shared) await shared.close();
  });

  it('runs against a schema build that is not stale', () => {
    // A successful `assertSchemaBuildIsFresh()` above is the assertion; this
    // states it so a failure here names the problem instead of a symptom.
    expect(() => assertSchemaBuildIsFresh()).not.toThrow();
  });

  it('applies every migration in the journal, forwards, in order', () => {
    const migrations = readMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(7);
    // Journal order, and contiguous from zero: a missing or reordered index
    // means a deploy would apply migrations in the wrong order.
    expect(migrations.map((migration) => migration.index)).toEqual(
      migrations.map((_migration, position) => position),
    );
  });

  it('creates a table for every table the Drizzle schema declares', async () => {
    const declared = Object.values(schema)
      .filter((value) => isTable(value))
      .map((table) => getTableName(table));
    const migrated = new Set(await tableNames(shared));
    // Reported as a diff, because "a table is missing" is not actionable.
    expect(declared.filter((table) => !migrated.has(table)).sort()).toEqual([]);
  });

  it('creates every column the Drizzle schema declares', async () => {
    const migrated = new Set(await tableNames(shared));
    const missing: string[] = [];
    for (const value of Object.values(schema)) {
      if (!isTable(value)) continue;
      const table = getTableName(value);
      if (!migrated.has(table)) continue;
      const present = new Set(await columnNames(shared, table));
      for (const column of Object.values(getTableColumns(value))) {
        if (!present.has(column.name)) missing.push(`${table}.${column.name}`);
      }
    }
    // A column Drizzle knows about but no migration creates is the exact
    // failure this test exists to catch.
    expect(missing).toEqual([]);
  });

  it('does not leave a table the schema no longer declares', async () => {
    const declared: ReadonlySet<string> = new Set(
      Object.values(schema)
        .filter((value) => isTable(value))
        .map((table) => getTableName(table)),
    );
    // A migration that creates a table nothing reads is dead schema: it costs
    // storage, migration time, and review attention.
    const orphans = (await tableNames(shared)).filter(
      (table) => !declared.has(table) && !table.startsWith('_'),
    );
    expect(orphans).toEqual([]);
  });

  it('applies the newest migration, whose constraints are visible in the catalogue', async () => {
    // A representative table from the first, middle and newest migrations, so a
    // graph that stopped partway is caught rather than half-applied.
    const tables = await tableNames(shared);
    expect(tables).toContain('installations');
    expect(tables).toContain('execution_jobs');
    expect(tables).toContain('canonical_run_results');
    expect(await constraintNames(shared, 'quarantine')).toContain(
      'quarantine_ttf_resolution_check',
    );
    expect(await constraintNames(shared, 'artifacts')).toContain('artifacts_evidence_check');
    expect(await constraintNames(shared, 'api_keys')).toContain(
      'api_keys_admin_role_explicit_check',
    );
  });

  it('leaves exactly one audit table, and it is the attributable one', async () => {
    // `system_audit_events` was a strict subset of `audit_events` with no writer,
    // and its indexes were named `audit_events_resource_idx` and
    // `audit_events_retain_idx` — so a reader of the schema or a query plan would
    // attribute them to the wrong table, and `retain_until` does not exist on
    // `audit_events` at all. Migration 0010 dropped it. This asserts the drop
    // actually took effect against a real database, not just that the Drizzle
    // export is gone.
    const remaining = await shared.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE '%audit_events'`,
    );
    expect(remaining.rows.map((row) => row.table_name).sort()).toEqual(['audit_events']);

    const strayIndexes = await shared.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexname IN ('audit_events_resource_idx', 'audit_events_retain_idx')`,
    );
    expect(strayIndexes.rows).toEqual([]);
  });

  it('reports which migrations it applied, and refuses a journal that names a missing file', () => {
    // `readMigrations` is the single reader for the journal. It throws on a file
    // the journal names but the directory lacks, and on a file with no journal
    // entry, because either case means a migration no deploy would ever run.
    expect(readMigrations().map((migration) => migration.tag)).toEqual([
      '0000_fixed_outlaw_kid',
      '0001_phase3_foundation',
      '0002_phase3_key_constraint',
      '0003_durable_execution',
      '0004_orange_hellfire_club',
      '0005_canonical_run_results',
      '0006_fail_closed_controls',
      '0007_one_status_spelling',
      '0008_one_event_version',
      '0009_enum_constraints',
      '0010_drop_duplicate_audit',
    ]);
  });

  it('permits one spelling per test status, so an aggregation cannot split a state', async () => {
    // `tests.status` accepted both `timedOut` and `timed_out`, and nothing
    // reads the camelCase one — it mapped back to `unknown`, so a timed-out test
    // read as unobserved and a GROUP BY produced two rows for one state.
    const live = 'timed_out';
    const dead = 'timedOut';
    const names = new Set<string>(await readMigrationStateValues(shared, 'tests', 'status'));
    expect(names.has(live)).toBe(true);
    expect(names.has(dead)).toBe(false);
    // And no state appears under two spellings once the list is folded: two
    // values that differ only in case or separators are one state spelled twice.
    const folded = [...names].map((state) => state.replace(/[_-]/g, '').toLowerCase());
    expect(folded.filter((state, index) => folded.indexOf(state) !== index)).toEqual([]);
  });

  it('creates canonical_run_results, including every column the schema declares', async () => {
    const columns = await columnNames(shared, 'canonical_run_results');
    for (const column of Object.values(getTableColumns(canonicalRunResults))) {
      expect(columns, `canonical_run_results.${column.name}`).toContain(column.name);
    }
  });
});

/**
 * The 0006 constraints, asserted through the database rather than through the
 * Drizzle schema — the whole point is that the *database* refuses.
 */
describe('fail-closed constraints from migration 0006', () => {
  // One migrated database for the whole describe.
  //
  // Each test used to build its own, which meant applying all nine migrations
  // *per test* — slow by construction, and slow enough to exceed Vitest's 5s
  // per-test timeout on a loaded machine, so this suite failed intermittently
  // for a reason that had nothing to do with the constraints it checks.
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    assertSchemaBuildIsFresh();
    client = await createMigratedDatabase();
    db = drizzle(client, { schema });
  });
  afterAll(async () => {
    if (client) await client.close();
  });

  it('quarantines as pending by default and ties a time-to-fix to a resolution', async () => {
    await db.insert(quarantine).values({
      id: 'q-1',
      testTitle: 'flaky login',
      testFile: 'tests/login.spec.ts',
      quarantinedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const inserted = await client.query<{ status: string }>(
      "SELECT status FROM quarantine WHERE id = 'q-1'",
    );
    // `pending`, not `approved`: a quarantined test stays in the pass rate
    // until a human decides to remove it.
    expect(inserted.rows[0]?.status).toBe('pending');

    // A time-to-fix claims the problem was fixed; it cannot exist without a
    // resolution.
    await expect(
      client.exec("UPDATE quarantine SET ttf_ms = 60000 WHERE id = 'q-1'"),
    ).rejects.toThrow();

    await expect(
      client.exec("UPDATE quarantine SET resolved_at = now(), ttf_ms = 60000 WHERE id = 'q-1'"),
    ).resolves.toBeDefined();
  });

  it('requires a checksum and a size for every artifact, legacy rows included', async () => {
    await db
      .insert(workspaces)
      .values({ id: 'ws-1', name: 'default', configPath: 'config', createdAt: new Date() });
    await db.insert(runs).values({
      id: '00000000-0000-4000-8000-0000000000aa',
      externalId: 'ext-1',
      startedAt: new Date(),
      source: 'api',
      testType: 'browser',
      framework: 'playwright',
      status: 'running',
      phase: 'queued',
      idempotencyKey: 'key-1',
    });
    const runId = '00000000-0000-4000-8000-0000000000aa';

    // A `legacy_attachment_id` used to exempt a row from carrying evidence, on
    // a mutable column, so any artifact could opt out by setting it.
    await expect(
      db.insert(schema.artifacts).values({
        runId,
        legacyAttachmentId: 'legacy-1',
        name: 'a.log',
        contentType: 'text/plain',
        storageKey: 'k/1',
        kind: 'log',
      } as typeof schema.artifacts.$inferInsert),
    ).rejects.toThrow();

    await expect(
      db.insert(schema.artifacts).values({
        runId,
        name: 'a.log',
        contentType: 'text/plain',
        storageKey: 'k/2',
        kind: 'log',
        checksumAlgorithm: 'sha256',
        checksum: 'a'.repeat(64),
        sizeBytes: 5,
      } as typeof schema.artifacts.$inferInsert),
    ).resolves.toBeDefined();
  });

  it('defaults a new API key to viewer and demands scopes for admin', async () => {
    await db.insert(apiKeys).values({
      id: 'key-1',
      name: 'default',
      keyHash: 'hash-1',
      createdAt: new Date(),
    });
    const inserted = await client.query<{ role: string }>(
      "SELECT role FROM api_keys WHERE id = 'key-1'",
    );
    // A key created with no role used to become `admin`.
    expect(inserted.rows[0]?.role).toBe('viewer');

    const admin = {
      id: 'key-2',
      name: 'admin',
      keyHash: 'hash-2',
      role: 'admin' as const,
      createdAt: new Date(),
    };
    await expect(db.insert(apiKeys).values(admin)).rejects.toThrow();
    await expect(
      db.insert(apiKeys).values({ ...admin, scopes: ['runs:read'] }),
    ).resolves.toBeDefined();
  });

  it('stamps a generated test suggestion with a real time, not the epoch', async () => {
    const before = Date.now();
    await db.insert(schema.generatedTestSuggestions).values({
      id: 'sug-1',
      sourceType: 'pr_diff',
      status: 'draft',
      originalContent: 'test("login", () => {})',
      createdAt: new Date(),
    });
    const row = await client.query<{ updated_at: Date; status: string }>(
      'SELECT updated_at, status FROM generated_test_suggestions WHERE id = $1',
      ['sug-1'],
    );
    const stamped = row.rows[0]?.updated_at;
    // Migration 0000 created this column with `DEFAULT '1970-01-01…'`, so a
    // freshly inserted row looked 56 years stale to every "last updated" query —
    // indistinguishable from a suggestion nobody ever touched. Migration 0006
    // changed the default to now().
    expect(stamped?.getTime()).toBeGreaterThan(before - 60_000);
    expect(row.rows[0]?.status).toBe('draft');
  });

  it('agrees with the contract on the durable event version', async () => {
    // The column defaulted to 2 while the contract, the SSE frame and every
    // writer used 1. A writer that omitted the field — which the type allowed —
    // produced a row a consumer could never match against the frame, because it
    // compared 2 to 1 and found no equality. `packages/db` is a leaf and cannot
    // import the contract, so the two agreeing is asserted here instead.
    const { EVENT_VERSION } = (await import('@automate/shared-contracts')) as {
      EVENT_VERSION: number;
    };
    expect(EVENT_VERSION).toBe(1);

    // Read the live default rather than the Drizzle declaration: Drizzle's
    // `default()` is compile-time only, and the mismatch lived in the database.
    const defaulted = await client.query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'outbox_events' AND column_name = 'event_version'`,
    );
    const columnDefault = defaulted.rows[0]?.column_default;
    expect(columnDefault, 'outbox_events.event_version has no database default').toBeDefined();
    expect(String(columnDefault)).toContain(String(EVENT_VERSION));
    // And not the old value, which is the whole point.
    expect(String(columnDefault)).not.toContain('2');
  });
});

describe('applyMigrations', () => {
  it('reports the tags it applied, in journal order', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const client = new PGlite();
    try {
      const applied = await applyMigrations(client);
      expect(applied).toEqual(readMigrations().map((migration) => migration.tag));
    } finally {
      await client.close();
    }
  });
});
