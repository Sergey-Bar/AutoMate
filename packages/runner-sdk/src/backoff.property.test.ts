import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SPOOL_RETRY_POLICY, spoolBackoffDelayMs } from './spool.js';

/**
 * Property suite for invariants SPOOL-1 .. SPOOL-3 in `docs/quality/property-invariants.json`.
 *
 * Fixed seed and `numRuns`. The policy domain mirrors the runner's own configuration schema
 * (`base` 1..60_000, `max` 1..600_000, see `apps/runner/src/config.ts`) so the properties are
 * stated over the values the product can actually be configured with.
 */
const SEED = 20261022;
const params = { seed: SEED, numRuns: 1_000 } as const;

const policyArb = fc.record({
  baseDelayMs: fc.integer({ min: 1, max: 60_000 }),
  maxDelayMs: fc.integer({ min: 1, max: 600_000 }),
});
/** `Math.random()`'s range: [0, 1), including both extremes the generator can reach. */
const randomArb = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });
/** Far beyond any `maxAttempts`, so `2 ** n` overflows to Infinity inside the range. */
const attemptArb = fc.integer({ min: 0, max: 5_000 });

describe('SPOOL-1: a delay never exceeds the maximum and is never zero', () => {
  it('lies in [1, maxDelayMs] for every policy, attempt and random draw', () => {
    fc.assert(
      fc.property(policyArb, attemptArb, randomArb, (policy, attempt, draw) => {
        const delay = spoolBackoffDelayMs(policy, attempt, () => draw);
        expect(Number.isInteger(delay)).toBe(true);
        expect(delay).toBeGreaterThanOrEqual(1);
        expect(delay).toBeLessThanOrEqual(Math.max(1, policy.maxDelayMs));
      }),
      {
        ...params,
        examples: [
          [{ baseDelayMs: 60_000, maxDelayMs: 1 }, 5_000, 0.999999],
          [{ baseDelayMs: 1, maxDelayMs: 600_000 }, 5_000, 0],
        ],
      },
    );
  });

  it('the first delay is within [base / 2, base] when the base is under the maximum', () => {
    fc.assert(
      fc.property(policyArb, randomArb, (policy, draw) => {
        fc.pre(policy.baseDelayMs <= policy.maxDelayMs);
        const delay = spoolBackoffDelayMs(policy, 1, () => draw);
        expect(delay).toBeGreaterThanOrEqual(Math.max(1, Math.round(policy.baseDelayMs / 2)));
        expect(delay).toBeLessThanOrEqual(policy.baseDelayMs);
      }),
      params,
    );
  });
});

describe('SPOOL-2: backoff is monotone in the attempt count', () => {
  it('for a fixed draw, a later attempt never waits less than an earlier one', () => {
    fc.assert(
      fc.property(policyArb, randomArb, attemptArb, attemptArb, (policy, draw, a, b) => {
        const [early, late] = a <= b ? [a, b] : [b, a];
        expect(spoolBackoffDelayMs(policy, late, () => draw)).toBeGreaterThanOrEqual(
          spoolBackoffDelayMs(policy, early, () => draw),
        );
      }),
      params,
    );
  });

  it('is pinned at the maximum once the exponential passes it', () => {
    fc.assert(
      fc.property(policyArb, (policy) => {
        const delay = spoolBackoffDelayMs(policy, 5_000, () => 0.999999999);
        expect(delay).toBe(Math.max(1, policy.maxDelayMs));
      }),
      params,
    );
  });
});

describe('SPOOL-3: the default policy is itself inside the configurable domain', () => {
  it('has a positive base no greater than its maximum and a bounded attempt budget', () => {
    expect(DEFAULT_SPOOL_RETRY_POLICY.baseDelayMs).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_SPOOL_RETRY_POLICY.baseDelayMs).toBeLessThanOrEqual(
      DEFAULT_SPOOL_RETRY_POLICY.maxDelayMs,
    );
    expect(DEFAULT_SPOOL_RETRY_POLICY.maxAttempts).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_SPOOL_RETRY_POLICY.maxAttempts)).toBe(true);
  });
});

describe('the property harness can fail', () => {
  it('refutes a deliberately wrong bound with a replayable counterexample', () => {
    // "A delay is never below the base" is false: the randomised half starts at base / 2.
    const outcome = fc.check(
      fc.property(policyArb, randomArb, (policy, draw) => {
        fc.pre(policy.baseDelayMs <= policy.maxDelayMs);
        return spoolBackoffDelayMs(policy, 1, () => draw) >= policy.baseDelayMs;
      }),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
});
