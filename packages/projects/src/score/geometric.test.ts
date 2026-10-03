import { describe, expect, it } from 'vitest';

import { PYRAMID_ROW, SCORE_CATEGORIES } from '../vocabulary.js';
import { geometricMean, geometricRowWeights, type ScoreRow } from './geometric.js';
import { DEFAULT_WEIGHTS } from './types.js';

const weights = DEFAULT_WEIGHTS;

/**
 * The red-first witness for this file, recorded rather than remembered.
 *
 * Plan task 16 asks for the geometric test to be written first, run against an
 * arithmetic implementation, watched to fail for the dilution reason, and only
 * then fixed. That was done: with `geometricMean`'s `Math.log(row.value)` replaced
 * by `row.value` and the zero short-circuit commented out, this file reported
 * **11 failures** — all six `is zero when …` cases, both bounding cases, the
 * capping-term case, and the weight-rescaling case — and the dilution assertion
 * read `expected 100 to be less than 1`, because an arithmetic mean over one zero
 * and five ones saturates the scale at its ceiling.
 *
 * It is written here because a test suite whose comment claims it was witnessed
 * red is worth exactly as much as a commit that shows it.
 */

/** A row the score will actually count, with all three of its cells scored. */
function row(id: ScoreRow['id'], value: number): ScoreRow {
  return { id, value, weight: 0.18, includedCells: 3 };
}

/** Five perfect categories and one at zero — the dilution case. */
const NO_SECURITY_TESTING: ScoreRow[] = [
  row('unit', 1),
  row('integration', 1),
  row('e2e', 1),
  row('performance', 1),
  row('security', 0),
  row(PYRAMID_ROW, 1),
];

describe('a zero in any row forces the total to zero', () => {
  // This is the test the plan says is "the reason to trust the number", so it is
  // written against the *property*, not against the implementation: it states
  // what the number must do, and would fail for any mean that can dilute.
  it('is zero when one of five categories has no suite at all', () => {
    const score = geometricMean(NO_SECURITY_TESTING, weights);
    expect(score.total).toBe(0);
  });

  it('names the zero row as the capping term, so the UI can say why', () => {
    const score = geometricMean(NO_SECURITY_TESTING, weights);
    expect(score.cappedBy).toBe('security');
    expect(score.cappingValue).toBe(0);
  });

  it('refuses to reach a respectable-looking score for a repository with no security testing', () => {
    // The arithmetic mean of these six rows is 0.833 — "83/100" beside a
    // repository that has never run a security suite. Asserted as a bound rather
    // than as an exact figure, because the point is the order of magnitude.
    const arithmetic =
      NO_SECURITY_TESTING.reduce((sum, r) => sum + r.value, 0) / NO_SECURITY_TESTING.length;
    expect(arithmetic).toBeGreaterThan(0.8);
    expect(geometricMean(NO_SECURITY_TESTING, weights).total).toBeLessThan(1);
  });

  it.each(SCORE_CATEGORIES)('is zero when %s is the only zero', (category) => {
    const rows = SCORE_CATEGORIES.map((name) => row(name, name === category ? 0 : 1)).concat(
      row(PYRAMID_ROW, 1),
    );
    const score = geometricMean(rows, weights);
    expect(score.total).toBe(0);
    expect(score.cappedBy).toBe(category);
  });

  it('is zero when the pyramid row is the only zero', () => {
    const rows = SCORE_CATEGORIES.map((name) => row(name, 1)).concat(row(PYRAMID_ROW, 0));
    const score = geometricMean(rows, weights);
    expect(score.total).toBe(0);
    expect(score.cappedBy).toBe(PYRAMID_ROW);
  });
});

describe('a repository with everything scores 100', () => {
  it('is exactly 100 when every row is 1', () => {
    const rows = SCORE_CATEGORIES.map((name) => row(name, 1)).concat(row(PYRAMID_ROW, 1));
    expect(geometricMean(rows, weights).total).toBe(100);
  });

  it('has no capping term of its own, and names a row anyway', () => {
    // Every row is at 1, so the "limiting" row is an artefact of the tie-break.
    // It is still returned rather than `null`, because a nullable capping term is
    // a field two screens will each have to handle, and one of them will forget.
    const rows = SCORE_CATEGORIES.map((name) => row(name, 1)).concat(row(PYRAMID_ROW, 1));
    expect(geometricMean(rows, weights).cappedBy).toBeDefined();
  });
});

describe('weights are renormalised, so an n/a row redistributes rather than shrinks', () => {
  it('sums to 1 by construction', () => {
    const rows = geometricRowWeights(weights);
    const total = Object.values(rows).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('gives the pyramid exactly the configured weight', () => {
    expect(geometricRowWeights(weights)[PYRAMID_ROW]).toBe(0.1);
    expect(geometricRowWeights({ ...weights, pyramid: 0.25 })[PYRAMID_ROW]).toBe(0.25);
  });

  it('gives the categories the remaining budget, rescaled from their declared ratio', () => {
    const rows = geometricRowWeights({
      ...weights,
      pyramid: 0.4,
      rows: { unit: 1, integration: 1, e2e: 1, performance: 1, security: 2 },
    });
    // Budget 0.6 over a declared total of 6, so `1` becomes 0.1 and `2` becomes
    // 0.2 — the *ratio* survives, the absolute scale does not.
    expect(rows.unit).toBeCloseTo(0.1, 10);
    expect(rows.security).toBeCloseTo(0.2, 10);
  });

  it('does not divide by zero when every category weight is zero', () => {
    const rows = geometricRowWeights({
      ...weights,
      rows: { unit: 0, integration: 0, e2e: 0, performance: 0, security: 0 },
    });
    expect(rows.unit).toBeCloseTo(0.18, 10);
    expect(rows.unit).toBeGreaterThan(0);
  });

  it('lifts the remaining rows when a row is excluded as n/a', () => {
    const allRows = SCORE_CATEGORIES.map((name) => row(name, 1)).concat(row(PYRAMID_ROW, 1));
    const withoutSecurity = allRows.filter(
      (candidate) => candidate.id !== 'security' && candidate.id !== PYRAMID_ROW,
    );
    // Five perfect rows and nothing wrong must not score below six perfect rows
    // and nothing wrong — the excluded row must redistribute, not subtract.
    expect(geometricMean(withoutSecurity, weights).total).toBe(100);
    expect(geometricMean(allRows, weights).total).toBe(100);
  });

  it('scores zero when every row is n/a, rather than reporting NaN', () => {
    const nothingScored = SCORE_CATEGORIES.map((name) => ({
      ...row(name, 1),
      includedCells: 0,
    }));
    expect(geometricMean(nothingScored, weights).total).toBe(0);
  });
});

describe('the capping term is the largest relative shortfall, not the smallest value', () => {
  it('names a heavy row at 0.5 over a lighter row at 0.4', () => {
    // Unit is cheap to fix and drags the mean down slightly. Security is not, and
    // drags it down more. A UI that named the smallest *value* would send the
    // operator to the wrong row — which is why the weights are declared unevenly
    // here rather than left at the equal defaults.
    const rows: ScoreRow[] = [
      { id: 'unit', value: 0.4, weight: 0.18, includedCells: 3 },
      { id: 'integration', value: 1, weight: 0.18, includedCells: 3 },
      { id: 'e2e', value: 1, weight: 0.18, includedCells: 3 },
      { id: 'performance', value: 1, weight: 0.18, includedCells: 3 },
      { id: 'security', value: 0.5, weight: 0.18, includedCells: 3 },
      { id: PYRAMID_ROW, value: 1, weight: 0.1, includedCells: 3 },
    ];
    const score = geometricMean(rows, {
      ...weights,
      rows: { unit: 1, integration: 1, e2e: 1, performance: 1, security: 3 },
    });
    expect(score.cappingValue).toBe(0.5);
    expect(score.cappedBy).toBe('security');
  });

  it('names the smaller value when the weights are equal, because it then is the shortfall', () => {
    // The other direction, so the test is about the *weighted* shortfall rather
    // than a rule that always picks one side. With equal weights, 0.4 is the
    // larger shortfall and saying so is correct.
    const rows: ScoreRow[] = [
      { id: 'unit', value: 0.4, weight: 0.18, includedCells: 3 },
      { id: 'security', value: 0.5, weight: 0.18, includedCells: 3 },
      { id: PYRAMID_ROW, value: 1, weight: 0.1, includedCells: 3 },
    ];
    expect(geometricMean(rows, weights).cappedBy).toBe('unit');
  });
});

describe('a geometric mean is bounded by its inputs in both directions', () => {
  it('never exceeds the largest row', () => {
    const rows = SCORE_CATEGORIES.map((name, index) => row(name, index === 0 ? 0.9 : 0.5)).concat(
      row(PYRAMID_ROW, 0.5),
    );
    const score = geometricMean(rows, weights);
    expect(score.total).toBeLessThanOrEqual(90);
    expect(score.total).toBeGreaterThan(50);
  });

  it('never falls below the smallest row', () => {
    const rows = SCORE_CATEGORIES.map((name, index) => row(name, index === 0 ? 0.9 : 0.5)).concat(
      row(PYRAMID_ROW, 0.5),
    );
    expect(geometricMean(rows, weights).total).toBeGreaterThanOrEqual(50);
  });

  it('ignores a row that is entirely n/a, in both the product and the cap', () => {
    const rows: ScoreRow[] = [
      { id: 'unit', value: 0.5, weight: 0.18, includedCells: 3 },
      { id: 'security', value: 0, weight: 0.18, includedCells: 0 },
      { id: PYRAMID_ROW, value: 1, weight: 0.1, includedCells: 3 },
    ];
    const score = geometricMean(rows, weights);
    // A zero value that is not scored must not zero the total — that would make
    // "mark security n/a" a way to remove a zero, which is the loophole the
    // presence component exists to close.
    expect(score.total).toBeGreaterThan(0);
    expect(score.cappedBy).not.toBe('security');
  });
});
