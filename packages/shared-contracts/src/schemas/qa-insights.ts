import { z } from 'zod/v4';

/**
 * Reliability insights, coverage history and release readiness.
 *
 * ## Every figure is computed from evidence the product already stores
 *
 * The leaderboard, the slowest tests, the heatmap, MTTR and the branch table are read from
 * runs and their per-test results; nothing here is estimated or sampled. A figure that has
 * no evidence behind it is `null` and says so, rather than `0` — a suite that has never
 * recovered has an *open* incident, not a mean time to recovery of zero.
 */

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const Percent = z.number().min(0).max(100);

/** One test, keyed by file and title, that flips between verdicts. */
export const FlakyTestSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  file: z.string().nullable(),
  /** Runs in the window this test appeared in. */
  runs: z.number().int().min(1),
  /** Results recorded as `flaky`: it failed, then passed on a retry. */
  flaky: z.number().int().min(0),
  /** Changes between passed and failed across consecutive runs, oldest first. */
  flips: z.number().int().min(0),
  /** `(flaky + flips) / runs`, 0–1. A test that only ever fails scores 0. */
  score: z.number().min(0).max(1),
  lastSeen: z.string().min(1),
});
export type FlakyTest = z.infer<typeof FlakyTestSchema>;

export const SlowTestSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  file: z.string().nullable(),
  samples: z.number().int().min(1),
  p50Ms: z.number().min(0),
  p95Ms: z.number().min(0),
  /** The previous window's median, or `null` when the test did not run in it. */
  previousP50Ms: z.number().min(0).nullable(),
  /** Change in the median, as a percentage of the previous one; `null` without a previous. */
  changePct: z.number().nullable(),
  /** The median duration per day of the current window, oldest first; `null` on a day with no sample. */
  daily: z.array(z.number().min(0).nullable()),
});
export type SlowTest = z.infer<typeof SlowTestSchema>;

export const HeatmapRowSchema = z.object({
  suite: z.string().min(1),
  /** One cell per day of the window, oldest first. */
  cells: z.array(z.object({ runs: z.number().int().min(0), failed: z.number().int().min(0) })),
  failed: z.number().int().min(0),
});
export type HeatmapRow = z.infer<typeof HeatmapRowSchema>;

export const MttrSchema = z.object({
  suite: z.string().min(1),
  /** Completed recoveries in the window: a failing run followed by a passing one. */
  recoveries: z.number().int().min(0),
  medianMs: z.number().min(0).nullable(),
  p90Ms: z.number().min(0).nullable(),
  /** When the suite started failing and has not recovered since, or `null`. */
  openSince: z.string().nullable(),
});
export type Mttr = z.infer<typeof MttrSchema>;

export const BranchPassRateSchema = z.object({
  branch: z.string().min(1),
  runs: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  passRate: Percent.nullable(),
});
export type BranchPassRate = z.infer<typeof BranchPassRateSchema>;

/** One line of "what changed since last week". */
export const DigestItemSchema = z.object({
  kind: z.enum(['new-flaky', 'newly-slow', 'new-failure', 'pass-rate', 'coverage', 'runs']),
  tone: z.enum(['good', 'bad', 'neutral']),
  text: z.string().min(1),
});
export type DigestItem = z.infer<typeof DigestItemSchema>;

/** One root cause: failures whose normalised message and own stack frames agree. */
export const FailureClusterSchema = z.object({
  signature: z.string().min(1),
  errorType: z.string().nullable(),
  /** The earliest message in the cluster, verbatim. */
  sampleMessage: z.string(),
  count: z.number().int().min(1),
  tests: z.array(z.string()),
  branches: z.array(z.string()),
  runs: z.number().int().min(1),
  firstSeen: z.string().min(1),
  lastSeen: z.string().min(1),
});
export type FailureCluster = z.infer<typeof FailureClusterSchema>;

export const QuarantineSuggestionSchema = z.object({
  testKey: z.string().min(1),
  title: z.string().min(1),
  /** `(flaky + flips) / observations`, 0–1. */
  flakyScore: z.number().min(0).max(1),
  observations: z.number().int().min(1),
  retriesSpent: z.number().int().min(0),
  /** Time spent on attempts beyond the first, in milliseconds. */
  wastedMs: z.number().int().min(0),
  blockedRuns: z.number().int().min(0),
  reason: z.string().min(1),
});
export type QuarantineSuggestion = z.infer<typeof QuarantineSuggestionSchema>;

export const QaInsightsSchema = z.object({
  days: z.number().int().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  /** The days of the current window, so the heatmap and the sparklines share an axis. */
  dates: z.array(Day),
  runs: z.number().int().min(0),
  flakyLeaderboard: z.array(FlakyTestSchema),
  slowestTests: z.array(SlowTestSchema),
  failureHeatmap: z.array(HeatmapRowSchema),
  mttr: z.object({
    overall: MttrSchema.omit({ suite: true }),
    suites: z.array(MttrSchema),
  }),
  passRateByBranch: z.array(BranchPassRateSchema),
  digest: z.array(DigestItemSchema),
  truncated: z.boolean(),
  /**
   * The window's failed results grouped by root cause (`clusterFailures` in
   * `@automate/reporting`). Optional so an older server's answer still parses.
   */
  failureClusters: z
    .object({
      clusters: z.array(FailureClusterSchema),
      totals: z.object({
        failures: z.number().int().min(0),
        causes: z.number().int().min(0),
      }),
      /** "N failures, M causes". */
      summary: z.string().min(1),
    })
    .optional(),
  /**
   * Tests worth quarantining, with the sentence a reviewer reads before agreeing. Suggestions
   * only: quarantining stays the operator's `POST /api/v1/dashboard/quarantine`.
   */
  quarantineSuggestions: z
    .object({
      thresholds: z.object({
        minScore: z.number().min(0).max(1),
        minObservations: z.number().int().min(1),
      }),
      suggestions: z.array(QuarantineSuggestionSchema),
    })
    .optional(),
});
export type QaInsights = z.infer<typeof QaInsightsSchema>;

/** One recorded reading of a project, at most one per hour. */
export const ScanSnapshotSchema = z.object({
  at: z.string().min(1),
  /** Mean line coverage over the coverage reports on disk, or `null` when there are none. */
  coverage: Percent.nullable(),
  healthScore: Percent.nullable(),
  maturity: Percent,
  flakyTests: z.number().int().min(0),
});
export type ScanSnapshot = z.infer<typeof ScanSnapshotSchema>;

export const ProjectHistorySchema = z.object({
  projectId: z.string().min(1),
  days: z.number().int().min(1),
  points: z.array(ScanSnapshotSchema),
  /** The first snapshot ever recorded for the project, so a short history can say so. */
  collectingSince: z.string().nullable(),
});
export type ProjectHistory = z.infer<typeof ProjectHistorySchema>;

export const READINESS_VERDICTS = ['go', 'caution', 'no-go'] as const;
export const ReadinessVerdictSchema = z.enum(READINESS_VERDICTS);
export type ReadinessVerdict = z.infer<typeof ReadinessVerdictSchema>;

export const ReadinessReasonSchema = z.object({
  code: z.enum(['gate', 'pass-rate', 'flaky', 'coverage', 'quarantine', 'activity']),
  /** `unknown` is its own level: an input that is missing is never a silent go. */
  level: z.enum(['go', 'caution', 'no-go', 'unknown']),
  message: z.string().min(1),
  evidence: z.string().min(1),
});
export type ReadinessReason = z.infer<typeof ReadinessReasonSchema>;

export const ReleaseReadinessCardSchema = z.object({
  projectId: z.string().min(1),
  verdict: ReadinessVerdictSchema,
  /** Worst first: every no-go, then every caution and unknown, then the passes. */
  reasons: z.array(ReadinessReasonSchema).min(1),
  evaluatedAt: z.string().min(1),
});
export type ReleaseReadinessCard = z.infer<typeof ReleaseReadinessCardSchema>;
