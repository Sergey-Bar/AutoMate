import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { defaultApiClient as api, resetRunEventStream } from './api.js';
import type { RunEvent } from './api.js';

/**
 * One `EventSource` per subscriber is one HTTP connection per subscriber.
 *
 * The dashboard layout returns `<Outlet />` while `CommandCenter` calls `useRuns`,
 * and a run detail page calls `useRunDetail` — so a reader on that page had two
 * open connections to `/api/v1/events`, each with its own dedup map and its own
 * listener for every event type. Both were correct; together they are two streams
 * of the same events, two reconnect paths, and a doubled connection count on the
 * one endpoint meant to be cheap and long-lived (ledger W-5).
 *
 * The poller had the same shape: `useRuns` refreshed every five seconds while a
 * stream was also pushing changes, so every page paid for a periodic full list
 * fetch to discover something the stream had usually already delivered.
 */

/** The `EventSource` stubs installed for the current test. */
let sources: FakeEventSource[] = [];

/** A `FakeEventSource` pushed here when constructed. */
class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();

  constructor(readonly url: string) {
    sources.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ data } as MessageEvent<string>);
    }
  }
}

/**
 * A `run.phase_changed` envelope the contract accepts.
 *
 * The first fixture here used `{ status: 'running' }`, which the schema rejects —
 * `RunPhaseChangedEventPayloadSchema` wants `phase` and an `outcome` from a
 * terminal-result enum. The event was silently discarded, and the test read as a
 * failure of the stream rather than of the fixture. That is worth knowing: an
 * invalid payload is dropped by design and nothing reports it, so a stream test
 * with a wrong fixture fails as though the product were broken.
 */
const event = (overrides: Partial<RunEvent> = {}): RunEvent =>
  ({
    version: '1',
    eventId: 'e-1',
    type: 'run.phase_changed',
    sequence: 1,
    occurredAt: '2026-09-29T00:00:00.000Z',
    runId: 'r-1',
    payload: { phase: 'running', outcome: 'unknown' },
    ...overrides,
  }) as RunEvent;

beforeEach(() => {
  vi.restoreAllMocks();
  sources = [];
  // The stream is module state shared with `api.test.ts`; Vitest gives each file
  // its own module registry, so a reset here is enough for this file.
  resetRunEventStream();
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  resetRunEventStream();
  vi.unstubAllGlobals();
});

describe('the run event stream is shared, not duplicated per subscriber', () => {
  it('opens one connection for two subscribers and closes it with the last', () => {
    const first = api.subscribeToRunEvents({ onEvent: () => undefined });
    const second = api.subscribeToRunEvents({ onEvent: () => undefined });

    // One connection, not two.
    expect(sources).toHaveLength(1);
    expect(sources[0]?.closed).toBe(false);

    // Releasing one must not take the stream from the other, which is the failure
    // mode of a bare singleton with no reference count.
    first();
    expect(sources[0]?.closed).toBe(false);

    second();
    expect(sources[0]?.closed).toBe(true);
  });

  it('delivers one event to every subscriber', () => {
    const first: RunEvent[] = [];
    const second: RunEvent[] = [];
    const releaseFirst = api.subscribeToRunEvents({ onEvent: (e) => first.push(e) });
    const releaseSecond = api.subscribeToRunEvents({ onEvent: (e) => second.push(e) });

    for (const source of sources) {
      source.emit('run.phase_changed', JSON.stringify(event()));
    }

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.runId).toBe('r-1');
    releaseFirst();
    releaseSecond();
  });

  it('de-duplicates a replayed sequence, once for the connection', () => {
    // Each subscriber used to keep its own `lastSequence` map, so a replayed
    // sequence was filtered independently in each — correct, but two maps to keep
    // in step and two places for a duplicate to slip through.
    const seen: RunEvent[] = [];
    const release = api.subscribeToRunEvents({ onEvent: (e) => seen.push(e) });

    for (const source of sources) {
      source.emit('run.phase_changed', JSON.stringify(event({ sequence: 1 })));
      source.emit('run.phase_changed', JSON.stringify(event({ sequence: 1, eventId: 'e-2' })));
      source.emit('run.phase_changed', JSON.stringify(event({ sequence: 2, eventId: 'e-3' })));
    }

    expect(seen.map((e) => e.sequence)).toEqual([1, 2]);
    // Released, because the dedup map belongs to the *connection* and outlives
    // every subscriber. Without this the next case emits sequence 1 again and is
    // filtered as a replay.
    release();
  });

  it('reports connection state once for the connection, not per subscriber', () => {
    const changes: boolean[] = [];
    const secondChanges: boolean[] = [];
    const reconnects: number[] = [];
    const releaseFirst = api.subscribeToRunEvents({
      onEvent: () => undefined,
      onConnectionChange: (live) => changes.push(live),
      onReconnect: () => reconnects.push(1),
    });
    // **Both** subscribers carry the callback. The first version gave it only to the
    // first, so `changes` could not have distinguished "one notification for the
    // connection" from "one per subscriber" even if the loop had iterated per
    // subscriber — the assertion was satisfied by a loop that reported N times.
    const releaseSecond = api.subscribeToRunEvents({
      onEvent: () => undefined,
      onConnectionChange: (live) => secondChanges.push(live),
    });

    const source = sources[0];
    source?.onopen?.();
    source?.onopen?.();
    source?.onerror?.();

    // `true, true, false`: the second `open` is a reconnect, and a reconnect
    // genuinely reports the connection live again — a view that has to be told
    // twice because the connection dropped once would be a *worse* contract than
    // one told about every transition. The first version of this asserted
    // `[true, false]` on the reasoning that a reconnect is not a state change,
    // which is wrong: it is the one a view most needs to hear.
    expect(changes).toEqual([true, true, false]);
    // The second subscriber heard exactly the same sequence — once each, not twice.
    expect(secondChanges).toEqual([true, true, false]);
    // The reconnect itself is reported once, because it is a property of the
    // connection rather than of a view.
    expect(reconnects).toHaveLength(1);
    releaseFirst();
    releaseSecond();
  });

  it('opens a new connection after the last subscriber leaves', () => {
    // A shared source that was never closed would leave a reader who navigated
    // away and back holding a dead connection forever.
    api.subscribeToRunEvents({ onEvent: () => undefined })();
    const release = api.subscribeToRunEvents({ onEvent: () => undefined });

    expect(sources).toHaveLength(2);
    expect(sources[0]?.closed).toBe(true);
    expect(sources[1]?.closed).toBe(false);
    release();
  });

  it('tells a late subscriber the connection is already live', async () => {
    // The regression this shared source introduced, and the one the two-subscriber
    // connection-count test could not see.
    //
    // `onopen` fires once per connection. A subscriber that arrives *after* the
    // connection is open never sees it, so in `useRuns` its `isLiveRef` stays
    // `false` and its five-second poller keeps fetching the list against a healthy
    // stream — which is the exact duplicate work the poller was gated to avoid.
    //
    // This is the ordinary case rather than an edge one: the dashboard layout calls
    // `useRuns` and renders an `<Outlet />`, so the layout's hook opens the source
    // and every page underneath it is a late subscriber.
    // The `EventSource` stub is already installed and the module state reset by
    // `beforeEach`; `currentSources` is this test's view of it.
    const first: boolean[] = [];
    const second: boolean[] = [];

    const releaseFirst = api.subscribeToRunEvents({
      onEvent: () => undefined,
      onConnectionChange: (live) => first.push(live),
    });
    const source = sources[0];
    source?.onopen?.();
    expect(first).toEqual([true]);

    // Arrives now, while the connection is open and will not fire `open` again.
    const releaseSecond = api.subscribeToRunEvents({
      onEvent: () => undefined,
      onConnectionChange: (live) => second.push(live),
    });
    expect(second, 'a late subscriber must be told the connection is live').toEqual([true]);

    // And it follows a subsequent drop like any other subscriber.
    source?.onerror?.();
    expect(first).toEqual([true, false]);
    expect(second).toEqual([true, false]);

    releaseFirst();
    releaseSecond();
  });

  it('releasing twice does not close a connection another subscriber is reading', () => {
    // `useEffect` cleanup can run twice under React's strict-mode double-invoke,
    // and an unguarded second release would decrement the count to zero and take
    // the stream away from a subscriber that never asked to leave.
    const first = api.subscribeToRunEvents({ onEvent: () => undefined });
    const second = api.subscribeToRunEvents({ onEvent: () => undefined });
    first();
    first();
    expect(sources[0]?.closed).toBe(false);
    second();
    expect(sources[0]?.closed).toBe(true);
  });

  it('is inert where EventSource does not exist', () => {
    // Server-side rendering: no global, so a subscribe must be a no-op rather than
    // a crash on a page that never had a stream.
    vi.stubGlobal('EventSource', undefined);
    const unsubscribe = api.subscribeToRunEvents({ onEvent: () => undefined });
    expect(() => unsubscribe()).not.toThrow();
  });
});
