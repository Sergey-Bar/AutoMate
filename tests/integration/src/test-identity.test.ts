import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { testIdentity } from '@automate/shared-contracts';
import { readMigrations, type Migration } from './migrations.js';

/**
 * `0045_test_identity`: `tests.stable_id` is the test's identity, for every row.
 *
 * The column existed from the first migration with an index on it, and nothing wrote it.
 * This migration backfills it, fills it for any writer that does not send it, makes it
 * NOT NULL, and replaces the index with one that leads with the tenancy boundary.
 *
 * **One rule in two languages.** The identity is `testIdentity` in TypeScript, and the
 * backfill and the fill-on-insert are `automate_test_identity` in SQL. The titles below are
 * chosen to carry every character the rule escapes, so the two cannot disagree on a row
 * without this test failing.
 */

const TAG = '0045_test_identity';
const RUN = '00000000-0000-4000-8000-0000000000c1';
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

async function migratedThrough(stopBefore: boolean): Promise<PGlite> {
  const client = new PGlite();
  opened.push(client);
  for (const migration of readMigrations()) {
    if (stopBefore && migration.tag === TAG) break;
    for (const statement of statements(migration)) await client.exec(statement);
  }
  return client;
}

async function applyTarget(client: PGlite): Promise<void> {
  const found = readMigrations().find((migration) => migration.tag === TAG);
  if (found === undefined) throw new Error(`${TAG} is missing from the journal`);
  for (const statement of statements(found)) await client.exec(statement);
}

const ROWS = [
  { id: 't-1', file: 'tests/a.spec.ts', title: 'logs in' },
  { id: 't-2', file: 'tests/a.spec.ts', title: 'handles [brackets] and {braces}' },
  { id: 't-3', file: 'tests/b.spec.ts', title: 'a › nested › title' },
  { id: 't-4', file: '', title: 'back\\slash' },
] as const;

async function seed(client: PGlite): Promise<void> {
  await client.exec(
    `INSERT INTO runs (id, started_at, workspace_id) VALUES ('${RUN}', now(), 'default-workspace')`,
  );
  for (const row of ROWS) {
    await client.query(
      'INSERT INTO tests (id, run_id, workspace_id, title, file) VALUES ($1, $2, $3, $4, $5)',
      [row.id, RUN, 'default-workspace', row.title, row.file],
    );
  }
}

async function identities(client: PGlite): Promise<Record<string, string | null>> {
  const result = await client.query<{ id: string; stable_id: string | null }>(
    'SELECT id, stable_id FROM tests ORDER BY id',
  );
  return Object.fromEntries(result.rows.map((row) => [row.id, row.stable_id]));
}

const expected = Object.fromEntries(
  ROWS.map((row) => [row.id, testIdentity({ file: row.file, title: row.title })]),
);

describe(TAG, () => {
  it('backfills every existing row with the identity the TypeScript rule computes', async () => {
    const client = await migratedThrough(true);
    await seed(client);
    expect(Object.values(await identities(client)).every((value) => value === null)).toBe(true);
    await applyTarget(client);
    expect(await identities(client)).toEqual(expected);
  });

  it('fills the identity for a writer that does not send one, and keeps one that it does', async () => {
    const client = await migratedThrough(false);
    await seed(client);
    await client.query(
      `INSERT INTO tests (id, run_id, workspace_id, title, file, stable_id)
       VALUES ('t-5', $1, 'default-workspace', 'pays', 'tests/c.spec.ts', 'tests/c.spec.ts › pays [webkit]')`,
      [RUN],
    );
    expect(await identities(client)).toEqual({
      ...expected,
      't-5': 'tests/c.spec.ts › pays [webkit]',
    });
  });

  it('refuses a row with no identity, and indexes it under the workspace', async () => {
    const client = await migratedThrough(false);
    await seed(client);
    await expect(client.exec(`UPDATE tests SET stable_id = NULL WHERE id = 't-1'`)).rejects.toThrow(
      /null value|not-null/iu,
    );
    const indexes = await client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'tests' AND indexdef ILIKE '%stable_id%'`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(['tests_workspace_stable_id_idx']);
    expect(indexes.rows[0]?.indexdef).toMatch(/\(workspace_id, stable_id\)/u);
  });
});
