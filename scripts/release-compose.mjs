#!/usr/bin/env node
/**
 * `pnpm release:compose` — write the release compose file and its `.env.example`.
 *
 * Reads `infra/compose/docker-compose.unified.yml`, replaces every `build:` with the
 * published `ghcr.io/sergey-bar/automate-<service>` image at this package's version, and
 * writes `dist/release/compose.yml` and `dist/release/.env.example`. See
 * `scripts/lib/release-compose.mjs` for why the release file is derived, not written.
 *
 * Usage: node scripts/release-compose.mjs [--version 2.5.0] [--out dist/release]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { envExample, releaseCompose } from './lib/release-compose.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/** @param {string} flag @returns {string | undefined} */
function option(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** @type {{ version: string }} */
const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const version = option('--version') ?? manifest.version;
const outDirectory = path.resolve(REPO_ROOT, option('--out') ?? 'dist/release');
const source = readFileSync(
  path.join(REPO_ROOT, 'infra/compose/docker-compose.unified.yml'),
  'utf8',
);
const header = [
  `# Automate ${version} — generated from infra/compose/docker-compose.unified.yml by`,
  '# `pnpm release:compose`. Do not edit: change the source file instead.',
  '',
].join('\n');
const compose = `${header}${releaseCompose(source, version)}`;

mkdirSync(outDirectory, { recursive: true });
writeFileSync(path.join(outDirectory, 'compose.yml'), compose);
writeFileSync(path.join(outDirectory, '.env.example'), envExample(compose));
console.log(`release:compose wrote ${path.relative(REPO_ROOT, outDirectory)} for ${version}`);
