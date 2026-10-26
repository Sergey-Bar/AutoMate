import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeDora,
  type DoraDeployment,
  type DoraIncident,
  type DoraInput,
  type DoraMetric,
} from './dora.js';

/**
 * Property suite for DORA-1, DORA-2 and DORA-3.
 *
 * Fixed seed and `numRuns`, so a red run reproduces on any host. Deployments are drawn
 * across both windows and beyond, in production under two spellings and in staging, with
 * every flag combination, overlapping shas and incidents that point at real deployments.
 */
const SEED = 20261031;
const params = { seed: SEED, numRuns: 300 } as const;

const NOW = new Date('2026-10-31T00:00:00.000Z');
const SHAS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

const iso = (offsetHours: number) =>
  new Date(NOW.getTime() - offsetHours * 3_600_000).toISOString();

const deployment = (index: number): fc.Arbitrary<DoraDeployment> =>
  fc.record({
    id: fc.constant(`d${index}`),
    environment: fc.constantFrom('production', 'Production', 'staging'),
    status: fc.constantFrom('success' as const, 'failure' as const),
    // Up to 130 days back: past both windows when windowDays is small.
    createdAt: fc.integer({ min: 0, max: 130 * 24 }).map(iso),
    sha: fc.option(fc.constantFrom(...SHAS), { nil: null }),
    shas: fc.option(fc.subarray([...SHAS]), { nil: undefined }),
    rollback: fc.option(fc.boolean(), { nil: undefined }),
    hotfix: fc.option(fc.boolean(), { nil: undefined }),
    unplanned: fc.option(fc.boolean(), { nil: undefined }),
  });

const input: fc.Arbitrary<DoraInput> = fc.integer({ min: 0, max: 25 }).chain((count) =>
  fc.record({
    deployments: fc.tuple(...Array.from({ length: count }, (_, index) => deployment(index))),
    changes: fc.array(
      fc.record({
        sha: fc.constantFrom(...SHAS),
        firstCommitAt: fc.integer({ min: 0, max: 140 * 24 }).map(iso),
        mergedAt: fc.constant(null),
      }),
      { maxLength: 10 },
    ),
    incidents: fc.array(
      fc.record({
        id: fc.uuid(),
        openedAt: fc.integer({ min: 0, max: 130 * 24 }).map(iso),
        resolvedAt: fc.option(fc.integer({ min: 0, max: 130 * 24 }).map(iso), { nil: null }),
        deploymentId: fc.option(
          fc.integer({ min: 0, max: Math.max(0, count - 1) }).map((index) => `d${index}`),
          { nil: null },
        ),
      }) satisfies fc.Arbitrary<DoraIncident>,
      { maxLength: 6 },
    ),
    productionEnvironments: fc.constant(['production'] as const),
    now: fc.constant(NOW),
    windowDays: fc.integer({ min: 1, max: 60 }),
    minSample: fc.integer({ min: 1, max: 6 }),
  }),
);

const inUnit = (value: number | null) => value === null || (value >= 0 && value <= 1);

describe('DORA-1: change failure rate is in [0, 1] or null', () => {
  it('holds now and over the previous window', () => {
    fc.assert(
      fc.property(input, (raw) => {
        const { changeFailureRate, reworkRate } = computeDora(raw).metrics;
        expect(inUnit(changeFailureRate.value)).toBe(true);
        expect(inUnit(changeFailureRate.previous)).toBe(true);
        expect(inUnit(reworkRate.value)).toBe(true);
      }),
      params,
    );
  });
});

/**
 * DORA-2. The added deployment ships nothing new and is not a remediation: it can only
 * grow the denominator. The offset may land in either window or outside both.
 */
function withNoOpDeployment(raw: DoraInput, offsetHours: number): DoraInput {
  const added: DoraDeployment = {
    id: 'added-no-op',
    environment: 'production',
    status: 'success',
    createdAt: iso(offsetHours),
    sha: null,
  };
  return { ...raw, deployments: [...raw.deployments, added] };
}

function neverRaises(before: number | null, after: number | null): boolean {
  return before === null || after === null || after <= before + 1e-12;
}

describe('DORA-2: a successful deployment that fixes nothing never raises the change failure rate', () => {
  it('holds wherever the deployment lands', () => {
    fc.assert(
      fc.property(input, fc.integer({ min: 0, max: 130 * 24 }), (raw, offset) => {
        const before = computeDora(raw).metrics.changeFailureRate;
        const after = computeDora(withNoOpDeployment(raw, offset)).metrics.changeFailureRate;
        expect(neverRaises(before.value, after.value)).toBe(true);
        expect(neverRaises(before.previous, after.previous)).toBe(true);
      }),
      params,
    );
  });

  it('pins the case that shifted blame under "the immediately next deployment"', () => {
    // failed → no-op → hotfix. Blaming the deployment immediately before the hotfix would
    // count the no-op as a second failure: 1/2 before, 2/3 after.
    const base: DoraInput = {
      deployments: [
        {
          id: 'f',
          environment: 'production',
          status: 'failure',
          createdAt: iso(48),
          sha: 'a',
        },
        {
          id: 'h',
          environment: 'production',
          status: 'success',
          createdAt: iso(24),
          sha: 'b',
          hotfix: true,
        },
      ],
      changes: [],
      incidents: [],
      productionEnvironments: ['production'],
      now: NOW,
      windowDays: 7,
      minSample: 1,
    };
    const before = computeDora(base).metrics.changeFailureRate.value;
    const after = computeDora(withNoOpDeployment(base, 36)).metrics.changeFailureRate.value;
    expect(before).toBe(0.5);
    expect(after).toBeCloseTo(1 / 3, 12);
  });
});

describe('DORA-3: a metric below minSample is insufficient and carries no band', () => {
  it('holds for every metric', () => {
    fc.assert(
      fc.property(input, (raw) => {
        const result = computeDora(raw);
        for (const metric of Object.values(result.metrics) as DoraMetric[]) {
          if (metric.sampleSize < result.minSample) {
            expect(metric.status).toBe('insufficient');
            expect(metric.value).toBeNull();
            expect(metric.band).toBeNull();
          } else {
            expect(metric.status).toBe('measured');
            expect(metric.value).not.toBeNull();
          }
          if (metric.previousSampleSize < result.minSample) expect(metric.previous).toBeNull();
        }
      }),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('the DORA-2 checker refutes a rate that went up', () => {
    // A harness that cannot fail is not evidence: 1/2 → 2/3 must be caught.
    expect(neverRaises(0.5, 2 / 3)).toBe(false);
    expect(neverRaises(0.5, 0.5)).toBe(true);
    expect(inUnit(1.0000001)).toBe(false);
    expect(inUnit(-0.1)).toBe(false);
  });

  it('finds a counterexample to a false claim about the generator', () => {
    // "No generated input ever has a measured change failure rate" is false; fast-check
    // must say so, or the generator is not reaching production deployments at all.
    const outcome = fc.check(
      fc.property(input, (raw) => computeDora(raw).metrics.changeFailureRate.value === null),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
});
