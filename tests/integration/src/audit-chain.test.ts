import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { readMigrations, type Migration } from './migrations.js';

/**
 * `0050_audit_chain` and `0052_audit_append_only`: the audit trail as a hash chain per
 * workspace, which the database refuses to change (ADR-014, enterprise).
 *
 * Every row an insert writes — by any writer, because the chain is a trigger and not a
 * convention — carries its position in the workspace's chain, the previous row's hash and its
 * own. `audit_chain_breaks(workspace)` recomputes the chain and names every row that was
 * edited, deleted from the middle or from the front, or relinked. Rows that existed before the
 * migration are chained by it, in the order they were written. And the table refuses an
 * UPDATE, a DELETE and a TRUNCATE outright, so every break below is made the only way one can
 * be: with a guard switched off first, which takes the table's owner.
 *
 * The chain is read on the whole graph, as an installation has it, so a later migration that
 * loosened either half fails here rather than in a deployment.
 */
const CHAIN = '0050_audit_chain';
const APPEND_ONLY = '0052_audit_append_only';
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

/** Every migration after `tag`, in journal order: the rest of the graph. */
async function after(client: PGlite, tag: string): Promise<void> {
  const migrations = readMigrations();
  const position = migrations.findIndex((candidate) => candidate.tag === tag);
  if (position === -1) throw new Error(`${tag} is missing`);
  for (const migration of migrations.slice(position + 1)) {
    for (const statement of statements(migration)) await client.exec(statement);
  }
}

async function apply(client: PGlite, tag: string): Promise<void> {
  const migration = readMigrations().find((candidate) => candidate.tag === tag);
  if (migration === undefined) throw new Error(`${tag} is missing`);
  for (const statement of statements(migration)) await client.exec(statement);
}

const insert = (ws: string, action: string, at = 'now()') =>
  `INSERT INTO audit_events (timestamp, actor_id, actor_type, action, resource_type, resource_id, details, workspace_id, created_at)
     VALUES (${at}, 'user:ana', 'user', '${action}', 'project', 'p1', '{"n":1}', '${ws}', now())`;

/** Two workspaces on the whole graph: three rows in `ws-a`, one in `ws-b`. */
async function seeded(): Promise<PGlite> {
  const client = await upTo(CHAIN, true);
  await after(client, CHAIN);
  await client.exec(`INSERT INTO workspaces (id, name, config_path, created_at)
                       VALUES ('ws-a', 'A', '.', now()), ('ws-b', 'B', '.', now())`);
  for (const action of ['one', 'two', 'three']) await client.exec(insert('ws-a', action));
  await client.exec(insert('ws-b', 'other'));
  return client;
}

/** Runs `sql` with the delete guard switched off, as only the table's owner can, and back on. */
async function behindTheDeleteGuard(client: PGlite, sql: string): Promise<void> {
  await client.exec(`
    ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only_delete;
    ${sql};
    ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only_delete;
  `);
}

async function breaks(client: PGlite, ws: string) {
  return (
    await client.query<{ seq: number; problem: string }>(
      `SELECT seq::int AS seq, problem FROM audit_chain_breaks($1)`,
      [ws],
    )
  ).rows;
}

/** The workspace's newest chained row: what an export ends with, and what an auditor files. */
async function head(client: PGlite, ws: string) {
  return (
    await client.query<{ seq: number; hash: string }>(
      `SELECT chain_seq::int AS seq, hash FROM audit_events
        WHERE workspace_id = $1 AND chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1`,
      [ws],
    )
  ).rows[0];
}

async function count(client: PGlite): Promise<number> {
  const result = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events`);
  return result.rows[0]?.n ?? -1;
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
    await behindTheDeleteGuard(client, `DELETE FROM audit_events WHERE action = 'two'`);
    expect(await breaks(client, 'ws-a')).toEqual([
      { seq: 3, problem: 'missing-before' },
      { seq: 3, problem: 'relinked' },
    ]);
  });

  it('chains the rows that existed before it, in the order they were written', async () => {
    const client = await upTo(CHAIN, false);
    await client.exec(`INSERT INTO workspaces (id, name, config_path, created_at)
                         VALUES ('ws-a', 'A', '.', now())`);
    await client.exec(insert('ws-a', 'later', `'2026-10-02T00:00:00Z'`));
    await client.exec(insert('ws-a', 'earlier', `'2026-10-01T00:00:00Z'`));
    await apply(client, CHAIN);
    const rows = await client.query<{ seq: number; action: string; prev: string | null }>(
      `SELECT chain_seq::int AS seq, action, prev_hash AS prev FROM audit_events ORDER BY chain_seq`,
    );
    // From 1, and the first row names nothing before it: the shape the check below holds a
    // chain's first row to.
    expect(rows.rows).toEqual([
      { seq: 1, action: 'earlier', prev: null },
      { seq: 2, action: 'later', prev: expect.any(String) },
    ]);
    // The rest of the graph, so a chain this migration wrote is read by the check an
    // installation runs today.
    await after(client, CHAIN);
    await client.exec(insert('ws-a', 'after'));
    expect(await breaks(client, 'ws-a')).toEqual([]);
  });
});

describe('0052_audit_append_only', () => {
  it('refuses a DELETE: a recorded decision is not removed', async () => {
    const client = await seeded();
    await expect(client.exec(`DELETE FROM audit_events WHERE action = 'two'`)).rejects.toThrow(
      /append-only/u,
    );
    await expect(
      client.exec(`DELETE FROM audit_events WHERE workspace_id = 'ws-a'`),
    ).rejects.toThrow(/append-only/u);
    expect(await count(client)).toBe(4);
  });

  it('refuses a TRUNCATE, including one that cascades from the workspaces', async () => {
    const client = await seeded();
    await expect(client.exec(`TRUNCATE audit_events`)).rejects.toThrow(/append-only/u);
    await expect(client.exec(`TRUNCATE workspaces CASCADE`)).rejects.toThrow(/append-only/u);
    expect(await count(client)).toBe(4);
  });

  it.each([
    { deleted: ['one'], first: 2 },
    { deleted: ['one', 'two'], first: 3 },
  ])(
    'names a chain whose first rows are gone ($deleted), by the first row left',
    async ({ deleted, first }) => {
      const client = await seeded();
      const list = deleted.map((action) => `'${action}'`).join(', ');
      await behindTheDeleteGuard(client, `DELETE FROM audit_events WHERE action IN (${list})`);
      expect(await breaks(client, 'ws-a')).toEqual([{ seq: first, problem: 'missing-before' }]);
      // The other workspace's chain is its own, and untouched.
      expect(await breaks(client, 'ws-b')).toEqual([]);
    },
  );

  it('names a first row renumbered to 1 that still names a row before it', async () => {
    const client = await seeded();
    await client.exec(`
      ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only;
      ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only_delete;
      DELETE FROM audit_events WHERE action IN ('one', 'two');
      UPDATE audit_events
         SET chain_seq = 1,
             hash = audit_event_hash(prev_hash, workspace_id, 1, timestamp, actor_id, actor_type,
                                     action, resource_type, resource_id, details)
       WHERE action = 'three';
      ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only_delete;
      ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only;
    `);
    expect(await breaks(client, 'ws-a')).toEqual([{ seq: 1, problem: 'missing-before' }]);
  });

  it('cannot see a tail removed and written again behind the guard; the head filed before can', async () => {
    const client = await seeded();
    const filed = await head(client, 'ws-a');
    await behindTheDeleteGuard(client, `DELETE FROM audit_events WHERE action = 'three'`);
    await client.exec(insert('ws-a', 'not three'));
    // The insert takes the position the removed row freed, so the chain reads as whole...
    expect(await breaks(client, 'ws-a')).toEqual([]);
    const now = await head(client, 'ws-a');
    expect(now?.seq).toBe(filed?.seq);
    // ...and the head an auditor filed before is what no longer matches.
    expect(now?.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(now?.hash).not.toBe(filed?.hash);
  });

  it('can be applied again, and still refuses', async () => {
    const client = await seeded();
    await apply(client, APPEND_ONLY);
    await expect(client.exec(`DELETE FROM audit_events`)).rejects.toThrow(/append-only/u);
    await expect(client.exec(`TRUNCATE audit_events`)).rejects.toThrow(/append-only/u);
    expect(await breaks(client, 'ws-a')).toEqual([]);
  });
});
