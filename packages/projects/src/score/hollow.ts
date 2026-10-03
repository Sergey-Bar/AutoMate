import type { CanonicalTestResult } from './types.js';
import { isExecuted } from './flaky.js';

/**
 * **Hollow** — passing, and contributing nothing.
 *
 * Three independent rules, each of which is enough on its own. A hollow test is
 * the most expensive kind of green this product can produce, because it raises
 * the pass rate and lowers nothing.
 *
 * The signals come from the producer, not from a parse of the test source: this
 * module reads what `canonical_run_results` recorded, so a producer that reports
 * nothing makes a test *unproven* rather than hollow. Absence of evidence is not
 * evidence of absence, and inferring it from source would be a second parser.
 */
export type HollowReason = 'no_observed_assertion' | 'trivially_true_assertions' | 'fast_and_inert';

export interface HollowVerdict {
  fingerprint: string;
  hollow: boolean;
  reasons: HollowReason[];
  /** 0–1. `0` for a hollow test, which is what the signal component reads. */
  valueScore: number;
}

/** Consecutive passes needed before "trivially true" is a claim rather than a guess. */
export const TRIVIAL_ASSERTION_PASS_THRESHOLD = 30;

/** Below this median duration, with no I/O, a passing test is not doing work. */
export const HOLLOW_DURATION_MS = 50;

/**
 * Whether every assertion the producer saw was trivially true.
 *
 * `assertionCount > 0` and `trivialAssertionCount === assertionCount`. The zero
 * case is deliberately **excluded**: a test with no assertions at all is already
 * rule 1, and counting it here too would mean the thirty-passes clause could
 * never add anything rule 1 had not said — which is exactly what happened while
 * this function tested for `assertionCount === 0`.
 */
function allTriviallyTrue(results: readonly CanonicalTestResult[]): boolean {
  return (
    results.length > 0 &&
    results.every(
      (result) =>
        result.assertionCount !== null &&
        result.trivialAssertionCount !== null &&
        result.assertionCount > 0 &&
        result.trivialAssertionCount === result.assertionCount,
    )
  );
}

/**
 * Classifies one fingerprint across every observation of it in the window.
 *
 * `consecutivePasses` is the caller's count of *trailing* passes, because the rule
 * is about a test that has been passing this way for a while — one green run of a
 * hollow test proves nothing about whether it is hollow.
 */
export function classifyHollow(
  fingerprint: string,
  results: readonly CanonicalTestResult[],
  consecutivePasses: number,
): HollowVerdict {
  const reasons: HollowReason[] = [];
  if (results.length === 0) return unfalsifiable(fingerprint);

  // Rule 1 — passing, with no assertion and no snapshot reported at all. `null`
  // means the producer said nothing, which is not the same as `0`.
  if (
    results.every(
      (result) =>
        result.outcome === 'passed' &&
        result.assertionCount !== null &&
        result.assertionCount === 0,
    )
  ) {
    reasons.push('no_observed_assertion');
  }

  // Rule 2 — a long green run whose assertions are all trivially true. The test
  // *has* assertions and every one of them cannot fail, which is a different and
  // more expensive defect than having none.
  if (consecutivePasses >= TRIVIAL_ASSERTION_PASS_THRESHOLD && allTriviallyTrue(results)) {
    reasons.push('trivially_true_assertions');
  }

  // Rule 3 — fast and inert: median duration below the ceiling with no network,
  // file, or database interaction in the trace. A test that runs in under 50ms
  // and touches nothing is not a slow integration test; it is nothing.
  if (isFastAndInert(results)) reasons.push('fast_and_inert');

  return {
    fingerprint,
    hollow: reasons.length > 0,
    reasons,
    valueScore: reasons.length > 0 ? 0 : 1,
  };
}

function isFastAndInert(results: readonly CanonicalTestResult[]): boolean {
  const durations = results
    .filter((result) => isExecuted(result.outcome))
    .map((result) => result.durationMs)
    .filter((duration): duration is number => duration !== null);
  if (durations.length === 0) return false;
  const sorted = [...durations].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
  if (median >= HOLLOW_DURATION_MS) return false;
  // `touchedIo === null` means the producer reported no trace. That is not
  // "touched nothing", so the rule declines to fire rather than accusing a test
  // of having no I/O on the strength of silence.
  return results.every((result) => result.touchedIo === false);
}

/**
 * No observations, so nothing can be said.
 *
 * Returned rather than thrown because an unobserved fingerprint is the normal
 * state of every test in a repository that has never run, and a score that threw
 * on it would be a score that only works once.
 */
function unfalsifiable(fingerprint: string): HollowVerdict {
  return { fingerprint, hollow: false, reasons: [], valueScore: 1 };
}

/** The mean value score over a cell's tests. Hollow tests contribute `0`. */
export function meanValueScore(verdicts: readonly HollowVerdict[]): number {
  if (verdicts.length === 0) return 0;
  return verdicts.reduce((total, verdict) => total + verdict.valueScore, 0) / verdicts.length;
}
