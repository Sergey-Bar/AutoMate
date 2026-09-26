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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    notConfigured.push(relativePath);
    continue;
  }
  const summaryPath = path.join(root, relativePath, 'coverage', 'coverage-summary.json');
  if (!existsSync(summaryPath)) {
    failures.push(`${relativePath}: missing ${path.relative(root, summaryPath)}`);
    continue;
  }
  const metrics = /** @type {Array<[string, number]>} */ (Object.entries(entry));
  if (metrics.length === 0) {
    failures.push(
      `${relativePath}: baseline entry declares no metric and no status, so it checks nothing`,
    );
    continue;
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')).total;
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

console.log('Coverage ratchet passed');
console.log(`  ratcheted:  ${checked.length} package(s)`);
console.log(`  derived from the workspace: ${workspacePackages.length} package(s) with tests`);
if (notConfigured.length > 0) {
  // Reported, never folded into the pass count: these packages have no
  // measured floor, so "passed" must not imply they were measured.
  console.log(`  not_configured (no measured floor yet): ${notConfigured.length}`);
  for (const name of notConfigured) console.log(`    - ${name}`);
}

// A guard against this script silently degrading again: if the derived set ever
// collapses, say so rather than reporting a vacuous pass.
if (statSync(root).isDirectory() && workspacePackages.length === 0) {
  console.error('Coverage ratchet found no workspace packages; the workspace scan is broken');
  process.exit(1);
}
