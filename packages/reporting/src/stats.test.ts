import { describe, expect, it } from 'vitest';
import {
  bootstrapMeanDifference,
  compareRates,
  median,
  percentile,
  rateDifference,
  seededRandom,
  wilson,
} from './stats.js';

describe('wilson', () => {
  it('matches the published interval for 8 of 10 at 95%', () => {
    // Reference: Wilson (1927); 8/10 → [0.490, 0.943] (Newcombe 1998, table I).
    const interval = wilson(8, 10);
    expect(interval?.estimate).toBe(0.8);
    expect(interval?.low).toBeCloseTo(0.49, 2);
    expect(interval?.high).toBeCloseTo(0.943, 2);
  });

  it('stays inside [0, 1] at the edges', () => {
    expect(wilson(0, 5)?.low).toBe(0);
    expect(wilson(5, 5)?.high).toBe(1);
    expect(wilson(0, 5)?.high).toBeGreaterThan(0);
  });

  it('has no rate over no trials', () => {
    expect(wilson(0, 0)).toBeNull();
  });

  it('clamps successes into the trial count', () => {
    expect(wilson(12, 10)?.estimate).toBe(1);
    expect(wilson(-1, 10)?.estimate).toBe(0);
  });
});

describe('compareRates', () => {
  it('calls a large difference with enough data', () => {
    expect(compareRates({ successes: 90, trials: 100 }, { successes: 30, trials: 100 })).toBe(
      'higher',
    );
    expect(compareRates({ successes: 3, trials: 100 }, { successes: 60, trials: 100 })).toBe(
      'lower',
    );
  });

  it('refuses to call noise a difference', () => {
    expect(compareRates({ successes: 9, trials: 10 }, { successes: 8, trials: 10 })).toBe('same');
  });

  it('tests the difference, so 9 of 10 against 3 of 10 is a real drop', () => {
    // The two Wilson intervals overlap by 0.007 here, so a non-overlap rule called it noise.
    expect(compareRates({ successes: 3, trials: 10 }, { successes: 9, trials: 10 })).toBe('lower');
    const difference = rateDifference({ successes: 9, trials: 10 }, { successes: 3, trials: 10 });
    // Newcombe (1998) method 10 for 9/10 − 3/10: [0.171, 0.809] to three places.
    expect(difference?.estimate).toBeCloseTo(0.6, 5);
    expect(difference?.low).toBeCloseTo(0.171, 2);
    expect(difference?.high).toBeCloseTo(0.809, 2);
    expect(rateDifference({ successes: 1, trials: 0 }, { successes: 0, trials: 1 })).toBeNull();
  });

  it('has nothing to say without trials', () => {
    expect(compareRates({ successes: 0, trials: 0 }, { successes: 1, trials: 2 })).toBeNull();
  });
});

describe('percentile', () => {
  it('interpolates between ranks', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20, 30], 0)).toBe(10);
    expect(percentile([10, 20, 30], 100)).toBe(30);
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(median([7])).toBe(7);
  });

  it('ignores non-finite values and is null over nothing', () => {
    expect(percentile([Number.NaN, 4], 50)).toBe(4);
    expect(percentile([], 95)).toBeNull();
  });

  it('clamps q', () => {
    expect(percentile([1, 2], 150)).toBe(2);
    expect(percentile([1, 2], -5)).toBe(1);
  });
});

describe('the seeded generators', () => {
  it('repeat for a seed and differ across seeds', () => {
    const a = seededRandom(1);
    const b = seededRandom(1);
    const c = seededRandom(2);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(c()).not.toBe(first[0]);
    for (const value of first) expect(value).toBeGreaterThanOrEqual(0);
    for (const value of first) expect(value).toBeLessThan(1);
  });

  it('bootstraps a difference that brackets its estimate, identically per seed', () => {
    const a = [1, 1, 1, 0, 1, 1, 1, 1, 0, 1];
    const b = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    const first = bootstrapMeanDifference(a, b, { seed: 7 });
    const second = bootstrapMeanDifference(a, b, { seed: 7 });
    expect(first).toEqual(second);
    expect(first?.estimate).toBeCloseTo(-0.6, 5);
    expect(first?.high).toBeLessThan(0);
    expect(first?.low).toBeLessThanOrEqual(first?.estimate ?? 0);
    expect(bootstrapMeanDifference([], b, { seed: 1 })).toBeNull();
  });
});
