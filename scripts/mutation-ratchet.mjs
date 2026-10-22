/**
 * Mutation ratchet. Tier: nightly (it needs the reports `pnpm mutation` writes).
 *
 *   node scripts/mutation-ratchet.mjs            compare reports with the baseline
 *   node scripts/mutation-ratchet.mjs --record   record new packages / raise floors
 *
 * The semantics live in `scripts/lib/mutation-ratchet.mjs`; this file owns the
 * filesystem and git. Fails closed: a missing or unreadable baseline, a missing report
 * and a lowered recorded floor are all exit 1. `--record` is the only way a package
 * enters the baseline, and it can raise a floor but never lower one.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultBaseRef, readFileAtRef } from './lib/coverage-floor-ratchet.mjs';
import {
  MUTATION_PACKAGES,
  MUTATION_TARGET,
  evaluateMutation,
  loweredMutationFloors,
  mutationScore,
  parseMutationBaseline,
  recordScores,
} from './lib/mutation-ratchet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = 'docs/quality/mutation-baseline.json';
const baselinePath = path.join(root, BASELINE_FILE);
const record = process.argv.includes('--record');

/** @param {string[]} lines @param {string} heading */
function fail(heading, lines) {
  console.error(heading);
  for (const line of lines) console.error(`- ${line}`);
  process.exit(1);
}

/** @type {Record<string, import('./lib/mutation-ratchet.mjs').MutationEntry & { score: number }>} */
const measuredDetail = {};
/** @type {Record<string, number | undefined>} */
const measured = {};
/** @type {string[]} */
const unreadable = [];
for (const name of MUTATION_PACKAGES) {
  const reportPath = path.join(root, name, 'reports', 'mutation', 'mutation.json');
  if (!existsSync(reportPath)) continue;
  try {
    const result = mutationScore(JSON.parse(readFileSync(reportPath, 'utf8')));
    measured[name] = result.score;
    measuredDetail[name] = { ...result, measuredOn: '' };
  } catch (failure) {
    unreadable.push(`${name}: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
}

const source = existsSync(baselinePath) ? readFileSync(baselinePath, 'utf8') : null;
const parsed = parseMutationBaseline(source);

if (record) {
  if (unreadable.length > 0) fail('Mutation ratchet could not record', unreadable);
  if (Object.keys(measured).length === 0) {
    fail('Mutation ratchet could not record', ['no report found; run `pnpm mutation` first']);
  }
  // Recording starts from the existing baseline if it is readable; only an absent file
  // may start empty - a corrupt one must be repaired by a human, not overwritten.
  if (!parsed.ok && source !== null && source.trim() !== '' && !source.includes('"packages"')) {
    fail('Mutation ratchet refuses to overwrite an unreadable baseline', [parsed.reason]);
  }
  const start = parsed.ok
    ? parsed.baseline
    : { target: MUTATION_TARGET, packages: /** @type {Record<string, never>} */ ({}) };
  const next = recordScores(start, measured, new Date().toISOString().slice(0, 10));
  for (const [name, entry] of Object.entries(next.packages)) {
    const detail = measuredDetail[name];
    if (detail !== undefined && entry.score === detail.score) {
      const { killed, timeout, survived, noCoverage } = detail;
      Object.assign(entry, { killed, timeout, survived, noCoverage });
    }
  }
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Recorded ${BASELINE_FILE}`);
  for (const [name, entry] of Object.entries(next.packages)) {
    console.log(`  ${name}: ${String(entry.score)}`);
  }
  process.exit(0);
}

if (!parsed.ok) fail('Mutation ratchet failed closed', [parsed.reason]);
const baseline = parsed.ok ? parsed.baseline : /** @type {never} */ (null);

const failures = [
  ...unreadable,
  ...evaluateMutation({ baseline, measured, expectedPackages: MUTATION_PACKAGES }),
];

const base = defaultBaseRef(root);
const baseSource = base.ref === null ? null : readFileAtRef(root, base.ref, BASELINE_FILE);
const baseParsed = baseSource === null ? null : parseMutationBaseline(baseSource);
if (baseParsed !== null && !baseParsed.ok) {
  failures.push(`the baseline at ${base.ref} is unreadable: ${baseParsed.reason}`);
}
failures.push(...loweredMutationFloors(baseParsed?.ok ? baseParsed.baseline : null, baseline));

writeSummary(failures);
if (failures.length > 0) fail('Mutation ratchet failed', failures);

console.log('Mutation ratchet passed');
for (const name of MUTATION_PACKAGES) {
  console.log(
    `  ${name}: ${String(measured[name])} (floor ${String(baseline.packages[name]?.score)})`,
  );
}
console.log(
  baseParsed?.ok
    ? `  floors: compared against ${base.ref}, none weakened`
    : '  note: no base baseline to compare floors against, so the floor comparison did not run',
);

/** @param {string[]} failureList */
function writeSummary(failureList) {
  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (!summaryPath) return;
  const lines = [
    '### Mutation ratchet',
    '',
    `\`pnpm mutation:ratchet\` **${failureList.length === 0 ? 'passed' : 'failed'}**.`,
    '',
    '| Package | Floor | Measured | Target |',
    '| --- | --- | --- | --- |',
    ...MUTATION_PACKAGES.map(
      (name) =>
        `| \`${name}\` | ${String(baseline.packages[name]?.score ?? '-')} | ${String(measured[name] ?? 'not measured')} | ${String(baseline.target)} |`,
    ),
  ];
  if (failureList.length > 0)
    lines.push('', '#### Failures', '', ...failureList.map((f) => `- ${f}`));
  lines.push('');
  writeFileSync(summaryPath, lines.join('\n'), { flag: 'a' });
}
