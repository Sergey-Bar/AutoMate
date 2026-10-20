/**
 * JUnit XML to the candidate local model (spike S1). Throwaway prototype code.
 *
 * Policy, all proposals:
 *
 * - Outcome precedence inside one `<testcase>`: a failure or error beats a skip, and a skip
 *   beats nothing. A testcase with no outcome child passed, which is the JUnit convention,
 *   but only when its element was closed; a testcase cut off by the end of the file is
 *   `unknown`.
 * - `<flakyFailure>` and `<flakyError>` mean "failed, then passed": the test passed and
 *   needed more than one attempt. `<rerunFailure>` and `<rerunError>` mean "kept failing":
 *   the outcome stays failed and flakiness stays unknown, because failing repeatedly is a
 *   broken test and not a flaky one.
 * - Identical identities with no retry evidence are separate tests, never attempts of one.
 *   A parameterised test whose cases share a display name would otherwise have a failing
 *   case hidden behind a later passing one. The report is flagged `duplicate-identity`.
 * - Counts come from the testcase elements. The counts a report declares are compared and a
 *   mismatch is a warning, never a replacement.
 */
import { observation, rejected } from './model.mjs';
import { normaliseReportPath } from './paths.mjs';
import { parseXml } from './xml.mjs';

/** @typedef {import('./model.mjs').TestResult} TestResult */
/** @typedef {import('./xml.mjs').XmlElement} XmlElement */

export const MAX_MESSAGE_CHARS = 8192;

const FAIL_KINDS = ['failure', 'error'];
const FLAKY_KINDS = ['flakyFailure', 'flakyError'];
const RERUN_KINDS = ['rerunFailure', 'rerunError'];

/**
 * @param {string | undefined} raw seconds, as a report writes them
 * @returns {{ ms: number | null, invalid: boolean }}
 */
function durationOf(raw) {
  if (raw === undefined || raw.trim() === '') return { ms: null, invalid: false };
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return { ms: null, invalid: true };
  return { ms: Math.round(seconds * 1e6) / 1e3, invalid: false };
}

/**
 * @param {XmlElement} element
 * @returns {{ message: string | null, truncated: boolean }}
 */
function messageOf(element) {
  const raw =
    (element.attrs.message ?? '') !== '' ? (element.attrs.message ?? '') : element.text.trim();
  if (raw === '') return { message: null, truncated: false };
  const truncated = element.textTruncated || raw.length > MAX_MESSAGE_CHARS;
  return { message: raw.slice(0, MAX_MESSAGE_CHARS), truncated };
}

/**
 * @param {string} kind
 * @returns {string}
 */
function outcomeOfKind(kind) {
  return kind.endsWith('Error') || kind === 'error' ? 'errored' : 'failed';
}

/**
 * Builds the attempts for one testcase from its children.
 *
 * @param {XmlElement} testcase
 * @param {number | null} durationMs
 * @param {string[]} warnings
 */
function attemptsOf(testcase, durationMs, warnings) {
  const kids = testcase.children;
  const primary = kids.find((kid) => FAIL_KINDS.includes(kid.name));
  const skipped = kids.find((kid) => kid.name === 'skipped');
  const flaky = kids.filter((kid) => FLAKY_KINDS.includes(kid.name));
  const reruns = kids.filter((kid) => RERUN_KINDS.includes(kid.name));
  if (skipped !== undefined && primary !== undefined) warnings.push('skipped-and-failed');

  /** @type {string} */
  let finalOutcome = 'passed';
  if (testcase.incomplete) finalOutcome = 'unknown';
  else if (primary !== undefined) finalOutcome = outcomeOfKind(primary.name);
  else if (skipped !== undefined) finalOutcome = 'skipped';

  /** @type {Array<{ outcome: string, raw: string, element: XmlElement | undefined }>} */
  const sequence = [];
  // A rerun element with no failure beside it is read as the earlier failed attempts of a
  // test that then passed, which is how `packages/reporter` reads it. Beside a failure it is
  // a later attempt of a test that kept failing.
  const rerunOnly = reruns.length > 0 && primary === undefined && skipped === undefined;
  const asAttempt = (/** @type {XmlElement} */ kid) => ({
    outcome: outcomeOfKind(kid.name),
    raw: kid.name,
    element: kid,
  });
  sequence.push(...flaky.map(asAttempt));
  if (rerunOnly) sequence.push(...reruns.map(asAttempt));
  sequence.push({
    outcome: finalOutcome,
    raw: primary?.name ?? skipped?.name ?? (testcase.incomplete ? 'incomplete' : 'pass'),
    element: primary ?? skipped,
  });
  if (!rerunOnly) sequence.push(...reruns.map(asAttempt));

  const attempts = sequence.map((step, position) => {
    const text =
      step.element === undefined ? { message: null, truncated: false } : messageOf(step.element);
    if (text.truncated) warnings.push('message-truncated');
    return {
      index: position + 1,
      outcome: step.outcome,
      rawStatus: step.raw,
      durationMs: position === sequence.length - 1 ? durationMs : null,
      message: text.message,
      messageTruncated: text.truncated,
    };
  });

  // The test's outcome is the last attempt's, except that retry evidence makes it passed.
  const retried = (flaky.length > 0 || rerunOnly) && finalOutcome === 'passed';
  const outcome = finalOutcome;
  const flakiness = retried ? 'observed' : 'unknown';
  return { attempts, outcome, flakiness };
}

/**
 * Walks the tree, returning testcases in document order with their enclosing suite.
 *
 * @param {XmlElement} root
 * @returns {Array<{ testcase: XmlElement, suite: XmlElement | null }>}
 */
function collectTestcases(root) {
  /** @type {Array<{ testcase: XmlElement, suite: XmlElement | null }>} */
  const found = [];
  /**
   * @param {XmlElement} node
   * @param {XmlElement | null} suite
   */
  const visit = (node, suite) => {
    for (const child of node.children) {
      if (child.name === 'testcase') found.push({ testcase: child, suite });
      else visit(child, child.name === 'testsuite' ? child : suite);
    }
  };
  visit(root, root.name === 'testsuite' ? root : null);
  return found;
}

/**
 * Compares the counts a suite declares with the elements it contains.
 *
 * @param {XmlElement} root
 * @returns {boolean} whether any declared count disagrees with the elements
 */
function declaredCountsDisagree(root) {
  /** @type {XmlElement[]} */
  const suites = [];
  /** @param {XmlElement} node */
  const visit = (node) => {
    if (node.name === 'testsuite' || node.name === 'testsuites') suites.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return suites.some((suite) => {
    const cases = collectTestcases(suite);
    const withChild = (/** @type {string} */ kind) =>
      cases.filter(({ testcase }) => testcase.children.some((kid) => kid.name === kind)).length;
    const checks = /** @type {Array<[string, number]>} */ ([
      ['tests', cases.length],
      ['failures', withChild('failure')],
      ['errors', withChild('error')],
      ['skipped', withChild('skipped')],
    ]);
    return checks.some(([attribute, actual]) => {
      const declared = suite.attrs[attribute];
      return declared !== undefined && /^\d+$/.test(declared) && Number(declared) !== actual;
    });
  });
}

/**
 * @param {Uint8Array} bytes
 * @param {{ repoRoot?: string, xml?: Partial<import('./xml.mjs').XmlLimits>, maxTests?: number }} [options]
 * @returns {import('./model.mjs').RunObservation | import('./model.mjs').Rejection}
 */
export function parseJunit(bytes, options = {}) {
  const xml = parseXml(bytes, options.xml);
  if (xml.rejection !== null) return rejected('junit-xml', xml.rejection);
  const { root, malformed, truncated } = xml;
  const warnings = [...xml.warnings];
  if (root.name !== 'testsuites' && root.name !== 'testsuite') {
    return rejected('junit-xml', 'not-junit', warnings);
  }

  const maxTests = options.maxTests ?? 100_000;
  const all = collectTestcases(root);
  const limited = all.length > maxTests;
  if (limited) warnings.push('test-limit-reached');
  if (declaredCountsDisagree(root)) warnings.push('declared-count-mismatch');

  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {TestResult[]} */
  const tests = [];
  for (const { testcase, suite } of all.slice(0, maxTests)) {
    const duration = durationOf(testcase.attrs.time);
    if (duration.invalid) warnings.push('duration-invalid');
    const { attempts, outcome, flakiness } = attemptsOf(testcase, duration.ms, warnings);
    const path = normaliseReportPath(testcase.attrs.file, options.repoRoot);
    if (path.warning !== null) warnings.push(path.warning);
    const name = testcase.attrs.name ?? 'unnamed test';
    const identity = [
      suite?.attrs.name ?? '',
      testcase.attrs.classname ?? '',
      name,
      path.fileRaw ?? '',
    ].join('\u0000');
    seen.set(identity, (seen.get(identity) ?? 0) + 1);
    if ((seen.get(identity) ?? 0) > 1) warnings.push('duplicate-identity');
    tests.push({
      name,
      suite: suite?.attrs.name ?? testcase.attrs.classname ?? null,
      project: null,
      file: path.file,
      fileRaw: path.fileRaw,
      attempts,
      outcome,
      flakiness: /** @type {'observed' | 'unknown'} */ (flakiness),
    });
  }

  const degraded = malformed || truncated || tests.some((test) => test.outcome === 'unknown');
  const completeness = degraded ? 'unknown' : limited ? 'partial' : 'complete';
  return observation({ format: 'junit-xml', completeness, tests, warnings });
}
