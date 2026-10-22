#!/usr/bin/env node
/**
 * `pnpm release:bundle` — write `dist/release/automate-<version>.zip` and `SHA256SUMS`.
 *
 * The zip is what a user downloads from the GitHub release: the derived compose file,
 * an `.env.example`, the three start scripts, a quick start and the licence. The version
 * comes from package.json unless `--version` is given. See `scripts/lib/release-bundle.mjs`.
 *
 * Usage: node scripts/release-bundle.mjs [--version 2.5.0] [--out dist/release]
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildBundle } from './lib/release-bundle.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/** @param {string} flag @returns {string | undefined} */
function option(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** @type {{ version: string }} */
const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const version = option('--version') ?? manifest.version;
const out = path.resolve(REPO_ROOT, option('--out') ?? 'dist/release');
const { zipPath, sumsPath } = buildBundle({ root: REPO_ROOT, version, out });
console.log(
  `release:bundle wrote ${path.relative(REPO_ROOT, zipPath)} and ${path.relative(REPO_ROOT, sumsPath)}`,
);
