import { describe, expect, it } from 'vitest';
import { diffCoverage, normaliseDiffPath, parseUnifiedDiff } from './diff-coverage.js';

const lines = (map: Map<string, Set<number>>) =>
  Object.fromEntries([...map].map(([path, set]) => [path, [...set]]));

describe('parseUnifiedDiff', () => {
  it('records added lines by their new-file number across several hunks', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      ' one',
      '+two',
      ' three',
      '-four',
      '+FOUR',
      '@@ -10 +11,2 @@ function x() {',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '+newer',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    expect(lines(parseUnifiedDiff(diff))).toEqual({ 'src/a.ts': [2, 4, 11, 12] });
  });

  it('reads a CRLF diff the same as an LF one', () => {
    const lf = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,1 +1,2 @@', ' a', '+b', ''].join('\n');
    expect(lines(parseUnifiedDiff(lf.replace(/\n/gu, '\r\n')))).toEqual({ 'x.ts': [2] });
  });

  it('gives a new file every line, a deleted file none, and a rename its new path', () => {
    const diff = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-a',
      '-b',
      'diff --git a/old/name.ts b/new/name.ts',
      'similarity index 90%',
      'rename from old/name.ts',
      'rename to new/name.ts',
      '--- a/old/name.ts',
      '+++ b/new/name.ts',
      '@@ -4,2 +4,3 @@',
      ' keep',
      '+added',
      ' keep',
      'diff --git a/pure/rename.ts b/pure/renamed.ts',
      'similarity index 100%',
      'rename from pure/rename.ts',
      'rename to pure/renamed.ts',
    ].join('\n');
    expect(lines(parseUnifiedDiff(diff))).toEqual({ 'new.ts': [1, 2], 'new/name.ts': [5] });
  });

  it('ignores binary files, including a git binary patch whose data starts with + or -', () => {
    const diff = [
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ',
      'diff --git a/blob.bin b/blob.bin',
      'GIT binary patch',
      'literal 12',
      '+zcmZ?wbhEHb',
      '-zcmZ?wbhEHb',
      '',
      'diff --git a/t.ts b/t.ts',
      '--- a/t.ts',
      '+++ b/t.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n');
    expect(lines(parseUnifiedDiff(diff))).toEqual({ 't.ts': [1] });
  });

  it('does not mistake a removed "-- " line or an added "++ " line for a file header', () => {
    const diff = [
      '--- a/q.sql',
      '+++ b/q.sql',
      '@@ -1,2 +1,2 @@',
      '--- a comment',
      '+++ counter',
      ' select 1;',
    ].join('\n');
    expect(lines(parseUnifiedDiff(diff))).toEqual({ 'q.sql': [1] });
  });

  it('reads an empty context line that a tool stripped of its leading space', () => {
    const diff = ['--- a/e.ts', '+++ b/e.ts', '@@ -1,3 +1,4 @@', 'a', '', '+b', ' c'].join('\n');
    // `a` is not a valid hunk line, so the hunk ends there; nothing after it is read as added.
    expect(lines(parseUnifiedDiff(diff))).toEqual({});
    const stripped = ['--- a/e.ts', '+++ b/e.ts', '@@ -1,3 +1,4 @@', ' a', '', '+b', ' c'].join(
      '\n',
    );
    expect(lines(parseUnifiedDiff(stripped))).toEqual({ 'e.ts': [3] });
  });

  it('reads quoted paths, tab-separated timestamps and --no-prefix diffs', () => {
    const diff = [
      '--- "a/with space.ts"\t2026-01-01 00:00:00',
      '+++ "b/with space.ts"\t2026-01-01 00:00:00',
      '@@ -0,0 +1 @@',
      '+x',
      '--- plain.ts',
      '+++ plain.ts',
      '@@ -0,0 +1 @@',
      '+x',
    ].join('\n');
    expect(lines(parseUnifiedDiff(diff))).toEqual({ 'with space.ts': [1], 'plain.ts': [1] });
  });

  it('returns nothing for an empty diff or a hunk with no file header', () => {
    expect(parseUnifiedDiff('').size).toBe(0);
    expect(parseUnifiedDiff('@@ -1 +1 @@\n+x\n').size).toBe(0);
  });

  it.each([
    '@@ -1 +1',
    '@@ -1 +1 +2 @@',
    '@@ -1 1 @@',
    '@@ -1 @@',
    '@@ -x +1 @@',
    '@@ -1,2,3 +1 @@',
    '@@ -1 +y @@',
    '@@ -1 +1,z @@',
  ])('does not read %j as a hunk header', (header) => {
    expect(parseUnifiedDiff(`--- a/f\n+++ b/f\n${header}\n+x\n`).size).toBe(0);
  });
});

describe('normaliseDiffPath', () => {
  it.each([
    ['b/src/x.ts', undefined, 'src/x.ts'],
    ['a/src/x.ts', undefined, 'src/x.ts'],
    ['./src/x.ts', undefined, 'src/x.ts'],
    ['.\\src\\x.ts', undefined, 'src/x.ts'],
    ['src//x.ts', undefined, 'src/x.ts'],
    ['packages/p/src/x.ts', 'packages/p', 'src/x.ts'],
    ['packages/p/src/x.ts', './packages\\p/', 'src/x.ts'],
    ['other/src/x.ts', 'packages/p', 'other/src/x.ts'],
    ['packages/p', 'packages/p', 'packages/p'],
  ])('%s (root %s) → %s', (path, root, expected) => {
    expect(normaliseDiffPath(path, root)).toBe(expected);
  });
});

describe('diffCoverage', () => {
  const coverage = {
    files: [
      { path: '/ci/repo/src/a.ts', executable: [1, 2, 3, 4], covered: [1, 3] },
      { path: 'src\\b.ts', executable: [10, 11], covered: [10, 11] },
      { path: 'lib/src/b.ts', executable: [10, 11], covered: [] },
    ],
  };

  it('counts only changed lines that are executable, and lists the uncovered ones', () => {
    const changed = new Map([
      ['src/a.ts', new Set([2, 3, 4, 99])],
      ['b/src/b.ts', new Set([10, 12])],
    ]);
    expect(diffCoverage(changed, coverage)).toEqual({
      covered: 2,
      executable: 4,
      ratio: 0.5,
      uncovered: [{ path: 'src/a.ts', lines: [2, 4] }],
      unmeasuredFiles: [],
    });
  });

  it('lists a changed file with no coverage entry as unmeasured, not as uncovered', () => {
    const changed = new Map([
      ['docs/readme.md', new Set([1])],
      ['src/a.ts', new Set([1])],
    ]);
    const result = diffCoverage(changed, coverage);
    expect(result).toMatchObject({ covered: 1, executable: 1, ratio: 1, uncovered: [] });
    expect(result.unmeasuredFiles).toEqual(['docs/readme.md']);
  });

  it('has no ratio when nothing changed is executable', () => {
    expect(diffCoverage(new Map(), coverage).ratio).toBeNull();
    expect(diffCoverage(new Map([['src/a.ts', new Set([50])]]), coverage)).toMatchObject({
      executable: 0,
      ratio: null,
    });
  });

  it('prefers an exact path to a suffix match, and merges suffix matches otherwise', () => {
    // `src/b.ts` exactly is fully covered; `lib/src/b.ts` only suffix-matches.
    expect(diffCoverage(new Map([['src/b.ts', new Set([11])]]), coverage).ratio).toBe(1);
    const suffixOnly = {
      files: [
        { path: '/x/m/b.ts', executable: [1, 2], covered: [1] },
        { path: '/y/m/b.ts', executable: [1, 2], covered: [2] },
      ],
    };
    expect(diffCoverage(new Map([['m/b.ts', new Set([1, 2])]]), suffixOnly).ratio).toBe(1);
  });

  it('does not match a path that merely ends with the same characters', () => {
    const result = diffCoverage(new Map([['b.ts', new Set([1])]]), {
      files: [{ path: 'src/ab.ts', executable: [1], covered: [1] }],
    });
    expect(result.unmeasuredFiles).toEqual(['b.ts']);
  });

  it('strips a source root from both sides before matching', () => {
    const result = diffCoverage(
      new Map([['packages/p/src/x.ts', new Set([1, 2])]]),
      { files: [{ path: 'src/x.ts', executable: [1, 2], covered: [2] }] },
      { sourceRoot: 'packages/p' },
    );
    expect(result).toMatchObject({
      covered: 1,
      executable: 2,
      uncovered: [{ path: 'src/x.ts', lines: [1] }],
    });
  });

  it('ignores a covered line the report does not also call executable', () => {
    const result = diffCoverage(new Map([['x.ts', new Set([1, 2])]]), {
      files: [{ path: 'x.ts', executable: [1], covered: [1, 2] }],
    });
    expect(result).toMatchObject({ covered: 1, executable: 1 });
  });

  it('sorts its output so the same input renders the same comment', () => {
    const result = diffCoverage(
      new Map([
        ['z.ts', new Set([3, 1])],
        ['y.ts', new Set([1])],
        ['q.md', new Set([1])],
        ['p.md', new Set([1])],
      ]),
      {
        files: [
          { path: 'z.ts', executable: [1, 3], covered: [] },
          { path: 'y.ts', executable: [1], covered: [] },
        ],
      },
    );
    expect(result.uncovered).toEqual([
      { path: 'y.ts', lines: [1] },
      { path: 'z.ts', lines: [1, 3] },
    ]);
    expect(result.unmeasuredFiles).toEqual(['p.md', 'q.md']);
  });
});
