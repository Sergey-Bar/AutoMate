import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * The README's version badges are a copy of facts the tree holds elsewhere, and a copy
 * nobody compares drifts: the badges read pnpm 10.30.2 and TypeScript 5.9 for months
 * over a tree pinned to pnpm 11.28.4 and TypeScript 6. Each badge is now read and
 * compared with its source.
 */

const ROOT = path.resolve(import.meta.dirname, '..', '..');
/** @param {string} relative */
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

/**
 * The `major` or `major.minor` a badge names, by its label, or null when absent.
 *
 * @param {string} readme @param {string} label @returns {string | null}
 */
export function badgeVersion(readme, label) {
  const match = new RegExp(`img\\.shields\\.io/badge/${label}-v?(\\d+(?:\\.\\d+)*)`, 'i').exec(
    readme,
  );
  return match?.[1] ?? null;
}

/**
 * Whether `stated` is a prefix of `actual`, component by component.
 *
 * @param {string} stated @param {string} actual @returns {boolean}
 */
export function agrees(stated, actual) {
  const a = actual.replace(/^[\^~>=<\s]+/, '').split(/[.\s]/);
  return stated.split('.').every((part, index) => a[index] === part);
}

function facts() {
  const manifest = JSON.parse(read('package.json'));
  const catalog = read('pnpm-workspace.yaml');
  const typescript = /^\s+typescript:\s*(\S+)/m.exec(catalog)?.[1] ?? '';
  return {
    pnpm: String(manifest.packageManager ?? '').replace(/^pnpm@/, ''),
    'Node.js': read('.nvmrc').trim().replace(/^v/, ''),
    TypeScript: typescript,
  };
}

test('every version badge in the README agrees with the file that owns the version', () => {
  const readme = read('README.md');
  /** @type {string[]} */
  const problems = [];
  for (const [label, actual] of Object.entries(facts())) {
    const stated = badgeVersion(readme, label.replace('.', '\\.'));
    if (stated === null) continue;
    if (!agrees(stated, actual))
      problems.push(`${label} badge says ${stated}; the tree says ${actual}`);
  }
  assert.deepEqual(problems, []);
});

test('the comparison can fail', () => {
  const stale = '![x](https://img.shields.io/badge/pnpm-10.30.2-F69220)';
  assert.equal(badgeVersion(stale, 'pnpm'), '10.30.2');
  assert.equal(agrees('10.30.2', '11.28.4'), false);
  assert.equal(agrees('11', '11.28.4'), true);
  assert.equal(agrees('6.0', '^6.0.3'), true);
});
