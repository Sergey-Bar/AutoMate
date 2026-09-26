import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleRealtimeFeed } from '../infrastructure/drizzle-realtime-feed.js';
import { DurableRealtimeBus } from './durable-realtime-bus.js';

/**
 * The realtime path was lossy in a way nothing reported.
 *
 * `pump` advanced a subscription's cursor *before* awaiting its listener, so a
 * listener that threw — an SSE write to a client that had already gone away —
 * advanced the cursor past an event that was therefore never delivered, and
 * never delivered again. The loop was also `for (subscription) await listener()`,
 * so one throw aborted the page for every later subscriber of the same
 * workspace. And `publish` rethrew after its retry budget, so a failing outbox
 * failed the write it was reporting on: a monitoring path taking down the service
 * it observes.
 *
 * These run against the real schema on PGlite rather than a fake, because the
 * feed wraps a *database* — a stub repository would have tested the stub.
 */
const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/drizzle',
);

function readMigrations(): string {
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

let client: PGlite;
let counter = 0;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(readMigrations());
  const db = drizzle(client, { schema });
  await db.insert(schema.workspaces).values({
    id: 'ws',
    name: 'default',
    configPath: 'config',
    testResultsDir: 'var/results',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}, 120_000);

afterAll(async () => {
  if (client) await client.close();
});

/** A feed on the real database, with one fresh outbox event appended. */
async function feedWithOneEvent() {
  const feed = new DrizzleRealtimeFeed(drizzle(client, { schema }));
  counter += 1;
  await feed.append({
    workspaceId: 'ws',
    aggregateType: 'run',
    aggregateId: `run-${counter}`,
    eventType: 'run.queued',
    eventVersion: 1,
    payload: { type: 'run.queued', runId: `run-${counter}` },
    dedupeKey: `parity-${counter}`,
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  return feed;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the outbox feed is lossless', () => {
  it('retries an event its listener failed to deliver instead of skipping it', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const feed = await feedWithOneEvent();
      const delivered: string[] = [];
      let failNext = true;

      const unsubscribe = feed.subscribe(
        'ws',
        0,
        async (event) => {
          if (failNext) {
            failNext = false;
            throw new Error('client went away');
          }
          delivered.push(event.eventId);
        },
        20,
      );

      await wait(200);
      // Unsubscribe before the test ends: the pump ticks on an interval, and a
      // tick still in flight when `afterAll` closes PGlite rejects — noise that
      // looks exactly like a real failure and is not one.
      unsubscribe();

      // Advancing the cursor before the call meant the event was never retried,
      // so a client that dropped one write lost that event permanently.
      expect(delivered.length).toBeGreaterThan(0);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('delivers to every subscriber even when one of them throws', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const feed = await feedWithOneEvent();
      const reached: string[] = [];
      const deliver = (label: string) => () => {
        reached.push(label);
      };

      const first = feed.subscribe(
        'ws',
        0,
        () => {
          throw new Error('first subscriber is broken');
        },
        20,
      );
      const second = feed.subscribe('ws', 0, deliver('second'), 20);
      const third = feed.subscribe('ws', 0, deliver('third'), 20);

      await wait(200);
      // See the note above: a tick in flight at teardown rejects against a closed
      // PGlite, which looks identical to a real failure.
      first();
      second();
      third();

      // The loop used to abort on the first throw, skipping the rest.
      expect(reached).toContain('second');
      expect(reached).toContain('third');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('logs a subscriber failure rather than swallowing it', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const feed = await feedWithOneEvent();
      const unsubscribe = feed.subscribe(
        'ws',
        0,
        () => {
          throw new Error('client went away');
        },
        20,
      );
      await wait(150);
      unsubscribe();
      const logged = JSON.stringify(errorLog.mock.calls);
      expect(logged).toContain('client went away');
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe('publishing is non-rejecting by contract', () => {
  const event = {
    type: 'run:updated',
    version: '1',
    runId: 'run-1',
    status: 'passed',
    timestamp: '2026-01-01T00:00:00.000Z',
  } as const;

  it('does not throw when the outbox refuses every attempt', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const bus = new DurableRealtimeBus(
        {
          append: vi.fn(async () => {
            throw new Error('outbox unavailable');
          }),
          appendMany: vi.fn(async () => []),
          readAfter: vi.fn(async () => []),
          getRetentionFloor: vi.fn(async () => 0),
          purgeExpired: vi.fn(async () => 0),
        } as never,
        'ws',
        24,
        2,
        1,
      );
      // The caller's write must not fail because a reporting path is down.
      await expect(bus.publish(event)).resolves.toBeUndefined();
      expect(errorLog).toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('notifies every subscriber even when one of them throws', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const reached: string[] = [];
      const bus = new DurableRealtimeBus(
        {
          append: vi.fn(async () => ({ sequence: 1 })),
          appendMany: vi.fn(async () => []),
          readAfter: vi.fn(async () => []),
          getRetentionFloor: vi.fn(async () => 0),
          purgeExpired: vi.fn(async () => 0),
        } as never,
        'ws',
        24,
        2,
        1,
      );
      bus.subscribe(() => {
        throw new Error('subscriber is broken');
      });
      bus.subscribe(() => {
        reached.push('second');
      });

      await bus.publish(event);
      expect(reached).toContain('second');
    } finally {
      errorLog.mockRestore();
    }
  });
});

/** The migration graph is applied through PGlite above; this asserts the read. */
describe('the feed reads the real outbox', () => {
  it('sees an appended event and can be read back by sequence', async () => {
    const feed = await feedWithOneEvent();
    let page: Array<{ workspaceId: string | null }> = [];
    let failure: string | undefined;
    try {
      page = await feed.readAfter({ workspaceId: 'ws', afterSequence: 0, limit: 10 });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    // A `readAfter` that rejects means the durable SSE feed never delivered
    // anything in production, and the retry loop above would have masked it by
    // re-reading the same failing page on every tick.
    expect(failure, 'readAfter rejected against the real schema').toBeUndefined();
    expect(page.length).toBeGreaterThan(0);
    expect(page.every((event) => event.workspaceId === 'ws')).toBe(true);
  });
});
