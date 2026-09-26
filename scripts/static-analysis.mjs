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
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} binary */
function have(binary) {
  const result = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return !result.error && result.status === 0;
}

/** @param {string} binary @param {string[]} args */
function run(binary, args) {
  return spawnSync(binary, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
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

/**
 * The trees semgrep scans.
 *
 * The previous list was `apps/api/src packages tools scripts e2e`, which left out
 * `apps/web` (the entire client), `apps/runner`, `apps/worker`, and `tests`. Every
 * one of those holds source, and a scanner whose scope was chosen by listing the
 * first few directories rather than by asking where the code is will keep missing
 * whatever is added next.
 *
 * Derived from what exists rather than hardcoded, so a new top-level workspace
 * directory is scanned by default and an omission has to be deliberate. A path that
 * does not exist is dropped, and the ones that were dropped are printed: silently
 * scanning less than the list says is the failure this is avoiding.
 */
function scanTargets() {
  const candidates = [
    'apps',
    'packages',
    'tools',
    'tests',
    'scripts',
    'e2e',
    'runners',
    'performance',
    'infra',
  ];
  const present = candidates.filter((candidate) => existsSync(path.join(root, candidate)));
  const missing = candidates.filter((candidate) => !present.includes(candidate));
  return { present, missing };
}

const { present: targets, missing: absentTargets } = scanTargets();
if (absentTargets.length > 0) {
  console.info(
    `Static analysis: not present in this checkout, so not scanned: ${absentTargets.join(', ')}.`,
  );
}

const missing = [];
let failed = false;

if (have('semgrep')) {
  const result = run('semgrep', [
    'scan',
    '--config',
    '.semgrep.yml',
    '--error',
    // Findings are errors for the gate. The rule severities still decide what a
    // human sees in CI.
    ...targets,
  ]);
  if (result.status !== 0) failed = true;
} else {
  missing.push('semgrep');
}

if (have('gitleaks')) {
  const result = run('gitleaks', [
    'detect',
    '--config',
    '.gitleaks.toml',
    '--no-banner',
    '--redact',
  ]);
  if (result.status !== 0) failed = true;
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
