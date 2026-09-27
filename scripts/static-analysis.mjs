/**
 * Runs the static-analysis scanners, when they are available.
 *
 * `.semgrep.yml` and `.gitleaks.toml` were committed and never invoked, so both
 * could be wrong indefinitely without anything noticing. This is the only step
 * that actually executes them.
 *
 * Three outcomes, no fourth:
 *   pass            — both scanners ran and reported nothing;
 *   fail            — a scanner ran and found something, or exited non-zero;
 *   not_configured  — a scanner is not installed. Non-zero: an unrun security
 *                     scan is not a pass, and reporting it as one is the exact
 *                     defect this script exists to end.
 *
 * The structural check always runs, because it needs no external tool.
 *
 * The scanners are bounded by a wall-clock ceiling rather than being trusted to
 * return: see `SCAN_TIMEOUT_MS` below for the measurement that made the ceiling
 * necessary.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBounded } from './lib/scan-runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The wall-clock ceiling for one scanner.
 *
 * `gitleaks detect` over this repository's full history takes about 24 s, so the
 * default is generous for it; semgrep is the one that needs watching. Raise it with
 * `AUTOMATE_SCAN_TIMEOUT_MS` if a host is genuinely slower — and record why, because an
 * unbounded budget is the defect this replaced.
 *
 * @type {number}
 */
const SCAN_TIMEOUT_MS = Number(process.env['AUTOMATE_SCAN_TIMEOUT_MS'] ?? 10 * 60 * 1000);

/** @param {string} binary */
function have(binary) {
  // No shell, for the same reason `run` has none: a `shell: true` spawn cannot be
  // bounded reliably on Windows, and `--version` is a probe, not the scan.
  const result = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  return !result.error && result.status === 0;
}

/**
 * Runs one scanner to completion, or kills it at the ceiling and says so.
 *
 * The logic lives in `scripts/lib/scan-runner.mjs` so a test can prove the ceiling
 * works; a timeout that has never been exercised is a timeout that will not be
 * believed. The measurement that made it necessary is in that module's doc comment:
 * `semgrep scan` over one small package produced no output and no exit in 15 minutes,
 * and this gate was killed at 30 and at 50 minutes.
 *
 * @param {string} binary
 * @param {string[]} args
 * @returns {Promise<number>} the exit status, 1 for "did not finish"
 */
async function run(binary, args) {
  const { status } = await runBounded(binary, args, {
    cwd: root,
    timeoutMs: SCAN_TIMEOUT_MS,
    log: (message) => console.error(message),
  });
  return status;
}

// Always: the check that needs no external tool. Spawned without a shell,
// because `process.execPath` contains a space on Windows and `shell: true` would
// split the path.
const structural = spawnSync(
  process.execPath,
  [path.join(root, 'scripts', 'static-analysis-config-check.mjs')],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
if (structural.status !== 0) process.exit(structural.status ?? 1);

const missing = [];
let failed = false;

if (have('semgrep')) {
  /**
   * Every workspace surface, listed one per line.
   *
   * `apps/api/src` alone was the previous scope, so `apps/web`, `apps/runner` and
   * `apps/worker` — the three applications most reachable from a browser or a
   * subprocess — were never examined by the security gate. The scope is written
   * out rather than as a bare `apps/` so that a new workspace package has to be
   * added here, and so a reviewer can see what is and is not covered without
   * reading the ruleset.
   */
  if (
    (await run('semgrep', [
      'scan',
      '--config',
      '.semgrep.yml',
      '--error',
      // Findings are errors for the gate. The rule severities still decide what a
      // human sees in CI.
      '--exclude',
      '**/node_modules',
      '--exclude',
      '**/dist',
      '--exclude',
      '**/coverage',
      // Test files are scanned. A finding in a test is still a finding, and a
      // blanket test exclusion is how a real secret in a fixture goes unnoticed.
      'apps/api/src',
      'apps/web/src',
      'apps/runner/src',
      'apps/worker/src',
      'packages',
      'tools',
      'scripts',
      'e2e',
      'tests',
    ])) !== 0
  ) {
    failed = true;
  }
} else {
  missing.push('semgrep');
}

if (have('gitleaks')) {
  if (
    (await run('gitleaks', ['detect', '--config', '.gitleaks.toml', '--no-banner', '--redact'])) !==
    0
  ) {
    failed = true;
  }
} else {
  missing.push('gitleaks');
}

if (missing.length > 0) {
  console.error(
    `Static analysis: not_configured — missing ${missing.join(' and ')}. ` +
      'Install them, or run this step on a host that has them. The structural ' +
      'config check above did run and passed.',
  );
}

if (failed || missing.length > 0) {
  process.exit(1);
}
console.log('Static analysis passed: semgrep and gitleaks reported nothing.');
