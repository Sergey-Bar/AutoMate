#!/usr/bin/env node
/**
 * review-rules-check.mjs — the ruleset, validated, as a gate.
 *
 * `pnpm review:rules` is a three-line script on purpose. Everything the review needs is
 * in `.github/review-rules/rules.json`, and the property that matters is that it stays
 * loadable: a ruleset with a rule missing a severity, or a category that maps to a
 * reviewer persona who does not exist, produces a report nobody can act on, and the
 * failure would otherwise be discovered by reading the report.
 *
 * `tests/contract/review-ruleset.test.mjs` checks the ruleset in detail, including the
 * two drift directions between it and the emitters. This is the cheap, standalone
 * version for the `verify` chain: it needs no test runner and answers one question — can
 * the reviewer load its policy?
 *
 * **Outcomes, three, and the third is not a pass.**
 *   - valid: every rule is declared properly, exit 0.
 *   - invalid: something is wrong, every problem listed, exit 1.
 *   - absent: no ruleset, exit 1 with a message saying what it is for. Absent is not
 *     "no rules configured", which would be an empty review that reports nothing and
 *     blocks nothing.
 */

import { RULESET_PATH, readRuleset, validateRuleset } from './ruleset.mjs';

const problems = (() => {
  try {
    return validateRuleset(readRuleset());
  } catch (failure) {
    return [failure instanceof Error ? failure.message : String(failure)];
  }
})();

if (problems.length > 0) {
  console.error(`Review ruleset is not loadable (${RULESET_PATH}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nEvery rule the reviewer can emit is declared there, with a severity, a category, ' +
      'a rationale and a fix. A rule that is missing any of them produces a finding the ' +
      'review cannot act on.',
  );
  process.exitCode = 1;
} else {
  const ruleset = readRuleset();
  const blocking = Object.entries(ruleset.severities)
    .filter(([, entry]) => entry.blocksMerge === true)
    .map(([severity]) => severity);
  console.log(
    `Review ruleset valid: ${ruleset.rules.length} rule(s), ${Object.keys(ruleset.categories).length} categor(ies), ` +
      `blocking severities: ${blocking.join(', ')}.`,
  );
}
