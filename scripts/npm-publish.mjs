#!/usr/bin/env node
/**
 * `node scripts/npm-publish.mjs --tag v3.1.0 --pack|--publish`
 *
 * Sets every public workspace package to the tag's version, then builds, tests and packs
 * it (`--pack`) or publishes it (`--publish`). Run by `.github/workflows/npm-publish.yml`;
 * there is no root script for it, because a developer never publishes from a laptop.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseTag } from './lib/release-notes.mjs';
import {
  publicPackages,
  publishArguments,
  publishProblems,
  workspacePackages,
} from './lib/npm-publish.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const tag = args[args.indexOf('--tag') + 1];
const mode = args.includes('--publish') ? 'publish' : args.includes('--pack') ? 'pack' : null;
if (args.indexOf('--tag') === -1 || tag === undefined || mode === null) {
  console.error('usage: node scripts/npm-publish.mjs --tag v<semver> --pack|--publish');
  process.exit(2);
}
const version = parseTag(tag);
const packages = publicPackages(workspacePackages(ROOT));
const problems = packages.flatMap(publishProblems);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
if (packages.length === 0) {
  console.error('No public workspace package: nothing to publish, which is not a pass.');
  process.exit(1);
}

/** @param {string[]} command @param {string} cwd */
const run = (command, cwd) =>
  execFileSync('pnpm', command, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

for (const pkg of packages) {
  const file = path.join(ROOT, pkg.dir, 'package.json');
  const manifest = /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(file, 'utf8')));
  manifest['version'] = version.version;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  const cwd = path.join(ROOT, pkg.dir);
  if (mode === 'pack') {
    // `<name>...` is the package and everything it depends on, devDependencies included,
    // because its tests import them.
    run(['--filter', `${pkg.name}...`, 'build'], ROOT);
    run(['--filter', pkg.name, 'test'], ROOT);
    run(['pack', '--pack-destination', path.join(ROOT, 'dist', 'npm')], cwd);
  } else {
    run(publishArguments(version), cwd);
  }
  console.log(`${mode === 'pack' ? 'Packed' : 'Published'} ${pkg.name}@${version.version}`);
}
