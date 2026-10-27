import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planShards, type ShardPlan, type ShardPlanInput } from './shard-plan.js';

/**
 * Property suite for SHARD-1 to SHARD-3.
 *
 * Fixed seed and `numRuns`. Files are drawn from a small path alphabet so that some names
 * are suffixes of others — the matching rule's hard case — and the history names a mix of
 * the files, their suffixes, and files that no longer exist.
 */
const SEED = 20261026;
const params = { seed: SEED, numRuns: 300 } as const;

const segment = fc.constantFrom('a', 'b', 'tests', 'e2e', 'pay.spec.ts', 'cart.spec.ts');
const file = fc.array(segment, { minLength: 1, maxLength: 3 }).map((parts) => parts.join('/'));
const input: fc.Arbitrary<ShardPlanInput> = fc.record({
  total: fc.integer({ min: 1, max: 8 }),
  files: fc.array(file, { maxLength: 30 }),
  history: fc
    .array(fc.tuple(file, fc.array(fc.nat({ max: 120_000 }), { minLength: 1, maxLength: 5 })), {
      maxLength: 20,
    })
    .map((entries) => new Map(entries)),
});

const load = (plan: ShardPlan) => plan.shards.map((shard) => shard.estimatedMs);

describe('SHARD-1: every requested file is in exactly one shard, and nothing else is', () => {
  it('holds for every input', () => {
    fc.assert(
      fc.property(input, (value) => {
        const plan = planShards(value);
        expect(plan.shards).toHaveLength(value.total);
        const planned = plan.shards.flatMap((shard) => shard.files);
        expect([...planned].sort()).toEqual([...new Set(value.files)].sort());
      }),
      { ...params, examples: [[{ total: 3, files: ['a', 'a', 'b'], history: new Map() }]] },
    );
  });
});

describe('SHARD-2: the slowest shard is within one file of the average', () => {
  it('max load ≤ total load / shards + the largest single estimate', () => {
    fc.assert(
      fc.property(input, (value) => {
        const plan = planShards(value);
        const loads = load(plan);
        const sum = loads.reduce((left, right) => left + right, 0);
        const largest = Math.max(0, ...Object.values(plan.estimates));
        expect(Math.max(0, ...loads)).toBeLessThanOrEqual(sum / value.total + largest);
      }),
      params,
    );
  });
});

describe('SHARD-3: the plan is a function of the set of files, not of their order', () => {
  it('two shards asking in a different order get the same plan', () => {
    fc.assert(
      fc.property(input, fc.nat(), (value, rotation) => {
        const turned = [...value.files];
        for (let index = 0; index < rotation % (turned.length + 1); index += 1) {
          turned.push(turned.shift() ?? '');
        }
        expect(planShards({ ...value, files: turned.reverse() })).toEqual(planShards(value));
      }),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes SHARD-2 for round-robin, which ignores durations', () => {
    const roundRobin = (value: ShardPlanInput) => {
      const plan = planShards(value);
      const loads = new Array<number>(value.total).fill(0);
      [...new Set(value.files)].sort().forEach((name, index) => {
        loads[index % value.total] =
          (loads[index % value.total] ?? 0) + (plan.estimates[name] ?? 0);
      });
      return { loads, largest: Math.max(0, ...Object.values(plan.estimates)) };
    };
    const result = fc.check(
      fc.property(input, (value) => {
        const { loads, largest } = roundRobin(value);
        const sum = loads.reduce((left, right) => left + right, 0);
        return Math.max(0, ...loads) <= sum / value.total + largest / 4;
      }),
      params,
    );
    expect(result.failed).toBe(true);
  });

  it('refutes SHARD-3 for a plan that assigns in the order it was asked', () => {
    const inOrder = (files: readonly string[], total: number) =>
      [...new Set(files)].map((name, index) => [name, index % total] as const);
    const result = fc.check(
      fc.property(
        input,
        (value) =>
          JSON.stringify(inOrder(value.files, value.total)) ===
          JSON.stringify(inOrder([...value.files].reverse(), value.total)),
      ),
      params,
    );
    expect(result.failed).toBe(true);
  });
});
