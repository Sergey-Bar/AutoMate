import type { ScoreCategory, ScoreSurface } from '../vocabulary.js';

/**
 * What one canonical test result says.
 *
 * A structural copy of the `result` JSONB in `canonical_run_results`, because
 * `packages/projects` is a leaf that must not depend on `packages/db`, and
 * because the score must not re-derive outcomes the reporter already normalised.
 */
export interface CanonicalTestResult {
  /** Stable identity of a test across runs. Quarantine and flake both key on it. */
  fingerprint: string;
  runId: string;
  commitSha: string | null;
  /** `null` when the reporter declared no category — unattributable, not `unit`. */
  category: ScoreCategory | null;
  surface: ScoreSurface | null;
  outcome: TestOutcome;
  durationMs: number | null;
  /** Assertion/snapshot count the producer reported, when it reported one. */
  assertionCount: number | null;
  /**
   * How many of those assertions were trivially true — `expect(true)`,
   * `assert.ok(true)`, and the dozen spellings of each.
   *
   * **Separate from `assertionCount` because "no assertions" and "thirty
   * assertions that cannot fail" are different defects.** Folding them together
   * made the second hollow rule unreachable: it required every assertion count to
   * be zero, which is precisely the first rule's condition, so the thirty-passes
   * clause could never add anything the first had not already reported.
   */
  trivialAssertionCount: number | null;
  /** Whether the test's own trace touched a network, file, or database. */
  touchedIo: boolean | null;
}

/**
 * The outcome vocabulary the score reads.
 *
 * `infra_failed` is **not** one of these. It is a *run* outcome, and plan §2.2
 * excludes it from the pass rate: a run that died because the machine fell over
 * says nothing about the code under test, and folding it into `failRate` is how
 * a QA dashboard starts lying about a team.
 */
export const TEST_OUTCOMES = [
  'passed',
  'failed',
  'flaky',
  'skipped',
  'blocked',
  'unknown',
  'timed_out',
  'cancelled',
] as const;
export type TestOutcome = (typeof TEST_OUTCOMES)[number];

/** One run, at the granularity the score's presence component needs. */
export interface RunRecord {
  runId: string;
  startedAt: string;
  projectId: string;
  outcome: string | null;
  /** False for `infra_failed`/`timed_out`/`runner_lost` — never evidence of quality. */
  countsTowardsQuality: boolean;
  /** Measured surface coverage per surface, when a coverage artifact was ingested. */
  coverageBySurface: Readonly<Partial<Record<ScoreSurface, number>>> | null;
}

/**
 * Coverage already reduced to a fraction per surface, by whatever produced it.
 *
 * The values are `number | null` because **absent is not zero**. `null` is "no
 * coverage artifact covered this surface", which is an absent measurement; `0` is
 * "measured, and nothing is covered", which is a finding. The score's depth
 * component drops an unmeasured half rather than scoring it, so the distinction has
 * to survive all the way from the adapter to here.
 */
export interface CoverageSummary {
  bySurface: Readonly<Partial<Record<ScoreSurface, number | null>>>;
}

/** The whole window's evidence for one project. Read once; scored purely. */
export interface ScoreInputs {
  projectId: string;
  profile: {
    /** Carried into provenance so a score can name the detector that shaped it. */
    detectorVersion: number;
    excludedCells: ReadonlyArray<{ category: ScoreCategory; surface: ScoreSurface }>;
    targets: {
      testsPerCell: Readonly<Record<string, number>>;
      coverageTarget: Readonly<Record<string, number>>;
      pyramid?: { unit: number; integration: number; e2e: number };
    };
    weights: ScoreWeights;
  };
  runs: readonly RunRecord[];
  results: readonly CanonicalTestResult[];
  coverage: CoverageSummary | null;
  /** Test fingerprints an operator quarantined. Never inferred from flakiness. */
  quarantined: readonly string[];
  /** Modules no test loads, as repo-relative paths. Empty when no source scan ran. */
  uncoveredModules: readonly string[];
  /** Fingerprints that run at the e2e layer *and* in a unit suite. */
  singleLayerE2eFingerprints: readonly string[];
}

/**
 * The cell component weights and the row weights.
 *
 * **Configuration, not constants.** A hard-coded `0.4/0.4/0.2` is a number
 * nobody can change without a release, and a weight a user cannot reach is a
 * weight the user cannot argue with.
 */
export interface ScoreWeights {
  cell: { depth: number; stability: number; signal: number };
  rows: Readonly<Record<ScoreCategory, number>>;
  /** The pyramid row's weight; the category rows are rescaled to `1 - pyramid`. */
  pyramid: number;
}

/** The defaults, and the one place they are written. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  cell: { depth: 0.4, stability: 0.4, signal: 0.2 },
  // Rescaled to sum to 0.9 by `geometricRowWeights`, since `pyramid` takes 0.10.
  rows: { unit: 0.18, integration: 0.18, e2e: 0.18, performance: 0.18, security: 0.18 },
  pyramid: 0.1,
};

/** `unit:backend`, the key a target and a cell share. */
export function cellKey(category: ScoreCategory, surface: ScoreSurface): string {
  return `${category}:${surface}`;
}
