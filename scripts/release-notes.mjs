#!/usr/bin/env node
/**
 * `pnpm release:notes --tag v2.5.0 [--out notes.md]` — the GitHub release body, taken
 * from the version's section of `docs/CHANGELOG.md`.
 *
 * Fails when the tag is not `v<semver>`, when `package.json` names a different version
 * (the images and the bundle are stamped from it, so a mismatch would publish one
 * version under another's tag), or when the changelog has no section for the version.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseTag, releaseNotes } from './lib/release-notes.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/** @param {string} flag @returns {string | undefined} */
function option(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

try {
  const tag = option('--tag') ?? process.env['GITHUB_REF_NAME'] ?? '';
  const { version } = parseTag(tag);
  /** @type {{ version: string }} */
  const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const base = version.split('-')[0] ?? version;
  if (manifest.version !== version && manifest.version !== base) {
    throw new Error(
      `tag ${tag} names ${version}, but package.json is ${manifest.version}. Bump package.json ` +
        'in the release PR before tagging.',
    );
  }
  const changelog = readFileSync(path.join(REPO_ROOT, 'docs/CHANGELOG.md'), 'utf8');
  const notes = releaseNotes(changelog, base);
  const out = option('--out');
  if (out !== undefined) writeFileSync(path.resolve(REPO_ROOT, out), notes);
  else process.stdout.write(notes);
} catch (error) {
  console.error(`release:notes: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
