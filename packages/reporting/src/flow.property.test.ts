import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { busFactor, computeFlow, type FlowDuration, type FlowPullRequest } from './flow.js';

/**
 * Property suite for FLOW-1 and FLOW-2.
 *
 * Fixed seed and `numRuns`, so a red run reproduces on any host. Timestamps are drawn in
 * any order, so reviews before opening and deploys before merging are generated as often
 * as sane histories, and some are null or unparseable.
 */
const SEED = 20261101;
const params = { seed: SEED, numRuns: 300 } as const;

const NOW = new Date('2026-10-31T00:00:00.000Z');

const stamp = fc
  .oneof(
    { weight: 10, arbitrary: fc.integer({ min: 0, max: 60 * 24 }) },
    { weight: 1, arbitrary: fc.constant(-1) },
  )
  .map((hours) =>
    hours < 0 ? 'not a date' : new Date(NOW.getTime() - hours * 3_600_000).toISOString(),
  );
const maybe = fc.option(stamp, { nil: null });

const pullRequest: fc.Arbitrary<FlowPullRequest> = fc.record({
  number: fc.integer({ min: 1, max: 10_000 }),
  state: fc.constantFrom('open' as const, 'closed' as const, 'merged' as const),
  draft: fc.boolean(),
  createdAt: stamp,
  firstCommitAt: maybe,
  firstReviewAt: maybe,
  approvedAt: maybe,
  mergedAt: maybe,
  closedAt: maybe,
  deployedAt: maybe,
  lastActivityAt: stamp,
  additions: fc.nat({ max: 3000 }),
  deletions: fc.nat({ max: 3000 }),
  reviewCount: fc.nat({ max: 5 }),
  approvals: fc.nat({ max: 3 }),
});

/** The checker FLOW-1 rests on. */
function durationIsSound(duration: FlowDuration): boolean {
  const { minHours, medianHours, p75Hours, maxHours, sampleSize } = duration;
  if (sampleSize === 0) {
    return minHours === null && medianHours === null && p75Hours === null && maxHours === null;
  }
  if (minHours === null || medianHours === null || p75Hours === null || maxHours === null) {
    return false;
  }
  return (
    minHours >= 0 && minHours <= medianHours && medianHours <= p75Hours && p75Hours <= maxHours
  );
}

describe('FLOW-1: every duration is non-negative and its median lies within its sample', () => {
  it('holds for each cycle-time phase and for review latency', () => {
    fc.assert(
      fc.property(
        fc.array(pullRequest, { maxLength: 30 }),
        fc.integer({ min: 1, max: 60 }),
        (prs, windowDays) => {
          const result = computeFlow(prs, { now: NOW, windowDays });
          const { coding, pickup, review, deploy } = result.cycleTime;
          for (const duration of [coding, pickup, review, deploy, result.reviewLatency]) {
            expect(durationIsSound(duration)).toBe(true);
          }
          for (const entry of result.stale) expect(entry.daysIdle).toBeGreaterThanOrEqual(0);
        },
      ),
      params,
    );
  });

  it('pins a review recorded before the pull request was opened', () => {
    const skewed: FlowPullRequest = {
      number: 1,
      state: 'merged',
      draft: false,
      createdAt: '2026-10-20T00:00:00.000Z',
      firstCommitAt: '2026-10-21T00:00:00.000Z',
      firstReviewAt: '2026-10-19T00:00:00.000Z',
      approvedAt: null,
      mergedAt: '2026-10-18T00:00:00.000Z',
      closedAt: null,
      deployedAt: '2026-10-17T12:00:00.000Z',
      lastActivityAt: '2026-11-02T00:00:00.000Z', // after `now`
      additions: 1,
      deletions: 1,
      reviewCount: 1,
      approvals: 0,
    };
    const result = computeFlow([skewed], { now: NOW, windowDays: 30 });
    for (const duration of Object.values(result.cycleTime)) {
      expect(durationIsSound(duration)).toBe(true);
    }
    expect(durationIsSound(result.reviewLatency)).toBe(true);
  });
});

const authorship = fc.array(
  fc.record({
    path: fc.constantFrom('src/a.ts', 'src/b.ts', 'docs/x.md', 'README.md', 'lib\\c.ts', 'x/y/z'),
    author: fc.constantFrom('p1', 'p2', 'p3', 'p4', 'p5'),
    commits: fc.integer({ min: -2, max: 50 }),
  }),
  { maxLength: 40 },
);

describe('FLOW-2: a directory bus factor is between 1 and its author count', () => {
  it('holds for every directory, with and without CODEOWNERS', () => {
    fc.assert(
      fc.property(authorship, fc.boolean(), (rows, withOwners) => {
        const owners = withOwners ? [{ pattern: 'src/', owners: ['@team'] }] : null;
        for (const entry of busFactor(rows, owners)) {
          expect(entry.busFactor).toBeGreaterThanOrEqual(1);
          expect(entry.busFactor).toBeLessThanOrEqual(entry.authorCount);
          expect(entry.commits).toBeGreaterThan(0);
        }
      }),
      params,
    );
  });

  it('pins one author holding exactly half the commits', () => {
    // Exactly 50% is enough: the rule is "at least half".
    const [entry] = busFactor(
      [
        { path: 'src/a.ts', author: 'p1', commits: 5 },
        { path: 'src/a.ts', author: 'p2', commits: 3 },
        { path: 'src/a.ts', author: 'p3', commits: 2 },
      ],
      null,
    );
    expect(entry).toMatchObject({ busFactor: 1, authorCount: 3 });
  });
});

describe('the property harness can fail', () => {
  it('the FLOW-1 checker refutes an unsound duration', () => {
    const sound: FlowDuration = {
      medianHours: 2,
      p75Hours: 3,
      minHours: 1,
      maxHours: 4,
      sampleSize: 3,
    };
    expect(durationIsSound(sound)).toBe(true);
    expect(durationIsSound({ ...sound, minHours: -1 })).toBe(false);
    expect(durationIsSound({ ...sound, medianHours: 5 })).toBe(false);
    expect(durationIsSound({ ...sound, p75Hours: 1.5 })).toBe(false);
    expect(durationIsSound({ ...sound, maxHours: null })).toBe(false);
    expect(durationIsSound({ ...sound, sampleSize: 0 })).toBe(false);
  });

  it('finds a counterexample to a false claim about bus factor', () => {
    // "Every bus factor is 1" is false; fast-check must find a directory where it is not.
    const outcome = fc.check(
      fc.property(authorship, (rows) =>
        busFactor(rows, null).every((entry) => entry.busFactor === 1),
      ),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
});
