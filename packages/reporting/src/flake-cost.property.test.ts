import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  flakeCost,
  suggestQuarantine,
  type FlakeCost,
  type FlakeObservation,
} from './flake-cost.js';

/**
 * Property suite for FLAKE-1 to FLAKE-4.
 *
 * Fixed seed and `numRuns`. Observations are drawn over a handful of test keys so that
 * one test collects several results, which is the only way it can disagree with itself.
 */
const SEED = 20261105;
const params = { seed: SEED, numRuns: 300 } as const;

const observation: fc.Arbitrary<FlakeObservation> = fc.record({
  testKey: fc.constantFrom('a', 'b', 'c', 'd'),
  title: fc.constantFrom('title one', 'title two'),
  runId: fc.constantFrom('r1', 'r2', 'r3', 'r4', 'r5'),
  commit: fc.option(fc.constantFrom('c1', 'c2', 'c3'), { nil: null }),
  status: fc.constantFrom('passed', 'failed', 'flaky', 'timed_out', 'skipped'),
  retries: fc.integer({ min: 0, max: 3 }),
  durationMs: fc.option(fc.nat({ max: 60_000 }), { nil: null }),
  runBlocked: fc.boolean(),
});
const observations = fc.array(observation, { maxLength: 40 });
const thresholds = fc.record({
  minScore: fc.double({ min: 0, max: 1, noNaN: true }),
  minObservations: fc.nat({ max: 6 }),
});

const keys = (costs: readonly FlakeCost[], minScore: number, minObservations: number) =>
  suggestQuarantine(costs, { minScore, minObservations }).map((suggestion) => suggestion.testKey);

/** Keys whose decisive results are all failures, read from the observations themselves. */
function alwaysFailing(rows: readonly FlakeObservation[]): Set<string> {
  const result = new Set<string>();
  for (const key of new Set(rows.map((row) => row.testKey))) {
    const decisive = rows
      .filter((row) => row.testKey === key)
      .filter((row) => row.status !== 'flaky' && row.status !== 'skipped');
    if (decisive.length > 0 && decisive.every((row) => row.status !== 'passed')) result.add(key);
  }
  return result;
}

describe('FLAKE-1: a test whose decisive results are all failures is never suggested', () => {
  it('holds at every threshold', () => {
    fc.assert(
      fc.property(observations, thresholds, (rows, { minScore, minObservations }) => {
        const broken = alwaysFailing(rows);
        for (const key of keys(flakeCost(rows), minScore, minObservations)) {
          expect(broken.has(key)).toBe(false);
        }
      }),
      {
        ...params,
        examples: [
          [
            [
              {
                testKey: 'a',
                title: 't',
                runId: 'r1',
                commit: null,
                status: 'failed',
                retries: 0,
                durationMs: 1,
                runBlocked: true,
              },
              {
                testKey: 'a',
                title: 't',
                runId: 'r2',
                commit: null,
                status: 'flaky',
                retries: 1,
                durationMs: 1,
                runBlocked: false,
              },
            ],
            { minScore: 0, minObservations: 0 },
          ],
        ],
      },
    );
  });
});

describe('FLAKE-2: raising minScore never adds suggestions', () => {
  it('the suggestions at a higher score are a subset of those at a lower one', () => {
    fc.assert(
      fc.property(
        observations,
        thresholds,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (rows, base, raise) => {
          const costs = flakeCost(rows);
          const low = new Set(keys(costs, base.minScore, base.minObservations));
          const high = keys(costs, Math.min(1, base.minScore + raise), base.minObservations);
          for (const key of high) expect(low.has(key)).toBe(true);
        },
      ),
      params,
    );
  });
});

describe('FLAKE-3: the score is a share of observations and ignores other tests', () => {
  it('is in [0, 1], zero for a test that never disagrees, and unchanged by other tests', () => {
    fc.assert(
      fc.property(observations, (rows) => {
        const all = flakeCost(rows);
        for (const cost of all) {
          expect(cost.flakyScore).toBeGreaterThanOrEqual(0);
          expect(cost.flakyScore).toBeLessThanOrEqual(1);
          const own = rows.filter((row) => row.testKey === cost.testKey);
          expect(flakeCost(own)).toEqual([cost]);
          const statuses = new Set(own.map((row) => row.status));
          if (!statuses.has('flaky') && !statuses.has('passed')) expect(cost.flakyScore).toBe(0);
        }
      }),
      params,
    );
  });
});

/**
 * Histories in which every outcome is decided by the commit: on a given commit the test always
 * passes or always fails, and it never passes on a retry. A code change explains every
 * disagreement in such a history, so nothing in it may be acted on automatically.
 */
const deterministic: fc.Arbitrary<FlakeObservation[]> = fc
  .record({
    outcome: fc.record({
      c1: fc.constantFrom('passed', 'failed', 'timed_out'),
      c2: fc.constantFrom('passed', 'failed', 'timed_out'),
      c3: fc.constantFrom('passed', 'failed', 'timed_out'),
    }),
    runs: fc.array(
      fc.record({
        commit: fc.constantFrom('c1', 'c2', 'c3'),
        skipped: fc.boolean(),
        retries: fc.integer({ min: 0, max: 3 }),
      }),
      { maxLength: 30 },
    ),
  })
  .map(({ outcome, runs }) =>
    runs.map((run, index) => ({
      testKey: 'a',
      title: 't',
      runId: `r${String(index)}`,
      commit: run.commit,
      status: run.skipped
        ? ('skipped' as const)
        : (outcome[run.commit as keyof typeof outcome] as FlakeObservation['status']),
      retries: run.retries,
      durationMs: 1,
      runBlocked: false,
    })),
  );

describe('FLAKE-4: a deterministic failure is never eligible for automatic quarantine', () => {
  it('holds for every history whose outcomes the commit decides', () => {
    fc.assert(
      fc.property(deterministic, (rows) => {
        for (const cost of flakeCost(rows)) expect(cost.autoEligible).toBe(false);
      }),
      params,
    );
  });

  it('holds for every test whose latest decisive result is a failure', () => {
    fc.assert(
      fc.property(observations, (rows) => {
        for (const cost of flakeCost(rows)) {
          const decisive = rows
            .filter((row) => row.testKey === cost.testKey)
            .filter((row) => row.status !== 'flaky' && row.status !== 'skipped');
          const latest = decisive.at(-1);
          if (latest !== undefined && latest.status !== 'passed') {
            expect(cost.autoEligible).toBe(false);
          }
        }
      }),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes FLAKE-1 for a rule that quarantines any test with a flaky result', () => {
    const naive = (rows: readonly FlakeObservation[]) =>
      new Set(rows.filter((row) => row.status === 'flaky').map((row) => row.testKey));
    const result = fc.check(
      fc.property(observations, (rows) => {
        const broken = alwaysFailing(rows);
        return [...naive(rows)].every((key) => !broken.has(key));
      }),
      params,
    );
    expect(result.failed).toBe(true);
  });

  it('refutes FLAKE-2 for a threshold read the wrong way round', () => {
    const inverted = (costs: readonly FlakeCost[], minScore: number) =>
      costs.filter((cost) => cost.flakyScore > 0 && cost.flakyScore <= minScore);
    const result = fc.check(
      fc.property(observations, (rows) => {
        const costs = flakeCost(rows);
        return inverted(costs, 1).length <= inverted(costs, 0.1).length;
      }),
      params,
    );
    expect(result.failed).toBe(true);
  });

  it('refutes FLAKE-4 for a rule that acts on any flip of a test that has passed', () => {
    const naive = (cost: FlakeCost) => cost.flips > 0 && cost.decisivePasses > 0;
    const result = fc.check(
      fc.property(deterministic, (rows) => flakeCost(rows).every((cost) => !naive(cost))),
      params,
    );
    expect(result.failed).toBe(true);
  });
});
