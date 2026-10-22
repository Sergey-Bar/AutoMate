import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { readMigrations, type Migration } from './migrations.js';

/**
 * `0030_drop_superseded_tables` (ledger MNT-60, closing part of C-6).
 *
 * `results`, `blob_shards` and `api_keys` were recorded in
 * `docs/quality/capability-justification.md` as superseded: by
 * `canonical_run_results`, by `runs.readAt`, and by the installation key. Nothing in
 * `apps/`, `packages/` or `tools/` reads or writes them, but two live tables still
 * carried a foreign key onto `results`. A drop that is only a `DROP TABLE` would either
 * fail on those keys or, with `CASCADE`, remove the keys silently.
 *
 * The migration is fail-closed in the same spirit as 0028 and 0029. It drops only
 * tables that are empty, and a table that holds rows stops the migration, naming the
 * table and the count, unless `automate.allow_drop_nonempty` is `on`. Dropping data
 * is the one thing a migration must never do by default.
 */

const TAG = '0030_drop_superseded_tables';
const RUN = '00000000-0000-4000-8000-0000000000b1';
const SUPERSEDED = ['results', 'blob_shards', 'api_keys'] as const;

const opened: PGlite[] = [];

afterEach(async () => {
  for (const client of opened.splice(0)) await client.close();
});

function statements(migration: Migration): string[] {
  return migration.sql
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter(Boolean);
}

function target(): Migration {
  const found = readMigrations().find((migration) => migration.tag === TAG);
  if (found === undefined) throw new Error(`${TAG} is missing from the journal`);
  return found;
}

/** The graph up to, but not including, the migration under test. */
async function applyBefore(): Promise<PGlite> {
  const client = new PGlite();
  opened.push(client);
  for (const migration of readMigrations()) {
    if (migration.tag === TAG) break;
    for (const statement of statements(migration)) await client.exec(statement);
  }
  return client;
}

async function applyTarget(client: PGlite): Promise<void> {
  // One transaction, as the migrator runs it, so a raise leaves nothing half-applied.
  try {
    await client.exec(`BEGIN;\n${statements(target()).join(';\n')};\nCOMMIT;`);
  } catch (failure) {
    await client.exec('ROLLBACK');
    throw failure;
  }
}

async function tablesPresent(client: PGlite): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name`,
    [[...SUPERSEDED]],
  );
  return result.rows.map((row) => row.table_name);
}

/** Foreign keys that name one of the superseded tables as their target. */
async function keysOntoSuperseded(client: PGlite): Promise<string[]> {
  const result = await client.query<{ conname: string }>(
    `SELECT conname FROM pg_constraint
      WHERE contype = 'f' AND confrelid::regclass::text = ANY($1) ORDER BY conname`,
    [[...SUPERSEDED]],
  );
  return result.rows.map((row) => row.conname);
}

const SEED: Record<(typeof SUPERSEDED)[number], string> = {
  results: `INSERT INTO results (id, test_id, run_id, workspace_id, status)
            VALUES ('r-1', 't-1', '${RUN}', 'default-workspace', 'passed')`,
  blob_shards: `INSERT INTO blob_shards
                  (id, run_id, workspace_id, shard_index, total_shards, file_path, uploaded_at)
                VALUES ('bs-1', '${RUN}', 'default-workspace', 0, 1, 'a.zip', now())`,
  api_keys: `INSERT INTO api_keys (id, name, key_hash, created_at)
             VALUES ('key-1', 'legacy', 'hash-1', now())`,
};

/** Unrelated rows that must survive the migration untouched. */
async function seedUnrelated(client: PGlite): Promise<void> {
  await client.exec(`
    INSERT INTO runs (id, started_at, workspace_id) VALUES ('${RUN}', now(), 'default-workspace');
    INSERT INTO tests (id, run_id, workspace_id, title, file)
      VALUES ('t-1', '${RUN}', 'default-workspace', 't', 'f');
  `);
}

describe(TAG, () => {
  it('drops all three tables from an empty database, and every key that named them', async () => {
    const client = await applyBefore();
    expect(await tablesPresent(client)).toEqual([...SUPERSEDED].sort());
    // The defect as a test: two live tables still point at `results`.
    expect(await keysOntoSuperseded(client)).toEqual([
      'artifacts_result_id_results_id_fk',
      'attachments_result_id_results_id_fk',
    ]);

    await applyTarget(client);

    expect(await tablesPresent(client)).toEqual([]);
    expect(await keysOntoSuperseded(client)).toEqual([]);
  });

  for (const table of SUPERSEDED) {
    it(`refuses to drop ${table} while it holds rows, naming the table and the count`, async () => {
      const client = await applyBefore();
      await seedUnrelated(client);
      await client.exec(SEED[table]);

      await expect(applyTarget(client)).rejects.toThrow(
        new RegExp(`${table}: 1 row\\(s\\).*automate\\.allow_drop_nonempty`, 's'),
      );

      // Nothing was applied: all three tables and both keys are still there.
      expect(await tablesPresent(client)).toEqual([...SUPERSEDED].sort());
      expect(await keysOntoSuperseded(client)).toHaveLength(2);
      const kept = await client.query(`SELECT 1 FROM ${table}`);
      expect(kept.rows).toHaveLength(1);
    });
  }

  it('refuses when any table holds rows even if the setting is merely present but not on', async () => {
    const client = await applyBefore();
    await seedUnrelated(client);
    await client.exec(SEED.api_keys);
    await client.exec(`SET automate.allow_drop_nonempty = 'off'`);

    await expect(applyTarget(client)).rejects.toThrow(/api_keys: 1 row/);
    expect(await tablesPresent(client)).toEqual([...SUPERSEDED].sort());
  });

  it('drops populated tables when the operator opts in, and keeps everything else', async () => {
    const client = await applyBefore();
    await seedUnrelated(client);
    for (const table of SUPERSEDED) await client.exec(SEED[table]);
    // Rows in the two live tables that carried a key onto `results`.
    await client.exec(`
      INSERT INTO attachments (id, result_id, workspace_id, name, content_type, path)
        VALUES ('att-1', 'r-1', 'default-workspace', 'a.png', 'image/png', 'a.png');
      INSERT INTO artifacts (run_id, workspace_id, result_id, name, content_type, storage_key, checksum, size_bytes)
        VALUES ('${RUN}', 'default-workspace', 'r-1', 'a.log', 'text/plain', 'k/1', '${'a'.repeat(64)}', 1);
    `);
    await client.exec(`SET automate.allow_drop_nonempty = 'on'`);

    await applyTarget(client);

    expect(await tablesPresent(client)).toEqual([]);
    expect(await keysOntoSuperseded(client)).toEqual([]);

    const runs = await client.query(`SELECT 1 FROM runs WHERE id = '${RUN}'`);
    expect(runs.rows).toHaveLength(1);
    const tests = await client.query(`SELECT 1 FROM tests WHERE id = 't-1'`);
    expect(tests.rows).toHaveLength(1);
    // The pointer columns stay, with their values, so the provenance is not erased.
    const attachment = await client.query<{ result_id: string }>(
      `SELECT result_id FROM attachments WHERE id = 'att-1'`,
    );
    expect(attachment.rows).toEqual([{ result_id: 'r-1' }]);
    const artifact = await client.query<{ result_id: string }>(
      `SELECT result_id FROM artifacts WHERE run_id = '${RUN}'`,
    );
    expect(artifact.rows).toEqual([{ result_id: 'r-1' }]);
  });

  it('keeps the index on artifacts.result_id, which the pointer column still uses', async () => {
    const client = await applyBefore();
    await applyTarget(client);
    const index = await client.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'artifacts_result_idx'`,
    );
    expect(index.rows).toHaveLength(1);
  });
});
