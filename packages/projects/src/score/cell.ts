import type { ScoreWeights } from './types.js';
import { cellKey } from './types.js';
import type { ScoreCategory, ScoreSurface } from '../vocabulary.js';

/**
 * One matrix cell's four components and the sub-score they combine into.
 *
 * Every field is carried, not just the result. A cell whose inputs are gone is a
 * number nobody can explain, and a number nobody can explain is a number nobody
 * trusts — which is the failure mode this whole section exists to avoid.
 */
export interface CellComponents {
  /** `unit:backend` — the key a target and a contract field share. */
  key: string;
  category: ScoreCategory;
  surface: ScoreSurface;
  /**
   * Declared `n/a` by the project, so excluded from the total with its weight
   * redistributed rather than scored as zero.
   *
   * Carried on every cell rather than only the excluded ones because the API
   * serves the full 6×3 matrix and a client must be able to tell "absent" from
   * "not sent" without a second request.
   */
  excluded: boolean;
  /** `0` or `1`. Multiplicative, so an absent category is `0` and not a small number. */
  presence: number;
  depth: number;
  stability: number;
  signal: number;
  /** `presence · (wD·depth + wS·stability + wQ·signal)`, in `[0,1]`. */
  score: number;
  /** The raw counts the components were computed from, for the provenance panel. */
  inputs: CellInputs;
}

export interface CellInputs {
  executedTests: number;
  targetTests: number;
  surfaceCoverage: number | null;
  coverageTarget: number | null;
  flakeRate: number;
  /**
   * Fingerprints whose last outcome was `failed`.
   *
   * **Distinct from `flakyFingerprints`, and the difference is the whole point.**
   * Flaky means the outcome *flipped* — the test is unreliable. Failed means it
   * failed, every time, which is a defect or a gap rather than noise. A cell that
   * could only report the first could not tell a reader "this suite is
   * consistently red", and the copilot's regression-suite draft has nothing to
   * draft from: a cluster is repeated *failures*, not repeated flips.
   */
  failedFingerprints: readonly string[];
  flakyFingerprints: readonly string[];
  hollowFingerprints: readonly string[];
  qualifyingRuns: number;
}

/**
 * **depth** `D`, from two halves that are only averaged when both are measurable.
 *
 * `D = wTest · min(1, executed/target) + wCoverage · min(1, coverage/target)`,
 * renormalised over the halves that exist.
 *
 * Two halves because a suite can be wide and shallow — 400 assertions against one
 * function — and either half alone is gameable in its own direction. The count
 * half is gameable by writing trivial tests; the coverage half is not, because
 * the coverage artifact is measured rather than declared. That is also why the
 * hollow component exists: the count half's failure mode needs its own row.
 *
 * ## An unmeasured half is dropped, not scored as full or as zero
 *
 * A repository with no coverage plugin has no coverage number. Scoring that half
 * as `1` would make every repository without a coverage tool look maximally deep,
 * which is the optimistic failure and the more expensive one: it inflates the
 * number nobody is checking. Scoring it as `0` would make it look maximally
 * shallow, which is the pessimistic failure, and it is the lie the plan names —
 * a repository is not shallow for lacking a reporting plugin.
 *
 * So the half is dropped and the other carries full weight. A target of `0` is
 * treated the same way: a cell with no declared target has told us nothing about
 * its intended size, and `NaN` in a score is worse than a saturated half.
 */
export function depth(
  executed: number,
  target: number,
  coverage: number | null,
  coverageTarget: number | null,
): number {
  const halves: number[] = [];
  if (target > 0) halves.push(ratioSaturated(executed, target));
  if (coverage !== null && coverageTarget !== null && coverageTarget > 0) {
    halves.push(ratioSaturated(coverage, coverageTarget));
  }
  if (halves.length === 0) return 1;
  return halves.reduce((total, half) => total + half, 0) / halves.length;
}

/** `min(1, value/target)`, with a zero or absent target saturating rather than dividing. */
export function ratioSaturated(value: number, target: number): number {
  if (target <= 0) return 1;
  return Math.min(1, Math.max(0, value / target));
}

/** **stability** `S = 1 − flakeRate`, clamped to `[0,1]`. */
export function stability(flakeRateValue: number): number {
  return Math.min(1, Math.max(0, 1 - flakeRateValue));
}

/**
 * `cell = presence · (wDepth·depth + wStability·stability + wSignal·signal)`.
 *
 * **Presence is multiplicative and that is the point.** An absent category is
 * `0`, not `0.05` — a suite that has never run cannot be partially present, and a
 * small number for it would let five working categories average away the one that
 * does not exist.
 */
export function cellScore(
  components: Omit<CellComponents, 'score' | 'category' | 'surface' | 'key'>,
  weights: ScoreWeights['cell'],
): Pick<CellComponents, 'score'> {
  const weighted =
    weights.depth * components.depth +
    weights.stability * components.stability +
    weights.signal * components.signal;
  const score = components.presence * Math.min(1, Math.max(0, weighted));
  return { score };
}

/** Assembles a full cell record from its four components. */
export function buildCell(
  category: ScoreCategory,
  surface: ScoreSurface,
  components: Omit<CellComponents, 'score' | 'category' | 'surface' | 'key'>,
  weights: ScoreWeights['cell'],
): CellComponents {
  return {
    key: cellKey(category, surface),
    category,
    surface,
    ...components,
    ...cellScore(components, weights),
  };
}
