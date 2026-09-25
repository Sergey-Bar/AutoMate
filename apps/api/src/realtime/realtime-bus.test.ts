import { describe, expect, it } from 'vitest';
import { InMemoryRealtimeBus, type RunUpdatedPayload } from './realtime-bus.js';

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

describe('InMemoryRealtimeBus', () => {
  it('stores published events in order and notifies subscribers synchronously', () => {
    const bus = new InMemoryRealtimeBus();
    const received: RunUpdatedPayload[] = [];

    bus.subscribe((event) => received.push(event));

    const first = runUpdated({ runId: 'run-a', status: 'running' });
    const second = runUpdated({ runId: 'run-b', status: 'passed' });

    bus.publish(first);
    bus.publish(second);

    expect(bus.published).toEqual([first, second]);
    expect(received).toEqual([first, second]);
  });

  it('unsubscribes only the matching callback and keeps other subscribers active', () => {
    const bus = new InMemoryRealtimeBus();
    const receivedA: RunUpdatedPayload[] = [];
    const receivedB: RunUpdatedPayload[] = [];

    const unsubscribeA = bus.subscribe((event) => receivedA.push(event));
    bus.subscribe((event) => receivedB.push(event));

    const beforeUnsubscribe = runUpdated({ runId: 'before' });
    const afterUnsubscribe = runUpdated({ runId: 'after' });

    bus.publish(beforeUnsubscribe);
    unsubscribeA();
    bus.publish(afterUnsubscribe);

    expect(receivedA).toEqual([beforeUnsubscribe]);
    expect(receivedB).toEqual([beforeUnsubscribe, afterUnsubscribe]);
  });

  it('allows an unsubscribe function to be called more than once without dropping events', () => {
    const bus = new InMemoryRealtimeBus();
    const received: RunUpdatedPayload[] = [];

    const unsubscribe = bus.subscribe((event) => received.push(event));

    unsubscribe();
    unsubscribe();

    const event = runUpdated({ runId: 'after-double-unsubscribe' });
    bus.publish(event);

    expect(bus.published).toEqual([event]);
    expect(received).toEqual([]);
  });
});
