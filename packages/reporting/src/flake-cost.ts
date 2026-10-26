/**
 * What flaky tests cost, and which of them to quarantine.
 *
 * ## Flakiness is disagreement, exactly as the insights leaderboard defines it
 *
 * A `flaky` result (failed, then passed on a retry) and a flip between `passed` and a
 * failure across consecutive runs are the two kinds of disagreement, and the score is
 * `(flaky + flips) / observations` — the formula `FlakyTestSchema` documents and
 * `apps/api/src/execution/insights.ts` computes for the leaderboard. Restated here because
 * the API's version is private to a route. **The two differ in one input:** the leaderboard
 * divides by every appearance of a test, while `flakeObservationsOf` hands this model only
 * `passed`, `failed`, `flaky`, `timed_out` and `skipped` results, so a test with `running`,
 * `unknown` or `blocked` results scores higher here than there. Nothing asserts the two agree.
 *
 * ## A test that only ever fails is not a quarantine candidate
 *
 * It is broken, and it is telling the truth. Quarantining it hides a real failure behind
 * the label meant for noise, which is the most expensive mistake a flake tool can make —
 * so a test whose decisive results are all failures is never suggested, even if it has a
 * `flaky` result in its history.
 */

export type ObservationStatus = 'passed' | 'failed' | 'flaky' | 'timed_out' | 'skipped';

export interface FlakeObservation {
  testKey: string;
  title: string;
  runId: string;
  status: ObservationStatus;
  /** Attempts after the first. */
  retries: number;
  /** Wall time of the test in this run, across every attempt; `null` when not recorded. */
  durationMs: number | null;
  /** Whether the run this result belongs to was blocked (its gate failed). */
  runBlocked: boolean;
}

export interface FlakeCost {
  testKey: string;
  title: string;
  observations: number;
  /** `(flaky + flips) / observations`, 0–1, to three places. */
  flakyScore: number;
  retriesSpent: number;
  /** Time spent on attempts beyond the first, in whole milliseconds. */
  wastedMs: number;
  /** Distinct blocked runs in which this test did not cleanly pass. */
  blockedRuns: number;
  decisiveFailures: number;
  decisivePasses: number;
}

export interface QuarantineSuggestion {
  testKey: string;
  title: string;
  flakyScore: number;
  reason: string;
}

function verdict(status: ObservationStatus): 'pass' | 'fail' | null {
  if (status === 'passed') return 'pass';
  if (status === 'failed' || status === 'timed_out') return 'fail';
  return null;
}

/** Running totals over one test's observations, oldest first. */
interface CostTally {
  flaky: number;
  flips: number;
  last: 'pass' | 'fail' | null;
  retriesSpent: number;
  wasted: number;
  decisiveFailures: number;
  decisivePasses: number;
  blocked: Set<string>;
}

/** A flip is a change between consecutive decisive results; flaky passes are not decisive. */
function tallyVerdict(tally: CostTally, status: ObservationStatus): void {
  if (status === 'flaky') tally.flaky += 1;
  const outcome = verdict(status);
  if (outcome === null) return;
  if (outcome === 'pass') tally.decisivePasses += 1;
  else tally.decisiveFailures += 1;
  if (tally.last !== null && outcome !== tally.last) tally.flips += 1;
  tally.last = outcome;
}

/** Only the repeats are waste: `retries / (retries + 1)` of the recorded duration. */
function tallyRetries(tally: CostTally, observation: FlakeObservation): void {
  const retries = Math.max(0, observation.retries);
  tally.retriesSpent += retries;
  tally.wasted += ((observation.durationMs ?? 0) * retries) / (retries + 1);
  const notClean = observation.status !== 'passed' && observation.status !== 'skipped';
  if (observation.runBlocked && notClean) tally.blocked.add(observation.runId);
}

function costOf(testKey: string, seen: readonly FlakeObservation[]): FlakeCost {
  const tally: CostTally = {
    flaky: 0,
    flips: 0,
    last: null,
    retriesSpent: 0,
    wasted: 0,
    decisiveFailures: 0,
    decisivePasses: 0,
    blocked: new Set<string>(),
  };
  for (const observation of seen) {
    tallyVerdict(tally, observation.status);
    tallyRetries(tally, observation);
  }
  const score = Math.min(1, (tally.flaky + tally.flips) / seen.length);
  return {
    testKey,
    title: (seen.at(-1) as FlakeObservation).title,
    observations: seen.length,
    flakyScore: Math.round(score * 1000) / 1000,
    retriesSpent: tally.retriesSpent,
    wastedMs: Math.round(tally.wasted),
    blockedRuns: tally.blocked.size,
    decisiveFailures: tally.decisiveFailures,
    decisivePasses: tally.decisivePasses,
  };
}

/**
 * Per-test flake cost, from observations given oldest first.
 *
 * Order matters within one test — a flip is a change between *consecutive* decisive
 * results — and not between tests. Retry waste assumes the attempts of one run took
 * equal time, so `retries / (retries + 1)` of the recorded duration was spent repeating
 * work: the first attempt was needed whatever happened, and only the repeats are the
 * flake's cost. A missing duration contributes nothing rather than an estimate.
 *
 * A run counts as blocked by the test when the run was blocked and the test's result in
 * it was a failure, a time-out or a flaky pass — the cases in which the test could have
 * been why. Sorted by score, then waste, then key.
 */
export function flakeCost(observations: readonly FlakeObservation[]): FlakeCost[] {
  const byTest = new Map<string, FlakeObservation[]>();
  for (const observation of observations) {
    const list = byTest.get(observation.testKey) ?? [];
    list.push(observation);
    byTest.set(observation.testKey, list);
  }
  return [...byTest]
    .map(([testKey, seen]) => costOf(testKey, seen))
    .sort(
      (left, right) =>
        right.flakyScore - left.flakyScore ||
        right.wastedMs - left.wastedMs ||
        (left.testKey < right.testKey ? -1 : 1),
    );
}

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

function reasonFor(cost: FlakeCost): string {
  const percent = Math.round(cost.flakyScore * 100);
  const seconds = (cost.wastedMs / 1000).toFixed(1);
  const blocked = cost.blockedRuns === 0 ? 'no run' : plural(cost.blockedRuns, 'run', 'runs');
  return (
    `Disagreed with itself in ${String(percent)}% of ${plural(cost.observations, 'run', 'runs')}; ` +
    `${plural(cost.retriesSpent, 'retry', 'retries')} cost ${seconds} s and it blocked ${blocked}.`
  );
}

/**
 * The tests worth quarantining, each with the sentence a reviewer reads before agreeing.
 *
 * A test qualifies with at least `minObservations` observations, a score above zero and
 * at least `minScore`, and at least one decisive pass — the broken-not-flaky rule in the
 * module comment. Every condition is a filter, so raising either threshold can only
 * remove suggestions, and the order is `flakeCost`'s.
 */
export function suggestQuarantine(
  costs: readonly FlakeCost[],
  thresholds: { minScore: number; minObservations: number },
): QuarantineSuggestion[] {
  return costs
    .filter(
      (cost) =>
        cost.observations >= thresholds.minObservations &&
        cost.flakyScore > 0 &&
        cost.flakyScore >= thresholds.minScore &&
        !(cost.decisivePasses === 0 && cost.decisiveFailures > 0),
    )
    .map((cost) => ({
      testKey: cost.testKey,
      title: cost.title,
      flakyScore: cost.flakyScore,
      reason: reasonFor(cost),
    }));
}
