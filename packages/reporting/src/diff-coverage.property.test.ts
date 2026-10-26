import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { diffCoverage, parseUnifiedDiff, type LineCoverageInput } from './diff-coverage.js';

/**
 * Property suite for DIFFCOV-1 to DIFFCOV-4.
 *
 * Fixed seed and `numRuns`. The diff generator writes hunk content that looks like
 * headers on purpose — `--- x`, `+++ y`, `diff --git`, `@@` — because a parser that reads
 * the first character instead of counting hunk lines is the usual way to get this wrong.
 */
const SEED = 20261103;
const params = { seed: SEED, numRuns: 300 } as const;

const PATHS = ['src/a.ts', 'src/b.ts', 'lib/c.go', 'docs/d.md'] as const;
const line = fc.integer({ min: 1, max: 40 });

const changedMap = fc
  .array(fc.tuple(fc.constantFrom(...PATHS), fc.uniqueArray(line, { maxLength: 12 })), {
    maxLength: 4,
  })
  .map((entries) => new Map(entries.map(([path, lines]) => [path, new Set(lines)])));

const coverageReport: fc.Arbitrary<LineCoverageInput> = fc
  .uniqueArray(
    fc.record({
      path: fc.constantFrom(...PATHS.map((path) => `/ci/repo/${path}`), ...PATHS),
      executable: fc.uniqueArray(line, { maxLength: 30 }),
      coveredShare: fc.array(fc.boolean(), { maxLength: 30 }),
    }),
    { selector: (file) => file.path.replace('/ci/repo/', ''), maxLength: 4 },
  )
  .map((files) => ({
    files: files.map(({ path, executable, coveredShare }) => ({
      path,
      executable,
      covered: executable.filter((_value, index) => coveredShare[index] === true),
    })),
  }));

describe('DIFFCOV-1: an empty diff has no ratio, never 100%', () => {
  it('holds for the empty diff against any report, and for a diff with nothing executable', () => {
    fc.assert(
      fc.property(coverageReport, changedMap, (report, changed) => {
        expect(diffCoverage(parseUnifiedDiff(''), report).ratio).toBeNull();
        const result = diffCoverage(changed, report);
        if (result.executable === 0) expect(result.ratio).toBeNull();
        else expect(result.ratio).not.toBeNull();
      }),
      params,
    );
  });
});

describe('DIFFCOV-2: marking one more changed executable line covered never lowers the ratio', () => {
  it('holds, and the ratio strictly rises', () => {
    fc.assert(
      fc.property(coverageReport, changedMap, fc.nat(), (report, changed, pick) => {
        const before = diffCoverage(changed, report);
        const candidates = before.uncovered.flatMap(({ path, lines }) =>
          lines.map((value) => ({ path, value })),
        );
        fc.pre(candidates.length > 0);
        const target = candidates[pick % candidates.length] as { path: string; value: number };
        const raised: LineCoverageInput = {
          files: report.files.map((file) =>
            file.path.endsWith(target.path) && file.executable.includes(target.value)
              ? { ...file, covered: [...file.covered, target.value] }
              : file,
          ),
        };
        const after = diffCoverage(changed, raised);
        expect(after.ratio as number).toBeGreaterThan(before.ratio as number);
        expect(after.executable).toBe(before.executable);
      }),
      params,
    );
  });
});

describe('DIFFCOV-3: parsing a unified diff recovers exactly its added new-file lines', () => {
  type Op = { kind: 'ctx' | 'add' | 'del'; text: string };
  const text = fc.constantFrom('x', '-- c', '++ i', '+++ y', '--- z', 'diff --git a b', '@@', '');
  const op: fc.Arbitrary<Op> = fc.record({ kind: fc.constantFrom('ctx', 'add', 'del'), text });
  const file = fc.record({
    path: fc.constantFrom(...PATHS),
    start: fc.integer({ min: 1, max: 30 }),
    ops: fc.array(op, { minLength: 1, maxLength: 20 }),
  });
  const files = fc.uniqueArray(file, { selector: (entry) => entry.path, maxLength: 4 });

  function render(entries: readonly { path: string; start: number; ops: Op[] }[]): string {
    const out: string[] = [];
    for (const { path, start, ops } of entries) {
      const oldCount = ops.filter((entry) => entry.kind !== 'add').length;
      const newCount = ops.filter((entry) => entry.kind !== 'del').length;
      out.push(`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`);
      out.push(`@@ -${String(start)},${String(oldCount)} +${String(start)},${String(newCount)} @@`);
      for (const entry of ops) {
        const marker = entry.kind === 'add' ? '+' : entry.kind === 'del' ? '-' : ' ';
        out.push(`${marker}${entry.text}`);
      }
    }
    return out.join('\n');
  }

  function expected(entries: readonly { path: string; start: number; ops: Op[] }[]) {
    const result: Record<string, number[]> = {};
    for (const { path, start, ops } of entries) {
      let at = start;
      for (const entry of ops) {
        if (entry.kind === 'add') (result[path] ??= []).push(at);
        if (entry.kind !== 'del') at += 1;
      }
    }
    return result;
  }

  const read = (diff: string) =>
    Object.fromEntries([...parseUnifiedDiff(diff)].map(([path, set]) => [path, [...set]]));

  it('holds with LF and with CRLF line endings', () => {
    fc.assert(
      fc.property(files, fc.boolean(), (entries, crlf) => {
        const diff = render(entries);
        expect(read(crlf ? diff.replace(/\n/gu, '\r\n') : diff)).toEqual(expected(entries));
      }),
      {
        ...params,
        examples: [
          // A removed SQL comment and an added `+++` line inside one hunk.
          [
            [
              {
                path: 'src/a.ts',
                start: 1,
                ops: [
                  { kind: 'del', text: '-- c' },
                  { kind: 'add', text: '++ i' },
                ],
              },
            ],
            false,
          ],
        ],
      },
    );
  });
});

describe('DIFFCOV-4: the counts are consistent with the listed lines', () => {
  it('covered ≤ executable, the ratio is in [0, 1], and uncovered lines account for the gap', () => {
    fc.assert(
      fc.property(coverageReport, changedMap, (report, changed) => {
        const result = diffCoverage(changed, report);
        const missed = result.uncovered.reduce((sum, file) => sum + file.lines.length, 0);
        expect(result.covered).toBeLessThanOrEqual(result.executable);
        expect(missed).toBe(result.executable - result.covered);
        if (result.ratio !== null) {
          expect(result.ratio).toBeGreaterThanOrEqual(0);
          expect(result.ratio).toBeLessThanOrEqual(1);
        }
      }),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes the wrong claim that a diff with no executable lines is fully covered', () => {
    const result = fc.check(
      fc.property(coverageReport, changedMap, (report, changed) => {
        const outcome = diffCoverage(changed, report);
        return outcome.executable > 0 || outcome.ratio === 1;
      }),
      params,
    );
    expect(result.failed).toBe(true);
  });

  it('refutes the wrong claim that covering a line never changes the ratio', () => {
    const result = fc.check(
      fc.property(coverageReport, changedMap, (report, changed) => {
        const before = diffCoverage(changed, report).ratio;
        const all: LineCoverageInput = {
          files: report.files.map((file) => ({ ...file, covered: [...file.executable] })),
        };
        return diffCoverage(changed, all).ratio === before;
      }),
      params,
    );
    expect(result.failed).toBe(true);
  });
});
