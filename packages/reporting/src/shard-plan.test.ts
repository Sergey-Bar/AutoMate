import { describe, expect, it } from 'vitest';
import { planShards } from './shard-plan.js';

/**
 * Which files each CI shard runs, from how long each file took before.
 *
 * The examples pin what the property suite states in general: the slowest files go first,
 * each to the shard with the least work so far; a file with no history is estimated at the
 * median of the files that have one; and a requested path matches its history by suffix,
 * because a report names a file relative to the runner's root and CI names it relative to
 * the repository.
 */
describe('planShards', () => {
  it('balances by duration, longest first, and says how sure it is', () => {
    const plan = planShards({
      total: 2,
      files: ['tests/a.spec.ts', 'tests/b.spec.ts', 'tests/c.spec.ts', 'tests/d.spec.ts'],
      history: new Map([
        ['a.spec.ts', [60_000, 50_000, 70_000]],
        ['b.spec.ts', [40_000]],
        ['c.spec.ts', [30_000, 30_000]],
        ['d.spec.ts', [20_000, 10_000]],
      ]),
    });
    expect(plan.shards).toEqual([
      { index: 1, files: ['tests/a.spec.ts', 'tests/d.spec.ts'], estimatedMs: 75_000 },
      { index: 2, files: ['tests/b.spec.ts', 'tests/c.spec.ts'], estimatedMs: 70_000 },
    ]);
    expect(plan).toMatchObject({ known: 4, unknown: 0 });
  });

  it('estimates a file with no history at the median of those with one', () => {
    const plan = planShards({
      total: 2,
      files: ['new.spec.ts', 'slow.spec.ts', 'fast.spec.ts', 'mid.spec.ts'],
      history: new Map([
        ['slow.spec.ts', [9_000]],
        ['mid.spec.ts', [5_000]],
        ['fast.spec.ts', [1_000]],
      ]),
    });
    expect(plan.estimates['new.spec.ts']).toBe(5_000);
    expect(plan).toMatchObject({ known: 3, unknown: 1 });
  });

  it('with no history at all, still runs every file, spread evenly', () => {
    const plan = planShards({ total: 2, files: ['c', 'a', 'b', 'd'], history: new Map() });
    expect(plan.shards.map((shard) => shard.files)).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
  });

  it('matches the longest history path that the requested path ends with', () => {
    const plan = planShards({
      total: 1,
      files: ['repo/e2e/checkout/pay.spec.ts'],
      history: new Map([
        ['pay.spec.ts', [1]],
        ['checkout/pay.spec.ts', [42]],
        // A suffix of the string but not of the path: never a match.
        ['out/pay.spec.ts', [999]],
      ]),
    });
    expect(plan.estimates['repo/e2e/checkout/pay.spec.ts']).toBe(42);
  });

  it('gives more shards than files an empty shard rather than a missing one', () => {
    const plan = planShards({ total: 3, files: ['only.spec.ts'], history: new Map() });
    expect(plan.shards.map((shard) => shard.files)).toEqual([['only.spec.ts'], [], []]);
  });
});
