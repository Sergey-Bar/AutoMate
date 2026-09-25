import { describe, expect, it } from 'vitest';
import * as servicesIndex from './index.js';

describe('services/index barrel', () => {
  it('re-exports EventHub from event-hub module', () => {
    expect(servicesIndex.EventHub).toBeTypeOf('function');
  });

  it('EventHub can be instantiated and used via barrel export', () => {
    const hub = new servicesIndex.EventHub();
    const received: unknown[] = [];
    const unsub = hub.subscribe((event) => received.push(event));
    hub.broadcast({ type: 'test', payload: { value: 1 } });
    expect(received).toHaveLength(1);
    unsub();
    hub.broadcast({ type: 'after-unsub', payload: {} });
    expect(received).toHaveLength(1);
  });
});
