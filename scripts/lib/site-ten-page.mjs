/**
 * The generated body of `site/pages/quality/ten.md`.
 *
 * A separate module from `scripts/build-site-pages.mjs` for one reason, and it is
 * the reason the staleness gate exists at all: **a page whose source is the whole
 * tree cannot be checked by copying the generator and its four data files.**
 *
 * The other three generated pages read a register, a ledger and a baseline, so
 * `docs-paths.test.mjs` can copy those five files into a scratch directory, run the
 * generator there, and compare bytes without touching the checkout. The twelve
 * points read the workflows, the manifest, the package scripts, the migration
 * graph, the route files, the ledger and the register — so a copy of five files
 * cannot reproduce the page, and a check that pretends otherwise either crashes or
 * compares a different thing.
 *
 * The fix is to drop the subprocess and the copy for this one page: the builder is
 * exported, the staleness check imports it, and both sides are computed in this
 * process from the same tree. The property is unchanged and the failure mode is
 * gone — if the tree changes and the committed page is not regenerated, the
 * recomputed body differs from the committed bytes and the check fails. Nothing
 * writes to the checkout, so the check still has the read-only property that
 * `docs.yml` broke the first time round.
 */
import { table } from './markdown-table.mjs';
import { VERDICTS, evaluate, loadContext, tally } from './status-ten.mjs';

/** What each of the three outcomes means, in the words the site uses. */
const OUTCOME_GLOSS = /** @type {Record<string, string>} */ ({
  pass: 'checked, and it held.',
  fail: 'checked, and it did not hold. Named.',
  not_configured: 'not checked, with a printed reason for why and for which parts did run.',
});

/**
 * The generated block, as an array of lines.
 *
 * @param {string} root the repository root
 * @returns {string[]}
 */
export function twelvePage(root) {
  const reports = evaluate(loadContext(root));
  const counts = tally(reports);

  return [
    '',
    'Generated from `pnpm status:10`, which reports the roadmap’s §17 "Definition of',
    'done" as `pass`, `fail` or `not_configured`. `not_configured` is a legitimate',
    'state — not checked, with a printed reason and the command that would check it —',
    'and it is not a pass. Every row names what decides it.',
    '',
    'The definition of done this repository can state honestly is **zero `fail` rows**.',
    '',
    /*
     * The regeneration line, same shape as the other three generated pages.
     *
     * Four pages, four tables, and this one alone did not say how to change a number — so a
     * reader who wanted to correct a verdict had to find the generator before they could find
     * the command that produces it, which is the wrong order. One sentence, four pages, the
     * same words: edit the named source, run the command.
     */
    'The numbers above are derived. To change one, edit the file this page names as',
    'its source, then run `pnpm site:generate`.',
    '',
    ...table(
      ['Point', 'Verdict', 'Why', 'Decided by'],
      reports.map((report) => [
        String(report.number),
        `\`${report.verdict}\``,
        report.reason,
        `\`${report.decidedBy}\``,
      ]),
    ),
    '',
    `**${String(counts.pass)} pass · ${String(counts.fail)} fail · ${String(counts.not_configured)} not_configured**`,
    '',
    ...VERDICTS.map((verdict) => `- \`${verdict}\` — ${OUTCOME_GLOSS[verdict]}`),
  ];
}
