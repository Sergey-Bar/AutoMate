/**
 * Which phase the rendering gate is in, and therefore what it is allowed to be.
 *
 * A performance gate with no baseline has two honest states, and confusing them is
 * worse than having neither:
 *
 *  - **measurement** — there is no ceiling yet. The job measures the four primary
 *    routes and reports the numbers. It does not compare, because there is nothing to
 *    compare against. Tier `pr-reporting`: it runs on every PR and reports, and it
 *    does not block.
 *  - **threshold** — a real run on reference hardware has been recorded. The same
 *    spec compares against those ceilings and fails on a regression. Tier
 *    `pr-blocking`: it is a required check.
 *
 * **Why the tier is derived rather than chosen.** The version this replaces shipped
 * `test:render` as `pr-blocking` with `recorded: false`, which is a required check
 * that can never pass. That is the single most reliable way to make a team stop
 * reading CI: every PR is red for a reason nobody can fix without hardware, so the
 * red is noise, so the real reds go unread too. It also blocks *all* work, not just
 * rendering work, which is the part that makes it indefensible rather than merely
 * annoying.
 *
 * The alternative — leave it red and call that integrity — trades a cosmetic problem
 * for a behavioural one. The repository's own rule is that a gate must not *silently*
 * pass, and the two phases keep that: in `measurement` the job reports numbers and
 * says in plain text that no threshold exists, which is a different statement from
 * "the numbers were within budget", and the spec cannot report the latter because it
 * never compares. The moment `recorded` becomes `true`, this module demands the tier
 * be `pr-blocking` and `gate-tooling.test.mjs` fails until it is — so graduating the
 * gate is a checked transition rather than a comment somebody remembers.
 *
 * That last rule is the important one. It closes the hole in the two-phase design: it
 * is possible to write `recorded: true` next to invented numbers, and without this
 * check the gate would then be permanently green *and* non-blocking. Here that is a
 * failing test with both numbers in the message.
 *
 * What this does **not** do is decide when to graduate. Populating the ceilings needs
 * a real run on the reference hardware the plan's D10 commits to, which is a human
 * decision (PERF-1 in the ledger). This module only makes the consequence of taking it
 * — or of not taking it — impossible to leave implicit.
 */

/** The two phases, and the tier each one is allowed to be. */
export const PHASES = {
  measurement: 'pr-reporting',
  threshold: 'pr-blocking',
};

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The phase implied by a rendering-budget baseline.
 *
 * `recorded` is the whole signal, and the budget file is written by
 * `pnpm render:baseline` — deliberately, by hand — so it is the one place that knows
 * whether a real run has ever happened. Anything other than a literal `true` is
 * `measurement`: a string, a missing key, or a `0` all mean nobody has measured.
 *
 * @param {unknown} baseline parsed `performance/rendering-budget.json`
 * @returns {'measurement' | 'threshold'}
 */
export function phaseFor(baseline) {
  if (!isRecord(baseline)) return 'measurement';
  return baseline['recorded'] === true ? 'threshold' : 'measurement';
}

/**
 * Every way a declared tier disagrees with the baseline, as findings.
 *
 * @param {unknown} baseline parsed `performance/rendering-budget.json`
 * @param {string} tier the tier `scripts/gate-tooling.json` gives `test:render`
 * @returns {string[]}
 */
export function tierProblems(baseline, tier) {
  const phase = phaseFor(baseline);
  const required = PHASES[phase];

  if (tier === required) return [];

  if (phase === 'measurement') {
    return [
      '`test:render` is tiered `pr-blocking` while performance/rendering-budget.json ' +
        'has no recorded measurement, so the required check can never pass. A required ' +
        'check that is permanently red blocks every pull request, trains reviewers to ' +
        'ignore red, and hides the failures that matter. Until a real run on reference ' +
        'hardware records the ceilings (PERF-1), the job measures and reports, and the ' +
        'tier is `pr-reporting`.',
    ];
  }

  return [
    'performance/rendering-budget.json records `recorded: true`, so the rendering ' +
      'budget is a real gate and `test:render` must be tiered `pr-blocking`. Leaving ' +
      'it below that is a gate nobody is required to satisfy, which is worse than the ' +
      'two-phase rollout it replaced: the comparison is real, and nothing enforces it.',
  ];
}
