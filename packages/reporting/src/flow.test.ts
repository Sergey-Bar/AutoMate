import { describe, expect, it } from 'vitest';
import { ScorecardSchema } from '@automate/shared-contracts';
import { wilson } from './stats.js';
import {
  busFactor,
  codeownersMatches,
  computeFlow,
  FLOW_SIZE_LIMITS,
  flowScorecard,
  sizeBucket,
  type FlowPullRequest,
} from './flow.js';

/**
 * A hand-computed fixture. Window: 14 days ending 2026-10-31T00:00Z, so a pull request
 * counts when it merged (or was first reviewed) on or after 2026-10-17T00:00Z.
 */
const NOW = new Date('2026-10-31T00:00:00.000Z');

const pr = (number: number, extra: Partial<FlowPullRequest>): FlowPullRequest => ({
  number,
  state: 'merged',
  draft: false,
  createdAt: '2026-10-20T00:00:00.000Z',
  firstCommitAt: null,
  firstReviewAt: null,
  approvedAt: null,
  mergedAt: null,
  closedAt: null,
  deployedAt: null,
  lastActivityAt: '2026-10-20T00:00:00.000Z',
  additions: 0,
  deletions: 0,
  reviewCount: 0,
  approvals: 0,
  ...extra,
});

const prs: FlowPullRequest[] = [
  pr(1, {
    firstCommitAt: '2026-10-19T00:00:00.000Z', // coding 24h
    firstReviewAt: '2026-10-20T04:00:00.000Z', // pickup 4h
    approvedAt: '2026-10-20T06:00:00.000Z',
    mergedAt: '2026-10-20T10:00:00.000Z', // review 6h
    deployedAt: '2026-10-20T12:00:00.000Z', // deploy 2h
    additions: 5,
    deletions: 3, // XS
    reviewCount: 1,
    approvals: 1,
  }),
  pr(2, {
    createdAt: '2026-10-21T00:00:00.000Z',
    firstCommitAt: '2026-10-21T06:00:00.000Z', // after opening: coding 0
    firstReviewAt: '2026-10-22T00:00:00.000Z', // pickup 24h
    mergedAt: '2026-10-22T12:00:00.000Z', // review 12h
    additions: 50,
    deletions: 30, // S
    reviewCount: 2,
  }),
  pr(3, {
    createdAt: '2026-10-25T00:00:00.000Z',
    mergedAt: '2026-10-25T02:00:00.000Z',
    deployedAt: '2026-10-25T03:00:00.000Z', // deploy 1h
    additions: 300,
    deletions: 200, // L
    reviewCount: 0, // merged without review
  }),
  pr(4, {
    createdAt: '2026-10-26T00:00:00.000Z',
    firstCommitAt: '2026-10-25T12:00:00.000Z', // coding 12h
    firstReviewAt: '2026-10-27T00:00:00.000Z', // pickup 24h
    mergedAt: '2026-10-28T00:00:00.000Z', // review 24h
    deployedAt: '2026-10-28T04:00:00.000Z', // deploy 4h
    additions: 1500, // XL
    reviewCount: 1,
  }),
  // Merged before the window: in nothing.
  pr(5, {
    createdAt: '2026-09-29T00:00:00.000Z',
    firstReviewAt: '2026-09-30T00:00:00.000Z',
    mergedAt: '2026-10-01T00:00:00.000Z',
    reviewCount: 1,
  }),
  // Open, reviewed after 8 days, idle 13 days.
  pr(6, {
    state: 'open',
    createdAt: '2026-10-10T00:00:00.000Z',
    firstReviewAt: '2026-10-18T00:00:00.000Z', // 192h
    lastActivityAt: '2026-10-18T00:00:00.000Z',
  }),
  // A draft: not in progress, never stale, its review not counted.
  pr(7, {
    state: 'open',
    draft: true,
    createdAt: '2026-10-17T00:00:00.000Z',
    firstReviewAt: '2026-10-18T00:00:00.000Z',
    lastActivityAt: '2026-10-01T00:00:00.000Z',
  }),
  pr(8, {
    state: 'open',
    createdAt: '2026-10-29T00:00:00.000Z',
    lastActivityAt: '2026-10-30T00:00:00.000Z',
  }),
  // Closed unmerged, reviewed in an hour.
  pr(9, {
    state: 'closed',
    firstReviewAt: '2026-10-20T01:00:00.000Z',
    closedAt: '2026-10-21T00:00:00.000Z',
  }),
  // Idle 7 days and 1 hour: stale at the 7-day default, reported as 7 whole days.
  pr(10, {
    state: 'open',
    createdAt: '2026-10-15T00:00:00.000Z',
    lastActivityAt: '2026-10-23T23:00:00.000Z',
  }),
];

describe('computeFlow on the hand-computed fixture', () => {
  const result = computeFlow(prs, { now: NOW, windowDays: 14 });

  it('breaks cycle time into four phases with median, p75 and range', () => {
    expect(result.cycleTime.coding).toEqual({
      medianHours: 12,
      p75Hours: 18,
      minHours: 0,
      maxHours: 24,
      sampleSize: 3,
    });
    expect(result.cycleTime.pickup).toEqual({
      medianHours: 24,
      p75Hours: 24,
      minHours: 4,
      maxHours: 24,
      sampleSize: 3,
    });
    expect(result.cycleTime.review).toMatchObject({ medianHours: 12, p75Hours: 18, sampleSize: 3 });
    expect(result.cycleTime.deploy).toMatchObject({ medianHours: 2, p75Hours: 3, sampleSize: 3 });
  });

  it('measures review latency over every first review in the window, merged or not', () => {
    // 1, 4, 24, 24, 192 — the draft and the pre-window review excluded.
    expect(result.reviewLatency).toEqual({
      medianHours: 24,
      p75Hours: 24,
      minHours: 1,
      maxHours: 192,
      sampleSize: 5,
    });
    expect(result.firstReviewWithinDay).toEqual({ count: 4, total: 5 });
  });

  it('buckets merged pull requests by changed lines', () => {
    expect(result.merged).toBe(4);
    expect(result.sizes).toEqual({ XS: 1, S: 1, M: 0, L: 1, XL: 1 });
  });

  it('counts open non-draft work and lists stale pull requests by number and idle days only', () => {
    expect(result.workInProgress).toBe(3);
    expect(result.stale).toEqual([
      { number: 6, daysIdle: 13 },
      { number: 10, daysIdle: 7 },
    ]);
  });

  it('reports the merged-without-review rate with a Wilson interval', () => {
    expect(result.mergedWithoutReview).toEqual({ count: 1, merged: 4, rate: wilson(1, 4) });
  });

  it('honours staleAfterDays and records its settings', () => {
    const strict = computeFlow(prs, { now: NOW, windowDays: 14, staleAfterDays: 1 });
    expect(strict.stale.map((entry) => entry.number)).toEqual([6, 10, 8]);
    expect(strict.staleAfterDays).toBe(1);
    expect(result.staleAfterDays).toBe(7);
    expect(result.windowDays).toBe(14);
  });
});

describe('computeFlow edge rules', () => {
  it('drops negative durations and unparseable timestamps, and ties stale lists by number', () => {
    const result = computeFlow(
      [
        pr(1, {
          createdAt: '2026-10-20T00:00:00.000Z',
          firstReviewAt: '2026-10-19T00:00:00.000Z', // before opening: clock skew
          mergedAt: '2026-10-20T10:00:00.000Z',
          deployedAt: '2026-10-20T09:00:00.000Z', // before merge
        }),
        pr(2, { createdAt: 'garbage', mergedAt: '2026-10-21T00:00:00.000Z' }),
        pr(3, { state: 'merged', mergedAt: 'garbage' }),
        pr(4, { state: 'open', lastActivityAt: 'garbage' }),
        pr(6, { state: 'open', lastActivityAt: '2026-10-01T00:00:00.000Z' }),
        pr(5, { state: 'open', lastActivityAt: '2026-10-01T00:00:00.000Z' }),
      ],
      { now: NOW, windowDays: 14 },
    );
    expect(result.merged).toBe(2);
    expect(result.cycleTime.pickup.sampleSize).toBe(0);
    expect(result.cycleTime.pickup.medianHours).toBeNull();
    expect(result.cycleTime.review.sampleSize).toBe(1); // firstReview → merged is 34h
    expect(result.cycleTime.deploy.sampleSize).toBe(0);
    expect(result.reviewLatency.sampleSize).toBe(0);
    expect(result.stale).toEqual([
      { number: 5, daysIdle: 30 },
      { number: 6, daysIdle: 30 },
    ]);
  });

  it('has no rate for merged-without-review when nothing merged', () => {
    const result = computeFlow([], { now: NOW, windowDays: 14 });
    expect(result.mergedWithoutReview).toEqual({ count: 0, merged: 0, rate: null });
    expect(result.cycleTime.coding).toEqual({
      medianHours: null,
      p75Hours: null,
      minHours: null,
      maxHours: null,
      sampleSize: 0,
    });
  });

  it('refuses a window that is not a positive number of days', () => {
    expect(() => computeFlow([], { now: NOW, windowDays: 0 })).toThrow(RangeError);
  });
});

describe('sizeBucket', () => {
  it('puts each boundary in the smaller bucket', () => {
    expect(FLOW_SIZE_LIMITS).toEqual({ XS: 10, S: 100, M: 400, L: 1000 });
    expect(sizeBucket(0)).toBe('XS');
    expect(sizeBucket(10)).toBe('XS');
    expect(sizeBucket(11)).toBe('S');
    expect(sizeBucket(100)).toBe('S');
    expect(sizeBucket(400)).toBe('M');
    expect(sizeBucket(1000)).toBe('L');
    expect(sizeBucket(1001)).toBe('XL');
  });
});

describe('codeownersMatches', () => {
  it('follows the gitignore-style rules CODEOWNERS uses', () => {
    expect(codeownersMatches('*', 'any/path.ts')).toBe(true);
    expect(codeownersMatches('*.ts', 'deep/nested/x.ts')).toBe(true);
    expect(codeownersMatches('*.ts', 'x.tsx')).toBe(false);
    expect(codeownersMatches('/src/', 'src/a.ts')).toBe(true);
    expect(codeownersMatches('/src/', 'lib/src/a.ts')).toBe(false);
    expect(codeownersMatches('apps/', 'apps')).toBe(false);
    expect(codeownersMatches('docs', 'docs/a.md')).toBe(true);
    expect(codeownersMatches('docs', 'x/docs/a.md')).toBe(true);
    expect(codeownersMatches('docs/*.md', 'docs/a.md')).toBe(true);
    expect(codeownersMatches('docs/*.md', 'x/docs/a.md')).toBe(false);
    expect(codeownersMatches('docs/*.md', 'docs/sub/a.md')).toBe(false);
    expect(codeownersMatches('**/test/**', 'test/a.ts')).toBe(true);
    expect(codeownersMatches('**/test/**', 'a/b/test/c.ts')).toBe(true);
    expect(codeownersMatches('apps/**/x.ts', 'apps/x.ts')).toBe(true);
    expect(codeownersMatches('?.md', 'a.md')).toBe(true);
    expect(codeownersMatches('?.md', 'ab.md')).toBe(false);
    expect(codeownersMatches('a+b.ts', 'a+b.ts')).toBe(true);
    expect(codeownersMatches('a+b.ts', 'aab.ts')).toBe(false);
  });

  it('never matches a comment, a blank line or a bare slash', () => {
    expect(codeownersMatches('# owners', 'owners')).toBe(false);
    expect(codeownersMatches('   ', 'a')).toBe(false);
    expect(codeownersMatches('/', 'a')).toBe(false);
  });
});

describe('busFactor', () => {
  const authorship = [
    { path: 'src/a.ts', author: 'alice', commits: 6 },
    { path: 'src/b.ts', author: 'bob', commits: 3 },
    { path: 'src/b.ts', author: 'alice', commits: 1 },
    { path: 'src/c.ts', author: 'carol', commits: 2 },
    { path: 'docs/x.md', author: 'alice', commits: 1 },
    { path: 'docs/y.md', author: 'bob', commits: 1 },
    { path: 'docs/z.md', author: 'carol', commits: 1 },
    { path: 'docs/w.md', author: 'dave', commits: 1 },
    { path: 'README.md', author: 'alice', commits: 2 },
    { path: 'lib\\win.ts', author: 'erin', commits: 1 },
    { path: './tools/t.ts', author: 'frank', commits: 0 },
  ];
  const codeowners = [
    { pattern: '/src/', owners: ['@team'] },
    { pattern: 'docs/*.md', owners: ['@docs'] },
    { pattern: 'docs/w.md', owners: [] },
  ];

  it('finds the fewest authors covering half the commits, per top-level directory', () => {
    expect(busFactor(authorship, codeowners)).toEqual([
      { directory: '.', authorCount: 1, busFactor: 1, commits: 2, codeowned: false },
      { directory: 'docs', authorCount: 4, busFactor: 2, commits: 4, codeowned: false },
      { directory: 'lib', authorCount: 1, busFactor: 1, commits: 1, codeowned: false },
      { directory: 'src', authorCount: 3, busFactor: 1, commits: 12, codeowned: true },
    ]);
  });

  it('reports CODEOWNERS coverage as unknown without a file, and total under `*`', () => {
    expect(busFactor(authorship, null).every((entry) => entry.codeowned === null)).toBe(true);
    const all = busFactor(authorship, [{ pattern: '*', owners: ['@all'] }]);
    expect(all.every((entry) => entry.codeowned === true)).toBe(true);
  });

  it('never names an author', () => {
    const text = JSON.stringify(busFactor(authorship, codeowners));
    for (const name of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank']) {
      expect(text).not.toContain(name);
    }
  });
});

describe('flowScorecard', () => {
  const result = computeFlow(prs, { now: NOW, windowDays: 14 });

  it('builds a valid card scored by the geometric mean of the shares', () => {
    const card = ScorecardSchema.parse(
      flowScorecard(result, { now: NOW, windowDays: 14, minSample: 3 }),
    );
    expect(card).toMatchObject({
      id: 'flow',
      dimension: 'delivery',
      status: 'pass',
      evaluatedAt: NOW.toISOString(),
      windowDays: 14,
      reasons: [],
      // (0.8 · 0.75 · 0.5 · ⅓)^¼ = 0.1^¼ = 0.5623…
      score: 56.2,
      cappedBy: 'fresh-work-in-progress',
    });
    const byKey = Object.fromEntries(card.metrics.map((metric) => [metric.key, metric]));
    expect(byKey['review-latency']).toMatchObject({
      value: 24,
      unit: 'hours',
      target: 24,
      status: 'good',
    });
    expect(byKey['first-review-within-a-day']).toMatchObject({ value: 0.8, status: 'warn' });
    expect(byKey['reviewed-before-merge']).toMatchObject({ value: 0.75, status: 'warn' });
    expect(byKey['small-pull-requests']).toMatchObject({ value: 0.5, status: 'bad' });
    expect(byKey['fresh-work-in-progress']).toMatchObject({ sampleSize: 3, status: 'bad' });
  });

  it('defaults minSample to 5, leaving what has fewer observations unmeasured', () => {
    const card = ScorecardSchema.parse(flowScorecard(result, { now: NOW, windowDays: 14 }));
    expect(card.score).toBe(80);
    expect(card.cappedBy).toBe('first-review-within-a-day');
    const merged = card.metrics.find((metric) => metric.key === 'reviewed-before-merge');
    expect(merged).toMatchObject({ value: null, status: 'insufficient' });
  });

  it('judges review latency against one business day', () => {
    const slow = (latencies: number[]) =>
      computeFlow(
        latencies.map((hours, index) =>
          pr(index + 1, {
            state: 'closed',
            createdAt: '2026-10-20T00:00:00.000Z',
            firstReviewAt: new Date(
              Date.parse('2026-10-20T00:00:00.000Z') + hours * 3_600_000,
            ).toISOString(),
          }),
        ),
        { now: NOW, windowDays: 14 },
      );
    const status = (latencies: number[]) =>
      flowScorecard(slow(latencies), { now: NOW, windowDays: 14, minSample: 1 }).metrics.find(
        (metric) => metric.key === 'review-latency',
      )?.status;
    expect(status([1, 2, 30])).toBe('good'); // median 2, p75 16
    expect(status([1, 30, 40])).toBe('bad'); // median 30
    expect(status([1, 2, 3])).toBe('good');
    expect(status([1, 2, 30, 40])).toBe('warn'); // median 16, p75 32.5
  });

  it('marks a share of at least 0.9 good', () => {
    const clean = computeFlow([pr(1, { mergedAt: '2026-10-20T02:00:00.000Z', reviewCount: 1 })], {
      now: NOW,
      windowDays: 14,
    });
    const card = flowScorecard(clean, { now: NOW, windowDays: 14, minSample: 1 });
    const reviewed = card.metrics.find((metric) => metric.key === 'reviewed-before-merge');
    expect(reviewed?.status).toBe('good');
  });

  it('is insufficient, unscored and uncapped when nothing has enough data', () => {
    const card = ScorecardSchema.parse(
      flowScorecard(computeFlow([], { now: NOW, windowDays: 14 }), { now: NOW, windowDays: 14 }),
    );
    expect(card.status).toBe('insufficient');
    expect(card.score).toBeNull();
    expect(card.cappedBy).toBeNull();
    expect(card.metrics.every((metric) => metric.value === null)).toBe(true);
  });
});

describe('codeownersMatches, trailing slashes', () => {
  it('reads any number of trailing slashes as one directory marker', () => {
    expect(codeownersMatches('/src//', 'src/a.ts')).toBe(true);
    expect(codeownersMatches('docs///', 'docs/a.md')).toBe(true);
    expect(codeownersMatches('docs///', 'docs')).toBe(false);
  });
});
