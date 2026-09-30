#!/usr/bin/env node
/**
 * `pnpm review:pr --base main` — the merge gate, run against a diff.
 *
 * §17 calls it `pnpm review --base main`. The script is called `review:pr` so it sits
 * beside `review:rules`, which validates the reviewer's vocabulary; two root scripts
 * called `review` and `review:rules` would be a naming pair where neither name says
 * which is which, and `pnpm review` is also a plausible name for a person's review
 * notes. The check is the same one either way.
 *
 * Read-only: it reads git, the policy file and the ledger, and prints. It runs no gate
 * and writes nothing, because a reviewer runs it while reading a diff, and a command
 * that modifies the tree while somebody is reading it is a command that eventually
 * does.
 *
 * **Exit codes, three values and one of them is a pass.**
 *   - 0: every check passed, or the only non-passes are `not_configured` with a
 *     printed reason. A developer laptop that cannot resolve the base is not a
 *     failing pull request, and treating it as one is how a gate gets ignored.
 *   - 1: at least one check failed. Every failure is named, in one run.
 *   - 2: the gate could not be run at all — no policy file, no git. Distinct from 1
 *     because "your branch fails" and "I could not look" are different messages and
 *     a caller that conflates them will retry the wrong thing.
 */
import { runMergeGate, ROOT } from '../lib/merge-gate.mjs';

/** @param {string[]} argv */
function parseArguments(argv) {
  const base = argv
    .map((argument, index) => (argument === '--base' ? (argv[index + 1] ?? '') : argument))
    .find((argument) => argument.startsWith('--base='))
    ?.replace('--base=', '');
  return { base: base ?? 'main' };
}

let outcome = 'pass';
try {
  const { base } = parseArguments(process.argv.slice(2));
  const gate = runMergeGate({ base, root: ROOT });
  outcome = gate.outcome;

  console.log(`Merge gate against \`${base}\`: ${gate.outcome}`);
  console.log('');
  for (const check of gate.checks) {
    console.log(`  ${check.outcome.padEnd(15)} ${check.what}`);
    for (const problem of check.problems) console.log(`  ${' '.repeat(15)} - ${problem}`);
    if (check.note !== '') console.log(`  ${' '.repeat(15)} ${check.note}`);
  }
  console.log('');
  if (outcome === 'fail') {
    console.log(
      'A failing check is not a verdict on the code. This gate reads the *shape* of a change:',
    );
    console.log('its name, its messages, its size, whether a test came with it, and whether the');
    console.log(
      'ledger is clear. `pnpm verify` reads the code, and `pnpm review:rules` checks that the',
    );
    console.log("reviewer's rules are loadable.");
  } else if (outcome === 'not_configured') {
    console.log(
      'Nothing failed; something could not be checked. The reason is printed above, and it',
    );
    console.log('names the state rather than passing it.');
  } else {
    console.log('Every check that could run, ran and held.');
  }
  console.log('');
  console.log('The severity, category and fix for anything the *reviewer* finds are declared in');
  console.log('.github/review-rules/rules.json. The branch grammar, the commit grammar, the line');
  console.log('budget and the test requirement are in .github/review-rules/merge-gate.json, which');
  console.log('this script reads rather than restating.');
} catch (failure) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exit(2);
}

if (outcome === 'fail') process.exit(1);
