import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrizzleRealtimeFeed } from './drizzle-realtime-feed.js';

const CREATE_OUTBOX_EVENTS = `
  CREATE TABLE outbox_events (
    sequence integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id text,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    event_type text NOT NULL,
    event_version integer DEFAULT 2 NOT NULL,
    payload jsonb NOT NULL,
    dedupe_key text NOT NULL,
    occurred_at timestamptz DEFAULT now() NOT NULL,
    expires_at timestamptz
  );
  CREATE UNIQUE INDEX outbox_events_dedupe_idx ON outbox_events (dedupe_key);
`;

const clients: PGlite[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function createFeed(): Promise<DrizzleRealtimeFeed> {
  const client = new PGlite();
  clients.push(client);
  await client.exec(CREATE_OUTBOX_EVENTS);
  return new DrizzleRealtimeFeed(drizzle(client));
}

describe('DrizzleRealtimeFeed', () => {
  it('inserts one row for each dedupe key', async () => {
    const feed = await createFeed();
    const event = {
      workspaceId: 'workspace-a',
      aggregateType: 'run',
      aggregateId: 'run-1',
      eventType: 'run.updated',
      dedupeKey: 'run-1:updated:1',
      payload: { runId: 'run-1', status: 'running' },
    };

    const inserted = await feed.append(event);
    const duplicate = await feed.append({
      ...event,
      payload: { runId: 'run-1', status: 'passed' },
    });

    expect(inserted?.sequence).toBeTypeOf('number');
    expect(duplicate).toBeNull();
  });

  it('inserts a batch of events in one operation', async () => {
    const feed = await createFeed();
    const inserted = await feed.appendMany([
      {
        workspaceId: 'workspace-a',
        aggregateType: 'run',
        aggregateId: 'run-1',
        eventType: 'run.updated',
        dedupeKey: 'batch-1',
        payload: {},
      },
      {
        workspaceId: 'workspace-a',
        aggregateType: 'run',
        aggregateId: 'run-2',
        eventType: 'run.updated',
        dedupeKey: 'batch-2',
        payload: {},
      },
    ]);
    expect(inserted).toHaveLength(2);
    expect((await feed.readAfter({ workspaceId: 'workspace-a', afterSequence: 0 })).length).toBe(2);
  });

  it('reads retained workspace events in sequence order with a bounded page', async () => {
    const feed = await createFeed();
    await feed.append({
      workspaceId: 'workspace-a',
      aggregateType: 'run',
      aggregateId: 'run-1',
      eventType: 'run.updated',
      dedupeKey: 'a-1',
      payload: { runId: 'run-1' },
    });
    await feed.append({
      workspaceId: 'workspace-b',
      aggregateType: 'run',
      aggregateId: 'run-2',
      eventType: 'run.updated',
      dedupeKey: 'b-1',
      payload: { runId: 'run-2' },
    });
    await feed.append({
      workspaceId: 'workspace-a',
      aggregateType: 'run',
      aggregateId: 'run-3',
      eventType: 'run.completed',
      dedupeKey: 'a-2',
      payload: { runId: 'run-3' },
    });
    await feed.append({
      workspaceId: 'workspace-a',
      aggregateType: 'run',
      aggregateId: 'run-4',
      eventType: 'run.updated',
      dedupeKey: 'a-expired',
      payload: { runId: 'run-4' },
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    const ordered = await feed.readAfter({
      workspaceId: 'workspace-a',
      afterSequence: 0,
      limit: 10,
    });
    const page = await feed.readAfter({
      workspaceId: 'workspace-a',
      afterSequence: 0,
      limit: 1,
    });

    expect(ordered.map((event) => event.dedupeKey)).toEqual(['a-1', 'a-2']);
    expect(page.map((event) => event.dedupeKey)).toEqual(['a-1']);
  });

  it('purges expired rows and fans out live rows through one workspace pump', async () => {
    const feed = await createFeed();
    await feed.append({
      workspaceId: 'workspace-a',
      aggregateType: 'run',
      aggregateId: 'run-expired',
      eventType: 'run.updated',
      dedupeKey: 'pump-expired',
      payload: {},
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    const received: string[] = [];
    const unsubscribe = feed.subscribe(
      'workspace-a',
      0,
      (event) => {
        received.push(event.dedupeKey);
      },
      5,
    );
    await feed.append({
      workspaceId: 'workspace-a',
      aggregateType: 'run',
      aggregateId: 'run-live',
      eventType: 'run.updated',
      dedupeKey: 'pump-live',
      payload: {},
    });
    await vi.waitFor(() => expect(received).toContain('pump-live'));
    unsubscribe();
    expect(await feed.purgeExpired(new Date('2021-01-01T00:00:00.000Z'))).toBe(1);
  });

  it('reports the oldest unexpired sequence as the retention floor', async () => {
    const feed = await createFeed();
    await feed.append({
      workspaceId: 'workspace-a',
      aggregateType: 'run',
      aggregateId: 'run-1',
      eventType: 'run.updated',
      dedupeKey: 'expired',
      payload: {},
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    await feed.append({
      workspaceId: 'workspace-b',
      aggregateType: 'run',
      aggregateId: 'run-2',
      eventType: 'run.updated',
      dedupeKey: 'retained',
      payload: {},
    });

    await expect(feed.getRetentionFloor()).resolves.toBe(2);
  });
});
