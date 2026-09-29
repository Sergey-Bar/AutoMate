import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/** The repository root. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** The source directories a workspace package can live in. */
const ROOTS = ['apps', 'packages', 'tools', 'tests'];

/**
 * Every TypeScript source file in the workspace, excluding build output.
 *
 * @returns {string[]}
 */
function sourceFiles() {
  /** @type {string[]} */
  const found = [];
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs)$/.test(entry.name)) found.push(full);
    }
  };
  for (const root of ROOTS) walk(path.join(REPO_ROOT, root));
  return found;
}

const RUNNER_SDK = path.join(REPO_ROOT, 'packages', 'runner-sdk');
const CLIENT = path.join(RUNNER_SDK, 'src', 'client.ts');

test('no shipped source file carries a raw NUL, or git stops showing diffs for it', () => {
  // `useCommandActions.ts` was committed with two raw NUL bytes inside a template
  // literal — the residue of a shell replacement that wrote `\0` literally. Git
  // classifies a file containing NUL as binary, so that commit had **no line-level
  // diff, no blame, and no reviewable content** for the exact change that fixed an
  // infinite render loop. Nobody reviewing the change could have seen what it did.
  //
  // A binary-classified source file is not a style problem, so this is a gate: a
  // change that fixes a real defect and then cannot be reviewed is a defect that
  // ships unreviewed.
  //
  // **Test files are exempt, and one of them has to be.**
  // `reporter-persistence.test.ts` contains `'report.json\0/../../etc/passwd'` as a
  // *fixture*: a NUL in a path is the traversal it is testing for, and writing it as
  // an escape would test a different string. So the rule is scoped to what ships.
  const shipped = sourceFiles().filter(
    (file) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && !/\.test\.mjs$/.test(file),
  );
  const offenders = shipped
    .filter((file) => readFileSync(file).includes(0))
    .map((file) => path.relative(REPO_ROOT, file).replaceAll('\\', '/'));
  assert.deepEqual(offenders, [], `source files containing a NUL byte: ${offenders.join(', ')}`);
});

test('the dead runner-sdk client is gone', () => {
  // `packages/runner-sdk/src/client.ts` targeted
  // `/api/v1/runner/v1/enroll` and `/sync`, which `apps/api/src/routes/runner.ts`
  // serves — so the two agreed on paper. But the runner binary uses its own client
  // at `apps/runner/src/client.ts`, and every import of `@automate/runner-sdk` in
  // the workspace names only a `spool` symbol. So the file was compiled, shipped,
  // and never called, against routes a second and separate client also talks to.
  //
  // Two HTTP clients for one protocol is the shape that eventually produces a
  // second one nobody updates.
  assert.equal(
    existsSync(CLIENT),
    false,
    'packages/runner-sdk/src/client.ts is dead code and should be gone',
  );
  const barrel = readFileSync(path.join(RUNNER_SDK, 'src', 'index.ts'), 'utf8');
  assert.doesNotMatch(barrel, /client\.js/);
  assert.match(barrel, /spool\.js/);
});

test('every export the runner-sdk barrel offers is used somewhere in the workspace', () => {
  // The check that would have caught `client.ts` while it was alive, and that
  // catches the next one. A barrel export with no consumer is not *obviously*
  // dead to a reader — it looks like a published API — so the cost of noticing
  // fell to whoever happened to be reading, which is how this one survived.
  const barrel = readFileSync(path.join(RUNNER_SDK, 'src', 'index.ts'), 'utf8');
  const barrelPath = path.join(RUNNER_SDK, 'src', 'index.ts');
  const sources = sourceFiles().filter((file) => file !== barrelPath);

  const modules = [...barrel.matchAll(/export\s*\*\s*from\s*'\.\/([\w-]+)\.js'/g)].map(
    (match) => match[1] ?? '',
  );
  assert.ok(modules.length > 0, 'the barrel re-exports something, or this is vacuous');

  const exported = new Set();
  for (const name of modules) {
    const source = readFileSync(path.join(RUNNER_SDK, 'src', `${name}.ts`), 'utf8');
    // One pattern per keyword rather than one alternation. The alternation
    // version reads fine but is the shape `security/detect-unsafe-regex` flags,
    // and three short patterns are easier to read anyway.
    for (const pattern of [
      /export (?:async )?function ([A-Za-z0-9_]+)/g,
      /export class ([A-Za-z0-9_]+)/g,
      /export const ([A-Za-z0-9_]+)/g,
      /export type ([A-Za-z0-9_]+)/g,
      /export interface ([A-Za-z0-9_]+)/g,
    ]) {
      for (const declared of source.matchAll(pattern)) exported.add(declared[1] ?? '');
    }
  }
  assert.ok(exported.size > 0, 'the re-exported modules declare something');

  const corpus = sources.map((file) => readFileSync(file, 'utf8')).join('\n');
  // A substring search rather than a `\b`-anchored pattern. The anchor is what
  // needs a regular expression, and building one from a source-derived name is
  // the shape `security/detect-unsafe-regex` flags — correctly, since a name
  // reaching here comes from a file that is about to be compiled.
  //
  // A substring match is slightly looser than a word boundary: a name is reported
  // as used if it appears as a substring of a longer identifier. That direction
  // of imprecision makes the gate *less* likely to cry wolf, which is the side to
  // err on — a check that reports live exports as dead gets switched off.
  const unconsumed = [...exported].filter((name) => !corpus.includes(name));

  assert.deepEqual(
    unconsumed,
    [],
    `packages/runner-sdk exports nothing in the workspace uses: ${unconsumed.join(', ')}`,
  );
});
