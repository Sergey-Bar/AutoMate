/**
 * Cross-workspace isolation for `quarantine` and `audit_events` (ledger MNT-17).
 *
 * `quarantine` had no workspace column at all, so `GET /api/v1/dashboard/quarantine`,
 * the resolve and the delete answered for the whole installation, and the readiness
 * card counted every workspace's pending entries. `audit_events.workspace_id` existed
 * and was written as NULL by every production writer, because nothing in the dashboard
 * module knew the workspace. Both stores are now bound to one workspace at construction,
 * and the audit row takes its workspace from the store rather than from a caller.
 *
 * On PGlite with the real migration graph: the column and its foreign key are the thing
 * being proved.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleQualityGateStore, DrizzleQuarantineStore } from './drizzle-stores.js';
import { ResolveQuarantineBodySchema } from './schemas.js';

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

const WS_A = 'ws-dashboard-a';
const WS_B = 'ws-dashboard-b';
const actor = { actorId: 'tester@example', actorType: 'user' as const };

let client: PGlite;
let mine: DrizzleQuarantineStore;
let theirs: DrizzleQuarantineStore;
let gates: DrizzleQualityGateStore;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql());
  const db = drizzle(client, { schema });
  for (const id of [WS_A, WS_B]) {
    await db
      .insert(schema.workspaces)
      .values({ id, name: id, configPath: 'config', createdAt: new Date() });
  }
  mine = new DrizzleQuarantineStore(db as never, WS_A);
  theirs = new DrizzleQuarantineStore(db as never, WS_B);
  gates = new DrizzleQualityGateStore(db as never, WS_A);
});

afterAll(async () => {
  if (client) await client.close();
});

async function auditFor(resourceId: string) {
  const rows = await client.query<{ action: string; workspace_id: string | null }>(
    'SELECT action, workspace_id FROM audit_events WHERE resource_id = $1 ORDER BY action',
    [resourceId],
  );
  return rows.rows;
}

describe('a quarantine entry', () => {
  it('is stored, and audited, in the workspace that created it', async () => {
    const created = await mine.add(
      { testTitle: 'flaky login', testFile: 'e2e/login.spec.ts', reason: null },
      actor,
    );
    const row = await client.query<{ workspace_id: string }>(
      'SELECT workspace_id FROM quarantine WHERE id = $1',
      [created.id],
    );
    expect(row.rows.map((entry) => entry.workspace_id)).toEqual([WS_A]);
    expect(await auditFor(created.id)).toEqual([
      { action: 'quarantine.created', workspace_id: WS_A },
    ]);
  });

  it('cannot be listed, resolved or removed from another workspace', async () => {
    const created = await mine.add(
      { testTitle: 'flaky checkout', testFile: 'e2e/checkout.spec.ts', reason: 'CI' },
      actor,
    );

    expect((await theirs.list()).map((entry) => entry.id)).not.toContain(created.id);
    const decision = ResolveQuarantineBodySchema.parse({
      status: 'approved',
      resolution: 'not theirs to decide',
      resolutionType: 'fixed',
    });
    expect(await theirs.resolve(created.id, decision, actor)).toEqual({ kind: 'not_found' });
    expect(await theirs.remove(created.id, actor)).toBe(false);

    // Untouched, and nothing was recorded for decisions that did not happen.
    const row = await client.query<{ status: string }>(
      'SELECT status FROM quarantine WHERE id = $1',
      [created.id],
    );
    expect(row.rows).toEqual([{ status: 'pending' }]);
    expect(await auditFor(created.id)).toEqual([
      { action: 'quarantine.created', workspace_id: WS_A },
    ]);
    expect((await mine.list()).map((entry) => entry.id)).toContain(created.id);
  });
});

describe('an audit event', () => {
  it('names the workspace even for an installation-wide gate', async () => {
    // The gate row stays installation-wide (`workspace_id` NULL is the default gate);
    // the *decision* to create it was made by an operator of one workspace, and the
    // audit trail is that workspace's.
    const created = await gates.add({ name: 'tenancy gate', passRateThreshold: 90 }, actor);
    expect(await auditFor(created.id)).toEqual([
      { action: 'quality_gate.created', workspace_id: WS_A },
    ]);
  });
});
