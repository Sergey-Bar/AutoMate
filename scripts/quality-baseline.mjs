/**
 * `pnpm quality:baseline` — the current status of every quality gate, in one
 * report.
 *
 * The plan's wording is "reproducible, not remembered": a floor nobody can
 * regenerate is a floor that quietly drifts. Every number here is measured now,
 * and the gates that cannot run in this environment are reported as
 * `not_configured` rather than as a pass.
 *
 * Plain JavaScript with no dependencies — every script here is `.mjs` and
 * `.mjs` is not typechecked.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRoot = createRequire(path.join(root, 'package.json'));
/** @type {Array<{gate: string, status: 'pass' | 'fail' | 'not_configured', detail: string}>} */
const rows = [];

/**
 * @param {string} gate
 * @param {'pass' | 'fail' | 'not_configured'} status
 * @param {string} detail
 */
function record(gate, status, detail) {
  rows.push({ gate, status, detail });
}

/** @param {string} command @param {string[]} args */
function run(command, args) {
  return spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: false });
}

/**
 * Node types a spawned process's `stdout` as `string | string[]` depending on
 * the options, so every read goes through here rather than through a cast at
 * each call site.
 *
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join('');
  return String(value);
}

/**
 * The directory of an installed package.
 *
 * Resolved through `createRequire` rather than by guessing `node_modules/<name>`:
 * under pnpm's store layout that path is a symlink to somewhere else, and a
 * hardcoded path is exactly the kind of thing that breaks on the next install.
 *
 * @param {string} name
 * @returns {string}
 */
function packageDirectory(name) {
  return path.dirname(requireFromRoot.resolve(`${name}/package.json`));
}

// ─── tests ──────────────────────────────────────────────────────────────────
// Counted from the root Vitest config, which is the supported way to run the
// whole workspace: `projects` covers apps, packages, the nested connectors
// level, tools and tests.
const testRun = run(process.execPath, [
  path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
  'run',
  '--config',
  'vitest.config.ts',
  '--reporter',
  'json',
  '--outputFile',
  path.join(root, 'var', 'quality-baseline-tests.json'),
]);
const testSummaryPath = path.join(root, 'var', 'quality-baseline-tests.json');
if (existsSync(testSummaryPath)) {
  const summary = JSON.parse(readFileSync(testSummaryPath, 'utf8'));
  record(
    'tests',
    summary.numFailedTests > 0 ? 'fail' : 'pass',
    `${summary.numPassedTests}/${summary.numTotalTests} passed, ${summary.numFailedTests} failed`,
  );
} else {
  const reason =
    testRun.error === undefined && text(testRun.stderr) !== ''
      ? (text(testRun.stderr)
          .split('\n')
          .find((line) => line.includes('Error')) ?? 'vitest did not run')
      : 'vitest produced no report';
  record('tests', 'not_configured', reason);
}

// ─── coverage ───────────────────────────────────────────────────────────────
const baseline = JSON.parse(readFileSync(path.join(root, 'coverage-baseline.json'), 'utf8'));
/**
 * The package with the lowest recorded floor.
 *
 * Returns the name and the number **together**. Taking the name from
 * `entries[0]` and the number from the minimum reported `apps/api` at 10% — the
 * name of one package with the figure of another, which is worse than no figure.
 *
 * @param {Array<[string, {statements?: number, lines?: number}]>} entries
 * @returns {{name: string, value: number}}
 */
function lowestFloor(entries) {
  let name = '';
  let value = Number.POSITIVE_INFINITY;
  for (const [entryName, entry] of entries) {
    const measured = Math.min(entry.statements ?? 0, entry.lines ?? 0);
    if (measured < value) {
      value = measured;
      name = entryName;
    }
  }
  return { name, value: name === '' ? -1 : value };
}

const ratcheted = Object.entries(baseline).filter(
  (entry) => /** @type {{status?: string}} */ (entry[1]).status !== 'not_configured',
);
const unconfigured = Object.entries(baseline).filter(
  (entry) => /** @type {{status?: string}} */ (entry[1]).status === 'not_configured',
);
const lowest = lowestFloor(
  /** @type {Array<[string, {statements?: number, lines?: number}]>} */ (ratcheted),
);
record(
  'coverage',
  'pass',
  `${ratcheted.length} package(s) ratcheted on measured floors, lowest ${lowest.name} at ${lowest.value}%` +
    (unconfigured.length > 0 ? `; ${unconfigured.length} not_configured` : ''),
);
if (unconfigured.length > 0) {
  record(
    'coverage:unconfigured',
    'not_configured',
    unconfigured.map((entry) => /** @type {string} */ (entry[0])).join(', '),
  );
}

// ─── duplication and complexity ─────────────────────────────────────────────
const duplication = run(process.execPath, [
  path.join(packageDirectory('jscpd'), 'run-jscpd.js'),
  '--config',
  '.jscpd.json',
]);
record(
  'duplication',
  duplication.status === 0 ? 'pass' : 'fail',
  duplication.error !== undefined
    ? `jscpd could not be launched: ${text(duplication.error.message)}`
    : duplication.status === 0
      ? 'within the 3% floor'
      : ((text(duplication.stdout) || text(duplication.stderr) || 'jscpd reported a breach')
          .trim()
          .split('\n')
          .filter((line) => line.includes('threshold') || line.includes('duplicates'))
          .slice(0, 1)[0] ?? 'over the 3% floor'),
);

const complexity = spawnSync(
  process.execPath,
  [path.join(root, 'scripts', 'complexity-gate.mjs')],
  {
    cwd: root,
    encoding: 'utf8',
  },
);
record(
  'complexity',
  complexity.status === 0 ? 'pass' : 'fail',
  text(complexity.stdout).trim() || text(complexity.stderr).trim(),
);

// ─── static analysis and secrets ────────────────────────────────────────────
/** @type {Array<[string, string, string[]]>} */
const nodeGates = [
  ['security:config-check', 'static-analysis-config-check.mjs', []],
  ['security:secrets:self-test', 'secret-scan.mjs', ['--self-test']],
  ['security:secrets', 'secret-scan.mjs', []],
  ['unify:preflight', 'unify-preflight.mjs', []],
  ['coverage:ratchet', 'coverage-ratchet.mjs', []],
];

for (const [gate, script, scriptArgs] of nodeGates) {
  const result = run(process.execPath, [path.join(root, 'scripts', script), ...scriptArgs]);
  const output = `${text(result.stdout)}${text(result.stderr)}`.trim();
  // Prefer a line that states a verdict. The earlier "last line" heuristic
  // picked list items and indentation-only lines, so `coverage:ratchet` reported
  // "- tests/integration" as its status.
  const verdict = output
    .split('\n')
    .map((line) => line.trim())
    .find(
      (line) =>
        line !== '' &&
        !line.startsWith('[') &&
        !line.startsWith('-') &&
        !line.startsWith('•') &&
        /passed|failed|fail|breach|threshold|complete|above/i.test(line),
    );
  record(
    gate,
    result.status === 0 ? 'pass' : 'fail',
    verdict ?? (output === '' ? 'no output' : (output.split('\n')[0] ?? '').trim()),
  );
}

// ─── external tools ─────────────────────────────────────────────────────────
// These are reported, never assumed. A scanner that is installed and not run is
// worse than one that is absent, because it reads as covered.
/** @type {Array<[string, string, string[]]>} */
const externalTools = [
  ['security:semgrep', 'semgrep', ['--version']],
  ['security:gitleaks', 'gitleaks', ['version']],
  ['test:performance', 'k6', ['version']],
];

for (const [gate, binary, probeArgs] of externalTools) {
  const probe = spawnSync(binary, probeArgs, { cwd: root, encoding: 'utf8', shell: true });
  if (probe.error !== undefined || probe.status !== 0) {
    record(gate, 'not_configured', `${binary} is not installed`);
  } else {
    record(gate, 'pass', text(probe.stdout).trim().split('\n')[0] ?? 'installed');
  }
}

const containerRuntimes = ['docker', 'podman']
  .filter(
    (runtime) => spawnSync(runtime, ['--version'], { encoding: 'utf8', shell: true }).status === 0,
  )
  .join(', ');
record(
  'oci',
  containerRuntimes === '' ? 'not_configured' : 'pass',
  containerRuntimes === ''
    ? 'no container runtime found; the runner images cannot be built or verified'
    : `runtime available: ${containerRuntimes}`,
);

// ─── report ─────────────────────────────────────────────────────────────────
const width = Math.max(...rows.map((row) => row.gate.length));
console.log('Quality baseline\n');
for (const row of rows) {
  const mark = row.status === 'pass' ? 'pass' : row.status === 'fail' ? 'FAIL' : 'n/c ';
  console.log(`  [${mark}] ${row.gate.padEnd(width)}  ${row.detail}`);
}
const failed = rows.filter((row) => row.status === 'fail');
const notConfigured = rows.filter((row) => row.status === 'not_configured');
console.log(
  `\n${rows.length - failed.length - notConfigured.length} passing, ${failed.length} failing, ` +
    `${notConfigured.length} not_configured.`,
);
console.log('`not_configured` is not a pass: an unrun check is a gap, and the report says which.');

// Non-zero when a gate *fails*. `not_configured` is reported loudly but does not
// fail the report, because on a contributor's laptop the container runtime and
// the external scanners are routinely absent and a permanently red baseline is
// one nobody reads.
process.exit(failed.length > 0 ? 1 : 0);
