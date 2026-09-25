import { describe, expect, it } from 'vitest';
import { InMemoryRealtimeBus } from './bus.js';

const event = (type: string) => ({
  eventType: type,
  occurredAt: '2026-09-25T00:00:00.000Z',
  data: { type },
});

describe('InMemoryRealtimeBus', () => {
  it('assigns stable cursors and replays after a cursor', () => {
    const bus = new InMemoryRealtimeBus(3);
    bus.publish(event('one'));
    bus.publish(event('two'));
    const subscription = bus.subscribe('1');
    expect(subscription.replay.map((item) => item.cursor)).toEqual(['2']);
    expect(subscription.gap).toBe(false);
  });

  it('reports a gap when history has moved past the cursor', () => {
    const bus = new InMemoryRealtimeBus(1);
    bus.publish(event('one'));
    bus.publish(event('two'));
    const subscription = bus.subscribe('0');
    expect(subscription.gap).toBe(true);
    expect(subscription.replay).toEqual([]);
  });

  it('delivers live events to subscribers', () => {
    const bus = new InMemoryRealtimeBus();
    const received: string[] = [];
    const subscription = bus.subscribe();
    const stop = subscription.onEvent((item) => received.push(item.cursor));
    bus.publish(event('live'));
    stop();
    expect(received).toEqual(['1']);
  });
});
