import { describe, it, expect } from 'vitest';
import { createConnectorLimiter } from './rate-limiter.js';

describe('createConnectorLimiter', () => {
  it('creates a Bottleneck instance', () => {
    const limiter = createConnectorLimiter({ maxConcurrent: 5, minTime: 100 });
    expect(limiter).toBeDefined();
    expect(typeof limiter.schedule).toBe('function');
  });

  it('schedules and executes a task', async () => {
    const limiter = createConnectorLimiter({ maxConcurrent: 1, minTime: 0 });
    const result = await limiter.schedule(() => Promise.resolve('done'));
    expect(result).toBe('done');
  });

  it('respects maxConcurrent by running tasks sequentially', async () => {
    const limiter = createConnectorLimiter({ maxConcurrent: 1, minTime: 0 });
    const order: number[] = [];
    const p1 = limiter.schedule(async () => { order.push(1); return 1; });
    const p2 = limiter.schedule(async () => { order.push(2); return 2; });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('accepts reservoir options', () => {
    const limiter = createConnectorLimiter({
      maxConcurrent: 10,
      minTime: 0,
      reservoir: 100,
      reservoirRefreshInterval: 1000,
      reservoirRefreshAmount: 100,
    });
    expect(limiter).toBeDefined();
  });

  it('minTime delays between consecutive calls', async () => {
    const limiter = createConnectorLimiter({ maxConcurrent: 1, minTime: 50 });
    const start = Date.now();
    await limiter.schedule(() => Promise.resolve('a'));
    await limiter.schedule(() => Promise.resolve('b'));
    const elapsed = Date.now() - start;
    // At least one minTime gap should have occurred
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow slight variance
  });
});
