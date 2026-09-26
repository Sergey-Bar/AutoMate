/**
 * Production licence check.
 *
 * The workspace list was hand-maintained and had already drifted: it named 18
 * packages and omitted `packages/config`, `apps/worker`, `tests/contract` and
 * `tests/integration`, so a forbidden licence in any of those went unreported.
 * The list is now derived from the workspace, and the gate fails if the
 * derivation ever finds nothing.
 *
 * `--failOn` also includes `UNLICENSED` and `UNKNOWN`. This repository's own
 * packages declare `UNLICENSED`, and a dependency with no detectable licence is
 * not a licence problem to ignore — it is an unknown one.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
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

const forbiddenLicenses = 'GPL-3.0;AGPL-3.0;UNLICENSED;UNKNOWN';

/** @param {string[]} args */
function runPnpm(args) {
  if (process.env['npm_execpath']) {
    return spawnSync(process.execPath, [process.env['npm_execpath'], ...args], {
      stdio: 'inherit',
    });
  }

  if (process.platform === 'win32') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], { stdio: 'inherit' });
  }

  return spawnSync('pnpm', args, { stdio: 'inherit' });
}

console.info(`Checking production licenses for ${workspaces.length} workspace packages`);
console.info(`Forbidden: ${forbiddenLicenses}`);

for (const workspace of workspaces) {
  const result = runPnpm([
    '--dir',
    workspace,
    'exec',
    'license-checker-evergreen',
    '--production',
    '--failOn',
    forbiddenLicenses,
  ]);

  if (result.status !== 0) {
    console.error(`License check failed in ${workspace}`);
    process.exit(result.status ?? 1);
  }
}

console.info(`License check passed for ${workspaces.length} workspace packages`);
