import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCoverageProvenance } from './write-coverage-provenance.mjs';

/**
 * Writes a coverage provenance stamp for every workspace package that has a
 * coverage summary.
 *
 * The ratchet refuses to read a summary that nothing records the provenance of —
 * "produced by different code" is then a claim it cannot check. But a stamp is
 * only useful if something writes one, and there was no command that did: coverage
 * was run per package by hand, so the gate reported every summary as
 * unattributable and could not pass. This is that missing step.
 *
 * Run after a coverage sweep, with no source changes in between: the stamp
 * records a hash of the inputs, and the ratchet compares that hash against the
 * inputs as they are now.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WORKSPACE_ROOTS = ['apps', 'packages', 'tools', 'tests'];
const IGNORED = new Set([
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
 * @param {string} relativeRoot
 * @returns {string[]}
 */
function members(relativeRoot) {
  const base = path.join(root, relativeRoot);
  const stats = statSync(base, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) return [];
  const found = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const full = path.join(base, entry.name);
    // A package is recognised by its manifest, **before** the directory test.
    // Testing `isDirectory()` first recursed into every package's `src/` and
    // never emitted the package at all, so the scan found nothing.
    if (existsSync(path.join(full, 'package.json'))) {
      found.push(path.relative(root, full).replaceAll('\\', '/'));
      continue;
    }
    if (entry.isDirectory()) {
      found.push(...members(path.relative(root, full).replaceAll('\\', '/')));
    }
  }
  return found;
}

const stamped = [];
const withoutSummary = [];
for (const relativePath of [...WORKSPACE_ROOTS.flatMap(members)].sort()) {
  const summary = path.join(root, relativePath, 'coverage', 'coverage-summary.json');
  if (!existsSync(summary)) {
    withoutSummary.push(relativePath);
    continue;
  }
  writeCoverageProvenance(path.join(root, relativePath));
  stamped.push(relativePath);
}

console.log(`Coverage provenance stamped for ${stamped.length} package(s).`);
for (const name of stamped) console.log(`  ${name}`);
if (withoutSummary.length > 0) {
  // Not an error: a package with no summary has nothing to attribute, which is a
  // different situation from a summary with no provenance beside it.
  console.log(
    `No coverage summary, so no stamp: ${withoutSummary.length} package(s) ` +
      `(${withoutSummary.join(', ')}).`,
  );
}
