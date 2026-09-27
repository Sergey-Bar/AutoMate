/**
 * Production licence check.
 *
 * The workspace list was hand-maintained and had already drifted: it named 18
 * packages and omitted `packages/config`, `apps/worker`, `tests/contract` and
 * `tests/integration`, so a forbidden licence in any of those went unreported.
 * The list is now derived from the workspace, and the gate fails if the
 * derivation ever finds nothing.
 *
 * The deny list still includes `UNLICENSED` and `UNKNOWN`, because a dependency
 * with no detectable licence is not a licence problem to ignore — it is an
 * unknown one. What the deny list must not do is apply to this repository's own
 * packages, which declare `UNLICENSED` by design: pnpm links them into every
 * other package's graph, so `license-checker` reports all of them, and
 * `--failOn UNLICENSED` then failed on the first workspace it looked at. The
 * gate could not pass for any tree, which is the same failure mode as a gate
 * that passes vacuously — it taught a reviewer nothing.
 *
 * So the check is evaluated here instead of delegated to `--failOn`: the
 * tool's JSON is read, this repository's own package names are subtracted, and
 * what remains is tested against the deny list. A third-party dependency with no
 * detectable licence still fails the gate.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
    const relative = path.relative(root, full).replaceAll('\\', '/');
    if (existsSync(path.join(full, 'package.json'))) found.push(relative);
    // `packages/connectors/*` is itself a workspace level, so descend too.
    found.push(...listMemberDirectories(relative));
  }
  return found;
}

const workspaces = WORKSPACE_ROOTS.flatMap(listMemberDirectories).sort();

if (workspaces.length === 0) {
  console.error('License check found no workspace packages; the workspace scan is broken');
  process.exit(1);
}

const FORBIDDEN_LICENSES = new Set(['GPL-3.0', 'AGPL-3.0', 'UNLICENSED', 'UNKNOWN']);

/**
 * This repository's own package names, so their declared licence is a fact
 * rather than a finding. Includes the root package: `pnpm exec` from a member
 * still reports it through the workspace link.
 * @returns {Set<string>}
 */
function ownPackageNames() {
  const names = new Set();
  for (const relative of ['', ...workspaces]) {
    const manifest = path.join(root, relative, 'package.json');
    if (!existsSync(manifest)) continue;
    const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
    if (typeof name === 'string') names.add(name);
  }
  return names;
}

const ownNames = ownPackageNames();

if (ownNames.size === 0) {
  console.error('License check found no package names; the workspace scan is broken');
  process.exit(1);
}

/**
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string }}
 */
function runPnpmCapture(args) {
  const result =
    process.env['npm_execpath'] === undefined
      ? spawnSync('pnpm', args, { encoding: 'utf8', shell: process.platform === 'win32' })
      : spawnSync(process.execPath, [process.env['npm_execpath'], ...args], { encoding: 'utf8' });

  if (result.error) {
    console.error(`License check could not run license-checker: ${result.error.message}`);
    process.exit(1);
  }

  return { status: result.status, stdout: result.stdout ?? '' };
}

/** @param {string} stdout @returns {Record<string, { name?: string, licenses?: string }>} */
function parseReport(stdout) {
  const start = stdout.indexOf('{');
  if (start === -1) {
    console.error('License check got no report from license-checker; refusing to pass');
    process.exit(1);
  }
  try {
    return JSON.parse(stdout.slice(start));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`License check could not parse the license-checker report: ${reason}`);
    process.exit(1);
  }
}

console.info(`Checking production licenses for ${workspaces.length} workspace packages`);
console.info(`Forbidden: ${[...FORBIDDEN_LICENSES].join(', ')}`);

for (const workspace of workspaces) {
  const { status, stdout } = runPnpmCapture([
    '--dir',
    workspace,
    'exec',
    'license-checker-evergreen',
    '--production',
    '--json',
  ]);

  if (status !== 0) {
    console.error(`License check could not run in ${workspace}`);
    process.exit(status ?? 1);
  }

  const violations = [];
  for (const [identifier, entry] of Object.entries(parseReport(stdout))) {
    const name = entry.name ?? identifier.replace(/@[^@]*$/, '');
    if (ownNames.has(name)) continue;
    for (const license of entry.licenses?.split(/\s+OR\s+|\s+AND\s+|\s+/).filter(Boolean) ?? []) {
      if (FORBIDDEN_LICENSES.has(license)) violations.push(`${name}: ${license}`);
    }
  }

  if (violations.length > 0) {
    console.error(`License check failed in ${workspace}`);
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
  }
}

console.info(`License check passed for ${workspaces.length} workspace packages`);
