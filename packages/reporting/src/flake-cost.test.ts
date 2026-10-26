import { describe, expect, it } from 'vitest';
import { flakeCost, suggestQuarantine, type FlakeObservation } from './flake-cost.js';

function observe(
  testKey: string,
  runId: string,
  status: FlakeObservation['status'],
  extra: Partial<FlakeObservation> = {},
): FlakeObservation {
  return {
    testKey,
    title: testKey,
    runId,
    commit: null,
    status,
    retries: 0,
    durationMs: 100,
    runBlocked: false,
    ...extra,
  };
}

describe('flake evidence', () => {
  it('separates a retry pass, a disagreement on one commit, and a flip across commits', () => {
    const [cost] = flakeCost([
      observe('t', 'r1', 'passed', { commit: 'a' }),
      observe('t', 'r2', 'failed', { commit: 'a' }),
      observe('t', 'r3', 'flaky', { commit: 'b', retries: 1 }),
      observe('t', 'r4', 'failed', { commit: 'c' }),
      observe('t', 'r5', 'passed', { commit: 'd' }),
    ]);
    // passed@a→failed@a is a same-commit flip; flaky@b is not decisive; failed@c→passed@d is
    // the one flip across commits.
    expect(cost?.evidence).toEqual({ retryPasses: 1, sameCommit: 1, crossCommitFlips: 1 });
    expect(cost).toMatchObject({ flakyResults: 1, flips: 2 });
  });

  it('never makes a test broken on one commit and fixed on the next eligible to act on', () => {
    // A test that caught a regression on `b` and passed once it was fixed on `c`. Every
    // flip is across commits, so a code change explains all of it.
    const [cost] = flakeCost([
      observe('t', 'r1', 'passed', { commit: 'a' }),
      observe('t', 'r2', 'failed', { commit: 'b' }),
      observe('t', 'r3', 'failed', { commit: 'b' }),
      observe('t', 'r4', 'passed', { commit: 'c' }),
      observe('t', 'r5', 'passed', { commit: 'c' }),
    ]);
    expect(cost?.flakyScore).toBeGreaterThan(0);
    expect(cost?.autoEligible).toBe(false);
  });

  it('makes a retry pass and a same-commit disagreement eligible, while the test is passing', () => {
    const [retried] = flakeCost([
      observe('t', 'r1', 'passed', { commit: 'a' }),
      observe('t', 'r2', 'flaky', { commit: 'a', retries: 1 }),
    ]);
    expect(retried?.autoEligible).toBe(true);
    const [disagreed] = flakeCost([
      observe('t', 'r1', 'failed', { commit: 'a' }),
      observe('t', 'r2', 'passed', { commit: 'a' }),
    ]);
    expect(disagreed?.autoEligible).toBe(true);
  });

  it('is never eligible while its latest decisive result is a failure', () => {
    // Flaky history, then a real regression: acting now would hide it.
    const [cost] = flakeCost([
      observe('t', 'r1', 'flaky', { commit: 'a', retries: 1 }),
      observe('t', 'r2', 'passed', { commit: 'a' }),
      observe('t', 'r3', 'failed', { commit: 'b' }),
    ]);
    expect(cost?.evidence.retryPasses).toBe(1);
    expect(cost?.autoEligible).toBe(false);
  });

  it('reads no commit as no same-commit evidence, never as one shared commit', () => {
    const [cost] = flakeCost([observe('t', 'r1', 'failed'), observe('t', 'r2', 'passed')]);
    expect(cost?.evidence).toEqual({ retryPasses: 0, sameCommit: 0, crossCommitFlips: 1 });
    expect(cost?.autoEligible).toBe(false);
  });
});

describe('flakeCost', () => {
  it('scores disagreement the way the insights leaderboard does', () => {
    const [cost] = flakeCost([
      observe('t', 'r1', 'passed'),
      observe('t', 'r2', 'failed'),
      observe('t', 'r3', 'flaky', { retries: 1 }),
      observe('t', 'r4', 'passed'),
      observe('t', 'r5', 'skipped'),
    ]);
    // One flaky result and two flips (passed→failed, failed→passed) over five runs.
    expect(cost).toMatchObject({
      testKey: 't',
      observations: 5,
      flakyScore: 0.6,
      decisivePasses: 2,
      decisiveFailures: 1,
    });
  });

  it('gives a test that only ever fails a score of zero: it is broken, not flaky', () => {
    const [cost] = flakeCost([
      observe('broken', 'r1', 'failed'),
      observe('broken', 'r2', 'timed_out'),
      observe('broken', 'r3', 'failed'),
    ]);
    expect(cost).toMatchObject({ flakyScore: 0, decisiveFailures: 3, decisivePasses: 0 });
  });

  it('rounds the score to three places, and reaches 1 only when every result is flaky', () => {
    const [capped] = flakeCost([
      observe('t', 'r1', 'passed'),
      observe('t', 'r2', 'flaky'),
      observe('t', 'r3', 'failed'),
    ]);
    // flaky 1, flips 1 (passed→failed; flaky is not decisive) over 3.
    expect(capped?.flakyScore).toBe(0.667);
    const [full] = flakeCost([observe('t', 'r1', 'flaky'), observe('t', 'r2', 'flaky')]);
    expect(full?.flakyScore).toBe(1);
  });

  it('counts retries, the time they cost, and the distinct runs it blocked', () => {
    const [cost] = flakeCost([
      // 3 retries of a 400 ms total: 300 ms spent on attempts beyond the first.
      observe('t', 'r1', 'flaky', { retries: 3, durationMs: 400, runBlocked: true }),
      observe('t', 'r1', 'failed', { retries: 1, durationMs: 50, runBlocked: true }),
      observe('t', 'r2', 'failed', { retries: 1, durationMs: null, runBlocked: true }),
      observe('t', 'r3', 'passed', { runBlocked: true }),
      observe('t', 'r4', 'skipped', { runBlocked: true }),
      observe('t', 'r5', 'timed_out', { retries: -2, runBlocked: false }),
    ]);
    expect(cost).toMatchObject({ retriesSpent: 5, wastedMs: 325, blockedRuns: 2 });
  });

  it('takes the latest title, and orders tests by score, then waste, then key', () => {
    const costs = flakeCost([
      observe('b', 'r1', 'flaky', { title: 'old title' }),
      observe('a', 'r1', 'flaky'),
      observe('c', 'r1', 'flaky', { retries: 1, durationMs: 1000 }),
      observe('d', 'r1', 'passed'),
      observe('b', 'r2', 'flaky', { title: 'new title' }),
      observe('a', 'r2', 'flaky'),
      observe('c', 'r2', 'flaky'),
    ]);
    expect(costs.map((cost) => cost.testKey)).toEqual(['c', 'a', 'b', 'd']);
    expect(costs.find((cost) => cost.testKey === 'b')?.title).toBe('new title');
  });

  it('returns nothing for no observations', () => {
    expect(flakeCost([])).toEqual([]);
  });

  it('breaks a full tie by key, whatever the input order', () => {
    const tied = [observe('a', 'r1', 'flaky'), observe('b', 'r1', 'flaky')];
    expect(flakeCost(tied).map((cost) => cost.testKey)).toEqual(['a', 'b']);
    expect(flakeCost([...tied].reverse()).map((cost) => cost.testKey)).toEqual(['a', 'b']);
  });
});

describe('suggestQuarantine', () => {
  const costs = flakeCost([
    observe('flaky', 'r1', 'passed'),
    observe('flaky', 'r2', 'flaky', { retries: 2, durationMs: 3000, runBlocked: true }),
    observe('flaky', 'r3', 'passed'),
    observe('flaky', 'r4', 'failed', { runBlocked: true }),
    observe('rare', 'r1', 'flaky'),
    observe('broken', 'r1', 'failed'),
    observe('broken', 'r2', 'flaky'),
    observe('broken', 'r3', 'failed'),
    observe('stable', 'r1', 'passed'),
    observe('stable', 'r2', 'passed'),
    observe('only-flaky', 'r1', 'flaky', { retries: 1, durationMs: 200 }),
    observe('only-flaky', 'r2', 'flaky', { retries: 1, durationMs: 200 }),
  ]);

  it('suggests flaky tests with enough evidence, and says why in one sentence', () => {
    const suggestions = suggestQuarantine(costs, { minScore: 0.3, minObservations: 2 });
    expect(suggestions.map((suggestion) => suggestion.testKey)).toEqual(['only-flaky', 'flaky']);
    expect(suggestions[1]).toEqual({
      testKey: 'flaky',
      title: 'flaky',
      flakyScore: 0.5,
      autoEligible: false,
      evidence: { retryPasses: 1, sameCommit: 0, crossCommitFlips: 1 },
      reason: 'Disagreed with itself in 50% of 4 runs; 2 retries cost 2.0 s and it blocked 2 runs.',
    });
    expect(suggestions[0]?.reason).toBe(
      'Disagreed with itself in 100% of 2 runs; 2 retries cost 0.2 s and it blocked no run.',
    );
  });

  it('never suggests a test whose decisive results are all failures, even with a flaky result', () => {
    const suggestions = suggestQuarantine(costs, { minScore: 0, minObservations: 1 });
    expect(suggestions.map((suggestion) => suggestion.testKey)).not.toContain('broken');
    expect(suggestions.map((suggestion) => suggestion.testKey)).not.toContain('stable');
    expect(suggestions.map((suggestion) => suggestion.testKey)).toContain('rare');
  });

  it('writes singular forms for one retry and one blocked run', () => {
    const [single] = suggestQuarantine(
      flakeCost([observe('t', 'r1', 'flaky', { retries: 1, durationMs: 1000, runBlocked: true })]),
      { minScore: 0, minObservations: 1 },
    );
    expect(single?.reason).toBe(
      'Disagreed with itself in 100% of 1 run; 1 retry cost 0.5 s and it blocked 1 run.',
    );
  });
});
