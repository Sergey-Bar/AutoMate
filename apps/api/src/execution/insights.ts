import { Hono } from 'hono';
import { buildDigest } from '@automate/reporting';
import type {
  BranchPassRate,
  FlakyTest,
  HeatmapRow,
  Mttr,
  QaInsights,
  SlowTest,
} from '@automate/shared-contracts';
import { dayKey, passRate, readSince, startOfDay } from './trend.js';
import type { ExecutionRun, ExecutionStore, ExecutionTestResult } from './types.js';

const DAY_MS = 86_400_000;
const WINDOWS = [7, 14, 30, 90] as const;
const LEADERBOARD = 15;
const SLOWEST = 10;
const HEATMAP_SUITES = 8;
const BRANCHES = 10;
/** A median that grew by less than this is noise, not a slower test. */
const SLOWER_PCT = 20;

/**
 * Reliability insights over the run history: which tests flip, which are slow, where
 * failures cluster, how long a red suite stays red, and how each branch is doing.
 *
 * ## Read like the trend, from the same store
 *
 * The execution store, newest first, through its own cursor, stopping at the start of the
 * earlier window — `readSince` is the trend's reader and not a copy of it, so the two
 * screens can never disagree about which runs exist. The earlier window is read because the
 * slowest-tests trend and the digest compare against it.
 *
 * ## A test that only ever fails is not flaky
 *
 * Flakiness is *disagreement*: a `flaky` result (failed, then passed on retry), or a change
 * between passed and failed from one run to the next. A test that failed every time it ran
 * is broken, and ranking it on a flaky leaderboard would send someone to stabilise a test
 * that is telling the truth.
 */
export function createInsightsRoutes(options: {
  store: ExecutionStore;
  workspaceId: string;
  now?: () => Date;
}): Hono {
  const app = new Hono();
  app.get('/api/v1/dashboard/insights', async (context) => {
    const requested = Number(context.req.query('days') ?? '14');
    const days = (WINDOWS as readonly number[]).includes(requested) ? requested : 14;
    const projectId = context.req.query('projectId');
    const now = options.now?.() ?? new Date();
    const since = startOfDay(now).getTime() - (2 * days - 1) * DAY_MS;
    const { runs, truncated } = await readSince(options.store, options.workspaceId, since);
    const scoped =
      projectId === undefined || projectId === ''
        ? runs
        : runs.filter((run) => belongsTo(run, projectId));
    return context.json(buildInsights(scoped, now, days, truncated));
  });
  return app;
}

/**
 * A run counts toward a project when it names it **or names no project at all**.
 *
 * A reporter that does not send a project id is the common case for a CI pipeline pointed at
 * this install, and the trend on the dashboard already counts those runs. Excluding them here
 * would make the insights page report an empty quarter for a repository that ran every day.
 * A run attributed to a *different* project is never counted.
 */
export function belongsTo(run: Pick<ExecutionRun, 'projectId'>, projectId: string): boolean {
  return run.projectId === projectId || run.projectId === null;
}

interface Appearance {
  run: ExecutionRun;
  test: ExecutionTestResult;
}

export function buildInsights(
  runs: readonly ExecutionRun[],
  now: Date,
  days: number,
  truncated: boolean,
): QaInsights {
  const today = startOfDay(now).getTime();
  const currentFrom = today - (days - 1) * DAY_MS;
  const previousFrom = currentFrom - days * DAY_MS;
  const dates = Array.from({ length: days }, (_, index) => dayKey(currentFrom + index * DAY_MS));
  const oldestFirst = [...runs].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
  const created = (run: ExecutionRun) => Date.parse(run.createdAt);
  const current = oldestFirst.filter((run) => created(run) >= currentFrom);
  const previous = oldestFirst.filter(
    (run) => created(run) >= previousFrom && created(run) < currentFrom,
  );

  const flakyLeaderboard = flakyTests(current);
  const slowestTests = slowTests(current, previous, dates);
  const previousFlaky = flakyTests(previous);
  const verdicts = (window: readonly ExecutionRun[]) =>
    passRate(
      window.filter((run) => run.outcome === 'passed').length,
      window.filter((run) => run.outcome === 'failed').length,
    );
  const digest = buildDigest({
    current: {
      runs: current.length,
      passRate: verdicts(current),
      flakyKeys: flakyLeaderboard.map((test) => test.key),
      failingKeys: failingKeys(current),
      slowKeys: slowestTests
        .filter((test) => test.changePct !== null && test.changePct >= SLOWER_PCT)
        .sort((left, right) => (right.changePct ?? 0) - (left.changePct ?? 0))
        .map((test) => ({ key: test.key, title: test.title, changePct: test.changePct ?? 0 })),
    },
    previous: {
      runs: previous.length,
      passRate: verdicts(previous),
      flakyKeys: previousFlaky.map((test) => test.key),
      failingKeys: failingKeys(previous),
    },
    // Coverage is not in the run history; the readiness card carries it.
    coverageDelta: null,
  });

  return {
    days,
    from: new Date(currentFrom).toISOString(),
    to: new Date(today + DAY_MS).toISOString(),
    dates,
    runs: current.length,
    flakyLeaderboard,
    slowestTests,
    failureHeatmap: heatmap(current, dates),
    mttr: mttr(current),
    passRateByBranch: branches(current),
    digest,
    truncated,
  };
}

/** `file › title`, so two tests with one title in two files are two tests. */
function testKey(test: ExecutionTestResult): string {
  return `${test.file ?? ''} › ${test.title}`;
}

function appearances(runs: readonly ExecutionRun[]): Map<string, Appearance[]> {
  const byTest = new Map<string, Appearance[]>();
  for (const run of runs) {
    for (const test of run.tests) {
      const key = testKey(test);
      const list = byTest.get(key) ?? [];
      list.push({ run, test });
      byTest.set(key, list);
    }
  }
  return byTest;
}

function verdictOf(status: ExecutionTestResult['status']): 'pass' | 'fail' | null {
  if (status === 'passed') return 'pass';
  if (status === 'failed' || status === 'timed_out') return 'fail';
  return null;
}

/** How often consecutive decisive results of one test disagree. */
function countFlips(seen: readonly Appearance[]): number {
  let flips = 0;
  let last: 'pass' | 'fail' | null = null;
  for (const { test } of seen) {
    const verdict = verdictOf(test.status);
    if (verdict === null) continue;
    if (last !== null && verdict !== last) flips += 1;
    last = verdict;
  }
  return flips;
}

function flakyTests(runs: readonly ExecutionRun[]): FlakyTest[] {
  const ranked: FlakyTest[] = [];
  for (const [key, seen] of appearances(runs)) {
    const flaky = seen.filter(({ test }) => test.status === 'flaky').length;
    const flips = countFlips(seen);
    const score = Math.min(1, (flaky + flips) / seen.length);
    const latest = seen.at(-1);
    if (score === 0 || latest === undefined) continue;
    ranked.push({
      key,
      title: latest.test.title,
      file: latest.test.file ?? null,
      runs: seen.length,
      flaky,
      flips,
      score: Math.round(score * 1000) / 1000,
      lastSeen: latest.run.createdAt,
    });
  }
  return ranked
    .sort((left, right) => right.score - left.score || right.runs - left.runs)
    .slice(0, LEADERBOARD);
}

function failingKeys(runs: readonly ExecutionRun[]): string[] {
  const keys = new Set<string>();
  for (const run of runs) {
    for (const test of run.tests) if (verdictOf(test.status) === 'fail') keys.add(testKey(test));
  }
  return [...keys];
}

/** The `fraction` percentile of `values` by nearest rank; `values` must be non-empty. */
function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function durations(seen: readonly Appearance[]): number[] {
  return seen
    .map(({ test }) => test.durationMs)
    .filter((value): value is number => typeof value === 'number' && value >= 0);
}

function slowTests(
  current: readonly ExecutionRun[],
  previous: readonly ExecutionRun[],
  dates: readonly string[],
): SlowTest[] {
  const before = appearances(previous);
  const slow: SlowTest[] = [];
  for (const [key, seen] of appearances(current)) {
    const samples = durations(seen);
    const latest = seen.at(-1);
    if (samples.length === 0 || latest === undefined) continue;
    const earlier = durations(before.get(key) ?? []);
    const p50 = percentile(samples, 0.5);
    const previousP50 = earlier.length === 0 ? null : percentile(earlier, 0.5);
    slow.push({
      key,
      title: latest.test.title,
      file: latest.test.file ?? null,
      samples: samples.length,
      p50Ms: p50,
      p95Ms: percentile(samples, 0.95),
      previousP50Ms: previousP50,
      changePct:
        previousP50 === null || previousP50 === 0
          ? null
          : Math.round(((p50 - previousP50) / previousP50) * 1000) / 10,
      daily: dates.map((date) => {
        const day = durations(seen.filter(({ run }) => dayKey(Date.parse(run.createdAt)) === date));
        return day.length === 0 ? null : percentile(day, 0.5);
      }),
    });
  }
  return slow.sort((left, right) => right.p95Ms - left.p95Ms).slice(0, SLOWEST);
}

function suiteOf(run: ExecutionRun): string {
  return run.suite ?? 'unnamed suite';
}

function heatmap(runs: readonly ExecutionRun[], dates: readonly string[]): HeatmapRow[] {
  const bySuite = new Map<string, ExecutionRun[]>();
  for (const run of runs) bySuite.set(suiteOf(run), [...(bySuite.get(suiteOf(run)) ?? []), run]);
  return [...bySuite]
    .map(([suite, suiteRuns]) => {
      const cells = dates.map((date) => {
        const day = suiteRuns.filter((run) => dayKey(Date.parse(run.createdAt)) === date);
        return { runs: day.length, failed: day.filter((run) => run.outcome === 'failed').length };
      });
      return { suite, cells, failed: cells.reduce((sum, cell) => sum + cell.failed, 0) };
    })
    .sort((left, right) => right.failed - left.failed || left.suite.localeCompare(right.suite))
    .slice(0, HEATMAP_SUITES);
}

function finished(run: ExecutionRun): number {
  return Date.parse(run.completedAt ?? run.createdAt);
}

/** One suite's completed recoveries, and the run that opened an incident still open. */
function suiteIncidents(runs: readonly ExecutionRun[]): {
  recoveries: number[];
  openedAt: ExecutionRun | null;
} {
  const recoveries: number[] = [];
  let openedAt: ExecutionRun | null = null;
  for (const run of runs) {
    if (run.outcome === 'failed' && openedAt === null) openedAt = run;
    if (run.outcome === 'passed' && openedAt !== null) {
      recoveries.push(Math.max(0, finished(run) - finished(openedAt)));
      openedAt = null;
    }
  }
  return { recoveries, openedAt };
}

function summarise(recoveries: readonly number[]): Pick<Mttr, 'recoveries' | 'medianMs' | 'p90Ms'> {
  return {
    recoveries: recoveries.length,
    medianMs: recoveries.length === 0 ? null : percentile(recoveries, 0.5),
    p90Ms: recoveries.length === 0 ? null : percentile(recoveries, 0.9),
  };
}

/**
 * Time to recovery, per suite: from the first failing run of an incident to the next run
 * that passed. An incident still open at the end of the window is reported as open, with
 * when it started — never folded into the mean as a zero or as "now".
 */
function mttr(runs: readonly ExecutionRun[]): QaInsights['mttr'] {
  const suites: Mttr[] = [];
  const all: number[] = [];
  for (const suite of [...new Set(runs.map(suiteOf))].sort()) {
    const { recoveries, openedAt } = suiteIncidents(
      runs.filter((candidate) => suiteOf(candidate) === suite),
    );
    all.push(...recoveries);
    if (recoveries.length === 0 && openedAt === null) continue;
    suites.push({ suite, ...summarise(recoveries), openSince: openedAt?.createdAt ?? null });
  }
  const open = suites
    .map((entry) => entry.openSince)
    .filter((since): since is string => since !== null)
    .sort();
  return {
    overall: { ...summarise(all), openSince: open[0] ?? null },
    suites: suites.sort(
      (left, right) =>
        Number(right.openSince !== null) - Number(left.openSince !== null) ||
        (right.medianMs ?? 0) - (left.medianMs ?? 0),
    ),
  };
}

function branches(runs: readonly ExecutionRun[]): BranchPassRate[] {
  const byBranch = new Map<string, { runs: number; passed: number; failed: number }>();
  for (const run of runs) {
    const branch = run.branch ?? 'unknown';
    const entry = byBranch.get(branch) ?? { runs: 0, passed: 0, failed: 0 };
    entry.runs += 1;
    if (run.outcome === 'passed') entry.passed += 1;
    if (run.outcome === 'failed') entry.failed += 1;
    byBranch.set(branch, entry);
  }
  return [...byBranch]
    .map(([branch, entry]) => ({
      branch,
      ...entry,
      passRate: passRate(entry.passed, entry.failed),
    }))
    .sort((left, right) => right.runs - left.runs || left.branch.localeCompare(right.branch))
    .slice(0, BRANCHES);
}
