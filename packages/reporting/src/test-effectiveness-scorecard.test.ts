import { describe, expect, it } from 'vitest';
import { ScorecardSchema } from '@automate/shared-contracts';
import {
  testEffectivenessScorecard,
  type TestEffectivenessInput,
} from './test-effectiveness-scorecard.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const parsed = (card: unknown) => ScorecardSchema.parse(card);
const byKey = (card: ReturnType<typeof parsed>) =>
  Object.fromEntries(card.metrics.map((metric) => [metric.key, metric]));

const NOTHING: TestEffectivenessInput = {
  mutationScore: null,
  diffCoverage: null,
  flakes: null,
  failures: null,
};

const MEASURED: TestEffectivenessInput = {
  mutationScore: 81,
  diffCoverage: { commits: 3, covered: 90, executable: 100 },
  flakes: { tests: 50, flaky: 1, retriesSpent: 4, wastedMs: 7_200_000, blockedRuns: 0 },
  failures: { failures: 6, causes: 2, topCause: 'TimeoutError: <n>ms' },
};

describe('testEffectivenessScorecard', () => {
  it('is not configured with nothing measured', () => {
    const card = parsed(testEffectivenessScorecard(NOTHING, { now: NOW, windowDays: 14 }));
    expect(card).toMatchObject({
      id: 'test-effectiveness',
      dimension: 'test-effectiveness',
      status: 'not_configured',
      score: null,
      cappedBy: null,
      windowDays: 14,
    });
    expect(byKey(card)['flaky-tests']?.summary).toMatch(/run history/u);
  });

  it('scores the geometric mean of the three proportions and names the lowest', () => {
    const card = parsed(testEffectivenessScorecard(MEASURED, { now: NOW, windowDays: 14 }));
    // (0.81 × 0.90 × 0.98)^(1/3) × 100 = 89.41
    expect(card).toMatchObject({ status: 'pass', score: 89.4, cappedBy: 'mutation-score' });
    const metrics = byKey(card);
    expect(metrics['mutation-score']).toMatchObject({ value: 81, status: 'good' });
    expect(metrics['diff-coverage']).toMatchObject({ value: 90, status: 'good', sampleSize: 3 });
    expect(metrics['flaky-tests']).toMatchObject({ value: 1, status: 'warn', sampleSize: 50 });
    expect(metrics['flake-cost']).toMatchObject({ value: 2, status: 'warn' });
    expect(metrics['failure-causes']).toMatchObject({ value: 2, status: 'warn', sampleSize: 6 });
    expect(metrics['failure-causes']?.summary).toContain('TimeoutError');
  });

  it('fails under a policy minimum, one reason per broken rule', () => {
    const card = parsed(
      testEffectivenessScorecard(
        {
          ...MEASURED,
          mutationScore: 41.26,
          diffCoverage: { commits: 1, covered: 1, executable: 2 },
        },
        { now: NOW, windowDays: 14, policy: { minMutationScore: 60, minDiffCoverage: 70 } },
      ),
    );
    expect(card.status).toBe('fail');
    expect(card.reasons).toEqual([
      'The mutation score is 41.3%; the policy requires at least 60%.',
      'Diff coverage is 50.0%; the policy requires at least 70%.',
    ]);
    expect(byKey(card)['mutation-score']?.status).toBe('bad');
    expect(card.cappedBy).toBe('mutation-score');
  });

  it('withholds what rests on too little: no executable line, too few tests', () => {
    const card = parsed(
      testEffectivenessScorecard(
        {
          mutationScore: null,
          diffCoverage: { commits: 2, covered: 0, executable: 0 },
          flakes: { tests: 3, flaky: 0, retriesSpent: 0, wastedMs: 0, blockedRuns: 0 },
          failures: { failures: 0, causes: 0, topCause: null },
        },
        { now: NOW, windowDays: 14 },
      ),
    );
    const metrics = byKey(card);
    expect(metrics['diff-coverage']).toMatchObject({ status: 'insufficient', sampleSize: 2 });
    expect(metrics['flaky-tests']).toMatchObject({ status: 'insufficient', sampleSize: 3 });
    expect(metrics['flake-cost']).toMatchObject({ value: 0, status: 'good' });
    expect(metrics['failure-causes']).toMatchObject({ value: 0, status: 'good' });
    expect(card).toMatchObject({ status: 'insufficient', score: null });
  });

  it('a zero proportion cannot be averaged away, and a blocked run is bad', () => {
    const card = parsed(
      testEffectivenessScorecard(
        {
          ...MEASURED,
          mutationScore: 0,
          flakes: { tests: 10, flaky: 10, retriesSpent: 2, wastedMs: 1, blockedRuns: 1 },
        },
        { now: NOW, windowDays: 14 },
      ),
    );
    expect(card.score).toBe(0);
    expect(byKey(card)['flaky-tests']?.status).toBe('bad');
    expect(byKey(card)['flake-cost']?.status).toBe('bad');
    expect(byKey(card)['mutation-score']?.status).toBe('bad');
  });

  it('clamps inputs a contract would refuse', () => {
    const card = parsed(
      testEffectivenessScorecard(
        {
          mutationScore: 140,
          diffCoverage: { commits: 1, covered: 500, executable: 10 },
          flakes: { tests: 5, flaky: 9, retriesSpent: -1, wastedMs: -5, blockedRuns: -1 },
          failures: { failures: -1, causes: -1, topCause: 'x'.repeat(1000) },
        },
        { now: NOW, windowDays: 900, policy: { minTests: 0 } },
      ),
    );
    const metrics = byKey(card);
    expect(metrics['mutation-score']?.value).toBe(100);
    expect(metrics['diff-coverage']?.value).toBe(100);
    expect(metrics['flaky-tests']?.value).toBe(5);
    expect(card.windowDays).toBe(366);
    expect(
      parsed(
        testEffectivenessScorecard({ ...NOTHING, mutationScore: 65 }, { now: NOW, windowDays: 7 }),
      ),
    ).toMatchObject({ score: 65, status: 'pass' });
    expect(
      byKey(
        parsed(
          testEffectivenessScorecard(
            { ...NOTHING, mutationScore: 65 },
            { now: NOW, windowDays: 7 },
          ),
        ),
      )['mutation-score']?.status,
    ).toBe('warn');
  });
});
