import type { CellComponents } from './cell.js';
import type { ScoreCategory } from '../vocabulary.js';

/**
 * **Structural** findings — the highest-value signal in the product, and the one
 * nobody ships.
 *
 * Every one of these describes a suite that is *green* and worthless, or a
 * repository that is not testing what it appears to test. None of them is a
 * per-test property, which is why they cannot live in the hollow detector: hollow
 * looks at one test, structural looks at the shape of the whole.
 *
 * Each finding carries the cells it came from, so the risk queue can rank by
 * score impact rather than by how alarming the wording is.
 */
export type StructuralKind =
  | 'green_but_empty'
  | 'uncovered_surface'
  | 'dominant_cell'
  | 'single_layer_dependency';

export interface StructuralFinding {
  kind: StructuralKind;
  /** One sentence, naming the cells or the count it is about. */
  statement: string;
  /** Cells whose score the finding depresses. */
  cells: readonly string[];
  /** `0`–`1`. How much of the project's total this finding is worth. */
  impact: number;
}

/** Above this share, a category is effectively one cell and the matrix is fiction. */
export const DOMINANT_CELL_THRESHOLD = 0.8;

/** A cell with no tests at all, which cannot be counted in a denominator. */
const MINIMUM_CELL_TESTS = 1;

export interface StructuralInputs {
  cells: readonly CellComponents[];
  /** Modules with zero tests in any category, as paths. */
  uncoveredModules: readonly string[];
  /** Executed e2e tests whose fingerprint also appears in a unit cell. */
  singleLayerE2eFingerprints: readonly string[];
}

/**
 * Finds every structural defect in the window.
 *
 * Reported rather than scored: none of these changes the geometric mean. A cell
 * that is present, deep, stable and non-hollow but dominates its category has
 * *earned* its number by the formula, and silently discounting it would be a
 * fourth rule nobody could see. The findings go to the risk queue instead, which
 * is where "what should I fix next" is answered.
 */
export function findStructural(inputs: StructuralInputs): StructuralFinding[] {
  return [
    ...greenButEmpty(inputs.cells),
    ...uncoveredSurface(inputs.cells, inputs.uncoveredModules),
    ...dominantCell(inputs.cells),
    ...singleLayerDependency(inputs.singleLayerE2eFingerprints),
  ];
}

/**
 * *Green but empty* — `presence = 1` and `depth = 0`.
 *
 * A suite exists, runs, passes, and covers nothing. The strongest form of the
 * finding is that `depth` is zero while `presence` is one: the cell is actively
 * claiming to be covered.
 */
function greenButEmpty(cells: readonly CellComponents[]): StructuralFinding[] {
  return cells
    .filter((cell) => cell.presence === 1 && cell.depth === 0)
    .map((cell) => ({
      kind: 'green_but_empty' as const,
      statement:
        `${cell.key} runs and passes but covers nothing: presence 1, depth 0. ` +
        `The suite is evidence that the command works, not that the code does.`,
      cells: [cell.key],
      impact: cell.score,
    }));
}

/** *Uncovered surface* — a module with zero tests in any category. */
function uncoveredSurface(
  cells: readonly CellComponents[],
  modules: readonly string[],
): StructuralFinding[] {
  if (modules.length === 0) return [];
  const keys = cells.filter((cell) => cell.score < 1).map((cell) => cell.key);
  return [
    {
      kind: 'uncovered_surface',
      statement:
        `${modules.length} module(s) have no test in any category` +
        `${modules.length > 5 ? '' : `: ${modules.slice(0, 5).join(', ')}`}. ` +
        `A suite that never loads a module cannot fail when it breaks.`,
      cells: keys,
      impact: Math.min(1, modules.length / 100),
    },
  ];
}

/** *Dominant cell* — more than 80% of a category's tests sit in one cell. */
function dominantCell(cells: readonly CellComponents[]): StructuralFinding[] {
  const findings: StructuralFinding[] = [];
  for (const [category, group] of byCategory(cells)) {
    const total = group.reduce((sum, cell) => sum + cell.inputs.executedTests, 0);
    if (total === 0) continue;
    const largest = [...group].sort(
      (left, right) => right.inputs.executedTests - left.inputs.executedTests,
    )[0];
    if (largest === undefined) continue;
    const share = largest.inputs.executedTests / total;
    if (share <= DOMINANT_CELL_THRESHOLD) continue;
    findings.push({
      kind: 'dominant_cell',
      statement:
        `${Math.round(share * 100)}% of the ${category} tests are in ${largest.key}, so the ` +
        `matrix reads as one cell rather than three.`,
      cells: [largest.key],
      impact: 1 - share,
    });
  }
  return findings;
}

/**
 * *Single-layer dependency* — an E2E suite asserting what a unit test should.
 *
 * Named for its cost rather than its correctness: the test passes, and the fast
 * feedback loop that would have caught the defect an hour earlier does not exist.
 */
function singleLayerDependency(fingerprints: readonly string[]): StructuralFinding[] {
  if (fingerprints.length === 0) return [];
  return [
    {
      kind: 'single_layer_dependency',
      statement:
        `${fingerprints.length} fingerprint(s) run at the e2e layer and also in a unit suite. ` +
        `They pass, and the fast loop that would have caught the defect is missing.`,
      cells: ['e2e:platform'],
      impact: Math.min(1, fingerprints.length / 50),
    },
  ];
}

function byCategory(cells: readonly CellComponents[]): Map<ScoreCategory, CellComponents[]> {
  const grouped = new Map<ScoreCategory, CellComponents[]>();
  for (const cell of cells) {
    const group = grouped.get(cell.category) ?? [];
    group.push(cell);
    grouped.set(cell.category, group);
  }
  return grouped;
}

/** A cell with fewer than `MINIMUM_CELL_TESTS` executed tests, which no denominator can include. */
export function isEmptyCell(cell: CellComponents): boolean {
  return cell.inputs.executedTests < MINIMUM_CELL_TESTS;
}
