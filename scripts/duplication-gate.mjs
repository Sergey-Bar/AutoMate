/**
 * The duplication budget gate.
 *
 * `pnpm duplication` used to be `jscpd --config .jscpd.json` directly, and that
 * command analysed zero files while printing "Found 0 clones" and exiting 0. Every
 * duplication number this repository had reported was 0% because nothing was
 * measured.
 *
 * This wrapper exists because the exit status cannot carry the verdict: jscpd exits
 * 0 both when the tree is clean and when it saw nothing at all, and those two states
 * look identical from outside. So the report's own `statistics.total.sources` is the
 * signal, and an empty analysis is a failure.
 *
 * The decision lives in `scripts/lib/duplication-gate.mjs` with its own tests.
 * Reading it here and here only would make it untestable, which is how the original
 * defect survived: nobody could demonstrate the gate failing without uninstalling
 * jscpd and reading its console output.
 *
 * Run with `--report` to re-record `docs/quality/duplication-baseline.json`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { duplicationVerdict, notConfiguredVerdict, readTotals } from './lib/duplication-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(path.join(root, 'pnpm-workspace.yaml'))) {
  console.error(`Refusing to run: ${root} is not a repository root (no pnpm-workspace.yaml).`);
  process.exit(1);
}

const configPath = path.join(root, '.jscpd.json');
const reportPath = path.join(root, 'var', 'jscpd', 'jscpd-report.json');
const recordPath = path.join(root, 'docs', 'quality', 'duplication-baseline.json');
const record = process.argv.includes('--record');

/** @param {string} binary */
function have(binary) {
  const probe = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return !probe.error && probe.status === 0;
}

if (!have('jscpd')) {
  const verdict = notConfiguredVerdict('jscpd');
  console.error(verdict.message);
  process.exit(1);
}

// The paths are the roots that hold maintained source, mirroring what the preflight
// and complexity gates measure. Passing them on the command line is required: jscpd 5
// takes its targets from argv, not from the config file.
const ROOTS = ['apps', 'packages', 'tools', 'scripts', 'tests', 'e2e'];
const present = ROOTS.filter((name) => existsSync(path.join(root, name)));
const absent = ROOTS.filter((name) => !present.includes(name));
if (absent.length > 0) {
  console.error(
    `Duplication gate: these roots do not exist, so the scan would be partial: ` +
      `${absent.join(', ')}.`,
  );
  process.exit(1);
}

// Delete any previous report before running.
//
// jscpd does not clear its output directory, and a scan that failed — a bad flag, a
// config it rejected — leaves the last run's `jscpd-report.json` in place. Reading
// that is how this gate first reported "0.00%" with a stale report claiming a
// healthy tree: a failed measurement of nothing rendered as a clean measurement.
// The report is evidence of the run that just happened, so the previous one has to
// be gone before the next one starts.
rmSync(path.join(root, 'var', 'jscpd'), { recursive: true, force: true });

const run = spawnSync('jscpd', ['--config', configPath, '--reporters', 'json', ...present], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

// jscpd writes the report to ./var/jscpd and prints its own table. Its stdout is not
// the verdict, so it is only echoed when the report is missing or unreadable.
let report = null;
if (existsSync(reportPath)) {
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (error) {
    console.error(`Duplication gate: could not read ${path.relative(root, reportPath)}`);
    console.error(String(error));
    process.exit(1);
  }
} else {
  console.error(run.stdout ?? '');
  console.error(run.stderr ?? '');
  console.error(
    `Duplication gate: jscpd wrote no report to ${path.relative(root, reportPath)}, so ` +
      'nothing was measured. jscpd rejects its own config on an unknown key, and a ' +
      'config it rejects yields a scan of zero files rather than an error.',
  );
  process.exit(1);
}

// A non-zero exit with no console output is jscpd rejecting its own arguments, which
// it reports as a usage error rather than by scanning. Saying so beats letting the
// report's contents speak for a run that did not happen.
if (run.status !== 0 && (run.stdout ?? '').trim() === '') {
  console.error(`Duplication gate: jscpd exited ${run.status} without scanning anything.`);
  console.error(run.stderr ?? '');
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const threshold = typeof config.threshold === 'number' ? config.threshold : 3;
const totals = readTotals(report);

if (record) {
  mkdirSync(path.dirname(recordPath), { recursive: true });
  // No comment key in the JSON. That is the defect this gate was built to survive:
  // jscpd validates its config strictly and rejected the whole `.jscpd.json` over a
  // `$comment` key, which made it scan zero files and report a clean tree. The
  // rationale lives in `docs/quality/duplication-budget.md` for the same reason.
  writeFileSync(
    recordPath,
    `${JSON.stringify(
      {
        measuredAt: new Date().toISOString().slice(0, 10),
        threshold,
        ...totals,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`Duplication baseline re-recorded: ${totals.percentage.toFixed(2)}%`);
}

const verdict = duplicationVerdict({
  totals,
  threshold,
  exitStatus: run.status,
  stderr: run.stderr ?? '',
});

if (verdict.outcome === 'pass') console.log(verdict.message);
else console.error(verdict.message);
process.exit(verdict.outcome === 'pass' ? 0 : 1);
