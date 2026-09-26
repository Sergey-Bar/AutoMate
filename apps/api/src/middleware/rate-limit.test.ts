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
});
