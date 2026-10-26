import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { readMigrations, type Migration } from './migrations.js';

/**
 * `0048_triage_labels`: `fingerprint_categories` becomes a workspace's triage labels.
 *
 * The table mapped a failure fingerprint to a `defect_categories` row and nothing wrote it.
 * A label is a team's decision about its own failures, so it is workspace-scoped with the
 * hard boundary every such table has (NOT NULL, a `restrict` key, an index leading with it).
 * The migration refuses to scope rows it would have to guess a workspace for.
 */
const TAG = '0048_triage_labels';
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

async function before(): Promise<PGlite> {
  const client = new PGlite();
  opened.push(client);
  for (const migration of readMigrations()) {
    if (migration.tag === TAG) break;
    for (const statement of statements(migration)) await client.exec(statement);
  }
  return client;
}

async function target(client: PGlite): Promise<void> {
  const found = readMigrations().find((migration) => migration.tag === TAG);
  if (found === undefined) throw new Error(`${TAG} is missing`);
  try {
    await client.exec(`BEGIN;\n${statements(found).join(';\n')};\nCOMMIT;`);
  } catch (failure) {
    await client.exec('ROLLBACK');
    throw failure;
  }
}

describe(TAG, () => {
  it('seeds the four triage categories and scopes a label to its workspace', async () => {
    const client = await before();
    await target(client);
    const categories = await client.query<{ id: string }>(
      `SELECT id FROM defect_categories ORDER BY id`,
    );
    expect(categories.rows.map((row) => row.id)).toEqual([
      'environment',
      'known-issue',
      'product',
      'test',
    ]);
    await client.exec(`INSERT INTO workspaces (id, name, config_path, created_at)
                       VALUES ('ws-b', 'b', 'c', now())`);
    const label = (workspace: string) =>
      `INSERT INTO fingerprint_categories (workspace_id, fingerprint, category_id, assigned_at)
       VALUES ('${workspace}', 'timeout <n>ms', 'environment', now())`;
    await client.exec(label('default-workspace'));
    // The same signature in another workspace is another team's decision.
    await client.exec(label('ws-b'));
    await expect(client.exec(label('ws-b'))).rejects.toThrow(/duplicate key/u);
    await expect(
      client.exec(`INSERT INTO fingerprint_categories (fingerprint, category_id, assigned_at)
                   VALUES ('x', 'test', now())`),
    ).rejects.toThrow(/null value/u);
    const index = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'fingerprint_categories'`,
    );
    expect(index.rows.some((row) => /\(workspace_id, fingerprint\)/u.test(row.indexdef))).toBe(
      true,
    );
  });

  it('refuses to guess a workspace for a label that already exists, and applies nothing', async () => {
    const client = await before();
    await client.exec(
      `INSERT INTO defect_categories (id, name, created_at) VALUES ('c', 'C', now())`,
    );
    await client.exec(`INSERT INTO fingerprint_categories (fingerprint, category_id, assigned_at)
                       VALUES ('legacy', 'c', now())`);
    await expect(target(client)).rejects.toThrow(/fingerprint_categories holds 1 row/u);
    const column = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'fingerprint_categories' AND column_name = 'workspace_id'`,
    );
    expect(column.rows).toHaveLength(0);
  });
});
