import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit.js';

describe('createRateLimiter', () => {
  it('allows up to the limit and then refuses with a retry hint', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1_000, now: () => 0 });
    expect(limiter.consume('ip:a').allowed).toBe(true);
    expect(limiter.consume('ip:a').allowed).toBe(true);
    const third = limiter.consume('ip:a');
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = limiter.consume('ip:a');
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBe(1);
  });

  it('opens a fresh window once the old one expires', () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => clock });
    expect(limiter.consume('ip:a').allowed).toBe(true);
    expect(limiter.consume('ip:a').allowed).toBe(false);
    clock = 1_001;
    expect(limiter.consume('ip:a').allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => 0 });
    expect(limiter.consume('ip:a').allowed).toBe(true);
    expect(limiter.consume('ip:b').allowed).toBe(true);
    expect(limiter.consume('ip:a').allowed).toBe(false);
  });

  it('reports a growing retry-after as the window drains', () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000, now: () => clock });
    limiter.consume('ip:a');
    expect(limiter.consume('ip:a').retryAfterSeconds).toBe(10);
    clock = 6_000;
    expect(limiter.consume('ip:a').retryAfterSeconds).toBe(4);
  });

  it('counts down the remaining allowance', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1_000, now: () => 0 });
    expect(limiter.consume('ip:a').remaining).toBe(2);
    expect(limiter.consume('ip:a').remaining).toBe(1);
    expect(limiter.consume('ip:a').remaining).toBe(0);
  });

  it('forgets windows that have expired, so distinct keys cannot grow memory for ever', () => {
    // The login route is unauthenticated and keys a window on every distinct API key
    // guessed. Nothing deleted an expired window, so a client looping random keys grew
    // the process by one entry per request, permanently.
    let clock = 0;
    const limiter = createRateLimiter({ limit: 5, windowMs: 1_000, now: () => clock });
    for (let index = 0; index < 10_000; index += 1) limiter.consume(`key:${String(index)}`);
    clock = 2_000;
    limiter.consume('key:after');
    expect(limiter.size).toBeLessThan(100);
  });

  it('holds no more than its ceiling of live windows', () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, now: () => 0, maxKeys: 50 });
    for (let index = 0; index < 1_000; index += 1) limiter.consume(`key:${String(index)}`);
    expect(limiter.size).toBeLessThanOrEqual(50);
  });
});
