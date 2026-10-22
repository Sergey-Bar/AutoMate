import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { propertyInvariantFindings } from './property-invariants.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @param {string} directory @param {string[]} out @returns {string[]} */
function walk(directory, out = []) {
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue;
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.property.test.ts'))
      out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

/** The real tree. */
const realTree = {
  /** @param {string} relative */
  read: (relative) => {
    const full = path.join(root, relative);
    return existsSync(full) ? readFileSync(full, 'utf8') : null;
  },
  propertyTests: [...walk(path.join(root, 'apps')), ...walk(path.join(root, 'packages'))],
};

const register = JSON.parse(
  readFileSync(path.join(root, 'docs/quality/property-invariants.json'), 'utf8'),
);

/** A one-file tree that satisfies the register below. */
const GOOD = [
  'const SEED = 7;',
  'const params = { seed: SEED, numRuns: 10 };',
  "describe('X-1: a thing', () => {});",
  "describe('the property harness can fail', () => {});",
].join('\n');
const goodRegister = () => ({
  invariants: [
    { id: 'X-1', statement: 's', package: 'p', testFile: 'p/a.property.test.ts', seed: 7 },
  ],
});
/** @param {Record<string, string>} files */
const treeOf = (files) => ({
  read: (/** @type {string} */ relative) => files[relative] ?? null,
  propertyTests: Object.keys(files).filter((file) => file.endsWith('.property.test.ts')),
});

test('the real register and the real tree agree', () => {
  assert.deepEqual(propertyInvariantFindings(register, realTree), []);
});

test('the real register covers every area the roadmap names', () => {
  const prefixes = new Set(
    register.invariants.map((/** @type {{ id: string }} */ row) => row.id.split('-')[0]),
  );
  for (const area of ['ORCH', 'RUN', 'RETRY', 'SPOOL', 'REPORT', 'OUTBOX']) {
    assert.ok(prefixes.has(area), `no invariant in ${area}`);
  }
});

test('a consistent register and tree produce no finding', () => {
  assert.deepEqual(
    propertyInvariantFindings(goodRegister(), treeOf({ 'p/a.property.test.ts': GOOD })),
    [],
  );
});

test('a listed test file that is missing is a finding', () => {
  const findings = propertyInvariantFindings(goodRegister(), treeOf({}));
  assert.match(findings.join('\n'), /does not exist/);
});

test('an invariant with no describe block in its file is a finding', () => {
  const findings = propertyInvariantFindings(
    goodRegister(),
    treeOf({ 'p/a.property.test.ts': GOOD.replace('X-1:', 'something else:') }),
  );
  assert.match(findings.join('\n'), /no describe block named "X-1/);
});

test('a property suite no invariant lists is a finding', () => {
  const findings = propertyInvariantFindings(
    goodRegister(),
    treeOf({ 'p/a.property.test.ts': GOOD, 'q/b.property.test.ts': GOOD }),
  );
  assert.match(
    findings.join('\n'),
    /q\/b\.property\.test\.ts: a property suite no invariant lists/,
  );
});

test('an invariant a suite states but the register omits is a finding', () => {
  const findings = propertyInvariantFindings(
    goodRegister(),
    treeOf({ 'p/a.property.test.ts': `${GOOD}\ndescribe('X-2: extra', () => {});` }),
  );
  assert.match(findings.join('\n'), /states X-2, which the register does not list/);
});

test('a suite that does not fix its seed, numRuns, or show it can fail is a finding', () => {
  const noSeed = propertyInvariantFindings(
    goodRegister(),
    treeOf({ 'p/a.property.test.ts': GOOD.replace('SEED = 7', 'SEED = 8') }),
  );
  assert.match(noSeed.join('\n'), /does not fix the seed 7/);
  const noRuns = propertyInvariantFindings(
    goodRegister(),
    treeOf({ 'p/a.property.test.ts': GOOD.replace('numRuns', 'runs') }),
  );
  assert.match(noRuns.join('\n'), /no fixed numRuns/);
  const noHarness = propertyInvariantFindings(
    goodRegister(),
    treeOf({ 'p/a.property.test.ts': GOOD.replace('the property harness can fail', 'x') }),
  );
  assert.match(noHarness.join('\n'), /harness can fail/);
});

test('a skipped test, an empty register, and a duplicate id are findings', () => {
  assert.match(
    propertyInvariantFindings(
      goodRegister(),
      treeOf({ 'p/a.property.test.ts': `${GOOD}\nit.skip('x', () => {});` }),
    ).join('\n'),
    /skips or focuses/,
  );
  assert.deepEqual(propertyInvariantFindings({ invariants: [] }, treeOf({})), [
    'the register lists no invariants',
  ]);
  const twice = goodRegister();
  twice.invariants.push({ ...twice.invariants[0] });
  assert.match(
    propertyInvariantFindings(twice, treeOf({ 'p/a.property.test.ts': GOOD })).join('\n'),
    /listed twice/,
  );
});
