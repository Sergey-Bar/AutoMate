/**
 * The score's two axes — **re-exported, not declared**.
 *
 * These lists live in `@automate/shared-contracts` because four packages need
 * them: the score computes with them, `run-command` declares commands against
 * them, the web client renders them, and this package detects which test
 * framework feeds which one. A second copy in a leaf package would be the exact
 * defect `RUN_PHASES` was — two lists that a schema test catches only when someone
 * remembers to look.
 *
 * Re-exporting costs nothing: this package already depends on `shared-contracts`.
 */
export {
  PYRAMID_LAYERS,
  PYRAMID_ROW,
  SCORE_CATEGORIES,
  SCORE_SURFACES,
  type PyramidLayer,
  type ScoreCategory,
  type ScoreRowId,
  type ScoreSurface,
} from '@automate/shared-contracts';

import { SCORE_CATEGORIES, type ScoreCategory } from '@automate/shared-contracts';

export function isScoreCategory(value: unknown): value is ScoreCategory {
  return typeof value === 'string' && (SCORE_CATEGORIES as readonly string[]).includes(value);
}
