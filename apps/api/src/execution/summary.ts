import type { ExecutionSummary, ExecutionTestResult } from './types.js';

/**
 * Derives a summary from a run's tests, and judges whether a summary can be
 * believed.
 *
 * **Exactly one bucket per test.** The derivation this replaces incremented
 * `blocked` *and* `unknown` for a blocked test, and put `cancelled` in `unknown`
 * with no bucket of its own — so the buckets summed to more than `total`. Any
 * consumer dividing by `total` for a pass rate got a number that could not
 * exist, and ten blocked tests reported eleven observations.
 *
 * `ExecutionSummary` has no `cancelled` counter, so a cancelled test lands in
 * `unknown`: it produced no outcome, which is what `unknown` means.
 *
 * Shared by both stores, so the two cannot derive the same run differently —
 * which is the class of drift `store-parity.test.ts` exists to catch.
 */
export function countTests(tests: readonly ExecutionTestResult[]): ExecutionSummary {
  const summary: ExecutionSummary = {
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    blocked: 0,
    unknown: 0,
    durationMs: null,
  };
  for (const test of tests) {
    summary.total += 1;
    // A switch rather than a chain of `if`s, because "one bucket" is the
    // property and a chain is exactly how a status came to be counted twice.
    switch (test.status) {
      case 'passed':
        summary.passed += 1;
        break;
      case 'failed':
      case 'timed_out':
        summary.failed += 1;
        break;
      case 'flaky':
        summary.flaky += 1;
        break;
      case 'skipped':
        summary.skipped += 1;
        break;
      case 'blocked':
        summary.blocked += 1;
        break;
      default:
        // unknown, queued, running, cancelled: no outcome was observed.
        summary.unknown += 1;
        break;
    }
  }
  const durations = tests
    .map((test) => test.durationMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  summary.durationMs =
    durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) : null;
  return summary;
}

/**
 * Whether a summary's buckets account for its total.
 *
 * The test for believing a reporter's own summary. One that does not add up is
 * not a slightly wrong number, it is a claim about evidence that cannot be
 * checked, and this product does not publish those.
 */
export function isCoherentSummary(summary: ExecutionSummary): boolean {
  const buckets =
    summary.passed +
    summary.failed +
    summary.flaky +
    summary.skipped +
    summary.blocked +
    summary.unknown;
  return summary.total === buckets;
}

/**
 * A runner's summary, or the run's own tests counted — whichever is coherent.
 *
 * Used wherever a completion carries a reporter's counters. A coherent claimed
 * summary is preferred, because it can know about tests the API was not sent;
 * an incoherent one is discarded rather than repaired, since guessing which of
 * its numbers to believe is exactly the claim this product refuses to publish.
 */
export function resolveSummary(
  claimed: Partial<ExecutionSummary> | undefined,
  tests: readonly ExecutionTestResult[],
): ExecutionSummary {
  const derived = countTests(tests);
  if (claimed === undefined) return derived;
  const merged = { ...derived, ...claimed } as ExecutionSummary;
  return isCoherentSummary(merged) ? merged : derived;
}
