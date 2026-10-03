/**
 * canonical-projection.ts — `canonical_run_results` → `runs` / `tests`.
 *
 * **The canonical row is the authority. These two tables are a view of it**, which is the
 * exact line the blueprint draws in §10: a projection is not a second authority, and the
 * rule that makes it one is that the canonical row is written first, the projection is
 * derived from it, and a gate recomputes the projection from the canonical row and fails
 * on any divergence. `canonical-projection.test.ts` is that gate.
 *
 * This function is **the** projection. There was no function at all before: the upload
 * route parsed JUnit and Playwright with its own scanner, invented its own status ladder,
 * and wrote `runs`/`tests` from the result — so the same report through two doors produced
 * two sets of rows with two sets of statuses, and only one of the two tables was readable
 * by the reporting package. A rule that lives in two files is a rule nobody compares, and
 * this one was in two files for the whole life of the product.
 */

import type { CanonicalRunResult } from '@automate/shared-contracts';
import { deriveRunState } from '../execution/phase-outcome.js';
import type { RunOutcome, RunPhase } from '../execution/types.js';
import { normaliseFailure } from './reporter-persistence.js';
import type { RunRecord, TestRecord, TestStatus } from '../repositories/run-repository.js';

export interface CanonicalProjection {
  run: RunRecord;
  tests: TestRecord[];
}

/**
 * Canonical run status → the `(phase, claimed outcome)` pair `deriveRunState` needs.
 *
 * The pair is derived by `deriveRunState` and never assembled here: the database enforces
 * `runs_phase_outcome_check`, so a caller that wrote both columns could produce a
 * combination the CHECK rejects — as a 500 — for a request that was merely malformed.
 *
 * **Why most non-green statuses land on `partial` rather than `complete`.** `runs.status`
 * stores four values and the canonical vocabulary has eleven, so this is a narrowing, and
 * the narrowing has to be chosen rather than defaulted. `deriveRunState` reports
 * `status: 'passed'` only for `outcome: 'passed'`; everything else on a `complete` phase
 * becomes `failed`. That is right for a product failure and wrong for a *run* whose verdict
 * is merely untrustworthy: a flaky run, a suite where every test was skipped, and a run
 * with an unobserved test all reached a terminal moment, but none of them reached a verdict
 * worth reading. `phase: 'partial'` is the vocabulary's own name for "evidence without a
 * terminal verdict", and it keeps `runs.status` at `interrupted` for them — which is the
 * non-green, non-failing landing the evidence supports.
 *
 * The non-product statuses keep their own phases, because the vocabulary names exactly
 * what happened: a cancelled run was cancelled, a blocked run was blocked, and collapsing
 * them all into `partial` would throw away the distinction an operator needs to tell a CI
 * cancellation from a test that never ran.
 */
const RUN_STATUS_TO_PHASE: Record<
  CanonicalRunResult['status'],
  { phase: RunPhase; outcome: RunOutcome }
> = {
  passed: { phase: 'complete', outcome: 'passed' },
  failed: { phase: 'complete', outcome: 'failed' },
  // A timeout is a real result about the product — `policy.ts` classifies it as `product`
  // for that reason — so it is a `complete` failure rather than a partial one.
  timedOut: { phase: 'complete', outcome: 'timed_out' },
  // The producer says the run has not finished. `deriveRunState` gives a non-terminal
  // phase `outcome: null` and `status: 'running'` without being told, so the payload carries
  // no outcome and there is nothing for a caller to forge one from.
  running: { phase: 'running', outcome: null },
  flaky: { phase: 'partial', outcome: 'partial' },
  skipped: { phase: 'partial', outcome: 'partial' },
  unknown: { phase: 'partial', outcome: 'partial' },
  cancelled: { phase: 'cancelled', outcome: 'cancelled' },
  blocked: { phase: 'blocked', outcome: 'blocked' },
  configFailed: { phase: 'config_failed', outcome: 'config_failed' },
  infraFailed: { phase: 'infra_failed', outcome: 'infra_failed' },
  runnerFailed: { phase: 'runner_lost', outcome: 'runner_lost' },
};

/** Canonical status → the `tests.status` spelling, which is narrower still. */
const TEST_STATUS_BY_CANONICAL: Record<CanonicalRunResult['status'], TestStatus> = {
  passed: 'passed',
  failed: 'failed',
  flaky: 'flaky',
  skipped: 'skipped',
  timedOut: 'timed_out',
  // A test still in flight. The `tests` table has its own word for it and it is not
  // `queued`: `queued` is this table's name for "declared, no outcome observed", and a
  // test that is running is exactly that.
  running: 'running',
  // `unknown` is "declared, no outcome observed", and `queued` is this table's name for
  // exactly that.
  unknown: 'queued',
  cancelled: 'queued',
  blocked: 'queued',
  configFailed: 'queued',
  infraFailed: 'queued',
  runnerFailed: 'queued',
};

/** One test and the attempts it took to reach a verdict. */
interface TestProjection {
  testId: string;
  specPath: string;
  title: string;
  status: TestStatus;
  durationMs: number | null;
  error: { message: string; code?: string | undefined } | undefined;
  flaky: boolean;
}

/**
 * The attempts of one test, collapsed to the test's outcome.
 *
 * **A retry history is not a set of independent tests.** The last attempt is the outcome
 * and the earlier ones are the evidence that the outcome needed help — which is exactly
 * what `runStatusFrom` says, and what the upload path used to contradict by writing one
 * `tests` row per attempt, so a test that failed once and passed on retry appeared twice
 * in the dashboard and pushed `runs.total` to 2 for one test.
 *
 * The one place a retry changes the stored status is flakiness. `flakiness: 'observed'`
 * on any attempt means the producer *witnessed* a retry, and `tests.status` has a `flaky`
 * member precisely for it: the run did reach a verdict, but the verdict is not one a
 * release should be read from, and recording `passed` for it is the failure this product
 * exists to prevent.
 */
function testsFrom(result: CanonicalRunResult): TestProjection[] {
  const byTestId = new Map<string, CanonicalRunResult['attempts'][number][]>();
  for (const attempt of result.attempts) {
    const existing = byTestId.get(attempt.testId);
    if (existing) existing.push(attempt);
    else byTestId.set(attempt.testId, [attempt]);
  }
  return [...byTestId.entries()].map(([testId, attempts]) => {
    // Attempts arrive ordered, so the last is the outcome and the first is the one the
    // evidence is about. Sorted rather than assumed: the contract requires 1..n per
    // `testId` but not that the array is in index order, and reading a stale "last"
    // attempt would silently report the wrong verdict.
    const ordered = [...attempts].sort((left, right) => left.index - right.index);
    const final = ordered[ordered.length - 1] as CanonicalRunResult['attempts'][number];
    const flaky = ordered.some((attempt) => attempt.flakiness === 'observed');
    return {
      testId,
      specPath: final.specPath,
      title: final.title,
      status: flaky ? 'flaky' : TEST_STATUS_BY_CANONICAL[final.status],
      durationMs: final.durationMs ?? null,
      error: final.error,
      flaky,
    };
  });
}

/**
 * Project a canonical result onto the dashboard's two tables.
 *
 * Pure: it reads the result and returns rows, so the recompute gate can call it against
 * what is stored and compare. Nothing here consults a database, a clock, or an ambient
 * workspace — the workspace is on the result, because `identity.workspaceId` is what the
 * ingestion service checked the writer against.
 *
 * @param result the authority
 * @param triggeredBy what wrote it, when the door is not the source of the truth
 */
export function projectCanonicalRun(
  result: CanonicalRunResult,
  options: { triggeredBy?: string } = {},
): CanonicalProjection {
  const tests = testsFrom(result);
  const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const test of tests) {
    if (test.status === 'passed') counts.passed += 1;
    else if (test.status === 'flaky') counts.flaky += 1;
    else if (test.status === 'failed' || test.status === 'timed_out') counts.failed += 1;
    else if (test.status === 'skipped') counts.skipped += 1;
  }

  const { phase, outcome } = RUN_STATUS_TO_PHASE[result.status];
  const state = deriveRunState(phase, outcome);

  return {
    run: {
      id: result.identity.runId,
      workspaceId: result.identity.workspaceId,
      phase: state.phase,
      outcome: state.outcome,
      startedAt: result.startedAt,
      // Absent when the producer declared none, and `null` rather than `startedAt`: a run
      // with a duration invented from its own start is a chart showing a length nobody
      // measured.
      finishedAt: result.finishedAt ?? null,
      status: state.status,
      total: tests.length,
      ...counts,
      durationMs: result.durationMs ?? null,
      branch: result.provenance.branch ?? null,
      commitSha: result.provenance.commitSha ?? null,
      triggeredBy: options.triggeredBy ?? 'upload',
    },
    tests: tests.map((test) => ({
      id: test.testId,
      runId: result.identity.runId,
      title: test.title,
      file: test.specPath,
      status: test.status,
      durationMs: test.durationMs,
      // The same bound, the same marker and the same `null`-for-none convention the event
      // door uses, imported rather than restated: the failure text is a producer's string
      // in both cases and one limit on it is one rule.
      ...normaliseFailure(test.error),
    })),
  };
}

/**
 * What a stored projection says against what the canonical row implies.
 *
 * Every difference is named. A gate that reports "the projection drifted" is a gate whose
 * red is not actionable, and this is the function that decides whether the gate can
 * honestly claim to be measuring anything at all.
 *
 * @param expected what the canonical row projects to
 * @param actual what the repository holds
 * @returns one sentence per divergent field; empty when the two agree
 */
export function projectionDivergence(
  expected: CanonicalProjection,
  actual: { run: RunRecord | null; tests: Map<string, TestRecord> },
): string[] {
  const differences: string[] = [];
  if (actual.run === null) {
    differences.push(`runs: no row for ${expected.run.id}, which the canonical row projects to`);
    return differences;
  }
  for (const field of [
    'phase',
    'outcome',
    'status',
    'startedAt',
    'finishedAt',
    'durationMs',
    'branch',
    'commitSha',
    'total',
    'passed',
    'failed',
    'flaky',
    'skipped',
  ] as const) {
    if (actual.run[field] !== expected.run[field]) {
      differences.push(
        `runs.${field}: stored ${JSON.stringify(actual.run[field])}, ` +
          `canonical row implies ${JSON.stringify(expected.run[field])}`,
      );
    }
  }
  for (const expectedTest of expected.tests) {
    const stored = actual.tests.get(expectedTest.id);
    if (stored === undefined) {
      differences.push(`tests: no row for ${expectedTest.id}, which the canonical row projects to`);
      continue;
    }
    for (const field of [
      'title',
      'file',
      'status',
      'durationMs',
      'errorCode',
      'errorMessage',
    ] as const) {
      if (stored[field] !== expectedTest[field]) {
        differences.push(
          `tests[${expectedTest.id}].${field}: stored ${JSON.stringify(stored[field])}, ` +
            `canonical row implies ${JSON.stringify(expectedTest[field])}`,
        );
      }
    }
  }
  // Keyed, not scanned. The orphan check reads a stored row against every expected one, and
  // a suite is not a small list — 3 000 tests would make this quadratic on exactly the
  // reports where a divergence matters most.
  const projectedIds = new Set(expected.tests.map((test) => test.id));
  for (const storedId of actual.tests.keys()) {
    if (!projectedIds.has(storedId)) {
      differences.push(
        `tests: row ${storedId} exists with no attempt for it in the canonical row, so ` +
          'nothing is authoritative for it',
      );
    }
  }
  return differences;
}
