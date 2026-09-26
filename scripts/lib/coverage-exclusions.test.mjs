import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractCoverageExclusions,
  findRegisterDisagreements,
  parseRegister,
} from './coverage-exclusions.mjs';

test('reads the coverage exclude list and not the test-discovery one', () => {
  const source = [
    'export default {',
    "  test: { exclude: ['node_modules', 'dist'],",
    "    coverage: { exclude: [...coverage.exclude, 'src/index.ts', 'src/instrument.ts'] },",
    '  },',
    '};',
  ].join('\n');
  assert.deepEqual(extractCoverageExclusions(source), ['src/index.ts', 'src/instrument.ts']);
});

test('a config with no coverage object yields no exclusions rather than a discovery list', () => {
  const source = "export default { test: { exclude: ['node_modules', 'dist'] } };";
  assert.deepEqual(extractCoverageExclusions(source), []);
});

test('a repeated glob is reported once', () => {
  const source = "coverage: { exclude: ['src/index.ts', 'src/index.ts'] }";
  assert.deepEqual(extractCoverageExclusions(source), ['src/index.ts']);
});

test('the register table is read, and a malformed row is a finding rather than a skip', () => {
  const markdown = [
    '| Package | Excluded glob | Why |',
    '| --- | --- | --- |',
    '| `apps/api` | `src/index.ts` | composition root |',
    '| src/routeTree.gen.ts | apps/web | missing backticks, so it documents nothing |',
  ].join('\n');
  const { rows, unparsed } = parseRegister(markdown);
  assert.deepEqual(rows, [{ package: 'apps/api', glob: 'src/index.ts' }]);
  assert.equal(unparsed.length, 1);
  assert.match(unparsed[0] ?? '', /missing backticks/);
});

test('the rejected-exclusions table is prose, not a claim about the configs', () => {
  const markdown = [
    '| Glob | Where it was proposed | Why it was refused |',
    '| --- | --- | --- |',
    '| `src/**/index.ts` | `packages/shared-contracts` | contradicts the policy |',
    '',
    '## Per-package exclusions',
    '',
    '| Package | Excluded glob | Why |',
    '| --- | --- | --- |',
    '| `apps/web` | `src/main.tsx` | entry point |',
  ].join('\n');
  assert.deepEqual(parseRegister(markdown).rows, [{ package: 'apps/web', glob: 'src/main.tsx' }]);
});

test('the register and the Vitest configs agree, in both directions', () => {
  assert.deepEqual(findRegisterDisagreements(), []);
});
