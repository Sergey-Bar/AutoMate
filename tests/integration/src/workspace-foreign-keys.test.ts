import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedDatabase, readMigrations, type Migration } from './migrations.js';

/**
 * `0029_workspace_foreign_keys` (ledger MNT-18).
 *
 * Seven tables were hard-scoped before MNT-17 by a `workspace_id NOT NULL` with no key
 * onto `workspaces`: `schedules` (0015), `outbox_events` (0017), `conversations` and
 * `messages` (0018), `connector_configs` and `vault_entries` (0020), and
 * `canonical_run_results` (0005). NOT NULL says a row names *a* workspace; only the key
 * says it names one that exists. Without it a row could claim a tenant nobody
 * registered, which is how `runs` came to hold such ids before 0028.
 *
 * The first block is the defect as a test: each table, a workspace id that is not in
 * `workspaces`, and the database must refuse it. Each refusal is paired with the same
 * row naming a real workspace, so the refusal is the key and not some other column.
 */

const TAG = '0029_workspace_foreign_keys';
const MISSING = 'no-such-workspace';
// Seeded by 0003, so it exists in every migrated database.
const REAL = 'default-workspace';
const CONVERSATION = 'conv-parent';

const opened: PGlite[] = [];

afterEach(async () => {
  for (const client of opened.splice(0)) await client.close();
});

async function migrated(): Promise<PGlite> {
  const client = await createMigratedDatabase();
  opened.push(client);
  return client;
}

/** One insert per table, parameterised on the workspace it names. `$1` is the workspace. */
const INSERTS: ReadonlyArray<{ table: string; sql: string }> = [
  {
    table: 'schedules',
    sql: `INSERT INTO schedules (id, cron_expr, workspace_id, created_at)
          VALUES ('sched-' || $1, '* * * * *', $1, now())`,
  },
  {
    table: 'outbox_events',
    sql: `INSERT INTO outbox_events (workspace_id, aggregate_type, aggregate_id, event_type, payload, dedupe_key)
          VALUES ($1, 'run', 'r-1', 'run.created', '{}'::jsonb, 'dedupe-' || $1)`,
  },
  {
    table: 'conversations',
    sql: `INSERT INTO conversations (id, workspace_id, created_at, updated_at)
          VALUES ('conv-' || $1, $1, now(), now())`,
  },
  {
    table: 'messages',
    sql: `INSERT INTO messages (id, conversation_id, workspace_id, role, content, created_at)
          VALUES ('msg-' || $1, '${CONVERSATION}', $1, 'user', 'hello', now())`,
  },
  {
    table: 'connector_configs',
    sql: `INSERT INTO connector_configs (id, connector_name, workspace_id, updated_at)
          VALUES ('cfg-' || $1, 'github', $1, now())`,
  },
  {
    table: 'vault_entries',
    sql: `INSERT INTO vault_entries
            (id, connector_name, workspace_id, ciphertext, iv, auth_tag, salt, iterations, created_at, updated_at)
          VALUES ('entry-' || $1, 'github', $1, 'c', 'i', 't', 's', 100000, now(), now())`,
  },
  {
    table: 'canonical_run_results',
    sql: `INSERT INTO canonical_run_results (workspace_id, run_id, fingerprint, result)
          VALUES ($1, 'run-1', 'fp', '{}'::jsonb)`,
  },
];

/** The rejection, or `null` when the insert was accepted. */
async function insertFailure(client: PGlite, sql: string, workspace: string): Promise<unknown> {
  return client.query(sql, [workspace]).then(
    () => null,
    (cause: unknown) => cause,
  );
}

describe('every workspace-scoped table refuses a workspace that does not exist (MNT-18)', () => {
  for (const { table, sql } of INSERTS) {
    it(`${table} rejects a workspace_id with no row in workspaces`, async () => {
      const client = await migrated();
      // The parent conversation `messages` needs, in a real workspace, so the message's
      // own workspace is the only thing under test.
      await client.query(
        `INSERT INTO conversations (id, workspace_id, created_at, updated_at) VALUES ($1, $2, now(), now())`,
        [CONVERSATION, REAL],
      );

      const failure = await insertFailure(client, sql, MISSING);
      expect(failure, `${table} accepted ${MISSING}`).toBeInstanceOf(Error);
      expect(String((failure as Error).message)).toMatch(
        new RegExp(`violates foreign key constraint "${table}_workspace_id_workspaces_id_fk"`),
      );

      // The same row naming a registered workspace is accepted.
      expect(await insertFailure(client, sql, REAL)).toBeNull();
    });

    it(`${table} refuses to delete a workspace that still owns a row`, async () => {
      // `restrict`, as 0028 chose for every comparable table: deleting a workspace must
      // not silently erase its rows, nor leave them pointing at nothing.
      const client = await migrated();
      await client.exec(`INSERT INTO workspaces (id, name, config_path, created_at)
        VALUES ('ws-owner', 'owner', 'config', now())`);
      await client.query(
        `INSERT INTO conversations (id, workspace_id, created_at, updated_at) VALUES ($1, $2, now(), now())`,
        [CONVERSATION, REAL],
      );
      expect(await insertFailure(client, sql, 'ws-owner')).toBeNull();

      // Postgres words a restrict as `violates RESTRICT setting of foreign key constraint`.
      await expect(client.exec(`DELETE FROM workspaces WHERE id = 'ws-owner'`)).rejects.toThrow(
        new RegExp(`foreign key constraint "${table}_workspace_id_workspaces_id_fk"`),
      );
    });
  }
});

// ─── The migration against a populated database ─────────────────────────────────

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

async function foreignKeyCount(client: PGlite): Promise<number> {
  const keys = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM pg_constraint
      WHERE contype = 'f' AND conname LIKE '%_workspace_id_workspaces_id_fk'
        AND conrelid::regclass::text IN (${INSERTS.map(({ table }) => `'${table}'`).join(', ')})`,
  );
  return keys.rows[0]?.count ?? -1;
}

describe(TAG, () => {
  it('registers a workspace the rows already name, and keeps every row', async () => {
    // 0028's rule for an id the data names but `workspaces` never registered: the rows
    // claim it, so it is materialised rather than the rows being deleted or re-labelled.
    const client = await applyBefore();
    await client.query(
      `INSERT INTO conversations (id, workspace_id, created_at, updated_at) VALUES ($1, $2, now(), now())`,
      [CONVERSATION, 'team-legacy'],
    );
    for (const { sql } of INSERTS) await client.query(sql, ['team-legacy']);

    await applyTarget(client);

    const registered = await client.query(`SELECT 1 FROM workspaces WHERE id = 'team-legacy'`);
    expect(registered.rows).toHaveLength(1);
    for (const { table } of INSERTS) {
      const rows = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${table} WHERE workspace_id = 'team-legacy'`,
      );
      // `conversations` holds the parent as well as the row INSERTS adds.
      expect(rows.rows[0]?.count, table).toBe(table === 'conversations' ? 2 : 1);
    }
    expect(await foreignKeyCount(client)).toBe(INSERTS.length);
  });

  it('raises, naming the table, on a blank workspace_id, and applies nothing', async () => {
    // A blank id names no workspace, and registering `''` as one would be inventing a
    // tenant. There is no parent to take one from, so this is the operator's decision.
    const client = await applyBefore();
    await client.query(INSERTS[0]?.sql ?? '', ['  ']);

    await expect(applyTarget(client)).rejects.toThrow(/schedules/);
    expect(await foreignKeyCount(client)).toBe(0);
  });

  it('raises on a message whose workspace disagrees with its conversation', async () => {
    // A message cannot belong to a different tenant from its conversation; registering
    // the message's workspace would turn a cross-tenant record into a valid-looking one.
    const client = await applyBefore();
    await client.query(
      `INSERT INTO conversations (id, workspace_id, created_at, updated_at) VALUES ($1, $2, now(), now())`,
      [CONVERSATION, REAL],
    );
    await client.query(INSERTS.find(({ table }) => table === 'messages')?.sql ?? '', ['elsewhere']);

    await expect(applyTarget(client)).rejects.toThrow(/messages/);
    const workspace = await client.query(`SELECT 1 FROM workspaces WHERE id = 'elsewhere'`);
    expect(workspace.rows).toHaveLength(0);
  });

  it('is a no-op on an empty install beyond adding the keys', async () => {
    const client = await applyBefore();
    await applyTarget(client);
    const workspaces = await client.query<{ id: string }>('SELECT id FROM workspaces');
    expect(workspaces.rows).toEqual([{ id: REAL }]);
    expect(await foreignKeyCount(client)).toBe(INSERTS.length);
  });
});
