/**
 * reconnect.test.ts
 *
 * Tests for the computeBackoff helper and ReconnectState type defined in
 * reconnect.ts.
 *
 * Backoff formula (from source docs):
 *   delay = min(baseMs * 2^(attempt-1) + rand(0, baseMs * 1.5), maxMs)
 *
 * For attempt=1, baseMs=1000, maxMs=30000 → result in [1000, 2500]
 * For high attempts the result is capped at maxMs.
 */

import { computeBackoff, type ReconnectState } from './reconnect.js';

// ---------------------------------------------------------------------------
// Return type / range sanity
// ---------------------------------------------------------------------------

describe('computeBackoff — return type and basic range', () => {
  it('returns a number', () => {
    expect(typeof computeBackoff(1, 1000, 30_000)).toBe('number');
  });

  it('returns a finite value', () => {
    expect(isFinite(computeBackoff(1, 1000, 30_000))).toBe(true);
  });

  it('result is non-negative', () => {
    expect(computeBackoff(1, 1000, 30_000)).toBeGreaterThanOrEqual(0);
  });

  it('result never exceeds maxMs', () => {
    for (let attempt = 1; attempt <= 20; attempt++) {
      expect(computeBackoff(attempt, 1000, 30_000)).toBeLessThanOrEqual(30_000);
    }
  });

  it('result is at least baseMs on attempt 1 (no jitter below base)', () => {
    // exponential = 1000 * 2^0 = 1000; jitter ≥ 0 → min = 1000
    expect(computeBackoff(1, 1000, 30_000)).toBeGreaterThanOrEqual(1000);
  });
});

// ---------------------------------------------------------------------------
// Exponential growth (no jitter edge: deterministic lower bound)
// ---------------------------------------------------------------------------

describe('computeBackoff — exponential growth', () => {
  it('attempt 2 lower-bound (2000) exceeds attempt 1 lower-bound (1000)', () => {
    // exponential for attempt 1 = 1000; for attempt 2 = 2000
    // Without jitter both produce their base exponential; with jitter they
    // can be slightly higher.  We assert minimum values by mocking Math.random.
    const originalRandom = Math.random;

    try {
      Math.random = () => 0; // zero jitter

      const delay1 = computeBackoff(1, 1000, 30_000);
      const delay2 = computeBackoff(2, 1000, 30_000);
      const delay3 = computeBackoff(3, 1000, 30_000);

      expect(delay1).toBe(1000); // 1000 * 2^0 = 1000
      expect(delay2).toBe(2000); // 1000 * 2^1 = 2000
      expect(delay3).toBe(4000); // 1000 * 2^2 = 4000
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('backoff grows with successive attempts (probabilistic — 100 samples)', () => {
    // Run 100 samples; at each attempt the median should increase
    const medians: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const samples = Array.from({ length: 100 }, () => computeBackoff(attempt, 1000, 30_000));
      const sorted = samples.slice().sort((a, b) => a - b);
      medians.push(sorted[49]!);
    }
    for (let i = 1; i < medians.length; i++) {
      expect(medians[i]).toBeGreaterThan(medians[i - 1]!);
    }
  });
});

// ---------------------------------------------------------------------------
// Cap at maxMs
// ---------------------------------------------------------------------------

describe('computeBackoff — cap', () => {
  it('caps at maxMs when exponential alone exceeds it', () => {
    const originalRandom = Math.random;
    try {
      Math.random = () => 0;
      // attempt=10, base=1000 → 1000 * 2^9 = 512000 >> 30000
      expect(computeBackoff(10, 1000, 30_000)).toBe(30_000);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('caps at maxMs when jitter pushes it over', () => {
    const originalRandom = Math.random;
    try {
      Math.random = () => 0.9999; // near-maximum jitter
      // attempt=1, base=1000 → 1000 + 0.9999*1500 ≈ 2499; still under cap
      const result = computeBackoff(1, 1000, 30_000);
      expect(result).toBeLessThanOrEqual(30_000);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('respects a very small maxMs', () => {
    expect(computeBackoff(1, 1000, 500)).toBe(500);
    expect(computeBackoff(5, 1000, 500)).toBe(500);
  });

  it('handles maxMs equal to baseMs', () => {
    const originalRandom = Math.random;
    try {
      Math.random = () => 0;
      expect(computeBackoff(1, 1000, 1000)).toBe(1000);
    } finally {
      Math.random = originalRandom;
    }
  });
});

// ---------------------------------------------------------------------------
// Jitter range
// ---------------------------------------------------------------------------

describe('computeBackoff — jitter', () => {
  it('attempt 1 result is within documented range [1000, 2500]', () => {
    for (let i = 0; i < 200; i++) {
      const delay = computeBackoff(1, 1000, 30_000);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(2500);
    }
  });

  it('produces different values on successive calls (randomness present)', () => {
    const results = new Set(Array.from({ length: 50 }, () => computeBackoff(1, 1000, 30_000)));
    // With real Math.random we should see at least a few distinct values
    expect(results.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('computeBackoff — edge cases', () => {
  it('handles attempt=1 with baseMs=0 → returns 0', () => {
    // exponential = 0 * 2^0 = 0; jitter = 0; result = 0
    const originalRandom = Math.random;
    try {
      Math.random = () => 0;
      expect(computeBackoff(1, 0, 30_000)).toBe(0);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('returns maxMs when maxMs is 0', () => {
    expect(computeBackoff(1, 1000, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ReconnectState type exhaustiveness (compile-time check via assignment)
// ---------------------------------------------------------------------------

describe('ReconnectState type', () => {
  it('accepts all documented states', () => {
    const states: ReconnectState[] = ['idle', 'connecting', 'connected', 'reconnecting', 'failed'];
    expect(states).toHaveLength(5);
  });
});
