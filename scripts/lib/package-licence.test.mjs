import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * One licence, and it is the root `LICENSE`'s.
 *
 * The root `LICENSE` is MIT and every package that declared a licence said
 * `"UNLICENSED"`, which is npm's word for proprietary. A reader of the tarball reads
 * the package's field, not the repository's file, so an open-source repository whose
 * packages say otherwise is not open source to anyone who installs it. The licence is
 * read from the file rather than written here, so changing it is one edit and this test
 * follows.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** @returns {string} the SPDX id the root `LICENSE` states. */
function rootLicence() {
  const text = readFileSync(path.join(REPO_ROOT, 'LICENSE'), 'utf8');
  if (/^MIT License\b/u.test(text.trimStart())) return 'MIT';
  if (/Apache License\s+Version 2\.0/u.test(text)) return 'Apache-2.0';
  throw new Error('The root LICENSE is not one this test recognises; teach it the new one.');
}

/** @returns {string[]} every tracked package.json, root-relative. */
function packageFiles() {
  return (
    execFileSync('git', ['ls-files', '--', 'package.json', '**/package.json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.includes('node_modules/'))
      // The semgrep probe tree is a fixture for a scanner, not a package of this product.
      .filter((line) => !line.startsWith('.config/'))
  );
}

/**
 * @param {string[]} files
 * @param {string} expected
 * @param {(file: string) => string} read
 * @returns {string[]} one line per package whose licence is not the expected one.
 */
export function licenceProblems(files, expected, read) {
  /** @type {string[]} */
  const problems = [];
  for (const file of files) {
    const parsed = /** @type {Record<string, unknown>} */ (JSON.parse(read(file)));
    const declared = parsed['license'];
    if (declared !== expected) {
      problems.push(`${file}: license is ${JSON.stringify(declared ?? null)}, not "${expected}"`);
    }
  }
  return problems;
}

test('every package declares the root LICENSE', () => {
  const files = packageFiles();
  assert.ok(files.length >= 10, `found ${String(files.length)} package.json files; vacuous`);
  const problems = licenceProblems(files, rootLicence(), (file) =>
    readFileSync(path.join(REPO_ROOT, file), 'utf8'),
  );
  assert.deepEqual(problems, []);
});

test('the check can fail: a missing or proprietary licence is reported', () => {
  const docs = {
    'a/package.json': '{"license":"UNLICENSED"}',
    'b/package.json': '{}',
    'c/package.json': '{"license":"MIT"}',
  };
  const problems = licenceProblems(
    Object.keys(docs),
    'MIT',
    (file) => /** @type {Record<string, string>} */ (docs)[file] ?? '{}',
  );
  assert.equal(problems.length, 2);
  assert.match(problems[0] ?? '', /UNLICENSED/u);
  assert.match(problems[1] ?? '', /null/u);
});
