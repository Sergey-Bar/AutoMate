import {
  PYRAMID_ROW,
  SCORE_CATEGORIES,
  type ScoreCategory,
  type ScoreRowId,
} from '../vocabulary.js';
import type { ScoreWeights } from './types.js';

/** One row's contribution to the general score. */
export interface ScoreRow {
  id: ScoreRowId;
  /** The row's own score, in `[0,1]`. */
  value: number;
  /**
   * The weight this row carried in the geometric mean, in `(0,1)`.
   *
   * Carried so a reader can recompute the product from the rows without also
   * holding the weights table — and so the API can serve the score without
   * re-deriving a number it was handed.
   */
  weight: number;
  /** How many of its cells were actually scored, versus marked `n/a`. */
  includedCells: number;
}

/** A total plus the row that limited it. */
export interface GeneralScore {
  /** `0`–`100`. */
  total: number;
  /** The lowest-weight-adjusted limiting row; the term that dragged the total down. */
  cappedBy: ScoreRowId;
  /** The capping row's own value, so the UI can say "capped by Security (0)". */
  cappingValue: number;
  rows: readonly ScoreRow[];
}

/**
 * The category weights, rescaled so the rows sum to `1`.
 *
 * `weights.rows` sums to `0.9` and `weights.pyramid` takes the remaining `0.10`,
 * so a caller can set the pyramid weight and the category weights follow. Written
 * as a function rather than a table because a table would be a second place for
 * the sum to be wrong.
 */
export function geometricRowWeights(weights: ScoreWeights): Record<ScoreRowId, number> {
  const categoryBudget = 1 - weights.pyramid;
  const declared = SCORE_CATEGORIES.map((category) => weights.rows[category]);
  const total = declared.reduce((sum, value) => sum + value, 0);
  const scaled = Object.fromEntries(
    SCORE_CATEGORIES.map((category, index) => [
      category,
      // A declared total of zero would divide by zero; an equal split is the
      // honest reading of "no category is worth more than another".
      total === 0
        ? categoryBudget / SCORE_CATEGORIES.length
        : (declared[index] ?? 0) * (categoryBudget / total),
    ]),
  ) as Record<ScoreCategory, number>;
  return { ...scaled, [PYRAMID_ROW]: weights.pyramid };
}

/**
 * `score = 100 · Π sᵢ^(wᵢ)` over the included rows.
 *
 * ## Geometric, and that is the load-bearing choice of the whole section
 *
 * An arithmetic mean lets five perfect categories average away a Security score
 * of `0` and print `78/100` next to a repository with no security testing at all.
 * A geometric mean cannot dilute a zero, which is the property that makes the
 * number worth defending in a review — and it is asserted as a test, because a
 * mean is exactly the kind of thing that gets "simplified" into an arithmetic one
 * by someone who did not read why it was not.
 *
 * The cost of that choice is that the number alone is undiagnosable, which is why
 * `GeneralScore` carries `cappedBy` and `cappingValue` and why the UI must always
 * render the capping cell. A geometric score without its limiting term is a worse
 * lie than an arithmetic one.
 *
 * ## Zero rows
 *
 * A row of `0` forces the total to `0`, which is correct and is the property the
 * test asserts. The alternative — dropping zero rows and renormalising — would
 * let a project delete its security row to improve its score, which is why
 * `n/a` exists as a *declared* state and this is not one.
 *
 * ## Empty
 *
 * With no rows at all the geometric mean is undefined, so it returns `0` rather
 * than `NaN`. A repository with nothing scored has not earned a score, and
 * reporting `NaN` in a JSON payload would break the client rather than inform it.
 */
export function geometricMean(rows: readonly ScoreRow[], weights: ScoreWeights): GeneralScore {
  const rowWeights = geometricRowWeights(weights);
  const scored = rows.filter((row) => row.includedCells > 0);
  if (scored.length === 0) {
    return { total: 0, cappedBy: PYRAMID_ROW, cappingValue: 0, rows };
  }

  // A zero row short-circuits: `log(0)` is `-Infinity` and the product is `0`, but
  // summing `-Infinity` is a way to end up with `NaN` if any other row is also
  // degenerate. The short-circuit states the property instead of computing it.
  const zeroRow = scored.find((row) => row.value <= 0);
  if (zeroRow !== undefined) {
    return { total: 0, cappedBy: zeroRow.id, cappingValue: 0, rows };
  }

  // Weights are renormalised over the scored rows, so an `n/a` row's weight is
  // redistributed rather than silently reducing every contribution.
  const weightSum = scored.reduce((total, row) => total + (rowWeights[row.id] ?? 0), 0);
  const logSum = scored.reduce((total, row) => {
    const weight = rowWeights[row.id] ?? 0;
    return total + (weight / weightSum) * Math.log(row.value);
  }, 0);

  return {
    total: clampHundred(Math.exp(logSum) * 100),
    ...cappedBy(scored, rowWeights, weightSum),
    rows,
  };
}

/**
 * The row that limited the total.
 *
 * The limiting term of a weighted geometric mean is the row contributing the
 * **most negative** weighted log term — the largest relative shortfall, not the
 * smallest raw value. Naming the smallest value instead would point at a row that
 * is fine: a unit row at `0.4` with a tiny weight contributes less than a security
 * row at `0.5` with a large one, and the security row is the one the operator has
 * to fix.
 */
function cappedBy(
  scored: readonly ScoreRow[],
  rowWeights: Readonly<Record<string, number>>,
  weightSum: number,
): { cappedBy: ScoreRowId; cappingValue: number } {
  let worst = scored[0] as ScoreRow;
  let worstContribution = Number.POSITIVE_INFINITY;
  for (const row of scored) {
    const weight = rowWeights[row.id] ?? 0;
    const contribution = (weight / weightSum) * Math.log(row.value);
    if (contribution < worstContribution) {
      worstContribution = contribution;
      worst = row;
    }
  }
  return { cappedBy: worst.id, cappingValue: worst.value };
}

function clampHundred(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
