/**
 * Coverage ratchet.
 *
 * The previous version had two ways to check nothing:
 *
 *  1. `baseline[name] ?? {}` — a package tracked by the ratchet but missing
 *     from `coverage-baseline.json` got an empty metric set, so the loop body
 *     never ran and the package passed silently.
 *  2. Both the package list and the baseline were hand-maintained and covered
 *     9 of the 23 workspace packages that have a Vitest config. The other 14
 *     were not checked at all, which is why the ratchet could report "passed"
 *     while most of the tree was unmeasured.
 *
 * Now the package set is derived from the workspace, and the gate fails when it
 * and the baseline disagree in either direction. A package that has tests but
 * no measured coverage is declared `not_configured` — reported, never silently
 * treated as passing.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { staleCoverageFinding, hashInputs } from './lib/coverage-freshness.mjs';
import { collectCoverageInputs } from './write-coverage-provenance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'coverage-baseline.json');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

/** Directories that are never workspace members. */
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.kilo',
  '.turbo',
  'blob-report',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
  'var',
]);

/**
 * Workspace members, derived from the tree rather than from a hand-kept list.
 * A member is any directory holding both a `package.json` and a
 * `vitest.config.ts`, under one of the workspace roots.
 */
const WORKSPACE_ROOTS = ['apps', 'packages', 'tools', 'tests'];

/** @param {string} relativeRoot @returns {string[]} */
function listMemberDirectories(relativeRoot) {
  const base = path.join(root, relativeRoot);
  if (!existsSync(base)) return [];
  const found = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(base, entry.name);
    // `packages/connectors/*` is itself a workspace level, so descend once.
    const nested =
      existsSync(path.join(full, 'package.json')) &&
      existsSync(path.join(full, 'vitest.config.ts'));
    if (nested) found.push(path.relative(root, full).replaceAll('\\', '/'));
    else found.push(...listMemberDirectories(path.relative(root, full).replaceAll('\\', '/')));
  }
  return found;
}

const workspacePackages = WORKSPACE_ROOTS.flatMap(listMemberDirectories).sort();

/**
 * The stamp a package's last coverage run left beside its summary.
 *
 * @param {string} relativePath
 * @returns {{ hash: string, files: Array<{ path: string, hash: string }> } | null}
 */
function readProvenance(relativePath) {
  const stampPath = path.join(root, relativePath, 'coverage', 'provenance.json');
  if (!existsSync(stampPath)) return null;
  try {
    const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
    if (typeof stamp.hash !== 'string' || !Array.isArray(stamp.files)) return null;
    return stamp;
  } catch {
    // A truncated or hand-edited stamp is not evidence of anything.
    return null;
  }
}

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notConfigured = [];
/** @type {string[]} */
const checked = [];

/** The gate fails when either side names something the other does not. */
const missingFromBaseline = workspacePackages.filter((relativePath) => !(relativePath in baseline));
const missingFromWorkspace = Object.keys(baseline).filter(
  (name) => !workspacePackages.includes(name),
);

for (const relativePath of missingFromBaseline) {
  failures.push(
    `${relativePath}: has tests but no entry in coverage-baseline.json. ` +
      `Add {"status":"not_configured"} to declare it, or record its real metrics.`,
  );
}
for (const name of missingFromWorkspace) {
  failures.push(`${name}: coverage-baseline.json names a package the workspace does not contain`);
}

for (const relativePath of workspacePackages) {
  const entry = baseline[relativePath];
  if (entry === undefined) continue;
  if (entry.status === 'not_configured') {
    // `not_configured` is a legitimate outcome — a package with no source to
    // measure genuinely has nothing to ratchet. It is only honest if it says
    // why, so a bare status is a finding rather than a pass.
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      failures.push(
        `${relativePath}: declared not_configured with no reason. Print what is ` +
          'unmeasured and why — an unexplained not_configured is indistinguishable ' +
          'from a skipped gate.',
      );
    } else {
      notConfigured.push(`${relativePath} — ${entry.reason}`);
    }
    continue;
  }
  const summaryPath = path.join(root, relativePath, 'coverage', 'coverage-summary.json');
  // Compare content, not timestamps. A summary is a claim about the code that
  // produced it, and only a content hash can answer that: a file rewritten with
  // identical bytes has a new mtime and the same claim, and a gate that fails on
  // the first while passing on the second is a gate that cries wolf.
  const recorded = readProvenance(relativePath);
  const current = collectCoverageInputs(path.join(root, relativePath));
  const recordedFiles = new Map((recorded?.files ?? []).map((file) => [file.path, file.hash]));
  const changedInputs = current
    .filter((file) => recordedFiles.get(file.path) !== file.hash)
    .map((file) => file.path);
  for (const file of recorded?.files ?? []) {
    if (!current.some((candidate) => candidate.path === file.path)) changedInputs.push(file.path);
  }
  const staleness = staleCoverageFinding({
    relativePath,
    summaryPath: path.relative(root, summaryPath).replaceAll('\\', '/'),
    recordedHash: recorded?.hash ?? null,
    currentHash: current.length === 0 ? null : hashInputs(current),
    changedInputs,
  });
  if (staleness !== null) {
    failures.push(staleness);
    continue;
  }
  const metrics = /** @type {Array<[string, number]>} */ (Object.entries(entry));
  if (metrics.length === 0) {
    failures.push(
      `${relativePath}: baseline entry declares no metric and no status, so it checks nothing`,
    );
    continue;
  }
  // A floor of zero is a gate that cannot fail.
  //
  // Four packages sat at `branches: 0, functions: 0` for months. Nothing could
  // regress those two metrics — not deleting a test, not removing a file
  // entirely — because there was no room below zero to regress into. A floor is
  // a promise that a drop will be caught, and a promise that cannot be broken is
  // not a promise.
  //
  // The honest alternatives are a real floor, or an explicit `not_configured`
  // with a printed reason. Both are recorded; a silent zero is not.
  for (const [metric, minimum] of metrics) {
    if (minimum === 0) {
      failures.push(
        `${relativePath}: ${metric} floor is 0, which no measurement can breach. ` +
          'Record the real value, or declare {"status":"not_configured"} with a reason.',
      );
    }
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')).total;
  // A report of 0/0 is a gate measuring nothing while printing a number. It is
  // the failure mode `vitest.shared.ts` calls out when it explains why `index.ts`
  // is not excluded, and it reaches the ratchet through the other end: a package
  // whose only source is its own test file.
  const measured = summary?.statements?.total ?? 0;
  if (measured === 0) {
    failures.push(
      `${relativePath}: the coverage summary reports 0/0 statements, so it measures ` +
        'nothing. Either the package has no source to cover — in which case declare ' +
        '{"status":"not_configured","reason":"..."} — or the include glob is wrong.',
    );
    continue;
  }
  for (const [metric, minimum] of metrics) {
    const actual = summary[metric]?.pct;
    if (typeof actual !== 'number') {
      failures.push(`${relativePath}: ${metric} is missing from the coverage summary`);
    } else if (actual < minimum) {
      failures.push(`${relativePath}: ${metric} ${actual} < ${minimum}`);
    }
  }
  checked.push(relativePath);
}

if (failures.length > 0) {
  console.error('Coverage ratchet failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

// A guard against this script silently degrading again.
//
// The previous version of this check was `statSync(root).isDirectory() &&
// workspacePackages.length === 0`. `root` is the repository root and was
// resolved from this script's own location, so `statSync(root).isDirectory()`
// was always true — the condition collapsed to the half that mattered, and the
// half that mattered was checked *after* the pass was already printed. A guard
// that runs after the verdict and cannot fail is not a guard.
//
// So: the emptiness check happens before anything is reported, and it is
// strengthened to "no package was actually ratcheted", which is the property a
// reader of the output depends on. `not_configured` for every package is
// technically a pass, and it means the gate measured nothing.
if (workspacePackages.length === 0 || checked.length === 0) {
  console.error(
    'Coverage ratchet measured nothing: ' +
      `${checked.length} package(s) ratcheted out of ${workspacePackages.length} found. ` +
      'A pass that checked no package is not a pass.',
  );
  process.exit(1);
}

console.log('Coverage ratchet passed');
console.log(`  ratcheted:  ${checked.length} package(s)`);
console.log(`  derived from the workspace: ${workspacePackages.length} package(s) with tests`);
if (notConfigured.length > 0) {
  // Reported, never folded into the pass count: these packages have no
  // measured floor, so "passed" must not imply they were measured.
  console.log(`  not_configured (no measured floor yet): ${notConfigured.length}`);
  for (const name of notConfigured) console.log(`    - ${name}`);
}
