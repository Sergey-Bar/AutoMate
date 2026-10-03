import type { CanonicalTestResult, RunRecord, TestOutcome } from './types.js';

/**
 * Two definitions of flaky, because they mean different things.
 *
 * **strong** — the same `fingerprint` and the same `commitSha`, different
 * outcome. Unambiguous: the code did not change and the result did.
 *
 * **weak** — three or more outcome flips across the last ten runs of one
 * fingerprint, regardless of commit. Weaker evidence: a real change can flip a
 * test three times in ten runs, and a test that only fails on Tuesdays looks
 * exactly like a flaky one.
 *
 * The distinction is load-bearing because a test is quarantined on **strong**
 * evidence or operator action, never on weak. Guessing wrong hides a real defect,
 * and a hidden defect is the one failure mode this product cannot have.
 */

/** One observed outcome of one fingerprint, in run order. */
export interface OutcomeObservation {
  fingerprint: string;
  runId: string;
  commitSha: string | null;
  outcome: TestOutcome;
}

const STRONG_FLIP_OUTCOMES: ReadonlySet<TestOutcome> = new Set<TestOutcome>(['passed', 'failed']);

export interface FlakyVerdict {
  fingerprint: string;
  /** Unambiguous: same commit, different outcome. */
  strong: boolean;
  /** Three or more flips across the last `WEAK_FLIP_WINDOW` runs. */
  weak: boolean;
  /** How many outcome changes the weak rule counted. */
  flips: number;
}

/** The last ten runs of one fingerprint. A heuristic, and it is stated as one. */
export const WEAK_FLIP_WINDOW = 10;
export const WEAK_FLIP_THRESHOLD = 3;

/** Classifies one fingerprint. Exported so a UI can render the same evidence. */
export function classifyFlakiness(
  fingerprint: string,
  observations: readonly OutcomeObservation[],
): FlakyVerdict {
  const ordered = [...observations].sort((left, right) => left.runId.localeCompare(right.runId));
  const flips = countFlips(ordered);
  return {
    fingerprint,
    strong: hasStrongFlip(ordered),
    weak: flips >= WEAK_FLIP_THRESHOLD,
    flips,
  };
}

function hasStrongFlip(observations: readonly OutcomeObservation[]): boolean {
  const byCommit = new Map<string, Set<TestOutcome>>();
  for (const observation of observations) {
    // A null commit cannot form a *strong* claim: "the same commit" is the whole
    // claim, and a run with no recorded commit is not evidence that nothing
    // changed. It can still be weak evidence.
    if (observation.commitSha === null) continue;
    if (!STRONG_FLIP_OUTCOMES.has(observation.outcome)) continue;
    const seen = byCommit.get(observation.commitSha) ?? new Set<TestOutcome>();
    seen.add(observation.outcome);
    byCommit.set(observation.commitSha, seen);
  }
  for (const outcomes of byCommit.values()) {
    if (outcomes.size > 1) return true;
  }
  return false;
}

function countFlips(observations: readonly OutcomeObservation[]): number {
  const window = observations.slice(-WEAK_FLIP_WINDOW);
  let flips = 0;
  for (let index = 1; index < window.length; index += 1) {
    const previous = window[index - 1];
    const current = window[index];
    if (previous !== undefined && current !== undefined && previous.outcome !== current.outcome) {
      flips += 1;
    }
  }
  return flips;
}

/**
 * `flakeRate` over the window: the share of executed tests with **strong**
 * evidence of flakiness.
 *
 * Strong-only, and that is deliberate rather than conservative-looking. A weak
 * fingerprint still moves the cell's stability component; it just cannot remove a
 * test from reporting on its own, because "this test flips" and "this test is
 * wrong" are different claims and only the first is evidenced.
 */
export function flakeRate(
  results: readonly CanonicalTestResult[],
  observationsByFingerprint: ReadonlyMap<string, OutcomeObservation[]>,
): { rate: number; strong: readonly string[]; weak: readonly string[] } {
  const strong: string[] = [];
  const weak: string[] = [];
  for (const [fingerprint, observations] of observationsByFingerprint) {
    const verdict = classifyFlakiness(fingerprint, observations);
    if (verdict.strong) strong.push(fingerprint);
    else if (verdict.weak) weak.push(fingerprint);
  }
  const executed = results.filter((result) => isExecuted(result.outcome));
  const executedFingerprints = new Set(executed.map((result) => result.fingerprint));
  // Only fingerprints that actually ran count. A fingerprint whose every
  // observation was in a cancelled run is not a flaky test; it is a test nobody
  // finished, and counting it would let a broken pipeline lower the flake rate.
  const denominator = executedFingerprints.size;
  const numerator = strong.filter((fingerprint) => executedFingerprints.has(fingerprint)).length;
  return {
    rate: denominator === 0 ? 0 : numerator / denominator,
    strong: strong.filter((fingerprint) => executedFingerprints.has(fingerprint)),
    weak: weak.filter((fingerprint) => executedFingerprints.has(fingerprint)),
  };
}

/**
 * Whether a test ran to a verdict.
 *
 * `skipped` and `blocked` did not run; `cancelled` and `timed_out` were not
 * allowed to finish. All four are excluded from the executed population, and
 * `unknown` with it — an unobserved test is not a passing one.
 */
export function isExecuted(outcome: TestOutcome): boolean {
  return outcome === 'passed' || outcome === 'failed' || outcome === 'flaky';
}

/** Whether a run may contribute to the presence component. */
export function qualifiesForPresence(run: RunRecord): boolean {
  return run.countsTowardsQuality && run.outcome !== null;
}
