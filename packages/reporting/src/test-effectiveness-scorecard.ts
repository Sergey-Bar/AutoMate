import type { Scorecard } from '@automate/shared-contracts';
import {
  absent,
  assemble,
  measuredMetric,
  plural,
  round1,
  windowOf,
  type MetricShape,
  type Reading,
} from './scorecard-kit.js';

/**
 * The test-effectiveness scorecard: whether the tests would catch a defect, not only run.
 *
 * - **Mutation score** — the share of valid mutants the suite detected (Stryker).
 * - **Diff coverage** — of the executable lines the latest commits added, the share that ran.
 * - **Flaky tests** — tests that disagreed with themselves in the window, over the tests seen.
 * - **Flake cost** — the retries flaky results spent, in hours, and the runs they blocked.
 * - **Failure causes** — how many distinct root causes the window's failures cluster into.
 *
 * The score is the geometric mean of the three proportions (mutation score, diff coverage,
 * and the share of tests that are not flaky), so a suite with no mutation kill cannot be
 * averaged up by perfect coverage; `cappedBy` names the lowest. Flake cost and failure causes
 * are diagnosis and are not scored twice. A policy minimum, when set, fails the card.
 */

export interface TestEffectivenessInput {
  /** 0–100; `null` when no mutation report on the branch scored a valid mutant. */
  mutationScore: number | null;
  /** Summed over the latest computed commits; `null` when none has both halves. */
  diffCoverage: { commits: number; covered: number; executable: number } | null;
  /** From the run history; `null` when no run store is readable here. */
  flakes: {
    tests: number;
    flaky: number;
    retriesSpent: number;
    wastedMs: number;
    blockedRuns: number;
  } | null;
  /** From the run history; `null` when no run store is readable here. */
  failures: { failures: number; causes: number; topCause: string | null } | null;
}

export interface TestEffectivenessPolicy {
  /** 0–100. Unset: the score is shown, never failed. */
  minMutationScore?: number;
  /** 0–100. Unset: the share is shown, never failed. */
  minDiffCoverage?: number;
  /** Fewer tests than this is too few to call a flaky rate. Default 5. */
  minTests?: number;
}

const percentStatus = (value: number): 'good' | 'warn' | 'bad' =>
  value >= 80 ? 'good' : value >= 60 ? 'warn' : 'bad';

function belowMinimum(label: string, value: number, minimum: number | undefined): string | null {
  return minimum !== undefined && value < minimum
    ? `${label} is ${value.toFixed(1)}%; the policy requires at least ${String(minimum)}%.`
    : null;
}

function mutationReading(score: number | null, minimum: number | undefined): Reading {
  const shape: MetricShape = {
    key: 'mutation-score',
    label: 'Mutation score',
    unit: 'percent',
    direction: 'higher-better',
    target: minimum ?? 80,
  };
  if (score === null || !Number.isFinite(score)) {
    return absent(shape, 'not_configured', 'No mutation report scored a valid mutant.');
  }
  const value = round1(Math.min(100, Math.max(0, score)));
  const reason = belowMinimum('The mutation score', value, minimum);
  return {
    metric: measuredMetric(shape, {
      value,
      status: reason === null ? percentStatus(value) : 'bad',
      summary: `${value.toFixed(1)}% of valid mutants were detected by the tests.`,
    }),
    points: value,
    reason,
  };
}

function diffReading(
  diff: TestEffectivenessInput['diffCoverage'],
  minimum: number | undefined,
): Reading {
  const shape: MetricShape = {
    key: 'diff-coverage',
    label: 'Diff coverage of the latest commits',
    unit: 'percent',
    direction: 'higher-better',
    target: minimum ?? 80,
  };
  if (diff === null || diff.commits <= 0) {
    return absent(shape, 'not_configured', 'No commit has both a diff and a coverage report.');
  }
  const executable = Math.max(0, diff.executable);
  if (executable === 0) {
    return absent(
      shape,
      'insufficient',
      `The latest ${plural(diff.commits, 'commit', 'commits')} added no executable line.`,
      diff.commits,
    );
  }
  const covered = Math.min(executable, Math.max(0, diff.covered));
  const value = round1((covered / executable) * 100);
  const reason = belowMinimum('Diff coverage', value, minimum);
  return {
    metric: measuredMetric(shape, {
      value,
      status: reason === null ? percentStatus(value) : 'bad',
      summary: `${String(covered)} of ${plural(executable, 'added executable line', 'added executable lines')} ran, over ${plural(diff.commits, 'commit', 'commits')}.`,
      sampleSize: diff.commits,
    }),
    points: value,
    reason,
  };
}

const NO_HISTORY = 'No run history is readable on this install.';

function flakyReading(flakes: TestEffectivenessInput['flakes'], minTests: number): Reading {
  const shape: MetricShape = {
    key: 'flaky-tests',
    label: 'Flaky tests',
    unit: 'count',
    direction: 'lower-better',
    target: 0,
  };
  if (flakes === null) return absent(shape, 'not_configured', NO_HISTORY);
  const tests = Math.max(0, flakes.tests);
  if (tests < minTests) {
    return absent(
      shape,
      'insufficient',
      `${String(tests)} of the ${String(minTests)} tests needed ran in the window.`,
      tests,
    );
  }
  const flaky = Math.min(tests, Math.max(0, flakes.flaky));
  const share = flaky / tests;
  return {
    metric: measuredMetric(shape, {
      value: flaky,
      status: flaky === 0 ? 'good' : share <= 0.02 ? 'warn' : 'bad',
      summary: `${String(flaky)} of ${plural(tests, 'test', 'tests')} disagreed with themselves.`,
      sampleSize: tests,
    }),
    points: (1 - share) * 100,
    reason: null,
  };
}

function costReading(flakes: TestEffectivenessInput['flakes']): Reading {
  const shape: MetricShape = {
    key: 'flake-cost',
    label: 'Time spent retrying flaky tests',
    unit: 'hours',
    direction: 'lower-better',
    target: 0,
  };
  if (flakes === null) return absent(shape, 'not_configured', NO_HISTORY);
  const hours = Math.max(0, flakes.wastedMs) / 3_600_000;
  const retries = Math.max(0, flakes.retriesSpent);
  const blocked = Math.max(0, flakes.blockedRuns);
  return {
    metric: measuredMetric(shape, {
      value: hours,
      status: retries === 0 && blocked === 0 ? 'good' : blocked > 0 ? 'bad' : 'warn',
      summary: `${plural(retries, 'retry', 'retries')} cost ${hours.toFixed(2)} h and blocked ${plural(blocked, 'run', 'runs')}.`,
    }),
    points: null,
    reason: null,
  };
}

function causeReading(failures: TestEffectivenessInput['failures']): Reading {
  const shape: MetricShape = {
    key: 'failure-causes',
    label: 'Distinct failure causes',
    unit: 'count',
    direction: 'lower-better',
    target: 0,
  };
  if (failures === null) return absent(shape, 'not_configured', NO_HISTORY);
  const causes = Math.max(0, failures.causes);
  const top =
    failures.topCause === null ? '' : ` The most common: ${failures.topCause.slice(0, 200)}`;
  return {
    metric: measuredMetric(shape, {
      value: causes,
      status: causes === 0 ? 'good' : 'warn',
      summary: `${plural(Math.max(0, failures.failures), 'failure', 'failures')} from ${plural(causes, 'cause', 'causes')}.${top}`,
      sampleSize: Math.max(0, failures.failures),
    }),
    points: null,
    reason: null,
  };
}

/** Geometric mean: one proportion at zero makes the card zero, which is the point. */
function geometricMean(scored: readonly { points: number }[]): number {
  const product = scored.reduce((acc, entry) => acc * Math.max(0, entry.points / 100), 1);
  return 100 * product ** (1 / scored.length);
}

/** The test-effectiveness scorecard. Inputs a contract would refuse are clamped, never thrown. */
export function testEffectivenessScorecard(
  input: TestEffectivenessInput,
  options: { now: Date; windowDays: number; policy?: TestEffectivenessPolicy },
): Scorecard {
  const policy = options.policy ?? {};
  const minTests = Math.max(1, Math.floor(policy.minTests ?? 5));
  const readings = [
    mutationReading(input.mutationScore, policy.minMutationScore),
    diffReading(input.diffCoverage, policy.minDiffCoverage),
    flakyReading(input.flakes, minTests),
    costReading(input.flakes),
    causeReading(input.failures),
  ];
  return assemble(
    readings,
    {
      id: 'test-effectiveness',
      title: 'Test effectiveness',
      dimension: 'test-effectiveness',
      evaluatedAt: options.now.toISOString(),
      windowDays: windowOf(options.windowDays),
    },
    geometricMean,
  );
}
