import { describe, expect, it } from 'vitest';
import { InMemoryRealtimeBus, parseCursor, type RealtimeEventInput } from './bus.js';

/**
 * The in-memory realtime double, tested around the ways it used to lie.
 *
 * Four of these were not subtle bugs; they were *plausible* behaviour, which is why a
 * suite that only checked the happy path passed. A subscription that reports "caught
 * up" it never achieved, a cursor parser that accepts `''` as zero, a buffer bounded by
 * an event count that says nothing about memory, and a `close()` that closes nothing.
 * Each case below asserts the specific false statement the old code made, not merely
 * that something is returned.
 */

const event = (n: number, data: unknown = { n }): RealtimeEventInput => ({
  eventType: 'test.result',
  runId: `run-${String(n)}`,
  workspaceId: 'workspace-1',
  occurredAt: '2026-09-27T00:00:00.000Z',
  data,
});

describe('subscribing with no cursor', () => {
  it('replays what already happened rather than claiming to be current', () => {
    // R-4, and the worst of the five. The old code substituted the current cursor for
    // a missing one, so a brand-new subscriber was told it was caught up on a stream it
    // had read nothing of — silently, while looking healthy, and permanently omitting
    // every event that had already been published.
    const bus = new InMemoryRealtimeBus();
    bus.publish(event(1));
    bus.publish(event(2));
    bus.publish(event(3));

    const subscription = bus.subscribe();
    expect(subscription.replay.map((e) => e.cursor)).toEqual(['1', '2', '3']);
    expect(subscription.gap).toBe(false);
  });

  it('reports a gap when the retained window no longer covers the beginning', () => {
    // Asking for everything on a bus that has trimmed its history cannot be satisfied,
    // and saying so is the point. A gap flag nobody sets is a gap flag nobody reads.
    const bus = new InMemoryRealtimeBus({ historyLimit: 2 });
    for (let n = 1; n <= 5; n += 1) bus.publish(event(n));

    const subscription = bus.subscribe();
    expect(subscription.gap).toBe(true);
    expect(subscription.replay).toEqual([]);
  });

  it('reports no gap when everything since the origin is still retained', () => {
    const bus = new InMemoryRealtimeBus({ historyLimit: 10 });
    bus.publish(event(1));
    expect(bus.subscribe().gap).toBe(false);
  });
});

describe('cursors are strict', () => {
  it('accepts a decimal integer and nothing else', () => {
    // R-3. `Number('')` is 0 and `Number('0x10')` is 16, and both passed the old
    // `isInteger && >= 0` guard. The empty string is the dangerous one: it is what a
    // client sends when it has no cursor, and coercing it to 0 makes "I have nothing"
    // indistinguishable from "send me from the beginning".
    for (const good of ['0', '1', '42', '9007199254740991']) {
      expect(parseCursor(good), good).toBe(Number(good));
    }
    for (const bad of ['', ' ', '0x10', '1e3', '-1', '1.5', '+1', '01x', 'NaN', 'Infinity']) {
      expect(parseCursor(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('rejects a non-cursor at the subscription boundary', () => {
    const bus = new InMemoryRealtimeBus();
    expect(() => bus.subscribe('')).toThrow(/Invalid cursor/);
    expect(() => bus.subscribe('0x10')).toThrow(/Invalid cursor/);
  });

  it('continues a supplied sequence rather than restarting at one', () => {
    // R-6. The in-memory bus numbers cursors `1..n` per process while the durable bus
    // numbers from the outbox sequence, so the two schemes are unrelated and neither is
    // authoritative. This is how a process continues the durable numbering; it is
    // explicitly *not* a substitute for `DurableRealtimeBus` in a multi-process
    // deployment, and the comment on the option says so.
    const bus = new InMemoryRealtimeBus({ initialCursor: 500 });
    const published = bus.publish(event(1));
    expect(published.cursor).toBe('501');
    // `subscribe()` with no cursor asks from the origin, and the origin was 500 events
    // ago, so it correctly reports a gap rather than pretending it can serve them.
    expect(bus.subscribe().gap).toBe(true);
    expect(bus.subscribe('500').replay.map((e) => e.cursor)).toEqual(['501']);
  });

  it('rejects a negative or non-integer initial sequence', () => {
    expect(() => new InMemoryRealtimeBus({ initialCursor: -1 })).toThrow(/non-negative/);
    expect(() => new InMemoryRealtimeBus({ initialCursor: 1.5 })).toThrow(/non-negative/);
  });
});

describe('the retained history is bounded by bytes as well as by count', () => {
  it('evicts when a few large events exceed the byte budget', () => {
    // R-5. The old bound was an event count, so `historyLimit: 50` allowed 50 events of
    // any size — and one frame with a stack trace is orders of magnitude larger than one
    // with a status string. A count is not a memory bound.
    const bus = new InMemoryRealtimeBus({ historyLimit: 1000, historyBytes: 4_000 });
    for (let n = 1; n <= 20; n += 1) {
      bus.publish(event(n, { blob: 'x'.repeat(500) }));
    }
    // The count bound never binds here — 1000 is far above 20 — so whatever is
    // missing was removed by the byte budget.
    expect(bus.retainedCount).toBeLessThan(20);
    expect(bus.retainedCount).toBeGreaterThan(0);
    expect(bus.retainedBytes).toBeLessThanOrEqual(4_000);
  });

  it('still honours the count bound when events are small', () => {
    const bus = new InMemoryRealtimeBus({ historyLimit: 3, historyBytes: 1_000_000 });
    for (let n = 1; n <= 6; n += 1) bus.publish(event(n));
    // Six published, three retained: the window is cursors 4..6, so a subscriber asks
    // from 3 to see all of it without a gap.
    expect(bus.retainedCount).toBe(3);
    expect(bus.subscribe('3').replay.map((e) => e.cursor)).toEqual(['4', '5', '6']);
  });

  it('rejects a non-positive byte budget', () => {
    expect(() => new InMemoryRealtimeBus({ historyBytes: 0 })).toThrow(/positive integer/);
  });
});

describe('closing a subscription', () => {
  it('removes the listeners it added', () => {
    // R-1. The old `close` was `() => undefined`, so a closed subscription kept
    // receiving events and kept its closure alive for the life of the process.
    const bus = new InMemoryRealtimeBus();
    const subscription = bus.subscribe('0');
    const seen: string[] = [];
    subscription.onEvent((e) => seen.push(e.cursor));
    expect(bus.listenerCount).toBe(1);

    subscription.close();
    expect(bus.listenerCount).toBe(0);

    bus.publish(event(1));
    expect(seen).toEqual([]);
  });

  it('leaves other subscriptions alone', () => {
    // "Removes its own" rather than "clears the bus", which would be a different bug.
    const bus = new InMemoryRealtimeBus();
    const kept = bus.subscribe('0');
    const keptSeen: string[] = [];
    kept.onEvent((e) => keptSeen.push(e.cursor));

    const dropped = bus.subscribe('0');
    dropped.onEvent(() => undefined);
    expect(bus.listenerCount).toBe(2);

    dropped.close();
    expect(bus.listenerCount).toBe(1);

    bus.publish(event(1));
    expect(keptSeen).toEqual(['1']);
  });

  it('is idempotent, and a manual unsubscribe still works', () => {
    const bus = new InMemoryRealtimeBus();
    const subscription = bus.subscribe('0');
    const off = subscription.onEvent(() => undefined);
    off();
    subscription.close();
    subscription.close();
    expect(bus.listenerCount).toBe(0);
  });
});

describe('the constructor still takes a bare limit', () => {
  it('reads a number as the count limit, as it always has', () => {
    // Existing callers pass a number; the options form must not have changed what that
    // means, or the migration is a breaking change dressed as a convenience.
    const bus = new InMemoryRealtimeBus(2);
    for (let n = 1; n <= 4; n += 1) bus.publish(event(n));
    expect(bus.retainedCount).toBe(2);
    expect(bus.subscribe('2').replay.map((e) => e.cursor)).toEqual(['3', '4']);
  });

  it('still rejects a non-positive count', () => {
    expect(() => new InMemoryRealtimeBus(0)).toThrow(/positive integer/);
  });
});
