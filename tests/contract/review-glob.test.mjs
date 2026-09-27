import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesAny } from '../../scripts/review/glob.mjs';

/**
 * The one glob implementation, tested directly.
 *
 * Two gates depend on it — the review ruleset (a rule's `pathGlobs` decide where it
 * fires) and the format-glob coverage gate (the `format` scripts' patterns decide what
 * the formatting gate looks at) — and it replaced two implementations, one of which
 * used control-character sentinels that `no-control-regex` refuses.
 *
 * Both consumers exercise it indirectly. These are the cases where indirect coverage is
 * not enough, because each one produced a wrong answer that looked entirely reasonable:
 *
 *   - a directory wildcard consumed a character the loop then consumed **again**, so
 *     the token after it was never seen, and the pattern matched nothing while looking
 *     reasonable. The format gate reported "the globs matched nothing in the tree",
 *     which is a sentence about the *tree* when the bug was in the glob.
 *   - a bare `node_modules/` matched only a file literally named `node_modules`, so an
 *     exclusion that did nothing looked like an exclusion that worked.
 *   - a rule whose globs silently matched nothing would be a rule that never fires, and
 *     a rule that never fires is indistinguishable from a rule nobody implemented.
 */

/** @param {string} glob */
const test = (glob) => (file) => globToRegExp(glob).test(file);

describe('directory wildcards cross directory boundaries, which is the whole point', () => {
  it('a leading double-star matches at the root and at any depth', () => {
    const matcher = test('**/*.ts');
    expect(matcher('a.ts')).toBe(true);
    expect(matcher('apps/api/src/routes/execution.ts')).toBe(true);
    expect(matcher('a/b/c/d/e/f/g.ts')).toBe(true);
  });

  it('a single star matches one segment only, so a shallow pattern stays shallow', () => {
    // The distinction that was live: the two look interchangeable in a glob and match
    // very different sets.
    expect(test('*.ts')('a.ts')).toBe(true);
    expect(test('*.ts')('apps/a.ts')).toBe(false);
    expect(test('apps/*.ts')('apps/a.ts')).toBe(true);
    expect(test('apps/*.ts')('apps/api/a.ts')).toBe(false);
  });

  it('consumes the whole double-star token, so what follows it is still matched', () => {
    // The regression this asserts. A cursor that advances by the token's length *and*
    // by the loop's own increment drops whatever followed, so a brace list after it
    // became a literal dot — matching paths that do not exist and none that do.
    const matcher = test('**/*.{ts,tsx}');
    expect(matcher('a.ts')).toBe(true);
    expect(matcher('a.tsx')).toBe(true);
    expect(matcher('packages/ui/src/index.ts')).toBe(true);
    expect(matcher('packages/ui/src/index.js')).toBe(false);
  });
});

describe('braces and classes', () => {
  it('expands a brace list', () => {
    const matcher = test('**/*.{json,yaml,yml,md,css}');
    expect(matcher('README.md')).toBe(true);
    expect(matcher('docker-compose.yml')).toBe(true);
    expect(matcher('a/b/c.json')).toBe(true);
    expect(matcher('a/b/c.ts')).toBe(false);
  });

  it('does not treat a brace as a wildcard, so a literal brace still matches literally', () => {
    expect(test('a{b,c}.ts')('ab.ts')).toBe(true);
    expect(test('a{b,c}.ts')('a.ts')).toBe(false);
  });

  it('passes a character class through and keeps the segment boundary', () => {
    const matcher = test('**/[ab]*.ts');
    expect(matcher('apple.ts')).toBe(true);
    expect(matcher('banana.ts')).toBe(true);
    expect(matcher('cherry.ts')).toBe(false);
  });
});

describe('bare directory entries cover the tree beneath them', () => {
  it('matches a path under the directory, not only the directory itself', () => {
    // The failure this prevents: matched literally, the pattern would only ever match a
    // file whose name *is* the directory — so the exclusion did nothing while appearing
    // to be in force, and the files it was written to protect were covered anyway.
    const matcher = test('packages/db/drizzle/meta/');
    expect(matcher('packages/db/drizzle/meta/_journal.json')).toBe(true);
    expect(matcher('packages/db/drizzle/meta/0000_snapshot.json')).toBe(true);
    expect(matcher('packages/db/drizzle/meta')).toBe(true);
    expect(matcher('packages/db/drizzle/0000_base.sql')).toBe(false);
  });

  it('does not treat a wildcard entry as a bare directory', () => {
    const matcher = test('**/node_modules/**');
    expect(matcher('node_modules/x/y.js')).toBe(true);
    expect(matcher('apps/api/node_modules/x.js')).toBe(true);
  });
});

describe('refusing rather than guessing', () => {
  it('throws on a malformed pattern, instead of matching everything', () => {
    // A translator that mis-reads its own pattern reports confidently about a set it
    // never computed. A rule that silently matches everything then fires on the whole
    // repository, and nobody notices until a report is full of findings about files the
    // rule was never about.
    expect(() => globToRegExp('a{b.ts')).toThrow(/unterminated brace/);
    expect(() => globToRegExp('a[b.ts')).toThrow(/unterminated character class/);
    expect(() => globToRegExp('a{},b.ts')).toThrow(/empty alternative/);
    expect(() => globToRegExp('')).toThrow(/non-empty string/);
  });

  it('escapes regex metacharacters in a literal segment', () => {
    // A path may legitimately contain a dot; treating it as syntax is how a pattern
    // ends up matching a file nobody wrote.
    expect(test('a.b.ts')('axbxts')).toBe(false);
    expect(test('a.b.ts')('a.b.ts')).toBe(true);
  });
});

describe('matchesAny is the only caller-facing entry point', () => {
  it('normalises Windows separators, so a pattern behaves the same on both platforms', () => {
    // The gates run on Windows here and on Linux in CI. A pattern that matched on one
    // and not the other is a gate that passes locally and fails in CI, which is the
    // worst place for a discrepancy to live.
    expect(matchesAny('apps\\api\\src\\index.ts', ['**/*.ts'])).toBe(true);
    expect(matchesAny('apps/api/src/index.ts', ['**/*.ts'])).toBe(true);
  });

  it('answers false for an empty or missing glob list', () => {
    // A rule with no globs is already a finding in `validateRuleset`, so `matchesAny`
    // must not quietly answer true for it as well — two gates disagreeing about the same
    // malformed rule is the drift this module exists to remove.
    expect(matchesAny('a.ts', [])).toBe(false);
    expect(matchesAny('a.ts', undefined)).toBe(false);
  });
});
