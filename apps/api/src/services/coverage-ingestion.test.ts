import { describe, expect, it } from 'vitest';
import {
  compileGlob,
  selectCoverageArtifacts,
  uncoveredModulesFrom,
  type CoverageArtifact,
} from './coverage-ingestion.js';

/**
 * The coverage join, tested at its three rules.
 *
 * ## Why this is tested at the join and not at the score
 *
 * The score's `depth` component was `unknown` on every cell of every screen, and
 * the reason was not the score's arithmetic — it was that `assemble` was handed an
 * empty coverage list and never once read a document. These tests pin the three
 * rules that make the join honest: a glob matches the declared filename, a
 * format is never guessed, and a file the report never names is unknown rather
 * than uncovered.
 *
 * The third rule is the one that matters most. A coverage report that names 40
 * files in a repository of 400 could be read as "360 files are uncovered", and
 * that number would be a claim nobody made — the score's `depth: unknown` is the
 * honest answer for a file the report cannot see.
 */

function artifact(path: string, bytes: Uint8Array | null = null): CoverageArtifact {
  return { path, bytes };
}

describe('compileGlob', () => {
  it('matches a plain filename', () => {
    const matches = compileGlob('coverage/lcov.info');
    expect(matches?.('coverage/lcov.info')).toBe(true);
    expect(matches?.('coverage/other.info')).toBe(false);
  });

  it('treats a dot as a literal, so a dot cannot match any character', () => {
    const matches = compileGlob('lcov.info');
    expect(matches?.('lcovXinfo')).toBe(false);
  });

  it('matches one path segment with `*` and none with `?` crossing a separator', () => {
    const star = compileGlob('packages/*/coverage.out');
    expect(star?.('packages/app/coverage.out')).toBe(true);
    expect(star?.('packages/app/nested/coverage.out')).toBe(false);
    const question = compileGlob('lcov.?');
    expect(question?.('lcov.x')).toBe(true);
    expect(question?.('lcov.xy')).toBe(false);
  });

  it('crosses separators with `**`', () => {
    const deep = compileGlob('**/coverage/lcov.dat');
    expect(deep?.('coverage/lcov.dat')).toBe(true);
    expect(deep?.('packages/api/coverage/lcov.dat')).toBe(true);
    expect(deep?.('packages/api/lcov.dat')).toBe(false);
  });

  it('reads an unterminated bracket as a literal, not as a character class', () => {
    // **The character class is built by escaping, not by translation.** A
    // filename may legitimately contain `[`, so the matcher treats an
    // unterminated bracket as the literal character it is rather than rejecting
    // the pattern — and a pattern that rejects nothing is a pattern that
    // silently drops its glob.
    const matches = compileGlob('lcov.[info');
    expect(matches?.('lcov.[info')).toBe(true);
    expect(matches?.('lcov.info')).toBe(false);
  });

  it('matches a trailing `**` with no slash after it, and one in the middle', () => {
    // The third form, and the one the first two branches do not cover: `**` at
    // the end of a pattern crosses separators without a trailing slash, which is
    // how a directory-prefix glob is written more often than with one.
    const trailing = compileGlob('coverage/**');
    expect(trailing?.('coverage/a.dat')).toBe(true);
    expect(trailing?.('coverage/nested/b.dat')).toBe(true);
    expect(trailing?.('other/a.dat')).toBe(false);
    const middle = compileGlob('packages/**/coverage.out');
    expect(middle?.('packages/api/coverage.out')).toBe(true);
    expect(middle?.('packages/coverage.out')).toBe(true);
  });
});

describe('selectCoverageArtifacts', () => {
  const artifacts = [
    artifact('packages/api/coverage/lcov.dat', new Uint8Array([1, 2, 3])),
    artifact('packages/web/coverage/cobertura.xml', new Uint8Array([4])),
    artifact('packages/api/src/index.ts'),
  ];

  it('matches the declared filename and keeps the glob’s own format', () => {
    const found = selectCoverageArtifacts(artifacts, [
      { glob: 'packages/*/coverage/lcov.dat', format: 'lcov' },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.artifact.path).toBe('packages/api/coverage/lcov.dat');
    expect(found[0]?.glob.format).toBe('lcov');
  });

  it('selects whatever a declared glob names, and the parse is what rejects it', () => {
    // **The rule, and the thing it refuses to do.** A source file matched by a
    // coverage glob *is* selected: the caller declared the glob, and the parse
    // is where a `.ts` offered as lcov is refused. A matcher that filtered by
    // extension would be a second parser of the caller's own declaration — and
    // a repository whose coverage report is genuinely named `.ts` would lose it.
    const found = selectCoverageArtifacts(artifacts, [
      { glob: 'packages/*/src/*.ts', format: 'lcov' },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.artifact.path).toBe('packages/api/src/index.ts');
  });

  it('takes the first artifact a glob matches, deterministically', () => {
    const found = selectCoverageArtifacts(
      [
        artifact('a/coverage/x.dat', new Uint8Array([1])),
        artifact('b/coverage/x.dat', new Uint8Array([2])),
      ],
      [{ glob: '**/coverage/x.dat', format: 'go-coverprofile' }],
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.artifact.path).toBe('a/coverage/x.dat');
  });

  it('contributes nothing for a glob that matches no artifact', () => {
    // A glob with no match is not an error and not a zero: it is a declaration
    // about a file this run did not produce. The caller's merge is what decides
    // whether that leaves a surface unmeasured, and it decides that on its own
    // data rather than on a synthetic empty report.
    const found = selectCoverageArtifacts(artifacts, [
      { glob: 'does/not/exist/*.dat', format: 'lcov' },
      { glob: 'packages/[api/coverage/*.dat', format: 'lcov' },
    ]);
    expect(found).toEqual([]);
  });
});

describe('uncoveredModulesFrom', () => {
  it('names the files with executable lines and none covered, largest first', () => {
    const modules = uncoveredModulesFrom([
      { path: 'src/small.ts', coveredLines: 0, totalLines: 3 },
      { path: 'src/large.ts', coveredLines: 0, totalLines: 482 },
      { path: 'src/covered.ts', coveredLines: 10, totalLines: 10 },
    ]);
    expect(modules.map((module) => module.path)).toEqual(['src/large.ts', 'src/small.ts']);
  });

  it('does not count a file the report never named, because unknown is not uncovered', () => {
    // **The rule that keeps the score honest.** A report naming one file says
    // nothing about the other files in the repository; treating them as holes
    // would report a number nobody measured.
    expect(uncoveredModulesFrom([{ path: 'src/a.ts', coveredLines: 5, totalLines: 5 }])).toEqual(
      [],
    );
  });

  it('ignores a file with no executable lines, which is not a module', () => {
    expect(
      uncoveredModulesFrom([{ path: 'src/empty.ts', coveredLines: 0, totalLines: 0 }]),
    ).toEqual([]);
  });

  it('caps the list, and says so by taking the largest', () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      path: `src/f${index}.ts`,
      coveredLines: 0,
      totalLines: 200 - index,
    }));
    const modules = uncoveredModulesFrom(many);
    expect(modules).toHaveLength(50);
    expect(modules[0]?.path).toBe('src/f0.ts');
  });
});
