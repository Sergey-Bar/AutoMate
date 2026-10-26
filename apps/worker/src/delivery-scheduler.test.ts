import { describe, expect, it } from 'vitest';
import { InMemoryExecutionStore } from './in-memory-store.js';
import { deliverySlot, pollDeliverySyncs } from './scheduler.js';
import type { DeliverySourceDue } from './types.js';

/**
 * A due delivery source queues one sync per slot, and nothing more.
 *
 * The worker has no vault, so it never talks to GitHub: its whole part is one row in
 * `delivery_syncs`, keyed `delivery:<sourceId>:<slot>`, which the API's syncer claims.
 */
const source = (overrides: Partial<DeliverySourceDue> = {}): DeliverySourceDue => ({
  id: 'src-1',
  workspaceId: 'ws-1',
  projectId: 'p-1',
  cadence: 'hourly',
  nextSyncAt: '2026-10-23T11:00:00.000Z',
  ...overrides,
});

describe('deliverySlot', () => {
  it('names the UTC hour or day a moment is in, and when the next one starts', () => {
    const now = new Date('2026-10-23T11:42:10.000Z');
    expect(deliverySlot('hourly', now)).toEqual({
      slot: '2026-10-23T11',
      next: '2026-10-23T12:00:00.000Z',
    });
    expect(deliverySlot('daily', now)).toEqual({
      slot: '2026-10-23',
      next: '2026-10-24T00:00:00.000Z',
    });
  });
});

describe('pollDeliverySyncs', () => {
  it('queues one sync for a due source and points it at the next slot', async () => {
    const store = new InMemoryExecutionStore();
    store.addDeliverySource(source());
    expect(await pollDeliverySyncs(store, new Date('2026-10-23T11:42:00.000Z'), 10)).toBe(1);
    expect(store.listDeliverySyncs()).toEqual([
      {
        workspaceId: 'ws-1',
        projectId: 'p-1',
        sourceId: 'src-1',
        requestedBy: 'schedule',
        idempotencyKey: 'delivery:src-1:2026-10-23T11',
      },
    ]);
    // Polled again in the same hour: the source is no longer due.
    expect(await pollDeliverySyncs(store, new Date('2026-10-23T11:59:00.000Z'), 10)).toBe(0);
    expect(await pollDeliverySyncs(store, new Date('2026-10-23T12:00:00.000Z'), 10)).toBe(1);
    expect(store.listDeliverySyncs().map((sync) => sync.idempotencyKey)).toEqual([
      'delivery:src-1:2026-10-23T11',
      'delivery:src-1:2026-10-23T12',
    ]);
  });

  it('queues one sync after downtime, not one per missed slot', async () => {
    const store = new InMemoryExecutionStore();
    store.addDeliverySource(source({ cadence: 'daily', nextSyncAt: '2026-10-18T00:00:00.000Z' }));
    expect(await pollDeliverySyncs(store, new Date('2026-10-23T09:00:00.000Z'), 10)).toBe(1);
    expect(store.listDeliverySyncs().map((sync) => sync.idempotencyKey)).toEqual([
      'delivery:src-1:2026-10-23',
    ]);
  });

  it('queues a slot once even when two workers race for it', async () => {
    const store = new InMemoryExecutionStore();
    store.addDeliverySource(source());
    const now = new Date('2026-10-23T11:42:00.000Z');
    const [due] = await store.listDueDeliverySources(now, 10);
    const input = {
      source: due as DeliverySourceDue,
      now: now.toISOString(),
      nextSyncAt: '2026-10-23T12:00:00.000Z',
      idempotencyKey: 'delivery:src-1:2026-10-23T11',
    };
    expect(await store.enqueueDeliverySync(input)).toBe(true);
    expect(await store.enqueueDeliverySync(input)).toBe(false);
    // Due again, but the slot's key is taken: still one row.
    store.addDeliverySource(source());
    expect(await store.enqueueDeliverySync(input)).toBe(false);
    expect(store.listDeliverySyncs()).toHaveLength(1);
    expect(await store.enqueueDeliverySync({ ...input, source: source({ id: 'unknown' }) })).toBe(
      false,
    );
  });

  it('serves the longest-due source first, up to the batch', async () => {
    const store = new InMemoryExecutionStore();
    store.addDeliverySource(source({ id: 'late', nextSyncAt: '2026-10-23T11:30:00.000Z' }));
    store.addDeliverySource(source({ id: 'early', nextSyncAt: '2026-10-23T10:00:00.000Z' }));
    store.addDeliverySource(source({ id: 'future', nextSyncAt: '2026-10-23T13:00:00.000Z' }));
    const due = await store.listDueDeliverySources(new Date('2026-10-23T11:42:00.000Z'), 1);
    expect(due.map((entry) => entry.id)).toEqual(['early']);
  });

  it('does nothing for a store that has no delivery sources', async () => {
    const store = new InMemoryExecutionStore();
    expect(await pollDeliverySyncs(store, new Date(), 10)).toBe(0);
    const halfway = { listDueDeliverySources: store.listDueDeliverySources.bind(store) };
    expect(await pollDeliverySyncs(halfway as never, new Date(), 10)).toBe(0);
  });
});
