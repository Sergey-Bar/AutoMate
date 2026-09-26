/**
 * One definition of "this test is not really running", shared by the ESLint
 * rule and the preflight script so the two can never disagree.
 *
 * The previous rule matched only `MemberExpression[property.name="skip"]` and
 * `"only"`, which missed every mocha/vitest spelling that is not a member call:
 * `xdescribe`, `xit`, `test.todo`, `test.skipIf`, `test.runIf`, `test.fails`,
 * and the bare `describe.only` variants. Each of those is a way to commit a test
 * that never runs, and each was invisible to the gate that exists to stop that.
 *
 * Kept as plain JavaScript with no dependencies, because `unify-preflight.mjs`
 * imports it and every script in this repository is `.mjs` (and therefore
 * untypechecked — see Q0.18.16).
 */

/** Property names that gate a test on an expression rather than always running it. */
export const CONDITIONAL_SKIP_PROPERTIES = ['skipIf', 'runIf'];

/** Bare (non-member) mocha identifiers that disable a test or suite. */
export const DISABLED_TEST_IDENTIFIERS = [
  'xdescribe',
  'xcontext',
  'xsuite',
  'xit',
  'xspecify',
  'xtest',
];

/** Member names that restrict a suite or test to a single case. */
export const FOCUSED_TEST_PROPERTIES = ['only'];

/** Member names that disable a test or suite. */
export const SKIPPED_TEST_PROPERTIES = ['skip', 'todo'];

/** `test.fails` documents a known failure, which is also not a passing test. */
export const DOCUMENTED_FAILURE_PROPERTIES = ['fails'];

export const SKIPPED_TEST_IDENTIFIER_SET = new Set(DISABLED_TEST_IDENTIFIERS);

export const SKIPPED_TEST_PROPERTY_SET = new Set([
  ...SKIPPED_TEST_PROPERTIES,
  ...CONDITIONAL_SKIP_PROPERTIES,
  ...DOCUMENTED_FAILURE_PROPERTIES,
]);

export const FOCUSED_TEST_PROPERTY_SET = new Set(FOCUSED_TEST_PROPERTIES);

const DISABLED_IDENTIFIER_CALL = new RegExp(
  `^\\s*(?:await\\s+)?(?:${[...SKIPPED_TEST_IDENTIFIER_SET].join('|')})\\s*[.(]`,
);

const DISABLED_MEMBER_CALL = new RegExp(
  `^\\s*(?:await\\s+)?[\\w$.]*\\.(?:${[...SKIPPED_TEST_PROPERTY_SET, ...FOCUSED_TEST_PROPERTY_SET].join('|')})\\s*\\(`,
);

/** True for a source line that disables, documents, or focuses a test. */
/** @param {string} line */
export function lineDisablesATest(line) {
  return DISABLED_IDENTIFIER_CALL.test(line) || DISABLED_MEMBER_CALL.test(line);
}

/**
 * Every disabled, focused, or documented-failure call in a source file, as
 * `line: text` pairs. A line is reported once even if it matches several rules.
 */
/** @param {string} source @returns {string[]} */
export function findDisabledTests(source) {
  const found = new Set();
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (lineDisablesATest(line)) found.add(`${index + 1}: ${line.trim()}`);
  }
  return [...found];
}
