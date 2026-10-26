import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedDatabase, storeOnPglite } from './test-support/pglite.js';
import { pollDeliverySyncs } from './scheduler.js';
import type { DeliverySourceDue } from './types.js';
import { ExecutionWorker } from './worker.js';

/**
 * Delivery sync scheduling against the real migration graph: which sources are due, the
 * compare-and-set that moves a source to its next slot, and the one row per slot.
 */

let database: PGlite;
let projectId = '';

beforeAll(async () => {
  database = await migratedDatabase();
}, 120_000);

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database.query('DELETE FROM delivery_syncs');
  await database.query('DELETE FROM delivery_sources');
});

async function source(seed: { enabled?: boolean; cadence?: string; nextSyncAt?: string }) {
  // One source per project, so each seed is its own project.
  const created = await database.query<{ id: string }>(
    `INSERT INTO projects (workspace_id, name, slug) VALUES ('default-workspace', 'p', gen_random_uuid()::text) RETURNING id`,
  );
  projectId = created.rows[0]?.id as string;
  const result = await database.query<{ id: string }>(
    `INSERT INTO delivery_sources (workspace_id, project_id, enabled, cadence, next_sync_at)
     VALUES ('default-workspace', $1, $2, $3, $4::timestamptz) RETURNING id`,
    [
      projectId,
      seed.enabled ?? true,
      seed.cadence ?? 'hourly',
      seed.nextSyncAt ?? '2026-10-23T11:00:00.000Z',
    ],
  );
  return result.rows[0]?.id as string;
}

const syncs = async () =>
  (
    await database.query<{ idempotency_key: string; requested_by: string; status: string }>(
      'SELECT idempotency_key, requested_by, status FROM delivery_syncs ORDER BY created_at',
    )
  ).rows;

describe('delivery sync scheduling on PostgreSQL', () => {
  it('lists only enabled, due sources, oldest first, as their cadence says', async () => {
    const early = await source({ nextSyncAt: '2026-10-23T10:00:00.000Z', cadence: 'daily' });
    const earlyProject = projectId;
    await source({ nextSyncAt: '2026-10-23T11:30:00.000Z' });
    await source({ nextSyncAt: '2026-10-23T13:00:00.000Z' });
    await source({ enabled: false, nextSyncAt: '2026-10-23T09:00:00.000Z' });
    const store = storeOnPglite(database);
    const due = await store.listDueDeliverySources(new Date('2026-10-23T11:42:00.000Z'), 10);
    expect(due.map((entry) => entry.cadence)).toEqual(['daily', 'hourly']);
    expect(due[0]).toEqual({
      id: early,
      workspaceId: 'default-workspace',
      projectId: earlyProject,
      cadence: 'daily',
      nextSyncAt: '2026-10-23T10:00:00.000Z',
    });
    expect(
      await store.listDueDeliverySources(new Date('2026-10-23T11:42:00.000Z'), 1),
    ).toHaveLength(1);
  });

  it('queues one sync per slot, however often and by however many workers it is polled', async () => {
    const id = await source({});
    const now = new Date('2026-10-23T11:42:00.000Z');
    expect(await pollDeliverySyncs(storeOnPglite(database), now, 10)).toBe(1);
    expect(await pollDeliverySyncs(storeOnPglite(database), now, 10)).toBe(0);
    expect(await syncs()).toEqual([
      {
        idempotency_key: `delivery:${id}:2026-10-23T11`,
        requested_by: 'schedule',
        status: 'queued',
      },
    ]);
    const pointer = await database.query<{ next_sync_at: Date }>(
      'SELECT next_sync_at FROM delivery_sources WHERE id = $1',
      [id],
    );
    expect(new Date(pointer.rows[0]?.next_sync_at as Date).toISOString()).toBe(
      '2026-10-23T12:00:00.000Z',
    );
  });

  it('refuses a source that was disabled, or moved on, after it was listed', async () => {
    const id = await source({});
    const store = storeOnPglite(database);
    const now = new Date('2026-10-23T11:42:00.000Z');
    const [due] = await store.listDueDeliverySources(now, 10);
    await database.query('UPDATE delivery_sources SET enabled = false WHERE id = $1', [id]);
    const input = {
      source: due as DeliverySourceDue,
      now: now.toISOString(),
      nextSyncAt: '2026-10-23T12:00:00.000Z',
      idempotencyKey: `delivery:${id}:2026-10-23T11`,
    };
    expect(await store.enqueueDeliverySync(input)).toBe(false);
    await database.query('UPDATE delivery_sources SET enabled = true WHERE id = $1', [id]);
    expect(await store.enqueueDeliverySync(input)).toBe(true);
    // Due again by hand, but the slot is taken: the key holds it to one row.
    await database.query(
      `UPDATE delivery_sources SET next_sync_at = '2026-10-23T11:00:00Z' WHERE id = $1`,
      [id],
    );
    expect(await store.enqueueDeliverySync(input)).toBe(false);
    expect(await syncs()).toHaveLength(1);
  });

  it('adds no second queued sync when one already waits for the source', async () => {
    const id = await source({});
    const store = storeOnPglite(database);
    const now = new Date('2026-10-23T11:42:00.000Z');
    const [due] = await store.listDueDeliverySources(now, 10);
    const input = {
      source: due as DeliverySourceDue,
      now: now.toISOString(),
      nextSyncAt: '2026-10-23T12:00:00.000Z',
      idempotencyKey: `delivery:${id}:2026-10-23T11`,
    };
    // An operator's sync is already queued under another key.
    expect(await store.enqueueDeliverySync({ ...input, idempotencyKey: 'operator-request' })).toBe(
      true,
    );
    await database.query(
      `UPDATE delivery_sources SET next_sync_at = '2026-10-23T11:00:00Z' WHERE id = $1`,
      [id],
    );
    expect(await store.enqueueDeliverySync(input)).toBe(false);
    expect(await syncs()).toHaveLength(1);
  });

  it('is polled by the worker loop, beside schedules and reports', async () => {
    await source({ nextSyncAt: '2026-01-01T00:00:00.000Z' });
    const worker = new ExecutionWorker({
      store: storeOnPglite(database),
      runnerId: 'w',
      capabilities: [],
      labels: [],
      slots: 1,
      pollIntervalMs: 1000,
      leaseDurationMs: 1000,
      leaseRenewIntervalMs: 500,
    });
    await worker.runOnce(new Date('2026-10-23T11:42:00.000Z'));
    expect(await syncs()).toHaveLength(1);
  });
});
