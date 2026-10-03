import { QaScoreSchema, type QaScore } from '@automate/shared-contracts';
import { PYRAMID_ROW, SCORE_CATEGORIES, SCORE_SURFACES } from '../vocabulary.js';
import type { PyramidLayer, ScoreCategory, ScoreSurface } from '../vocabulary.js';
import { buildCell, depth, stability, type CellComponents } from './cell.js';
import { flakeRate, isExecuted, qualifiesForPresence, type OutcomeObservation } from './flaky.js';
import { geometricMean, geometricRowWeights, type ScoreRow } from './geometric.js';
import { classifyHollow, meanValueScore } from './hollow.js';
import { pyramidShape } from './pyramid.js';
import { findStructural } from './structural.js';
import {
  cellKey,
  type CanonicalTestResult,
  type RunRecord,
  type ScoreInputs,
  type ScoreWeights,
} from './types.js';

/**
 * The derived QA Health Score.
 *
 * **A pure function. Not a table.** There is no `health_scores` row, and
 * `score()` reads `canonical_run_results`, coverage artifacts, the project
 * profile, `quality_gate_config` and `known_failures` through the port the caller
 * passes in. A stored total would be a fourth blocking number that has to agree
 * with the coverage floor, the performance threshold and the gate tier — the
 * `no-second-authority` shape, wearing a dashboard.
 *
 * Materialising a snapshot later is permitted **only** with a provenance column
 * recording the exact inputs it read, and only if deleting the table changes no
 * gate and no verdict. `scripts/lib/docs-drift.mjs` and the ledger ratchet are
 * the pattern to copy.
 */
/**
 * The score, as the wire contract.
 *
 * **Re-exported rather than declared.** This file used to export its own `QaScore`,
 * which is a second authority for a shape `@automate/shared-contracts` already owns —
 * and the two drifted: the contract said `readonly` arrays and a `string` `at`, this one said
 * mutable and an ISO string, so every consumer that passed a score straight through had to
 * cast. `score()` already returns `QaScoreSchema.parse(...)`, so the returned type and the
 * validated type are now the same declaration, and a drift between them is a compile error
 * rather than a runtime surprise.
 */
export type { QaScore } from '@automate/shared-contracts';

/** One missing thing, and what would close it. */
export interface Gap {
  category: ScoreCategory;
  surface: ScoreSurface;
  cell: string;
  /** The cell's current sub-score, so the queue can rank by what is missing. */
  current: number;
  /** How much the total would gain if the cell reached 1. */
  potential: number;
  /** What would close it. Derived, not generated. */
  cheapestClosure: string;
}

/** Everything the number was read from, so it can be explained without re-running. */
export interface ScoreProvenance {
  detectorVersion: number | null;
  projectId: string;
  runsRead: number;
  resultsRead: number;
  /** Runs excluded because they died for non-test reasons. Never folded into `failRate`. */
  infraFailedRuns: readonly string[];
  quarantinedFingerprints: readonly string[];
  /** The rate reported **separately** from `failRate`, exactly as plan §3.5 requires. */
  infraFailedRate: number;
  outcomeCounts: Readonly<Record<string, number>>;
}

/**
 * Computes the score.
 *
 * `inputs` is the whole window, already read. Splitting read from compute is what
 * makes every sub-score assertable against a hand-computed fixture, which is the
 * proof the plan asks for in §3.6 — a fixture project where each number was
 * calculated by hand and then compared.
 */
export function score(inputs: ScoreInputs, at: string): QaScore {
  const weights = inputs.profile.weights;
  const executed = inputs.results.filter((result) => isExecuted(result.outcome));
  const observations = groupObservations(inputs.results);
  const flakiness = flakeRate(inputs.results, observations);
  const verdicts = hollowVerdicts(inputs);
  const qualityRuns = inputs.runs.filter((run) => qualifiesForPresence(run));
  const runIdsWithResults = new Set(executed.map((result) => result.runId));

  const cells = SCORE_CATEGORIES.flatMap((category) =>
    SCORE_SURFACES.map((surface) =>
      buildCell(
        category,
        surface,
        cellComponents(
          inputs,
          category,
          surface,
          executed,
          flakiness,
          verdicts,
          // Presence is "did a suite for this cell complete at least one good
          // run", so it is the count of qualifying runs that produced a result in
          // this cell — precomputed as a set membership rather than a scan per
          // cell, which was quadratic before.
          qualityRuns.filter((run) => runIdsWithResults.has(run.runId)),
        ),
        weights.cell,
      ),
    ),
  );

  const scored = cells.filter((cell) => !isExcluded(inputs, cell.category, cell.surface));
  const pyramid = pyramidShape(layerCounts(executed), inputs.profile.targets.pyramid);
  const rowWeights = geometricRowWeights(weights);
  const rows = SCORE_CATEGORIES.map((category) => rowFor(category, scored, rowWeights)).concat([
    {
      id: PYRAMID_ROW,
      value: pyramid.shape,
      weight: rowWeights[PYRAMID_ROW] ?? 0,
      includedCells: scored.length,
    } satisfies ScoreRow,
  ]);
  const general = geometricMean(rows, weights);

  // Validated against the wire contract **here**, at the source, rather than in the
  // route. The contract and this function were two declarations of one shape, and
  // they disagreed: the contract required `excluded` on every cell and `weight` on
  // every row, neither of which the score emitted, so the first request to
  // `GET /qa/score` failed its own schema check while every unit test of the
  // arithmetic passed. Parsing here means the score is incapable of producing a
  // shape the API cannot serve, and the failure lands next to the numbers.
  return QaScoreSchema.parse({
    projectId: inputs.projectId,
    at,
    total: general.total,
    cappedBy: general.cappedBy,
    cappingValue: general.cappingValue,
    cells,
    surfaces: surfaceRollups(scored),
    rows,
    pyramid,
    gaps: gapsFor(scored, weights),
    findings: findStructural({
      cells: scored,
      uncoveredModules: inputs.uncoveredModules,
      singleLayerE2eFingerprints: inputs.singleLayerE2eFingerprints,
    }),
    provenance: provenance(inputs),
    weights,
  });
}

/**
 * A cell marked `n/a` is **excluded and its weight renormalised**.
 *
 * Without this a frontend-only repository scores `0` forever, because two thirds
 * of its matrix has no backend to test. That is the single fastest way to lose a
 * user's trust in a number, and it is why `excludedCells` is a declared state
 * rather than an inference from "no tests found".
 */
function isExcluded(inputs: ScoreInputs, category: ScoreCategory, surface: ScoreSurface): boolean {
  return inputs.profile.excludedCells.some(
    (cell) => cell.category === category && cell.surface === surface,
  );
}

function cellComponents(
  inputs: ScoreInputs,
  category: ScoreCategory,
  surface: ScoreSurface,
  executed: readonly CanonicalTestResult[],
  flakiness: ReturnType<typeof flakeRate>,
  verdicts: Map<string, ReturnType<typeof classifyHollow>>,
  qualifyingRuns: readonly RunRecord[],
) {
  const key = cellKey(category, surface);
  const excluded = isExcluded(inputs, category, surface);
  const inCell = executed.filter(
    (result) => result.category === category && result.surface === surface,
  );
  const fingerprints = new Set(inCell.map((result) => result.fingerprint));
  const cellFlaky = flakiness.strong.filter((fingerprint) => fingerprints.has(fingerprint));
  const cellHollow = [...fingerprints].filter(
    (fingerprint) => verdicts.get(fingerprint)?.hollow === true,
  );
  const coverage = inputs.coverage?.bySurface[surface] ?? null;
  const cellFlakeRate = fingerprints.size === 0 ? 0 : cellFlaky.length / fingerprints.size;

  return {
    excluded,
    presence: qualifyingRuns.some((run) => inCell.some((result) => result.runId === run.runId))
      ? 1
      : 0,
    depth: depth(
      inCell.length,
      inputs.profile.targets.testsPerCell[key] ?? 0,
      coverage,
      inputs.profile.targets.coverageTarget[surface] ?? null,
    ),
    stability: stability(cellFlakeRate),
    signal: meanValueScore(
      [...fingerprints].map((fingerprint) => verdicts.get(fingerprint)).filter(isDefined),
    ),
    inputs: {
      executedTests: inCell.length,
      targetTests: inputs.profile.targets.testsPerCell[key] ?? 0,
      surfaceCoverage: coverage,
      coverageTarget: inputs.profile.targets.coverageTarget[surface] ?? null,
      flakeRate: cellFlakeRate,
      failedFingerprints: [
        ...new Set(inCell.filter((r) => r.outcome === 'failed').map((r) => r.fingerprint)),
      ],
      flakyFingerprints: cellFlaky,
      hollowFingerprints: cellHollow,
      qualifyingRuns: qualifyingRuns.filter((run) =>
        inCell.some((result) => result.runId === run.runId),
      ).length,
    },
  };
}

/** The mean of a category's included cells, with the weight the mean was taken under. */
function rowFor(
  category: ScoreCategory,
  scored: readonly CellComponents[],
  rowWeights: Readonly<Record<string, number>>,
): ScoreRow {
  const group = scored.filter((cell) => cell.category === category);
  return {
    id: category,
    value: mean(group.map((cell) => cell.score)),
    // Carried on the row because the contract requires it and because a score
    // whose weights are not shown cannot be argued with.
    weight: rowWeights[category] ?? 0,
    includedCells: group.length,
  };
}

/** The column rollups the plan's "backend score" and "frontend score" are. */
function surfaceRollups(scored: readonly CellComponents[]): Record<ScoreSurface, number> {
  return Object.fromEntries(
    SCORE_SURFACES.map((surface) => {
      const group = scored.filter((cell) => cell.surface === surface);
      return [surface, mean(group.map((cell) => cell.score))];
    }),
  ) as Record<ScoreSurface, number>;
}

/** Executed tests per pyramid layer, for the shape. */
function layerCounts(executed: readonly CanonicalTestResult[]): Record<PyramidLayer, number> {
  const counts: Record<PyramidLayer, number> = { unit: 0, integration: 0, e2e: 0 };
  for (const result of executed) {
    if (
      result.category === 'unit' ||
      result.category === 'integration' ||
      result.category === 'e2e'
    ) {
      counts[result.category] += 1;
    }
  }
  return counts;
}

/**
 * The automation gaps, ranked by what closing them is worth.
 *
 * Ranked by `potential` alone rather than by `impact ÷ effort`, because effort is
 * not measurable from the rows this function reads — inventing an effort estimate
 * would put a number on the dashboard that no input supports, which is the failure
 * this section exists to prevent. The cheapest-closure *text* is derived from the
 * cell; the ranking is arithmetic.
 */
function gapsFor(scored: readonly CellComponents[], weights: ScoreWeights): Gap[] {
  return scored
    .filter((cell) => cell.score < 1)
    .map((cell) => ({
      category: cell.category,
      surface: cell.surface,
      cell: cell.key,
      current: cell.score,
      // The cell is one sixth of the total at most, so this is an upper bound on
      // what closing it is worth, not an estimate of what it will be worth.
      potential: (1 - cell.score) * weights.cell.depth,
      cheapestClosure: closureFor(cell),
    }))
    .sort((left, right) => right.potential - left.potential || left.cell.localeCompare(right.cell));
}

/**
 * What would close the cell, named from its own weakest component.
 *
 * Derived from the components rather than generated: a cell with `presence 0` is
 * closed by running the suite that does not exist yet, and a cell with `depth 0`
 * by writing tests — and the two need completely different work, so a report that
 * said "improve coverage" for both would be wrong half the time.
 */
function closureFor(cell: CellComponents): string {
  if (cell.presence === 0) {
    return `No suite has completed a run for ${cell.key}. Add the ${cell.category} suite and register a command for it.`;
  }
  if (cell.depth === 0)
    return `${cell.key} runs but covers nothing. Add tests, or delete the suite.`;
  if (cell.stability < cell.signal) {
    return `${cell.key} is flaky: ${cell.inputs.flakyFingerprints.length} fingerprint(s) flip. Fix or quarantine them.`;
  }
  return `${cell.key} has low test value: ${cell.inputs.hollowFingerprints.length} hollow test(s).`;
}

function provenance(inputs: ScoreInputs): ScoreProvenance {
  const infraFailedRuns = inputs.runs
    .filter((run) => !run.countsTowardsQuality)
    .map((run) => run.runId);
  const outcomeCounts: Record<string, number> = {};
  for (const result of inputs.results) {
    outcomeCounts[result.outcome] = (outcomeCounts[result.outcome] ?? 0) + 1;
  }
  return {
    detectorVersion: inputs.profile.detectorVersion,
    projectId: inputs.projectId,
    runsRead: inputs.runs.length,
    resultsRead: inputs.results.length,
    infraFailedRuns,
    // **Reported separately and never folded into `failRate`** — plan §2.2 and
    // §3.5. A run that died because the machine fell over says nothing about the
    // code, and mixing the two is how a QA dashboard starts lying about a team.
    infraFailedRate: inputs.runs.length === 0 ? 0 : infraFailedRuns.length / inputs.runs.length,
    quarantinedFingerprints: inputs.quarantined,
    outcomeCounts,
  };
}

function groupObservations(
  results: readonly CanonicalTestResult[],
): Map<string, OutcomeObservation[]> {
  const grouped = new Map<string, OutcomeObservation[]>();
  for (const result of results) {
    const list = grouped.get(result.fingerprint) ?? [];
    list.push({
      fingerprint: result.fingerprint,
      runId: result.runId,
      commitSha: result.commitSha,
      outcome: result.outcome,
    });
    grouped.set(result.fingerprint, list);
  }
  return grouped;
}

/** Hollow verdicts per fingerprint, over every observation in the window. */
function hollowVerdicts(inputs: ScoreInputs): Map<string, ReturnType<typeof classifyHollow>> {
  const byFingerprint = new Map<string, CanonicalTestResult[]>();
  for (const result of inputs.results) {
    const list = byFingerprint.get(result.fingerprint) ?? [];
    list.push(result);
    byFingerprint.set(result.fingerprint, list);
  }
  const ordered = [...byFingerprint.keys()].sort();
  const verdicts = new Map<string, ReturnType<typeof classifyHollow>>();
  for (const fingerprint of ordered) {
    const observations = byFingerprint.get(fingerprint) ?? [];
    verdicts.set(
      fingerprint,
      classifyHollow(fingerprint, observations, trailingPasses(observations)),
    );
  }
  return verdicts;
}

/**
 * How many of a fingerprint's *trailing* observations passed.
 *
 * Trailing, because the trivially-true rule is about a test that has been green
 * this way for thirty runs — one green run of a hollow test proves nothing about
 * whether it is hollow.
 */
function trailingPasses(results: readonly CanonicalTestResult[]): number {
  const ordered = [...results].sort((left, right) => left.runId.localeCompare(right.runId));
  let passes = 0;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (ordered[index]?.outcome !== 'passed') break;
    passes += 1;
  }
  return passes;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
