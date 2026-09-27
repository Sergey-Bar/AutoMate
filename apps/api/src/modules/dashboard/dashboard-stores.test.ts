import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleQualityGateStore, DrizzleQuarantineStore } from './drizzle-stores.js';
import { ResolveQuarantineBodySchema } from './schemas.js';

/**
 * The dashboard's Postgres stores, against the **real** migration graph.
 *
 * These used to be tested against a hand-rolled fake `db` object whose `select`
 * returned whatever array the test had pre-loaded — which is how the suite came to
 * assert `insertedQuality[0]?.workspaceId === 'Main gate'`, i.e. it **encoded the
 * bug it was meant to catch**. `DrizzleQualityGateStore.add()` wrote the gate's
 * display name into `workspace_id`; the fake never noticed because a fake cannot
 * hold a value in the wrong column, and the test recorded the wrong column as the
 * expected one.
 *
 * A real database does notice: `name` is `NOT NULL`, `workspace_id` is a scoping
 * column, and the CHECK on `quarantine` ties a resolution to a timestamp. So the
 * tests below run on PGlite with every migration applied, and the assertions are
 * about what the database actually stored.
 */

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../packages/db/drizzle',
);

function migrationSql(): string {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

/**
 * Fails when `@automate/db` has not been rebuilt, because the schema this file
 * compares against would otherwise be whatever was last built — a drift test that
 * silently checks yesterday passes without checking anything.
 */
function assertSchemaBuildIsFresh(): void {
  const packageRoot = path.resolve(drizzleDirectory, '..');
  const buildTime = statSync(path.join(packageRoot, 'dist', 'index.js')).mtimeMs;
  const stack = [path.join(packageRoot, 'src')];
  const stale: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.ts') && statSync(full).mtimeMs > buildTime) stale.push(full);
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `packages/db is not built: ${stale.length} source file(s) are newer than dist/. ` +
        'Use `pnpm test` (turbo builds dependencies first).',
    );
  }
}

let client: PGlite;
let gates: DrizzleQualityGateStore;
let quarantineStore: DrizzleQuarantineStore;

const actor = { actorId: 'tester@example', actorType: 'user' as const };

beforeAll(async () => {
  assertSchemaBuildIsFresh();
  client = new PGlite();
  await client.exec(migrationSql());
  const db = drizzle(client, { schema });
  gates = new DrizzleQualityGateStore(db as never);
  quarantineStore = new DrizzleQuarantineStore(db as never);
});

afterAll(async () => {
  if (client) await client.close();
});

async function auditRowsFor(
  resourceId: string,
): Promise<Array<{ action: string; actor_id: string; details: Record<string, unknown> | null }>> {
  const result = await client.query<{
    action: string;
    actor_id: string;
    details: Record<string, unknown> | null;
  }>('SELECT action, actor_id, details FROM audit_events WHERE resource_id = $1 ORDER BY action', [
    resourceId,
  ]);
  return result.rows;
}

describe('DrizzleQualityGateStore', () => {
  it('lists the global default, because it is the row a threshold falls back to', async () => {
    await client.exec(
      "INSERT INTO quality_gate_config (id, name, pass_rate_threshold, updated_at) VALUES ('global', 'Global default', 90, now())",
    );

    const listed = await gates.list();

    const global = listed.find((gate) => gate.id === 'global');
    // The previous `list()` filtered this row out with `ne(id, 'global')`, so on a
    // fresh install — where the default is the *only* row — the dashboard reported
    // no gates at all. The operator could not see the threshold being applied.
    expect(global, 'the default gate config was filtered out of the listing').toBeDefined();
    expect(global?.name).toBe('Global default');
    expect(global?.passRateThreshold).toBe(90);
  });

  it('reads a gate name from `name`, not from the scoping column', async () => {
    await client.exec(
      "INSERT INTO quality_gate_config (id, name, workspace_id, pass_rate_threshold, updated_at) VALUES ('scoped-1', 'Release gate', 'ws-a', 92, now())",
    );

    const gate = await gates.get('scoped-1');

    // The previous mapping returned `row.workspaceId` under the heading "name", so a
    // properly scoped gate was displayed as its workspace identifier.
    expect(gate?.name).toBe('Release gate');
  });

  it('round-trips a created gate through its own name and leaves the scope unset', async () => {
    const created = await gates.add({ name: 'Main branch gate', passRateThreshold: 90 }, actor);

    const stored = await client.query<{ name: string; workspace_id: string | null }>(
      'SELECT name, workspace_id FROM quality_gate_config WHERE id = $1',
      [created.id],
    );
    // The `name` column holds the name, and `workspace_id` — the column that decides
    // visibility — is null, because a gate the dashboard created is not scoped to a
    // workspace. Writing the name there is the defect migration 0012 undoes.
    expect(stored.rows[0]?.name).toBe('Main branch gate');
    expect(stored.rows[0]?.workspace_id).toBeNull();
    await expect(gates.get(created.id)).resolves.toEqual(created);
  });

  it('records the creation, attributed, in the same transaction as the gate', async () => {
    const created = await gates.add({ name: 'Audited gate', passRateThreshold: 80 }, actor);

    const rows = await auditRowsFor(created.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('quality_gate.created');
    expect(rows[0]?.actor_id).toBe('tester@example');
    expect(rows[0]?.details).toMatchObject({ name: 'Audited gate', passRateThreshold: 80 });
  });

  it('returns null for a gate that does not exist', async () => {
    await expect(gates.get('no-such-gate')).resolves.toBeNull();
  });
});

describe('DrizzleQuarantineStore', () => {
  async function quarantineOne(title: string): Promise<string> {
    const created = await quarantineStore.add(
      { testTitle: title, testFile: 'e2e/login.spec.ts', reason: 'CI instability' },
      actor,
    );
    return created.id;
  }

  it('creates an entry as pending, so a fresh quarantine excludes nothing yet', async () => {
    const created = await quarantineStore.add(
      { testTitle: 'flaky login', testFile: 'e2e/login.spec.ts', reason: null },
      actor,
    );

    expect(created.status).toBe('pending');
    const stored = await client.query<{ status: string }>(
      'SELECT status FROM quarantine WHERE id = $1',
      [created.id],
    );
    expect(stored.rows[0]?.status).toBe('pending');
  });

  it('records the creation with its actor', async () => {
    const id = await quarantineOne('audited quarantine');

    const rows = await auditRowsFor(id);

    expect(rows.map((row) => row.action)).toContain('quarantine.created');
    expect(rows.every((row) => row.actor_id === 'tester@example')).toBe(true);
  });

  it('moves a pending entry to approved with a resolution, and records the decision', async () => {
    const id = await quarantineOne('approvable');

    const outcome = await quarantineStore.resolve(
      id,
      ResolveQuarantineBodySchema.parse({
        status: 'approved',
        resolution: 'fixed in #412',
        resolutionType: 'fixed',
      }),
      actor,
    );

    expect(outcome.kind).toBe('resolved');
    const stored = await client.query<{
      status: string;
      resolved_at: Date | null;
      resolution_type: string | null;
    }>('SELECT status, resolved_at, resolution_type FROM quarantine WHERE id = $1', [id]);
    expect(stored.rows[0]?.status).toBe('approved');
    // The database CHECK ties a resolution to a time-to-fix, so the write sets both
    // or the statement is refused.
    expect(stored.rows[0]?.resolved_at).not.toBeNull();
    expect(stored.rows[0]?.resolution_type).toBe('fixed');

    const rows = await auditRowsFor(id);
    expect(rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['quarantine.created', 'quarantine.approved']),
    );
  });

  it('refuses to re-open a resolved entry, and names the states it may take', async () => {
    const id = await quarantineOne('decided');
    await quarantineStore.resolve(
      id,
      ResolveQuarantineBodySchema.parse({ status: 'rejected', resolution: 'not a real flake' }),
      actor,
    );

    const outcome = await quarantineStore.resolve(
      id,
      ResolveQuarantineBodySchema.parse({ status: 'approved', resolution: 'changed my mind' }),
      actor,
    );

    expect(outcome).toEqual({ kind: 'illegal_transition', from: 'rejected', to: 'approved' });
    // And the database still says what it said: a refused decision is not a decision.
    const stored = await client.query<{ status: string }>(
      'SELECT status FROM quarantine WHERE id = $1',
      [id],
    );
    expect(stored.rows[0]?.status).toBe('rejected');
    const rows = await auditRowsFor(id);
    expect(rows.map((row) => row.action)).not.toContain('quarantine.approved');
  });

  it('is idempotent, so a retried decision does not append a second record', async () => {
    const id = await quarantineOne('retried');
    const body = ResolveQuarantineBodySchema.parse({ status: 'approved', resolution: 'fixed' });

    await quarantineStore.resolve(id, body, actor);
    const second = await quarantineStore.resolve(id, body, actor);

    expect(second.kind).toBe('resolved');
    const approvals = (await auditRowsFor(id)).filter(
      (row) => row.action === 'quarantine.approved',
    );
    expect(approvals).toHaveLength(1);
  });

  it('reports a missing entry rather than inventing one', async () => {
    await expect(
      quarantineStore.resolve(
        'no-such-entry',
        ResolveQuarantineBodySchema.parse({ status: 'approved', resolution: 'fixed' }),
        actor,
      ),
    ).resolves.toEqual({ kind: 'not_found' });
  });

  it('records a removal, because an unrecorded removal re-hides a test silently', async () => {
    const id = await quarantineOne('removable');

    await expect(quarantineStore.remove(id, actor)).resolves.toBe(true);

    const rows = await auditRowsFor(id);
    expect(rows.map((row) => row.action)).toContain('quarantine.removed');
    await expect(quarantineStore.remove(id, actor)).resolves.toBe(false);
    expect(await auditRowsFor(id)).toHaveLength(rows.length);
  });
});
