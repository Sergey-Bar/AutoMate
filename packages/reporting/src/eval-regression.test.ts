import { ScorecardSchema } from '@automate/shared-contracts';
import { describe, expect, it } from 'vitest';
import {
  compareEvalRuns,
  DEFAULT_EVAL_MIN_ATTEMPTS,
  evalScorecard,
  flakyEvalCases,
  type EvalCaseOutcomes,
  type EvalComparison,
} from './eval-regression.js';

/** `passes` of `total` attempts, each optionally carrying one metric score. */
function outcome(
  caseId: string,
  passes: number,
  total: number,
  score?: (index: number) => number | null,
): EvalCaseOutcomes {
  return {
    caseId,
    attempts: Array.from({ length: total }, (_, index) => ({
      passed: index < passes,
      scores: score === undefined ? [] : [{ metric: 'faithfulness', score: score(index) }],
    })),
  };
}

const SEED = 7;

describe('flakyEvalCases', () => {
  it('calls disagreement flaky and a case that always fails broken, not flaky', () => {
    const cases: EvalCaseOutcomes[] = [
      outcome('mixed', 2, 5),
      outcome('always-fails', 0, 5),
      outcome('always-passes', 5, 5),
      {
        caseId: 'undecided',
        attempts: [
          { passed: true, scores: [] },
          { passed: null, scores: [] },
        ],
      },
    ];
    expect(flakyEvalCases(cases)).toEqual(['mixed']);
  });

  it('merges repeated rows of one case before judging it, and lists each once', () => {
    const cases = [outcome('split', 1, 1), outcome('split', 0, 1), outcome('a', 1, 2)];
    expect(flakyEvalCases(cases)).toEqual(['a', 'split']);
  });
});

describe('compareEvalRuns: the pinned per-case examples', () => {
  it('9/10 → 8/10 is noise and passes', () => {
    const result = compareEvalRuns([outcome('c', 9, 10)], [outcome('c', 8, 10)], { seed: SEED });
    expect(result.verdict).toBe('pass');
    expect(result.regressions).toEqual([
      { caseId: 'c', baselinePassRate: 0.9, candidatePassRate: 0.8, significant: false },
    ]);
    expect(result.reasons).toEqual([]);
    expect(result.overall.change).toBe('same');
  });

  it('9/10 → 3/10 is a significant regression: the difference interval excludes zero', () => {
    // The two Wilson intervals overlap by 0.0074, so a non-overlap rule called this noise.
    // Newcombe's interval for the difference is [0.17, 0.81]: a real drop, and it fails.
    const result = compareEvalRuns([outcome('c', 9, 10)], [outcome('c', 3, 10)], { seed: SEED });
    expect(result.regressions[0]?.significant).toBe(true);
    expect(result.verdict).toBe('fail');
  });

  it('9/10 → 2/10 is a significant regression and fails', () => {
    const result = compareEvalRuns([outcome('c', 9, 10)], [outcome('c', 2, 10)], { seed: SEED });
    expect(result.verdict).toBe('fail');
    expect(result.regressions).toEqual([
      { caseId: 'c', baselinePassRate: 0.9, candidatePassRate: 0.2, significant: true },
    ]);
    expect(result.overall.change).toBe('lower');
    expect(result.reasons.join(' ')).toMatch(/c regressed from 9\/10 to 2\/10/u);
    // A case that passes sometimes is flaky, and is listed; it fails here on the regression.
    expect(result.flaky).toEqual(['c']);
  });
});

describe('compareEvalRuns: the overall rate', () => {
  const baseline = Array.from({ length: 20 }, (_, index) => outcome(`c${String(index)}`, 9, 10));
  const candidate = Array.from({ length: 20 }, (_, index) => outcome(`c${String(index)}`, 7, 10));

  it('fails on a credible overall drop that no single case shows', () => {
    const result = compareEvalRuns(baseline, candidate, { seed: SEED });
    expect(result.regressions.every((row) => !row.significant)).toBe(true);
    expect(result.regressions).toHaveLength(20);
    expect(result.overall.change).toBe('lower');
    expect(result.verdict).toBe('fail');
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/90\.0% to 70\.0%/u);
  });

  it('passes the same drop when maxRegression allows it', () => {
    const result = compareEvalRuns(baseline, candidate, { seed: SEED, maxRegression: 0.2 });
    expect(result.overall.change).toBe('lower');
    expect(result.verdict).toBe('pass');
  });

  it('clamps maxRegression into [0, 1] and minAttempts to at least one', () => {
    const negative = compareEvalRuns(baseline, candidate, { seed: SEED, maxRegression: -5 });
    expect(negative.verdict).toBe('fail');
    const huge = compareEvalRuns(baseline, candidate, { seed: SEED, maxRegression: 9 });
    expect(huge.verdict).toBe('pass');
    const nan = compareEvalRuns(baseline, candidate, { seed: SEED, maxRegression: Number.NaN });
    expect(nan.verdict).toBe('fail');
    const tiny = compareEvalRuns([outcome('c', 1, 1)], [outcome('c', 1, 1)], {
      seed: SEED,
      minAttempts: 0,
    });
    expect(tiny.verdict).toBe('pass');
  });

  it('reports overall intervals over the shared cases only', () => {
    const result = compareEvalRuns(
      [outcome('shared', 5, 10), outcome('removed', 0, 10)],
      [outcome('shared', 5, 10), outcome('new', 10, 10)],
      { seed: SEED },
    );
    expect(result.overall.baseline?.estimate).toBe(0.5);
    expect(result.overall.candidate?.estimate).toBe(0.5);
    expect(result.newCases).toEqual(['new']);
    expect(result.removedCases).toEqual(['removed']);
  });
});

describe('compareEvalRuns: insufficient evidence', () => {
  it('is insufficient below minAttempts, and says how many it had', () => {
    const result = compareEvalRuns([outcome('c', 3, 3)], [outcome('c', 3, 3)], { seed: SEED });
    expect(result.verdict).toBe('insufficient');
    expect(result.reasons[0]).toMatch(
      new RegExp(`3 decided attempts.*${String(DEFAULT_EVAL_MIN_ATTEMPTS)}`, 'u'),
    );
  });

  it('counts the smaller side', () => {
    const result = compareEvalRuns([outcome('c', 20, 20)], [outcome('c', 4, 4)], {
      seed: SEED,
      minAttempts: 5,
    });
    expect(result.verdict).toBe('insufficient');
    expect(result.reasons[0]).toMatch(/4 decided attempts/u);
  });

  it('is insufficient with no shared case, with no overall intervals', () => {
    const result = compareEvalRuns([outcome('a', 10, 10)], [outcome('b', 10, 10)], { seed: SEED });
    expect(result.verdict).toBe('insufficient');
    expect(result.overall).toEqual({ baseline: null, candidate: null, change: null });
    expect(result.regressions).toEqual([]);
  });

  it('still fails a credible regression it can see, however few attempts there are', () => {
    const result = compareEvalRuns([outcome('c', 5, 5)], [outcome('c', 0, 5)], {
      seed: SEED,
      minAttempts: 100,
    });
    expect(result.verdict).toBe('fail');
    expect(result.reasons.some((reason) => /at least 100/u.test(reason))).toBe(false);
  });

  it('skips a shared case with no decided attempts on one side', () => {
    const undecided: EvalCaseOutcomes = {
      caseId: 'c',
      attempts: [{ passed: null, scores: [] }],
    };
    const result = compareEvalRuns([outcome('c', 10, 10)], [undecided], { seed: SEED });
    expect(result.regressions).toEqual([]);
    expect(result.improvements).toEqual([]);
    expect(result.overall.candidate).toBeNull();
    expect(result.overall.change).toBeNull();
  });
});

describe('compareEvalRuns: improvements and unchanged cases', () => {
  it('lists improvements with their significance and leaves equal cases out of both lists', () => {
    const result = compareEvalRuns(
      [outcome('up', 2, 10), outcome('same', 5, 10), outcome('nudge', 5, 10)],
      [outcome('up', 10, 10), outcome('same', 5, 10), outcome('nudge', 6, 10)],
      { seed: SEED },
    );
    expect(result.improvements).toEqual([
      { caseId: 'nudge', baselinePassRate: 0.5, candidatePassRate: 0.6, significant: false },
      { caseId: 'up', baselinePassRate: 0.2, candidatePassRate: 1, significant: true },
    ]);
    expect(result.regressions).toEqual([]);
    expect(result.verdict).toBe('pass');
  });
});

describe('compareEvalRuns: metric score changes', () => {
  it('calls a bootstrap interval that excludes 0 significant', () => {
    const result = compareEvalRuns(
      [outcome('c', 10, 10, () => 0.9)],
      [outcome('c', 10, 10, (index) => (index % 2 === 0 ? 0.4 : 0.5))],
      { seed: SEED },
    );
    expect(result.metricChanges).toHaveLength(1);
    const change = result.metricChanges[0];
    expect(change?.metric).toBe('faithfulness');
    expect(change?.difference?.estimate).toBeCloseTo(-0.45, 10);
    expect(change?.significant).toBe(true);
    // Scores inform; they do not decide the verdict.
    expect(result.verdict).toBe('pass');
  });

  it('calls an identical constant score not significant', () => {
    const result = compareEvalRuns(
      [outcome('c', 10, 10, () => 0.7)],
      [outcome('c', 10, 10, () => 0.7)],
      { seed: SEED },
    );
    expect(result.metricChanges).toEqual([
      { metric: 'faithfulness', difference: { estimate: 0, low: 0, high: 0 }, significant: false },
    ]);
  });

  it('calls a rise that excludes 0 significant', () => {
    const result = compareEvalRuns(
      [outcome('c', 10, 10, () => 0.1)],
      [outcome('c', 10, 10, () => 0.9)],
      { seed: SEED },
    );
    expect(result.metricChanges[0]?.significant).toBe(true);
    expect(result.metricChanges[0]?.difference?.low).toBeGreaterThan(0);
  });

  it('has no difference for a metric only one side scored, and ignores null scores', () => {
    const result = compareEvalRuns(
      [outcome('c', 10, 10, () => null)],
      [outcome('c', 10, 10, () => 0.5)],
      { seed: SEED },
    );
    expect(result.metricChanges).toEqual([
      { metric: 'faithfulness', difference: null, significant: false },
    ]);
  });

  it('reads metrics from shared cases only, sorted by name', () => {
    const named = (caseId: string, metric: string): EvalCaseOutcomes => ({
      caseId,
      attempts: [{ passed: true, scores: [{ metric, score: 1 }] }],
    });
    const result = compareEvalRuns(
      [named('c', 'zeta'), named('c', 'alpha'), named('gone', 'removed-only')],
      [named('c', 'zeta'), named('c', 'alpha'), named('new', 'new-only')],
      { seed: SEED },
    );
    expect(result.metricChanges.map((change) => change.metric)).toEqual(['alpha', 'zeta']);
  });
});

describe('evalScorecard', () => {
  const now = new Date('2026-10-25T12:00:00.000Z');
  const parsed = (card: unknown) => ScorecardSchema.parse(card);
  const comparison = (verdict: EvalComparison['verdict'], extra: Partial<EvalComparison> = {}) => {
    const base = compareEvalRuns([outcome('c', 9, 10)], [outcome('c', 8, 10)], { seed: SEED });
    return { ...base, verdict, ...extra };
  };

  it('is not configured when nothing has ever run', () => {
    const card = parsed(
      evalScorecard(null, { passRate: null, attempts: 0, costUsd: null }, { now, windowDays: 30 }),
    );
    expect(card.status).toBe('not_configured');
    expect(card.score).toBeNull();
    expect(card.cappedBy).toBeNull();
    expect(card.id).toBe('agent-quality');
    expect(card.dimension).toBe('agent-quality');
    expect(card.evaluatedAt).toBe(now.toISOString());
    expect(card.metrics.every((metric) => metric.value === null)).toBe(true);
  });

  it('is insufficient with a run but no baseline, and still scores the pass rate', () => {
    const card = parsed(
      evalScorecard(null, { passRate: 0.95, attempts: 40, costUsd: 1.25 }, { now, windowDays: 7 }),
    );
    expect(card.status).toBe('insufficient');
    expect(card.score).toBe(95);
    expect(card.cappedBy).toBe('pass-rate');
    const byKey = Object.fromEntries(card.metrics.map((metric) => [metric.key, metric]));
    expect(byKey['pass-rate']?.status).toBe('good');
    expect(byKey['pass-rate']?.sampleSize).toBe(40);
    expect(byKey['pass-rate']?.trend).toBeNull();
    expect(byKey['regressions']?.status).toBe('not_configured');
    expect(byKey['flaky-cases']?.status).toBe('not_configured');
    expect(byKey['cost']?.value).toBe(1.25);
    expect(byKey['cost']?.status).toBe('good');
  });

  it('reads a pass rate over zero attempts as nothing measured', () => {
    const card = parsed(
      evalScorecard(null, { passRate: 1, attempts: 0, costUsd: null }, { now, windowDays: 7 }),
    );
    expect(card.status).toBe('not_configured');
    expect(card.score).toBeNull();
  });

  it('passes through a passing comparison, with the trend in points', () => {
    const card = parsed(
      evalScorecard(
        comparison('pass'),
        { passRate: 0.8, attempts: 10, costUsd: null },
        { now, windowDays: 30 },
      ),
    );
    expect(card.status).toBe('pass');
    const byKey = Object.fromEntries(card.metrics.map((metric) => [metric.key, metric]));
    expect(byKey['pass-rate']?.status).toBe('warn');
    expect(byKey['pass-rate']?.trend).toBeCloseTo(-10, 10);
    expect(byKey['regressions']?.value).toBe(0);
    expect(byKey['regressions']?.status).toBe('good');
    expect(byKey['flaky-cases']?.value).toBe(1);
    expect(byKey['flaky-cases']?.status).toBe('warn');
    expect(byKey['cost']?.status).toBe('not_configured');
  });

  it('fails with the comparison reasons, and counts significant regressions', () => {
    const failing = compareEvalRuns([outcome('c', 10, 10)], [outcome('c', 0, 10)], {
      seed: SEED,
    });
    const card = parsed(
      evalScorecard(failing, { passRate: 0, attempts: 10, costUsd: 0 }, { now, windowDays: 30 }),
    );
    expect(card.status).toBe('fail');
    expect(card.reasons).toEqual(failing.reasons);
    const byKey = Object.fromEntries(card.metrics.map((metric) => [metric.key, metric]));
    expect(byKey['regressions']?.value).toBe(1);
    expect(byKey['regressions']?.status).toBe('bad');
    expect(byKey['pass-rate']?.status).toBe('bad');
    expect(byKey['flaky-cases']?.value).toBe(0);
    expect(byKey['flaky-cases']?.status).toBe('good');
  });

  it('never fails without a reason, even given a comparison that has none', () => {
    const card = parsed(
      evalScorecard(
        comparison('fail', { reasons: [] }),
        { passRate: 0.5, attempts: 10, costUsd: null },
        { now, windowDays: 30 },
      ),
    );
    expect(card.status).toBe('fail');
    expect(card.reasons.length).toBeGreaterThan(0);
  });

  it('marks regression and flaky counts insufficient when the comparison was', () => {
    const card = parsed(
      evalScorecard(
        comparison('insufficient', { overall: { baseline: null, candidate: null, change: null } }),
        { passRate: 0.5, attempts: 3, costUsd: null },
        { now, windowDays: 30 },
      ),
    );
    expect(card.status).toBe('insufficient');
    const byKey = Object.fromEntries(card.metrics.map((metric) => [metric.key, metric]));
    expect(byKey['regressions']?.status).toBe('insufficient');
    expect(byKey['flaky-cases']?.status).toBe('insufficient');
    expect(byKey['pass-rate']?.trend).toBeNull();
  });

  it('clamps the window and the pass rate into what the contract accepts', () => {
    const wide = parsed(
      evalScorecard(null, { passRate: 7, attempts: 5, costUsd: -1 }, { now, windowDays: 9999 }),
    );
    expect(wide.windowDays).toBe(366);
    expect(wide.score).toBe(100);
    const narrow = parsed(
      evalScorecard(null, { passRate: -1, attempts: 5, costUsd: null }, { now, windowDays: 0.2 }),
    );
    expect(narrow.windowDays).toBe(1);
    expect(narrow.score).toBe(0);
    const nan = parsed(
      evalScorecard(
        null,
        { passRate: Number.NaN, attempts: 5, costUsd: Number.POSITIVE_INFINITY },
        { now, windowDays: Number.NaN },
      ),
    );
    expect(nan.windowDays).toBe(1);
    expect(nan.score).toBeNull();
    const cost = nan.metrics.find((metric) => metric.key === 'cost');
    expect(cost?.status).toBe('not_configured');
  });
});
