import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * A test cited as ledger evidence is executed by something.
 *
 * `pnpm findings:check` fails a `fixed` row whose evidence path no longer exists, and
 * that is all it can see: a test that exists and is run by nothing satisfies it. GLASS-4
 * was closed on `ports-agree.test.mjs`, which no Playwright project (`*.spec.ts`), no
 * `node --test` glob and no package runner ever collected — so the regression it guards
 * could return with the row still `fixed`.
 *
 * A cited test counts as executed when either:
 *
 * - the nearest `package.json` above it, other than the root, has a `test` script that
 *   runs Vitest, whose default include collects `*.test.{ts,tsx,mjs,js}`; or
 * - a root script passes it to `node --test`, by path or by a `dir/*.test.mjs` glob.
 */

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

/** @returns {string[]} */
function citedTests() {
  const ledger = JSON.parse(read('docs/quality/findings-ledger.json'));
  const cited = new Set();
  for (const row of ledger.findings) {
    for (const evidence of row.evidence ?? []) {
      const file = String(evidence.path ?? '');
      if (/\.test\.(mjs|js|ts|tsx)$/.test(file) && existsSync(path.join(ROOT, file))) {
        cited.add(file);
      }
    }
  }
  return [...cited].sort();
}

/** @param {string} file @returns {boolean} */
function runByPackageVitest(file) {
  let directory = path.dirname(file);
  while (directory !== '.' && directory !== '') {
    const manifest = path.join(directory, 'package.json');
    if (existsSync(path.join(ROOT, manifest))) {
      const scripts = JSON.parse(read(manifest)).scripts ?? {};
      return /\bvitest\b/.test(String(scripts.test ?? ''));
    }
    directory = path.dirname(directory);
  }
  return false;
}

/** The `node --test` operands of every root script. */
function nodeTestOperands() {
  const scripts = JSON.parse(read('package.json')).scripts ?? {};
  const operands = [];
  for (const command of Object.values(scripts)) {
    for (const segment of String(command).split('&&')) {
      const words = segment.trim().split(/\s+/);
      if (words[0] !== 'node' || !words.includes('--test')) continue;
      operands.push(...words.filter((word) => /\.test\.mjs$/.test(word)));
    }
  }
  return operands;
}

/** @param {string} file @param {string[]} operands */
function runByRootNodeTest(file, operands) {
  return operands.some((operand) => {
    if (operand === file) return true;
    const star = operand.indexOf('*');
    if (star === -1) return false;
    const directory = operand.slice(0, operand.lastIndexOf('/'));
    return path.posix.dirname(file) === directory && file.endsWith(operand.slice(star + 1));
  });
}

test('every test the ledger cites as evidence is run by a script or a package', () => {
  const cited = citedTests();
  assert.ok(cited.length > 20, `only ${cited.length} cited test(s) found; the reader is broken`);
  const operands = nodeTestOperands();
  const orphaned = cited.filter(
    (file) => !runByPackageVitest(file) && !runByRootNodeTest(file, operands),
  );
  assert.deepEqual(
    orphaned,
    [],
    'these tests are cited as evidence for a ledger row and nothing executes them, so the ' +
      'row can stay `fixed` while the regression returns. Add each to a runner.',
  );
});

test('the reader recognises a file a root glob runs and one nothing runs', () => {
  const operands = ['scripts/lib/*.test.mjs', 'tests/e2e/support/explicit.test.mjs'];
  assert.equal(runByRootNodeTest('scripts/lib/x.test.mjs', operands), true);
  assert.equal(runByRootNodeTest('tests/e2e/support/explicit.test.mjs', operands), true);
  assert.equal(runByRootNodeTest('tests/e2e/support/other.test.mjs', operands), false);
  assert.equal(runByPackageVitest('apps/api/src/index.test.ts'), true);
});
