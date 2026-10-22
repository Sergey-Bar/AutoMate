import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { readMigrations, type Migration } from './migrations.js';

/**
 * `0028_workspace_hard_boundaries` against a populated database (ledger MNT-17).
 *
 * The migration gives every workspace-scoped table a `workspace_id NOT NULL` with a
 * foreign key, and the backfill is the part that can do damage: a row given the wrong
 * workspace is a cross-tenant disclosure performed by the fix. So this applies the
 * graph *up to* 0028, seeds rows the way an install that predates it would hold them,
 * applies 0028 from the same file a deploy runs, and checks the three rules:
 *
 *   1. a row with a parent takes the parent's workspace;
 *   2. a row with no parent takes the only workspace, when there is exactly one;
 *   3. otherwise the migration raises, names the table, and changes nothing.
 */

const TAG = '0028_workspace_hard_boundaries';

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

const opened: PGlite[] = [];

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

afterEach(async () => {
  for (const client of opened.splice(0)) await client.close();
});

const RUN = '00000000-0000-4000-8000-0000000000a1';
const ORPHAN_RUN = '00000000-0000-4000-8000-0000000000a2';

/** Rows shaped as an install before 0028 holds them. 0003 seeded `default-workspace`. */
async function seedLegacy(client: PGlite): Promise<void> {
  await client.exec(`
    INSERT INTO runs (id, started_at, workspace_id) VALUES ('${RUN}', now(), 'team-a');
    INSERT INTO runs (id, started_at) VALUES ('${ORPHAN_RUN}', now());
    INSERT INTO tests (id, run_id, title, file) VALUES ('t-1', '${RUN}', 't', 'f');
    INSERT INTO results (id, test_id, run_id, status) VALUES ('r-1', 't-1', '${RUN}', 'passed');
    INSERT INTO attachments (id, result_id, name, content_type, path)
      VALUES ('att-1', 'r-1', 'a.png', 'image/png', 'a.png');
    INSERT INTO artifacts (run_id, name, content_type, storage_key, checksum, size_bytes)
      VALUES ('${RUN}', 'a.log', 'text/plain', 'k/1', '${'a'.repeat(64)}', 1);
    INSERT INTO audit_events (timestamp, actor_id, action, workspace_id, created_at)
      VALUES (now(), 'someone', 'did.thing', 'team-a', now());
  `);
}

describe(TAG, () => {
  it('registers a workspace the data already names, and derives children from parents', async () => {
    const client = await applyBefore();
    await seedLegacy(client);
    // `team-a` is named by a run and an audit row but was never registered, which the
    // missing foreign key allowed. It is materialised rather than invented: the rows
    // already claim it. That makes two workspaces, so a parentless row is ambiguous —
    // the orphan run is removed first, as an operator would have to.
    await client.exec(`DELETE FROM runs WHERE id = '${ORPHAN_RUN}'`);
    await client.exec(
      `INSERT INTO quarantine (id, test_title, test_file, quarantined_at) VALUES ('q-1', 't', 'f', now())`,
    );
    await expect(applyTarget(client)).rejects.toThrow(/quarantine/);

    // Nothing was applied: the raise rolled the whole migration back.
    const column = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'tests' AND column_name = 'workspace_id'`,
    );
    expect(column.rows).toHaveLength(0);
  });

  it('backfills every table when exactly one workspace exists', async () => {
    const client = await applyBefore();
    await client.exec(`
      INSERT INTO runs (id, started_at, workspace_id) VALUES ('${RUN}', now(), 'default-workspace');
      INSERT INTO runs (id, started_at) VALUES ('${ORPHAN_RUN}', now());
      INSERT INTO tests (id, run_id, title, file) VALUES ('t-1', '${RUN}', 't', 'f');
      INSERT INTO results (id, test_id, run_id, status) VALUES ('r-1', 't-1', '${RUN}', 'passed');
      INSERT INTO attachments (id, result_id, name, content_type, path)
        VALUES ('att-1', 'r-1', 'a.png', 'image/png', 'a.png');
      INSERT INTO quarantine (id, test_title, test_file, quarantined_at) VALUES ('q-1', 't', 'f', now());
      INSERT INTO audit_events (timestamp, actor_id, action, created_at)
        VALUES (now(), 'someone', 'did.thing', now());
    `);

    await applyTarget(client);

    for (const [table, key, id] of [
      ['runs', 'id', RUN],
      ['runs', 'id', ORPHAN_RUN],
      ['tests', 'id', 't-1'],
      ['results', 'id', 'r-1'],
      ['attachments', 'id', 'att-1'],
      ['quarantine', 'id', 'q-1'],
    ] as const) {
      const row = await client.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM ${table} WHERE ${key} = $1`,
        [id],
      );
      expect(row.rows, `${table} ${id}`).toEqual([{ workspace_id: 'default-workspace' }]);
    }
    const audit = await client.query<{ workspace_id: string }>(
      'SELECT workspace_id FROM audit_events',
    );
    expect(audit.rows).toEqual([{ workspace_id: 'default-workspace' }]);
  });

  it('takes a child’s workspace from its parent even when several workspaces exist', async () => {
    const client = await applyBefore();
    await seedLegacy(client);
    await client.exec(`DELETE FROM runs WHERE id = '${ORPHAN_RUN}'`);

    await applyTarget(client);

    for (const [table, key, id] of [
      ['tests', 'id', 't-1'],
      ['results', 'id', 'r-1'],
      ['attachments', 'id', 'att-1'],
      ['artifacts', 'run_id', RUN],
    ] as const) {
      const row = await client.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM ${table} WHERE ${key} = $1`,
        [id],
      );
      expect(row.rows, `${table} ${id}`).toEqual([{ workspace_id: 'team-a' }]);
    }
    const registered = await client.query<{ id: string }>(
      `SELECT id FROM workspaces WHERE id = 'team-a'`,
    );
    expect(registered.rows).toHaveLength(1);
  });

  it('refuses a parentless run when the workspace cannot be decided', async () => {
    const client = await applyBefore();
    await seedLegacy(client);
    await expect(applyTarget(client)).rejects.toThrow(/runs/);
  });

  it('lets an operator name the workspace explicitly instead of failing', async () => {
    const client = await applyBefore();
    await seedLegacy(client);
    await client.exec(`SET automate.backfill_workspace = 'team-a'`);

    await applyTarget(client);

    const orphan = await client.query<{ workspace_id: string }>(
      'SELECT workspace_id FROM runs WHERE id = $1',
      [ORPHAN_RUN],
    );
    expect(orphan.rows).toEqual([{ workspace_id: 'team-a' }]);
  });

  it('refuses an explicit workspace that does not exist', async () => {
    const client = await applyBefore();
    await seedLegacy(client);
    await client.exec(`SET automate.backfill_workspace = 'nobody'`);
    await expect(applyTarget(client)).rejects.toThrow(/nobody/);
  });

  it('drops the redundant audit_events.tenant_id only when it agrees with workspace_id', async () => {
    const client = await applyBefore();
    await client.exec(`
      INSERT INTO audit_events (timestamp, actor_id, action, tenant_id, workspace_id, created_at)
        VALUES (now(), 'someone', 'did.thing', 'elsewhere', 'default-workspace', now());
    `);
    await expect(applyTarget(client)).rejects.toThrow(/tenant_id/);
  });

  it('leaves no helper behind and is a no-op on an empty install', async () => {
    const client = await applyBefore();
    await applyTarget(client);
    const helpers = await client.query(
      `SELECT 1 FROM pg_proc WHERE proname LIKE 'automate_backfill%'`,
    );
    expect(helpers.rows).toHaveLength(0);
    const tenant = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_events' AND column_name = 'tenant_id'`,
    );
    expect(tenant.rows).toHaveLength(0);
  });
});
