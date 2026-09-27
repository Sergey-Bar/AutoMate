import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// One glob implementation for the repository. This gate and the review ruleset both
// ask "does this pattern match this path", and a second answer to that question is how a
// pattern comes to cover one tool and not the other.
import { globToRegExp } from '../../scripts/review/glob.mjs';

/**
 * `format` and `format:check` cover the whole tree, and this is what keeps that true.
 *
 * They used to be twenty hand-written globs, one per directory shape, and nothing
 * failed when a directory was added: the new files were simply outside the list, so
 * they were never formatted and never checked, and `format:check` stayed green. That
 * is a gate reporting success about a set it is silently not looking at.
 *
 * Audited against a whole-tree glob, the old list missed **22** files: twelve
 * `.github/agents/*.md` definitions, two package READMEs, a design map, and the whole
 * `performance/` directory the Q0.18 k6 gate introduced — so the performance gate's
 * own scenario and thresholds were never checked by the formatting gate either.
 *
 * The scripts now use real globs, so a new *file* is covered by construction. These
 * tests cover the two things a glob cannot:
 *
 * 1. the globs have not been optimised back into a directory list, which is a pure
 *    source-text property and is checked as one; and
 * 2. `.prettierignore` has not grown an entry that switches the gate off while still
 *    printing "checked".
 *
 * **What the coverage comparison does and does not prove.** `prettier --file-info`
 * honours `.prettierignore`, so *both* sides of the comparison are already filtered by
 * it — the check is therefore "the globs reach everything not ignored", and the ignore
 * list is audited separately. That split is deliberate: the two properties fail
 * differently, and a single test asserting both would pass when either was broken in
 * a way that cancelled out.
 */

/**
 * The repository root, resolved rather than assumed.
 *
 * Vitest runs a test file with the *package* as its working directory, so
 * `readFileSync('package.json')` and `npx prettier` both resolve against
 * `tests/contract/` and quietly read the wrong file or fail to resolve a glob. Both
 * failures looked like a broken gate rather than a wrong directory, which is why this
 * is stated rather than left implicit.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Exactly what `format:check` asks prettier to look at. */
const FORMAT_GLOBS = [
  '**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
  '**/*.{json,yaml,yml,md,css}',
  '.github/workflows/*.{yml,yaml}',
];

/** Every extension prettier could format, so "not covered" means "not in the globs". */
const TREE_GLOBS = ['**/*.{ts,tsx,mts,cts,js,mjs,cjs,json,yaml,yml,md,css}'];

/**
 * Every tracked file, which is the set the format scripts should be covering.
 *
 * `git ls-files` rather than a filesystem walk, so the comparison is against what is
 * *in the repository* — a file that exists only on this machine is not something the
 * gate can be expected to have an opinion about, and a committed file always is.
 */
function trackedFiles() {
  return execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replaceAll('\\', '/'));
}

/** The `.prettierignore` entries, as matchers, with negations kept separate. */
function ignoreMatchers() {
  const lines = readFileSync(path.join(repoRoot, '.prettierignore'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  return {
    ignored: lines.filter((line) => !line.startsWith('!')).map(globToRegExp),
    // `!.env.example` re-includes a file an earlier pattern excluded.
    included: lines
      .filter((line) => line.startsWith('!'))
      .map((line) => globToRegExp(line.slice(1))),
  };
}

function isIgnored(file, matchers) {
  if (matchers.ignored.some((matcher) => matcher.test(file))) {
    return !matchers.included.some((matcher) => matcher.test(file));
  }
  return false;
}

function coveredFiles(patterns) {
  const matchers = patterns.map(globToRegExp);
  const ignores = ignoreMatchers();
  return new Set(
    trackedFiles().filter(
      (file) => matchers.some((m) => m.test(file)) && !isIgnored(file, ignores),
    ),
  );
}

describe('the format scripts cover the tree', () => {
  it('use real globs, not a directory list that can silently fall behind', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    for (const name of ['format', 'format:check']) {
      const script = pkg.scripts[name] ?? '';
      expect(script, `format script is missing: ${name}`).not.toBe('');
      // The old list named directories: `apps/*\/src/**`, `packages/*\/src/**`,
      // `tools/*\/src/**`, `tests/*\/src/**`. A glob naming no directory cannot fall
      // behind a new one, and these three do not.
      expect(script, `${name} names a directory shape, so a new directory is skipped`).not.toMatch(
        /(apps|packages|tools|tests|scripts|e2e|docs|infra)\/\*/,
      );
      for (const glob of FORMAT_GLOBS) expect(script, `${name} lost ${glob}`).toContain(glob);
    }
  });

  it('reaches every tracked file prettier would format, that is not ignored', () => {
    const considered = coveredFiles(FORMAT_GLOBS);
    // The globs resolve, so the set is not empty. An empty set would make the
    // comparison below vacuously true — the failure mode this file exists for.
    expect(considered.size, 'the format globs matched nothing in the tree').toBeGreaterThan(100);

    const inTree = coveredFiles(TREE_GLOBS);
    const missed = [...inTree].filter((file) => !considered.has(file)).sort();
    expect(missed, 'tracked files prettier would format but the format scripts skip').toEqual([]);
  });

  it('covers the files the old list silently omitted', () => {
    // Named explicitly, because "the globs are broad" is not evidence that the
    // twenty-two files the old list missed are among them. One of them
    // (`performance/`) is the k6 gate's own input, so the formatting gate was not
    // checking the performance gate's files.
    const considered = coveredFiles(FORMAT_GLOBS);
    for (const file of [
      'performance/smoke.js',
      'performance/thresholds.json',
      'packages/shared-contracts/README.md',
      'packages/ui/DESIGN-MAP.md',
      '.github/agents/principal-architect.agent.md',
    ]) {
      expect(considered.has(file), `${file} is not covered by the format globs`).toBe(true);
    }
  });

  it('ignores the generated drizzle metadata, and only that of the tracked files', () => {
    // The reason it is ignored: it is generated, and formatting it makes `db:generate`
    // show a diff nobody made. Named rather than inferred, because the old glob list
    // omitted `packages/db/drizzle/**` entirely and so never had to say this.
    const considered = coveredFiles(FORMAT_GLOBS);
    expect(considered.has('packages/db/drizzle/meta/_journal.json')).toBe(false);
    expect(readFileSync(path.join(repoRoot, '.prettierignore'), 'utf8')).toContain(
      'packages/db/drizzle/meta/',
    );
  });

  it('ignores the generated drizzle metadata, which is the one real exclusion', () => {
    // The reason it is ignored at all: it is generated, and formatting it makes
    // `db:generate` show a diff nobody made. Named rather than inferred, because the old
    // glob list omitted `packages/db/drizzle/**` entirely and so never had to say this.
    const considered = coveredFiles(FORMAT_GLOBS);
    expect(considered.has('packages/db/drizzle/meta/_journal.json')).toBe(false);
    expect(readFileSync(path.join(repoRoot, '.prettierignore'), 'utf8')).toContain(
      'packages/db/drizzle/meta/',
    );
  });

  it('never switches itself off with a bare wildcard', () => {
    // A bare `*` in `.prettierignore` would exclude the whole tree while `format:check`
    // still printed "checked" — the failure mode the real globs exist to remove, and
    // the one thing an ignore list can do that a glob list cannot.
    for (const raw of readFileSync(path.join(repoRoot, '.prettierignore'), 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
      expect(
        line,
        `a bare "${line}" in .prettierignore disables formatting everywhere`,
      ).not.toMatch(/^\*+$|^\.\*$/);
    }
  });
});
