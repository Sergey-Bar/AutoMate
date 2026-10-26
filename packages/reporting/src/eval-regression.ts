import type { Scorecard, ScorecardMetric } from '@automate/shared-contracts';
import {
  bootstrapMeanDifference,
  compareRates,
  rateDifference,
  wilson,
  type Interval,
} from './stats.js';

/**
 * Does a candidate eval run regress against the default branch's baseline run?
 *
 * ## The inputs are structural
 *
 * The case shape is stated here rather than imported from `@automate/reporter`, so the
 * policy depends on what it reads — a case id and its attempts — and not on the adapter
 * that produced them. Any producer whose cases have this shape can be gated.
 *
 * ## Like for like
 *
 * Pass rates are compared over the cases both runs share. A new case is listed, never mixed
 * into the overall rate: otherwise deleting the hard cases would read as an improvement and
 * adding new ones as a regression.
 *
 * ## "Significant" means what it means everywhere else
 *
 * A case regresses significantly only when Newcombe's interval for the difference of its two
 * pass rates excludes zero (`compareRates`), and a metric score changes significantly only
 * when the seeded bootstrap interval for the difference of means excludes 0. The overall
 * rate fails when the whole difference interval sits below `−maxRegression`. The pinned
 * examples show the line: 9/10 → 8/10 is noise, 9/10 → 3/10 is a regression.
 *
 * ## Flaky is disagreement
 *
 * A case is flaky when its decided attempts disagree: some passed and some failed. That is
 * the attempt-level rule a Playwright retry uses, not the insights leaderboard's score
 * (`apps/api/src/execution/insights.ts`, `(flaky + flips) / runs` across runs) — a boolean
 * over one run's attempts. A case that fails every attempt is broken, not flaky, in both.
 * Flakiness is listed and never fails the gate on its own.
 */

/** One attempt as this policy reads it. `passed: null` is undecided: an error, or no verdict. */
export interface EvalAttemptOutcome {
  passed: boolean | null;
  scores: readonly { metric: string; score: number | null }[];
}

export interface EvalCaseOutcomes {
  caseId: string;
  attempts: readonly EvalAttemptOutcome[];
}

/** Fewer decided attempts than this, on either side, and a passing comparison is not claimed. */
export const DEFAULT_EVAL_MIN_ATTEMPTS = 10;

export interface EvalCompareOptions {
  /** Seeds the metric bootstrap, so one input is one answer on every host. */
  seed: number;
  /** The allowed drop in overall pass rate, 0..1. Default 0. */
  maxRegression?: number | undefined;
  /** Decided attempts each side needs on shared cases before `pass` is claimed. */
  minAttempts?: number | undefined;
}

export interface EvalCaseChange {
  caseId: string;
  /** Passed / decided attempts, 0..1. */
  baselinePassRate: number;
  candidatePassRate: number;
  significant: boolean;
}

export interface EvalMetricChange {
  metric: string;
  /** `mean(candidate) − mean(baseline)`; `null` when either side has no score. */
  difference: Interval | null;
  significant: boolean;
}

export interface EvalComparison {
  verdict: 'pass' | 'fail' | 'insufficient';
  overall: {
    baseline: Interval | null;
    candidate: Interval | null;
    /** The candidate against the baseline, by Newcombe's difference interval (`compareRates`). */
    change: 'higher' | 'lower' | 'same' | null;
  };
  /** Every shared case whose pass rate fell, with whether the fall is beyond noise. */
  regressions: EvalCaseChange[];
  improvements: EvalCaseChange[];
  newCases: string[];
  removedCases: string[];
  /** Flaky in either run. Listed; never a failure on its own. */
  flaky: string[];
  metricChanges: EvalMetricChange[];
  /** One sentence per failed rule, or the reason a pass could not be claimed. */
  reasons: string[];
}

/** Rows that repeat a case id are attempts of one case. */
function byCase(cases: readonly EvalCaseOutcomes[]): Map<string, EvalAttemptOutcome[]> {
  const merged = new Map<string, EvalAttemptOutcome[]>();
  for (const row of cases) {
    const attempts = merged.get(row.caseId) ?? [];
    attempts.push(...row.attempts);
    merged.set(row.caseId, attempts);
  }
  return merged;
}

function tally(attempts: readonly EvalAttemptOutcome[]): Tally {
  let successes = 0;
  let trials = 0;
  for (const attempt of attempts) {
    if (attempt.passed === null) continue;
    trials += 1;
    if (attempt.passed) successes += 1;
  }
  return { successes, trials };
}

function isFlaky(attempts: readonly EvalAttemptOutcome[]): boolean {
  const { successes, trials } = tally(attempts);
  return successes > 0 && successes < trials;
}

/** Code-unit order, never locale order, so the lists read the same on every host. */
function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

/** A case both runs have, with each run's attempts. */
interface SharedCase {
  caseId: string;
  baseline: readonly EvalAttemptOutcome[];
  candidate: readonly EvalAttemptOutcome[];
}

/** Case ids whose decided attempts disagree, each once, sorted. */
export function flakyEvalCases(cases: readonly EvalCaseOutcomes[]): string[] {
  return sorted(
    [...byCase(cases)].filter(([, attempts]) => isFlaky(attempts)).map(([caseId]) => caseId),
  );
}

function clampUnit(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function scoresOf(
  shared: readonly SharedCase[],
  side: 'baseline' | 'candidate',
): Map<string, number[]> {
  const scores = new Map<string, number[]>();
  for (const row of shared) {
    for (const attempt of row[side]) {
      for (const { metric, score } of attempt.scores) {
        const values = scores.get(metric) ?? [];
        if (score !== null && Number.isFinite(score)) values.push(score);
        scores.set(metric, values);
      }
    }
  }
  return scores;
}

function metricChanges(shared: readonly SharedCase[], seed: number): EvalMetricChange[] {
  const before = scoresOf(shared, 'baseline');
  const after = scoresOf(shared, 'candidate');
  return sorted(new Set([...before.keys(), ...after.keys()])).map((metric) => {
    const difference = bootstrapMeanDifference(before.get(metric) ?? [], after.get(metric) ?? [], {
      seed,
    });
    return {
      metric,
      difference,
      significant: difference !== null && (difference.low > 0 || difference.high < 0),
    };
  });
}

interface Tally {
  successes: number;
  trials: number;
}

interface CaseRows {
  regressions: EvalCaseChange[];
  improvements: EvalCaseChange[];
  reasons: string[];
  totals: { baseline: Tally; candidate: Tally };
}

function compareCases(shared: readonly SharedCase[]): CaseRows {
  const rows: CaseRows = {
    regressions: [],
    improvements: [],
    reasons: [],
    totals: { baseline: { successes: 0, trials: 0 }, candidate: { successes: 0, trials: 0 } },
  };
  for (const { caseId, baseline, candidate } of shared) {
    const before = tally(baseline);
    const after = tally(candidate);
    rows.totals.baseline.successes += before.successes;
    rows.totals.baseline.trials += before.trials;
    rows.totals.candidate.successes += after.successes;
    rows.totals.candidate.trials += after.trials;
    if (before.trials === 0 || after.trials === 0) continue;
    const baselinePassRate = before.successes / before.trials;
    const candidatePassRate = after.successes / after.trials;
    const change = compareRates(after, before);
    if (candidatePassRate < baselinePassRate) {
      const significant = change === 'lower';
      rows.regressions.push({ caseId, baselinePassRate, candidatePassRate, significant });
      if (significant) {
        rows.reasons.push(
          `Case ${caseId} regressed from ${String(before.successes)}/${String(before.trials)} to ${String(after.successes)}/${String(after.trials)} passing attempts.`,
        );
      }
    } else if (candidatePassRate > baselinePassRate) {
      rows.improvements.push({
        caseId,
        baselinePassRate,
        candidatePassRate,
        significant: change === 'higher',
      });
    }
  }
  return rows;
}

/**
 * Compare a candidate run to the baseline run.
 *
 * `fail` when the overall pass rate on shared cases is credibly lower by more than
 * `maxRegression` — the whole Newcombe interval for candidate − baseline sits below
 * `−maxRegression` — or when any case regresses significantly. Otherwise `insufficient`
 * when either side has fewer than `minAttempts` decided attempts on shared cases, and `pass`.
 * A credible regression fails however few attempts it rests on: insufficiency withholds a
 * pass, it never excuses a failure the data already shows.
 */
export function compareEvalRuns(
  baseline: readonly EvalCaseOutcomes[],
  candidate: readonly EvalCaseOutcomes[],
  options: EvalCompareOptions,
): EvalComparison {
  const maxRegression = clampUnit(options.maxRegression);
  const minAttempts = Math.max(1, Math.floor(options.minAttempts ?? DEFAULT_EVAL_MIN_ATTEMPTS));
  const before = byCase(baseline);
  const after = byCase(candidate);
  const shared: SharedCase[] = [];
  for (const [caseId, candidateAttempts] of [...after].sort(([left], [right]) =>
    left < right ? -1 : 1,
  )) {
    const baselineAttempts = before.get(caseId);
    if (baselineAttempts !== undefined) {
      shared.push({ caseId, baseline: baselineAttempts, candidate: candidateAttempts });
    }
  }
  const rows = compareCases(shared);

  const overallBaseline = wilson(rows.totals.baseline.successes, rows.totals.baseline.trials);
  const overallCandidate = wilson(rows.totals.candidate.successes, rows.totals.candidate.trials);
  const overallDrop = rateDifference(rows.totals.candidate, rows.totals.baseline);
  const reasons: string[] = [];
  if (
    overallBaseline !== null &&
    overallCandidate !== null &&
    overallDrop !== null &&
    overallDrop.high < -maxRegression
  ) {
    reasons.push(
      `Overall pass rate on shared cases fell from ${percent(overallBaseline.estimate)} to ${percent(overallCandidate.estimate)}, more than the ${(maxRegression * 100).toFixed(1)}-point drop allowed.`,
    );
  }
  reasons.push(...rows.reasons);

  let verdict: EvalComparison['verdict'] = reasons.length > 0 ? 'fail' : 'pass';
  const fewest = Math.min(rows.totals.baseline.trials, rows.totals.candidate.trials);
  if (verdict === 'pass' && fewest < minAttempts) {
    verdict = 'insufficient';
    reasons.push(
      `Only ${String(fewest)} decided attempts on shared cases; at least ${String(minAttempts)} are needed to pass.`,
    );
  }

  return {
    verdict,
    overall: {
      baseline: overallBaseline,
      candidate: overallCandidate,
      change: compareRates(rows.totals.candidate, rows.totals.baseline),
    },
    regressions: rows.regressions,
    improvements: rows.improvements,
    newCases: sorted([...after.keys()].filter((caseId) => !before.has(caseId))),
    removedCases: sorted([...before.keys()].filter((caseId) => !after.has(caseId))),
    flaky: sorted(new Set([...flakyEvalCases(baseline), ...flakyEvalCases(candidate)])),
    metricChanges: metricChanges(shared, options.seed),
    reasons,
  };
}

export interface EvalLatest {
  /** The latest run's pass rate, 0..1; `null` when it decided nothing. */
  passRate: number | null;
  /** Decided attempts the pass rate rests on. */
  attempts: number;
  costUsd: number | null;
}

/** Pass-rate bands. Below 70% is bad and 90% is the target, as for the test pass rate. */
const PASS_RATE_TARGET = 90;
const PASS_RATE_WARN = 70;

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

function unmeasured(
  key: string,
  label: string,
  unit: ScorecardMetric['unit'],
  direction: ScorecardMetric['direction'],
  status: 'insufficient' | 'not_configured',
  summary: string,
): ScorecardMetric {
  return {
    key,
    label,
    value: null,
    unit,
    direction,
    target: null,
    trend: null,
    sampleSize: null,
    band: null,
    status,
    summary,
  };
}

function passRateMetric(
  passRate: number | null,
  attempts: number,
  comparison: EvalComparison | null,
): ScorecardMetric {
  if (passRate === null) {
    return unmeasured(
      'pass-rate',
      'Eval pass rate',
      'percent',
      'higher-better',
      'not_configured',
      'No eval run has decided an attempt yet.',
    );
  }
  const value = passRate * 100;
  const { baseline, candidate } = comparison?.overall ?? { baseline: null, candidate: null };
  return {
    key: 'pass-rate',
    label: 'Eval pass rate',
    value,
    unit: 'percent',
    direction: 'higher-better',
    target: PASS_RATE_TARGET,
    trend:
      baseline !== null && candidate !== null
        ? (candidate.estimate - baseline.estimate) * 100
        : null,
    sampleSize: attempts,
    band: null,
    status: value >= PASS_RATE_TARGET ? 'good' : value >= PASS_RATE_WARN ? 'warn' : 'bad',
    summary: `${value.toFixed(1)}% of ${String(attempts)} decided eval attempts passed.`,
  };
}

/** A count read from the comparison: absent without a baseline, withheld when it was thin. */
function comparisonCount(
  comparison: EvalComparison | null,
  key: string,
  label: string,
  count: (comparison: EvalComparison) => number,
  bad: 'warn' | 'bad',
  noun: string,
): ScorecardMetric {
  if (comparison === null) {
    return unmeasured(
      key,
      label,
      'count',
      'lower-better',
      'not_configured',
      'No baseline run on the default branch to compare against.',
    );
  }
  if (comparison.verdict === 'insufficient') {
    return unmeasured(
      key,
      label,
      'count',
      'lower-better',
      'insufficient',
      'Too few decided attempts on shared cases to compare.',
    );
  }
  const value = count(comparison);
  return {
    key,
    label,
    value,
    unit: 'count',
    direction: 'lower-better',
    target: 0,
    trend: null,
    sampleSize: null,
    band: null,
    status: value === 0 ? 'good' : bad,
    summary: `${String(value)} ${noun} against the baseline.`,
  };
}

function costMetric(costUsd: number | null): ScorecardMetric {
  const cost = finiteOrNull(costUsd);
  if (cost === null || cost < 0) {
    return unmeasured(
      'cost',
      'Eval cost',
      'usd',
      'lower-better',
      'not_configured',
      'The eval tool reported no cost.',
    );
  }
  return {
    key: 'cost',
    label: 'Eval cost',
    value: cost,
    unit: 'usd',
    direction: 'lower-better',
    target: null,
    trend: null,
    sampleSize: null,
    band: null,
    // No budget is configured, so a reported cost is information rather than a verdict.
    status: 'good',
    summary: `The latest eval run cost $${cost.toFixed(2)}.`,
  };
}

/**
 * The agent-quality scorecard: the latest run's pass rate, scored, and the comparison's
 * verdict as the status.
 *
 * With no run that decided anything it is `not_configured`; with a run but no baseline it is
 * `insufficient` — the pass rate is still the score, but "does not regress" has not been
 * shown. The score is the pass rate and nothing else, so `cappedBy` is always `pass-rate`.
 * Inputs a contract would refuse (a window of 0 days, a pass rate of 7) are clamped rather
 * than thrown, because a scorecard is display and must always render.
 */
export function evalScorecard(
  comparison: EvalComparison | null,
  latest: EvalLatest,
  options: { now: Date; windowDays: number },
): Scorecard {
  const raw = finiteOrNull(latest.passRate);
  const passRate = raw === null || latest.attempts <= 0 ? null : Math.min(1, Math.max(0, raw));
  const metrics = [
    passRateMetric(passRate, latest.attempts, comparison),
    comparisonCount(
      comparison,
      'regressions',
      'Significant case regressions',
      (row) => row.regressions.filter((change) => change.significant).length,
      'bad',
      'cases regressed beyond noise',
    ),
    comparisonCount(
      comparison,
      'flaky-cases',
      'Flaky eval cases',
      (row) => row.flaky.length,
      'warn',
      'cases disagreed with themselves',
    ),
    costMetric(latest.costUsd),
  ];

  let status: Scorecard['status'];
  if (passRate === null) status = 'not_configured';
  else if (comparison === null) status = 'insufficient';
  else status = comparison.verdict;

  const reasons = comparison === null ? [] : [...comparison.reasons];
  if (status === 'fail' && reasons.length === 0) {
    reasons.push('The eval comparison against the baseline failed.');
  }
  const windowDays = Number.isFinite(options.windowDays)
    ? Math.min(366, Math.max(1, Math.round(options.windowDays)))
    : 1;

  return {
    id: 'agent-quality',
    title: 'Agent quality',
    dimension: 'agent-quality',
    evaluatedAt: options.now.toISOString(),
    windowDays,
    status,
    score: passRate === null ? null : passRate * 100,
    cappedBy: passRate === null ? null : 'pass-rate',
    metrics,
    reasons,
  };
}
