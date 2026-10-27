import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { readMigrations, type Migration } from './migrations.js';

/**
 * `0050_audit_chain`: the audit trail as a hash chain per workspace (ADR-014, enterprise).
 *
 * Every row an insert writes — by any writer, because the chain is a trigger and not a
 * convention — carries its position in the workspace's chain, the previous row's hash and its
 * own. `audit_chain_breaks(workspace)` recomputes the chain and names every row that was
 * edited, deleted from the middle, or relinked. Rows that existed before the migration are
 * chained by it, in the order they were written. And the table refuses an UPDATE outright.
 */
const TAG = '0050_audit_chain';
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

async function upTo(tag: string, inclusive: boolean): Promise<PGlite> {
  const client = new PGlite();
  opened.push(client);
  let found = false;
  for (const migration of readMigrations()) {
    if (migration.tag === tag && !inclusive) {
      found = true;
      break;
    }
    for (const statement of statements(migration)) await client.exec(statement);
    if (migration.tag === tag) {
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`${tag} is missing`);
  return client;
}

async function apply(client: PGlite, tag: string): Promise<void> {
  const migration = readMigrations().find((candidate) => candidate.tag === tag);
  if (migration === undefined) throw new Error(`${tag} is missing`);
  for (const statement of statements(migration)) await client.exec(statement);
}

const insert = (ws: string, action: string, at = 'now()') =>
  `INSERT INTO audit_events (timestamp, actor_id, actor_type, action, resource_type, resource_id, details, workspace_id, created_at)
     VALUES (${at}, 'user:ana', 'user', '${action}', 'project', 'p1', '{"n":1}', '${ws}', now())`;

async function seeded(): Promise<PGlite> {
  const client = await upTo(TAG, true);
  await client.exec(`INSERT INTO workspaces (id, name, config_path, created_at)
                       VALUES ('ws-a', 'A', '.', now()), ('ws-b', 'B', '.', now())`);
  for (const action of ['one', 'two', 'three']) await client.exec(insert('ws-a', action));
  await client.exec(insert('ws-b', 'other'));
  return client;
}

async function breaks(client: PGlite, ws: string) {
  return (
    await client.query<{ seq: number; problem: string }>(
      `SELECT seq::int AS seq, problem FROM audit_chain_breaks($1)`,
      [ws],
    )
  ).rows;
}

describe('0050_audit_chain', () => {
  it('chains every insert per workspace, each row naming the one before it', async () => {
    const client = await seeded();
    const rows = (
      await client.query<{ seq: number; action: string; prev: string | null; hash: string }>(
        `SELECT chain_seq::int AS seq, action, prev_hash AS prev, hash FROM audit_events
          WHERE workspace_id = 'ws-a' ORDER BY chain_seq`,
      )
    ).rows;
    expect(rows.map((row) => [row.seq, row.action])).toEqual([
      [1, 'one'],
      [2, 'two'],
      [3, 'three'],
    ]);
    expect(rows[0]?.prev).toBeNull();
    expect(rows[1]?.prev).toBe(rows[0]?.hash);
    expect(rows[2]?.prev).toBe(rows[1]?.hash);
    expect(rows.every((row) => /^[0-9a-f]{64}$/u.test(row.hash))).toBe(true);
    // Another workspace has its own chain.
    const other = await client.query<{ seq: number }>(
      `SELECT chain_seq::int AS seq FROM audit_events WHERE workspace_id = 'ws-b'`,
    );
    expect(other.rows).toEqual([{ seq: 1 }]);
    expect(await breaks(client, 'ws-a')).toEqual([]);
  });

  it('refuses an UPDATE: the trail is append-only', async () => {
    const client = await seeded();
    await expect(
      client.exec(`UPDATE audit_events SET action = 'nothing' WHERE action = 'two'`),
    ).rejects.toThrow(/append-only/u);
  });

  it('names a row edited by someone who could switch the guard off', async () => {
    const client = await seeded();
    await client.exec(`
      ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only;
      UPDATE audit_events SET details = '{"n":2}' WHERE action = 'two';
      ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only;
    `);
    expect(await breaks(client, 'ws-a')).toEqual([{ seq: 2, problem: 'edited' }]);
  });

  it('names a row whose hash was recomputed to hide an edit, by the link after it', async () => {
    const client = await seeded();
    await client.exec(`
      ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only;
      UPDATE audit_events
         SET action = 'rewritten',
             hash = audit_event_hash(prev_hash, workspace_id, chain_seq, timestamp, actor_id,
                                     actor_type, 'rewritten', resource_type, resource_id, details)
       WHERE action = 'two';
      ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only;
    `);
    expect(await breaks(client, 'ws-a')).toEqual([{ seq: 3, problem: 'relinked' }]);
  });

  it('names the gap a deleted row leaves', async () => {
    const client = await seeded();
    await client.exec(`DELETE FROM audit_events WHERE action = 'two'`);
    expect(await breaks(client, 'ws-a')).toEqual([
      { seq: 3, problem: 'missing-before' },
      { seq: 3, problem: 'relinked' },
    ]);
  });

  it('chains the rows that existed before it, in the order they were written', async () => {
    const client = await upTo(TAG, false);
    await client.exec(`INSERT INTO workspaces (id, name, config_path, created_at)
                         VALUES ('ws-a', 'A', '.', now())`);
    await client.exec(insert('ws-a', 'later', `'2026-10-02T00:00:00Z'`));
    await client.exec(insert('ws-a', 'earlier', `'2026-10-01T00:00:00Z'`));
    await apply(client, TAG);
    const rows = await client.query<{ seq: number; action: string }>(
      `SELECT chain_seq::int AS seq, action FROM audit_events ORDER BY chain_seq`,
    );
    expect(rows.rows).toEqual([
      { seq: 1, action: 'earlier' },
      { seq: 2, action: 'later' },
    ]);
    await client.exec(insert('ws-a', 'after'));
    expect(await breaks(client, 'ws-a')).toEqual([]);
  });
});
