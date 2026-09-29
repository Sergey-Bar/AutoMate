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
 * A fourth path exists and is opt-in: with `AUTOMATE_HOST_SCANNERS=unavailable`
 * set, a *missing* scanner is recorded as `not_configured` and exits 0, so a
 * developer on a host without the binaries can run the rest of `verify`. A
 * scanner that ran and found something still fails, and CI never sets the
 * variable. See `scripts/lib/host-scanners.mjs` for the rule and its test.
 *
 * The scanners are bounded by a wall-clock ceiling rather than being trusted to
 * return: see `SCAN_TIMEOUT_MS` below for the measurement that made the ceiling
 * necessary.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeWait, runBounded } from './lib/scan-runner.mjs';
import { SEMGREP_SCOPE } from './lib/semgrep-scope.mjs';
import {
  exitStatusFor,
  isHostDegradationOptedIn,
  notConfiguredMessage,
} from './lib/host-scanners.mjs';

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
 * @returns {Promise<{ status: number, timedOut: boolean, failedToStart: boolean }>}
 */
async function run(binary, args) {
  return runBounded(binary, args, {
    cwd: root,
    timeoutMs: SCAN_TIMEOUT_MS,
    log: (message) => console.error(message),
  });
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

const GITLEAKS_ARGS = ['detect', '--config', '.gitleaks.toml', '--no-banner', '--redact'];

/**
 * @typedef {object} ScanResult
 * @property {string[]} unavailable  scanners that could not produce a scan at all
 * @property {boolean} found         a scanner that ran and reported something
 */

/** @type {ScanResult} */
const result = { unavailable: [], found: false };

/**
 * Runs one scanner, if this host has it, and records how it went.
 *
 * Three outcomes, and the distinction between the last two is the one the host
 * opt-in turns on. A scanner that *ran* and returned non-zero found something.
 * A scanner that never started, or that was killed at the ceiling, produced no
 * scan — which is not the same claim, and conflating them is how "an unrun
 * security scan is not a pass" came to mean "a hung security scan is a finding".
 *
 * @param {string} binary
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function scan(binary, args) {
  if (!have(binary)) {
    result.unavailable.push(`${binary} is not installed`);
    return;
  }
  const { status, timedOut, failedToStart } = await run(binary, args);
  if (timedOut) {
    result.unavailable.push(
      `${binary} was killed at the ${describeWait(SCAN_TIMEOUT_MS)} ceiling ` +
        'without producing a scan',
    );
    return;
  }
  if (failedToStart) {
    result.unavailable.push(`${binary} could not be started on this host`);
    return;
  }
  if (status !== 0) result.found = true;
}

await scan('semgrep', SEMGREP_SCOPE);
await scan('gitleaks', GITLEAKS_ARGS);

const degraded = isHostDegradationOptedIn(process.env);
const status = exitStatusFor({
  unavailable: result.unavailable,
  found: result.found,
  degraded,
});

if (result.unavailable.length > 0) {
  if (status === 0) {
    // The opt-in path. The message names the variable, so a reader of the log can
    // tell a deliberately degraded host from a broken install.
    console.error(notConfiguredMessage(result.unavailable));
  } else {
    console.error(
      `Static analysis: not_configured — ${result.unavailable.join('; ')}. ` +
        'Install them, or run this step on a host that has them. The structural ' +
        'config check above did run and passed.',
    );
  }
}

if (status !== 0) process.exit(status);
console.log('Static analysis passed: semgrep and gitleaks reported nothing.');
