/**
 * `pnpm findings:check` — is the findings ledger still true?
 *
 * Plan §1: "A green run is necessary, not sufficient. `pnpm verify` passing means
 * the gates passed; the defect class missed here is the one no gate covered." §3
 * makes the release criterion machine-checkable by holding the ledger as data and
 * failing when the data has drifted from the tree.
 *
 * Four things fail:
 *
 *  1. A `fixed` row's evidence path no longer exists. The proof was deleted, so the
 *     claim is open again.
 *  2. A status regressed, or a row disappeared, against
 *     `docs/quality/findings-status.json`. Regressions fail; debt does not grow.
 *  3. A blocking-band row is unowned, a debt row has no owner or no removal
 *     condition, a `sweep` row is closed without hand-confirmation, a
 *     `false-positive` row does not say what refuted it, or the ledger is empty.
 *  4. `docs/quality/wave-gates.json` no longer describes this repository — a listed
 *     migration that is gone, a gating row that is not in the ledger, a `blocksWave`
 *     pointing at a wave nothing declares.
 *
 * What this deliberately does **not** do is judge whether a wave landed before its
 * gate did. That is a merge-time question about the ledger, it is already answered for
 * RF-5 twice over (as an open Blocker through `checkLedger`, and as §17's eleventh
 * point through `pnpm status:10`), and putting it here made `pnpm verify` red on a
 * defect nothing but `pnpm migrate:rehearse` against an installation can clear — the
 * `test:render` construction this repository already refuses. It is
 * `checkWaveBlocks` in `scripts/lib/merge-gate.mjs`.
 *
 * `pnpm findings:baseline` rewrites the recorded statuses. It is the only thing
 * that may move a status backwards, and it does so by being run on purpose.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  auditLedger,
  auditWaveGates,
  readLedger,
  readWaveGates,
  repoRoot,
} from './lib/findings-ledger.mjs';

const root = repoRoot();
const LEDGER = 'docs/quality/findings-ledger.json';
const STATUS = 'docs/quality/findings-status.json';
const BANDS_ORDERED = ['Blocker', 'Critical', 'Major', 'Minor', 'Nit'];
const write = process.argv.includes('--write');

/** @returns {Record<string, string> | null} */
function readRecordedStatuses() {
  const file = path.join(root, STATUS);
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || parsed.statuses === undefined) return null;
  return parsed.statuses;
}

const ledger = readLedger(LEDGER);
/** @type {Array<{ id: string, status: string, band: string, owner?: string, refutedBy?: string }>} */
const rows = Array.isArray(/** @type {{ findings?: unknown }} */ (ledger).findings)
  ? /** @type {{ findings: Array<{ id: string, status: string, band: string, owner?: string, refutedBy?: string }> }} */ (
      ledger
    ).findings
  : [];

if (write) {
  /** @type {Record<string, string>} */
  const statuses = {};
  for (const row of rows) {
    if (row && typeof row.id === 'string' && typeof row.status === 'string') {
      statuses[row.id] = row.status;
    }
  }
  writeFileSync(
    path.join(root, STATUS),
    `${JSON.stringify(
      {
        $comment: [
          'The status of every ledger row, as last reviewed. `pnpm findings:check`',
          'compares the ledger against this and fails on a regression or a deletion.',
          'Regenerate with `pnpm findings:baseline` — deliberately, never as a side',
          'effect of a failing check.',
        ],
        reviewedOn: new Date().toISOString().slice(0, 10),
        statuses,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`Findings baseline written: ${Object.keys(statuses).length} row(s)`);
  process.exit(0);
}

const previous = readRecordedStatuses();
if (previous === null) {
  console.error(
    `No ${STATUS}. Run \`pnpm findings:baseline\` to record the reviewed statuses; ` +
      'without it the ratchet half of this check is not running.',
  );
  process.exit(1);
}

const { findings, byBand } = auditLedger(ledger, { root, previous });

// The wave gates are read here rather than inside `auditLedger` because they are a
// second policy document with a second question — a wave against the tree, not a row
// against the rules — and `auditLedger` takes one document and answers about rows.
findings.push(...auditWaveGates(readWaveGates(), ledger, { root }));

if (findings.length > 0) {
  console.error(`Findings ledger check failed (${findings.length} finding(s))`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

const counts = Object.entries(byBand)
  .filter(([, count]) => count > 0)
  .map(([band, count]) => `${band} ${count}`)
  .join(', ');
const fixed = rows.filter((row) => row.status === 'fixed').length;
const debt = rows.filter((row) => row.status === 'debt').length;
const open = rows.filter((row) => row.status === 'open').length;
const refuted = rows.filter((row) => row.status === 'false-positive').length;

console.log('Findings ledger verified');
console.log(`  rows: ${rows.length}  (${counts})`);
console.log(`  open: ${open}  fixed: ${fixed}  debt: ${debt}  refuted: ${refuted}`);
for (const row of rows) {
  if (row.status === 'debt') {
    console.log(`  debt  ${row.id}  owner=${row.owner ?? '(none)'}`);
  }
  // Refutations are listed, not just counted. A count says how many findings were
  // dismissed; the row says which, and `refutedBy` is the only reason a dismissal is
  // allowed — so it is the line a reader needs in order to trust the count.
  if (row.status === 'false-positive') {
    console.log(`  refuted  ${row.id}  refutedBy=${row.refutedBy ?? '(none)'}`);
  }
}

// The job summary, because a per-band count nobody reads is a number in a log.
const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
if (summaryPath) {
  const body = [
    '### Findings ledger',
    '',
    `\`pnpm findings:check\` verified ${rows.length} row(s).`,
    '',
    '| Band | Open |',
    '| --- | --- |',
    ...BANDS_ORDERED.map((band) => `| ${band} | ${countOpen(band)} |`),
    '',
    `Closed with evidence: **${fixed}**. Carried as debt with an owner and a removal ` +
      `condition: **${debt}**. Refuted against the code, each with a \`refutedBy\` ` +
      `pointer: **${refuted}**. Open: **${open}**.`,
    '',
  ].join('\n');
  writeFileSync(summaryPath, body, { flag: 'a' });
}

/** @param {string} band @returns {number} */
function countOpen(band) {
  return rows.filter((row) => row.status === 'open' && row.band === band).length;
}
