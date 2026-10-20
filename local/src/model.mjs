/**
 * The candidate local evidence model (spike S1). Throwaway prototype code.
 *
 * It exists to answer one question: can the formats AUTOMATE (local) must read be
 * represented without losing an outcome or inventing one? The vocabulary below is a
 * proposal. It is a superset of what `automate.run@2` can say, because that contract
 * cannot express a run with zero tests, an errored test as distinct from a failed one, or
 * a test that was never run.
 */

/**
 * Per-test outcomes.
 *
 * `errored` is a test that raised an unexpected error (JUnit `<error>`), `infraError` is
 * the harness failing (configuration, infrastructure, runner), `notRun` is "no evidence it
 * executed" and `aborted` is "stopped before an outcome". None of the last three is a
 * product verdict.
 */
export const OUTCOMES = [
  'passed',
  'failed',
  'errored',
  'skipped',
  'timedOut',
  'unknown',
  'notRun',
  'aborted',
  'infraError',
];

/** Whether an outcome speaks about the product, about the harness, or about nothing yet. */
export const OUTCOME_CLASS = {
  passed: 'product',
  failed: 'product',
  errored: 'product',
  skipped: 'product',
  timedOut: 'product',
  unknown: 'indeterminate',
  notRun: 'nonProduct',
  aborted: 'nonProduct',
  infraError: 'nonProduct',
};

/**
 * One-way mapping from the server contract's status values (`StatusSchema` in
 * `packages/shared-contracts/src/schemas/canonical-reporting.ts`) to the local model.
 *
 * Every contract status has a row. `blueprint-consistency.test.mjs` derives the contract's
 * list from that file and fails when this table, or the table in
 * `docs/local/data-contracts.md`, disagrees with it.
 *
 * @type {Record<string, { outcome: string, flakiness?: 'observed', incomplete?: true }>}
 */
export const CONTRACT_STATUS_MAP = {
  passed: { outcome: 'passed' },
  failed: { outcome: 'failed' },
  flaky: { outcome: 'passed', flakiness: 'observed' },
  skipped: { outcome: 'skipped' },
  timedOut: { outcome: 'timedOut' },
  unknown: { outcome: 'unknown' },
  running: { outcome: 'unknown', incomplete: true },
  cancelled: { outcome: 'aborted' },
  blocked: { outcome: 'notRun' },
  configFailed: { outcome: 'infraError' },
  infraFailed: { outcome: 'infraError' },
  runnerFailed: { outcome: 'infraError' },
};

/** Outcomes that count as having executed the test body. */
const EXECUTED = new Set(['passed', 'failed', 'errored', 'timedOut']);

/**
 * @typedef {{ index: number, outcome: string, rawStatus: string, durationMs: number | null,
 *   message: string | null, messageTruncated: boolean }} Attempt
 * @typedef {{ name: string, suite: string | null, project: string | null,
 *   file: string | null, fileRaw: string | null, attempts: Attempt[], outcome: string,
 *   flakiness: 'observed' | 'unknown' }} TestResult
 * @typedef {{ kind: 'run', format: string, completeness: string, runStatus: string,
 *   tests: TestResult[], warnings: string[], runErrors: number }} RunObservation
 * @typedef {{ kind: 'rejected', format: string, completeness: 'rejected', runStatus: 'rejected',
 *   rejection: string, warnings: string[] }} Rejection
 */

/**
 * A rejection is a result, not an exception: "we could not read it" and "there was
 * nothing in it" are different answers.
 *
 * @param {string} format
 * @param {string} rejection
 * @param {string[]} [warnings]
 * @returns {Rejection}
 */
export function rejected(format, rejection, warnings = []) {
  return {
    kind: 'rejected',
    format,
    completeness: 'rejected',
    runStatus: 'rejected',
    rejection,
    warnings: unique(warnings),
  };
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
export function unique(values) {
  return [...new Set(values)].sort();
}

/**
 * The run's verdict, from final per-test outcomes.
 *
 * Order matters and is the policy: a failure dominates everything; otherwise anything
 * unknown or incomplete keeps the run from being called a pass; a run with no executed
 * test is not a pass either.
 *
 * @param {TestResult[]} tests
 * @param {string} completeness
 * @param {number} runErrors errors reported by the run itself rather than by a test
 * @returns {string}
 */
export function runStatusFor(tests, completeness, runErrors) {
  if (tests.some((test) => ['failed', 'errored', 'timedOut'].includes(test.outcome))) {
    return 'failed';
  }
  if (tests.length === 0) return runErrors > 0 ? 'errored' : 'noTests';
  if (tests.some((test) => test.outcome === 'infraError')) return 'errored';
  if (
    completeness !== 'complete' ||
    tests.some((test) => OUTCOME_CLASS[test.outcome] !== 'product')
  ) {
    return 'unknown';
  }
  if (!tests.some((test) => EXECUTED.has(test.outcome))) return 'noneExecuted';
  return 'passed';
}

/**
 * Assembles an observation and enforces its invariants.
 *
 * @param {{ format: string, completeness: string, tests: TestResult[], warnings: string[],
 *   runErrors?: number }} input
 * @returns {RunObservation}
 */
export function observation(input) {
  const runErrors = input.runErrors ?? 0;
  const run = {
    kind: /** @type {const} */ ('run'),
    format: input.format,
    completeness: input.completeness,
    runStatus: runStatusFor(input.tests, input.completeness, runErrors),
    tests: input.tests,
    warnings: unique(input.warnings),
    runErrors,
  };
  const problems = reconcile(run);
  if (problems.length > 0) throw new Error(`observation invariant broken: ${problems.join('; ')}`);
  return run;
}

/**
 * Counts by final outcome, plus the totals the dashboard must reconcile against.
 *
 * @param {RunObservation} run
 * @returns {Record<string, number>}
 */
export function countsOf(run) {
  /** @type {Record<string, number>} */
  const counts = { tests: run.tests.length, attempts: 0 };
  for (const outcome of OUTCOMES) counts[outcome] = 0;
  for (const test of run.tests) {
    counts.attempts += test.attempts.length;
    counts[test.outcome] = (counts[test.outcome] ?? 0) + 1;
  }
  return counts;
}

/**
 * The reconciliation rule: product + indeterminate + nonProduct = total, for tests and for
 * attempts. A breach means an outcome was dropped or counted twice.
 *
 * @param {RunObservation} run
 * @returns {string[]} problems, empty when the counts reconcile
 */
export function reconcile(run) {
  /** @type {string[]} */
  const problems = [];
  for (const test of run.tests) {
    if (!OUTCOMES.includes(test.outcome)) problems.push(`unknown outcome ${test.outcome}`);
    for (const attempt of test.attempts) {
      if (!OUTCOMES.includes(attempt.outcome)) problems.push(`unknown outcome ${attempt.outcome}`);
    }
  }
  const byClass = { product: 0, indeterminate: 0, nonProduct: 0 };
  for (const test of run.tests) {
    const cls = OUTCOME_CLASS[test.outcome];
    if (cls !== undefined) byClass[/** @type {keyof typeof byClass} */ (cls)] += 1;
  }
  const total = byClass.product + byClass.indeterminate + byClass.nonProduct;
  if (total !== run.tests.length) {
    problems.push(`class buckets sum to ${String(total)}, expected ${String(run.tests.length)}`);
  }
  return problems;
}
