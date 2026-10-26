import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareEvalRuns, type EvalCaseOutcomes } from './eval-regression.js';

/**
 * Property suite for EVAL-1 and EVAL-2.
 *
 * Fixed seed and `numRuns`, so a red run reproduces on any host. The generated runs are
 * deliberately awkward: repeated case ids, undecided attempts, null and out-of-range scores,
 * and runs too small to judge. The comparison's own `seed` is generated too, because EVAL-1
 * is a claim about every seed and not only the one a test happened to pick.
 */
const SEED = 20261025;
const params = { seed: SEED, numRuns: 200 } as const;

const attempt = fc.record({
  passed: fc.option(fc.boolean(), { nil: null }),
  scores: fc.array(
    fc.record({
      metric: fc.constantFrom('faithfulness', 'relevance', 'match'),
      score: fc.option(fc.double({ min: -2, max: 2, noNaN: true }), { nil: null }),
    }),
    { maxLength: 3 },
  ),
});

const run: fc.Arbitrary<EvalCaseOutcomes[]> = fc.array(
  fc.record({
    caseId: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'),
    attempts: fc.array(attempt, { maxLength: 25 }),
  }),
  { maxLength: 12 },
);

const options = fc.record({
  seed: fc.integer(),
  maxRegression: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
  minAttempts: fc.option(fc.integer({ min: 0, max: 50 }), { nil: undefined }),
});

/** Every attempt passed: the candidate EVAL-2 is about. */
const allPassing = (cases: EvalCaseOutcomes[]): EvalCaseOutcomes[] =>
  cases.map((row) => ({
    caseId: row.caseId,
    attempts: row.attempts.map((one) => ({ ...one, passed: true })),
  }));

describe('EVAL-1: an identical baseline and candidate is never a fail', () => {
  it('holds for any run and any seed', () => {
    fc.assert(
      fc.property(run, options, (cases, opts) => {
        const result = compareEvalRuns(cases, cases, opts);
        expect(result.verdict).not.toBe('fail');
        expect(result.regressions.filter((row) => row.significant)).toEqual([]);
        expect(result.newCases).toEqual([]);
        expect(result.removedCases).toEqual([]);
      }),
      params,
    );
  });

  it('pins the examples that sit on the boundary', () => {
    const examples: EvalCaseOutcomes[][] = [
      [],
      [{ caseId: 'a', attempts: [] }],
      [{ caseId: 'a', attempts: [{ passed: false, scores: [{ metric: 'm', score: 0 }] }] }],
      Array.from({ length: 3 }, () => ({
        caseId: 'a',
        attempts: Array.from({ length: 10 }, (_, index) => ({ passed: index < 9, scores: [] })),
      })),
    ];
    for (const cases of examples) {
      for (const seed of [0, 1, -1, 2 ** 31 - 1]) {
        expect(compareEvalRuns(cases, cases, { seed }).verdict).not.toBe('fail');
      }
    }
  });
});

describe('EVAL-2: a candidate whose every attempt passes never fails against any baseline', () => {
  it('holds for any baseline and any candidate made all-passing', () => {
    fc.assert(
      fc.property(run, run, options, (baseline, candidate, opts) => {
        const result = compareEvalRuns(baseline, allPassing(candidate), opts);
        expect(result.verdict).not.toBe('fail');
      }),
      params,
    );
  });

  it('pins a perfect baseline with far more attempts than the candidate', () => {
    // The floating-point edge: wilson(n, n).high must stay at 1, or a huge perfect baseline
    // would sit "credibly above" a small perfect candidate.
    const baseline: EvalCaseOutcomes[] = [
      { caseId: 'a', attempts: Array.from({ length: 5000 }, () => ({ passed: true, scores: [] })) },
    ];
    const candidate: EvalCaseOutcomes[] = [
      { caseId: 'a', attempts: [{ passed: true, scores: [] }] },
    ];
    expect(compareEvalRuns(baseline, candidate, { seed: 1, minAttempts: 1 }).verdict).toBe('pass');
  });
});

describe('the property harness can fail', () => {
  it('refutes the wrong claim that any candidate never fails', () => {
    const wrong = fc.check(
      fc.property(run, run, options, (baseline, candidate, opts) => {
        return compareEvalRuns(baseline, candidate, opts).verdict !== 'fail';
      }),
      {
        ...params,
        examples: [
          [
            [
              {
                caseId: 'a',
                attempts: Array.from({ length: 10 }, () => ({ passed: true, scores: [] })),
              },
            ],
            [
              {
                caseId: 'a',
                attempts: Array.from({ length: 10 }, () => ({ passed: false, scores: [] })),
              },
            ],
            { seed: 0, maxRegression: undefined, minAttempts: undefined },
          ],
        ],
      },
    );
    expect(wrong.failed).toBe(true);
  });
});
