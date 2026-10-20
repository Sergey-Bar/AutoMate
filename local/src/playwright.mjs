/**
 * Playwright JSON to the candidate local model (spike S1). Throwaway prototype code.
 *
 * The shape read here (`suites[].specs[].tests[].results[]`, `stats`, `errors`) is taken
 * from `packages/reporter/src/adapters/playwright-json.ts`, which is itself the only
 * description of the format available in this repository. No real Playwright output was
 * produced for the corpus, so conformance with Playwright's own reporter is unverified.
 *
 * Differences from that adapter, each a proposal:
 *
 * - The project name is part of a test's identity. The adapter's `testId` is
 *   `file:title`, so the same spec run in two projects yields two tests with the same
 *   identity, each numbered attempt 1, which the contract's `uniqueAttemptIdentity`
 *   refinement rejects. (Read from the source; not executed here.)
 * - A report with zero tests is a result (`noTests`), not an error.
 * - Run-level `errors` (for example a failed global setup) are kept and turn an otherwise
 *   empty run into `errored`.
 * - `null` entries (a project whose worker died) are kept as a warning and make the report
 *   incomplete, instead of being skipped silently.
 */
import { TextDecoder } from 'node:util';
import { observation, rejected } from './model.mjs';

/** @typedef {import('./model.mjs').TestResult} TestResult */

const MAX_BYTES = 64 * 1024 * 1024;

/** @type {Record<string, string>} */
const RESULT_STATUS = {
  passed: 'passed',
  failed: 'failed',
  timedOut: 'timedOut',
  skipped: 'skipped',
  interrupted: 'aborted',
};

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function listOf(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function textOf(value) {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Maps one Playwright result status, recording the ones it does not know.
 *
 * @param {unknown} status
 * @param {string[]} warnings
 * @returns {string}
 */
function outcomeOf(status, warnings) {
  const mapped = RESULT_STATUS[String(status)];
  if (mapped !== undefined) return mapped;
  warnings.push('unknown-status');
  return 'unknown';
}

/**
 * @param {Record<string, unknown>} test
 * @param {string[]} warnings
 */
function attemptsOf(test, warnings) {
  const results = listOf(test.results).filter(isRecord);
  if (results.length === 0) {
    warnings.push('no-results');
    return [
      {
        index: 1,
        outcome: test.status === 'skipped' ? 'skipped' : 'unknown',
        rawStatus: String(test.status ?? 'unknown'),
        durationMs: null,
        message: null,
        messageTruncated: false,
      },
    ];
  }
  return results.map((result, position) => {
    const error = isRecord(result.error) ? textOf(result.error.message) : undefined;
    return {
      index: position + 1,
      outcome: outcomeOf(result.status, warnings),
      rawStatus: String(result.status ?? 'unknown'),
      durationMs:
        typeof result.duration === 'number' && result.duration >= 0 ? result.duration : null,
      message: error ?? null,
      messageTruncated: false,
    };
  });
}

/**
 * @param {Record<string, unknown>[]} suites
 * @param {string[]} warnings
 * @param {TestResult[]} tests
 * @param {{ file: string, suite: string | null }} inherited
 * @param {Map<string, number>} seen
 */
function walk(suites, warnings, tests, inherited, seen) {
  for (const entry of suites) {
    if (!isRecord(entry)) {
      warnings.push('null-entry');
      continue;
    }
    const isSpec = Array.isArray(entry.tests);
    const file = textOf(entry.file) ?? inherited.file;
    // A node with `tests` is a spec, whose title is the test's name; any other node is a
    // suite, whose title is the group the specs below it belong to.
    const suite = isSpec ? inherited.suite : (textOf(entry.title) ?? inherited.suite);
    walk(listOf(entry.suites), warnings, tests, { file, suite }, seen);
    walk(listOf(entry.specs), warnings, tests, { file, suite }, seen);
    if (!isSpec) continue;
    for (const test of listOf(entry.tests)) {
      if (!isRecord(test)) {
        warnings.push('null-entry');
        continue;
      }
      const attempts = attemptsOf(test, warnings);
      const last = attempts.at(-1);
      const earlierBad = attempts
        .slice(0, -1)
        .some((a) => ['failed', 'timedOut'].includes(a.outcome));
      const flaky = last?.outcome === 'passed' && earlierBad;
      if ((test.status === 'flaky') !== flaky) warnings.push('declared-flaky-mismatch');
      const name = textOf(entry.title) ?? 'unnamed test';
      const project = textOf(test.projectName) ?? null;
      const identity = [file, suite ?? '', name, project ?? ''].join('\u0000');
      seen.set(identity, (seen.get(identity) ?? 0) + 1);
      if ((seen.get(identity) ?? 0) > 1) warnings.push('duplicate-identity');
      tests.push({
        name,
        suite,
        project,
        file: file === '' ? null : file,
        fileRaw: file === '' ? null : file,
        attempts,
        outcome: last?.outcome ?? 'unknown',
        flakiness: flaky ? 'observed' : 'unknown',
      });
    }
  }
}

/**
 * @param {Record<string, unknown>} stats
 * @param {TestResult[]} tests
 * @returns {boolean}
 */
function statsDisagree(stats, tests) {
  const count = (/** @type {(test: TestResult) => boolean} */ predicate) =>
    tests.filter(predicate).length;
  const computed = {
    expected: count((t) => t.outcome === 'passed' && t.flakiness !== 'observed'),
    unexpected: count((t) => t.outcome === 'failed' || t.outcome === 'timedOut'),
    skipped: count((t) => t.outcome === 'skipped'),
    flaky: count((t) => t.flakiness === 'observed'),
  };
  return Object.entries(computed).some(
    ([key, actual]) => typeof stats[key] === 'number' && stats[key] !== actual,
  );
}

/**
 * @param {Uint8Array} bytes
 * @param {{ maxBytes?: number, maxTests?: number }} [options]
 * @returns {import('./model.mjs').RunObservation | import('./model.mjs').Rejection}
 */
export function parsePlaywright(bytes, options = {}) {
  if (bytes.length === 0) return rejected('playwright-json', 'empty-input');
  if (bytes.length > (options.maxBytes ?? MAX_BYTES))
    return rejected('playwright-json', 'too-large');
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes).replace(/^\ufeff/, ''));
  } catch (error) {
    return rejected('playwright-json', error instanceof RangeError ? 'too-deep' : 'not-json');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.suites)) {
    return rejected('playwright-json', 'not-playwright');
  }

  /** @type {string[]} */
  const warnings = [];
  /** @type {TestResult[]} */
  const tests = [];
  walk(parsed.suites, warnings, tests, { file: '', suite: null }, new Map());

  const limit = options.maxTests ?? 100_000;
  const limited = tests.length > limit;
  if (limited) {
    tests.length = limit;
    warnings.push('test-limit-reached');
  }
  const runErrors = listOf(parsed.errors).length;
  if (runErrors > 0) warnings.push('run-level-errors');
  if (isRecord(parsed.stats) && statsDisagree(parsed.stats, tests)) {
    warnings.push('declared-count-mismatch');
  }

  const degraded =
    warnings.includes('null-entry') || tests.some((test) => test.outcome === 'unknown');
  const completeness = degraded ? 'unknown' : limited ? 'partial' : 'complete';
  return observation({ format: 'playwright-json', completeness, tests, warnings, runErrors });
}
