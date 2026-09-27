import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The live half of the `double-assertion` rule, in a `node --test` suite on purpose.
 *
 * This starts a real ESLint process, which costs a whole ESLint boot: configuration
 * load, TypeScript project resolution, the lot. It lived in
 * `tests/contract/review-ruleset.test.mjs` first, and that case measured 76 s under
 * `pnpm test` — where turbo runs thirty-odd package suites at once — and failed at a
 * 60 s budget. `scripts/lib/` runs serially via `--test-concurrency=1` with nothing
 * else competing, which is where a process spawn belongs. The cheap structural
 * assertions about the ruleset stay in the contract suite, where they belong.
 *
 * It is here rather than nowhere because a rule declared in JSON and enforced nowhere
 * is a stated intention. `new Date(0) as unknown as Date` is the exact shape the
 * review ruleset's `double-assertion` rule names, and the exact shape that used to sit
 * under `packages/db/src/schema/**` with nothing objecting.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
const probe = path.join(
  root,
  'packages',
  'shared-contracts',
  'src',
  'zz-double-assertion-probe.ts',
);

/** @param {string} file */
function lint(file) {
  const result = spawnSync(process.execPath, [eslintBin, file], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

test('a double assertion under a contract is an error, and a single one is not', () => {
  writeFileSync(
    probe,
    [
      'export const twice = (new Date(0) as unknown) as Date;',
      'export const once = new Date(0) as Date;',
      '',
    ].join('\n'),
    'utf8',
  );
  try {
    const output = lint(path.relative(root, probe));
    assert.match(
      output,
      /Do not assert twice under a schema or a contract/,
      'the double assertion must be an error, and the message has to say what to do',
    );
    // The control assertion matters as much as the failing one: a selector that matched
    // *every* `as` would also make this test pass.
    assert.ok(
      !/\n\s*2:\d+/.test(output),
      `the single assertion on line 2 was also reported, so the selector no longer ` +
        `distinguishes the two cases:\n${output}`,
    );
  } finally {
    // The probe must not survive a failed run: a leftover file under
    // `packages/shared-contracts/src` is lint-clean only by accident, and it is a
    // double assertion in the tree the rule exists to keep clean.
    rmSync(probe, { force: true });
  }
});

test('the two contract trees are free of double assertions today', () => {
  // The rule cannot fire on the tree it scopes, so this is a statement that the
  // baseline is clean rather than a claim that the rule is lenient.
  for (const directory of ['packages/db/src/schema', 'packages/shared-contracts/src']) {
    const result = spawnSync(process.execPath, [eslintBin, directory], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(
      result.status,
      0,
      `${directory} did not lint clean:\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
});
