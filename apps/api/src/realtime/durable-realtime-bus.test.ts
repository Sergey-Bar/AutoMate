import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrizzleRealtimeFeed } from '../infrastructure/drizzle-realtime-feed.js';
import { createEventsRoutes } from '../routes/events.js';
import { DurableRealtimeBus, type DurableRealtimeWriter } from './durable-realtime-bus.js';
import type {
  CanonicalRealtimeEvent,
  RealtimeBusEvent,
  RunUpdatedPayload,
} from './realtime-bus.js';

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
  vi.restoreAllMocks();
});

async function createFeed(): Promise<DrizzleRealtimeFeed> {
  const client = new PGlite();
  clients.push(client);
  await client.exec(CREATE_OUTBOX_EVENTS);
  return new DrizzleRealtimeFeed(drizzle(client));
}

function runUpdated(overrides: Partial<RunUpdatedPayload> = {}): RunUpdatedPayload {
  return {
    type: 'run:updated',
    version: '1',
    runId: 'run-1',
    status: 'running',
    timestamp: '2026-05-06T00:00:00.000Z',
    ...overrides,
  };
}

function canonical(overrides: Partial<CanonicalRealtimeEvent> = {}): CanonicalRealtimeEvent {
  return {
    type: 'run.phase_changed',
    version: '1',
    eventId: '2f0a3f3e-6f0a-4a4a-9a4a-1b2c3d4e5f60',
    sequence: 1,
    occurredAt: '2026-05-06T00:00:00.000Z',
    runId: 'run-1',
    payload: { phase: 'running', outcome: null },
    ...overrides,
  };
}

async function readPage(feed: DrizzleRealtimeFeed, workspaceId = 'workspace-a') {
  return feed.readAfter({ workspaceId, afterSequence: 0, limit: 10 });
}

async function read(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read().then((chunk) => {
        if (chunk.done) throw new Error('SSE stream closed before the first frame');
        return chunk.value;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('SSE read timed out')), 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('DurableRealtimeBus', () => {
  it('persists a sanitized canonical event and notifies subscribers', async () => {
    const feed = await createFeed();
    const bus = new DurableRealtimeBus(feed, 'workspace-a');
    const received: RealtimeBusEvent[] = [];
    bus.subscribe((event) => received.push(event));

    await bus.publish(
      canonical({
        payload: {
          phase: 'running',
          outcome: null,
          apiKey: 'super-secret',
          nested: { authorization: 'Bearer token', title: 'checkout' },
        },
      }),
    );

    const rows = await readPage(feed);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe('run.phase_changed');
    expect(rows[0]?.aggregateId).toBe('run-1');
    expect(rows[0]?.workspaceId).toBe('workspace-a');
    expect(rows[0]?.payload).toEqual({
      type: 'run.phase_changed',
      version: '1',
      eventId: '2f0a3f3e-6f0a-4a4a-9a4a-1b2c3d4e5f60',
      sequence: 1,
      occurredAt: '2026-05-06T00:00:00.000Z',
      runId: 'run-1',
      payload: { phase: 'running', outcome: null, nested: { title: 'checkout' } },
    });
    expect(rows[0]?.expiresAt).toBeInstanceOf(Date);
    expect(received).toEqual([
      {
        type: 'run.phase_changed',
        version: '1',
        eventId: '2f0a3f3e-6f0a-4a4a-9a4a-1b2c3d4e5f60',
        sequence: 1,
        occurredAt: '2026-05-06T00:00:00.000Z',
        runId: 'run-1',
        payload: { phase: 'running', outcome: null, nested: { title: 'checkout' } },
      },
    ]);
  });

  it('writes one row and one notification per distinct event', async () => {
    const feed = await createFeed();
    const bus = new DurableRealtimeBus(feed, 'workspace-a');
    const received: RealtimeBusEvent[] = [];
    bus.subscribe((event) => received.push(event));

    await bus.publish(canonical());
    await bus.publish(canonical());
    await bus.publish(runUpdated());
    await bus.publish(runUpdated());
    await bus.publish(runUpdated({ status: 'passed' }));

    const rows = await readPage(feed);
    expect(rows.map((row) => row.eventType)).toEqual([
      'run.phase_changed',
      'run:updated',
      'run:updated',
    ]);
    expect(received).toHaveLength(3);
  });

  it('falls back to the publish time when the event timestamp is unusable', async () => {
    const feed = await createFeed();
    const bus = new DurableRealtimeBus(feed, 'workspace-a', 48);

    await bus.publish(runUpdated({ timestamp: 'not-a-timestamp' }));

    const rows = await readPage(feed);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurredAt).toBeInstanceOf(Date);
    expect(Number.isNaN(rows[0]?.occurredAt.getTime() ?? Number.NaN)).toBe(false);
  });

  it('unsubscribes without dropping later events', async () => {
    const feed = await createFeed();
    const bus = new DurableRealtimeBus(feed, 'workspace-a');
    const received: RealtimeBusEvent[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event));

    unsubscribe();
    unsubscribe();
    await bus.publish(runUpdated());

    expect(received).toEqual([]);
    expect(await readPage(feed)).toHaveLength(1);
  });

  it('logs and resolves when the outbox write keeps failing, rather than rejecting', async () => {
    // `publish` is a reporting concern called from the middle of request
    // handling and store transactions. Rethrowing after the retry budget let a
    // failing outbox fail the write it was reporting on — a monitoring path
    // taking down the service it observes.
    const failure = new Error('outbox unavailable');
    const feed: DurableRealtimeWriter = { append: async () => Promise.reject(failure) };
    const bus = new DurableRealtimeBus(feed, 'workspace-a', 24, 2, 1);
    const received: RealtimeBusEvent[] = [];
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bus.subscribe((event) => received.push(event));

    await expect(bus.publish(runUpdated())).resolves.toBeUndefined();

    expect(received).toEqual([]);
    expect(logged).toHaveBeenCalledWith('durable realtime publish failed', failure);
  });
});

describe('durable realtime composition', () => {
  it('replays a published run:updated event over the SSE route', async () => {
    const feed = await createFeed();
    const bus = new DurableRealtimeBus(feed, 'workspace-a');
    const app = new Hono();
    app.route(
      '/',
      createEventsRoutes({ bus, feed, workspaceId: 'workspace-a', pollIntervalMs: 60_000 }),
    );

    await bus.publish(runUpdated({ status: 'passed' }));

    const response = await app.request('/api/v1/events?cursor=0');
    const reader = response.body!.getReader();
    try {
      const frame = new TextDecoder().decode(await read(reader));
      expect(frame).toContain('id: 1');
      expect(frame).toContain('event: run.phase_changed');
      expect(frame).toContain('"status":"passed"');
    } finally {
      await reader.cancel();
    }
  });
});
