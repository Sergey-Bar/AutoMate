import { z } from 'zod/v4';
import { HEALTH_DIMENSIONS, HealthDimensionSchema, HealthLetterSchema } from './health.js';

/**
 * A scorecard: one area of a repository's health, measured beside the grade.
 *
 * The grade answers "how healthy is this repository". A scorecard answers one narrower
 * question — how fast and safely it ships, what it ships, whether its tests catch
 * anything, what AI-written change does to it, whether its agents regress — and it is
 * shown whether or not its dimension is weighted into the grade.
 *
 * Three rules every scorecard keeps, enforced here so no producer can skip them:
 *
 * - **A number nobody measured is not a number.** A metric with too few observations is
 *   `insufficient`, and one whose source is not set up is `not_configured`; neither has a
 *   `value`, so neither can be drawn as a pass.
 * - **A score always names what limited it**, the same rule as the grade's `cappedBy`.
 * - **A failing scorecard says why.** `fail` with no reason is refused.
 */
export const SCORECARD_IDS = [
  'delivery',
  'flow',
  'supply-chain',
  'test-effectiveness',
  'ai-code',
  'agent-quality',
] as const;
export type ScorecardId = (typeof SCORECARD_IDS)[number];
export const ScorecardIdSchema = z.enum(SCORECARD_IDS);

/** What a metric's number is counted in. The UI formats by this and nothing else. */
export const METRIC_UNITS = [
  'count',
  'percent',
  'ratio',
  'ms',
  'hours',
  'days',
  'per-day',
  'per-week',
  'usd',
  'tokens',
  'score',
] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];
export const MetricUnitSchema = z.enum(METRIC_UNITS);

export const METRIC_STATUSES = ['good', 'warn', 'bad', 'insufficient', 'not_configured'] as const;
export type MetricStatus = (typeof METRIC_STATUSES)[number];
export const MetricStatusSchema = z.enum(METRIC_STATUSES);

export const ScorecardMetricSchema = z
  .object({
    key: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    /** `null` exactly when the status is `insufficient` or `not_configured`. */
    value: z.number().finite().nullable(),
    unit: MetricUnitSchema,
    /** Which way is better, so a trend is only called better in the right direction. */
    direction: z.enum(['higher-better', 'lower-better']),
    target: z.number().finite().nullable(),
    /** Value now minus value over the previous window of the same length. */
    trend: z.number().finite().nullable(),
    /** How many observations the value rests on. */
    sampleSize: z.number().int().min(0).nullable(),
    /** A named band such as the DORA tier, when the metric has one. */
    band: z.string().min(1).max(50).nullable(),
    status: MetricStatusSchema,
    summary: z.string().min(1).max(500),
  })
  .superRefine((metric, ctx) => {
    const unmeasured = metric.status === 'insufficient' || metric.status === 'not_configured';
    if (unmeasured && metric.value !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'an unmeasured metric has no value',
      });
    }
    if (!unmeasured && metric.value === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'a metric with no value is insufficient or not configured',
      });
    }
  });
export type ScorecardMetric = z.infer<typeof ScorecardMetricSchema>;

export const SCORECARD_STATUSES = ['pass', 'fail', 'insufficient', 'not_configured'] as const;
export type ScorecardStatus = (typeof SCORECARD_STATUSES)[number];
export const ScorecardStatusSchema = z.enum(SCORECARD_STATUSES);

export const ScorecardSchema = z
  .object({
    id: ScorecardIdSchema,
    title: z.string().min(1).max(200),
    /** The health dimension this scorecard feeds when a policy weights it. */
    dimension: HealthDimensionSchema,
    evaluatedAt: z.iso.datetime(),
    /** The window the metrics cover, in days. */
    windowDays: z.number().int().min(1).max(366),
    status: ScorecardStatusSchema,
    /** 0–100, `null` while nothing is measured. */
    score: z.number().min(0).max(100).nullable(),
    /** The metric key that limited the score. Required whenever there is a score. */
    cappedBy: z.string().min(1).nullable(),
    metrics: z.array(ScorecardMetricSchema).readonly(),
    /** One sentence per failed rule. */
    reasons: z.array(z.string().min(1)).readonly(),
  })
  .superRefine((card, ctx) => {
    if (card.score !== null && card.cappedBy === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cappedBy'],
        message: 'a scored scorecard always names what limited it',
      });
    }
    if (card.status === 'fail' && card.reasons.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['reasons'],
        message: 'a failing scorecard says why',
      });
    }
  });
export type Scorecard = z.infer<typeof ScorecardSchema>;

// ─── The portfolio heatmap ───────────────────────────────────────────────────

/** The most projects one heatmap answers with. A larger workspace is `truncated`, and says so. */
export const HEATMAP_PROJECT_LIMIT = 50;

/** One grade dimension of one project, from its latest snapshot. Unmeasured has no score. */
export const HeatmapCellSchema = z.object({
  dimension: HealthDimensionSchema,
  measured: z.boolean(),
  score: z.number().min(0).max(100).nullable(),
  letter: HealthLetterSchema.nullable(),
});
export type HeatmapCell = z.infer<typeof HeatmapCellSchema>;

/** One scorecard of one project: its verdict and score, never a metric. */
export const HeatmapScorecardSchema = z.object({
  id: ScorecardIdSchema,
  status: ScorecardStatusSchema,
  score: z.number().min(0).max(100).nullable(),
});
export type HeatmapScorecard = z.infer<typeof HeatmapScorecardSchema>;

export const PortfolioHeatmapRowSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  branch: z.string().min(1),
  score: z.number().min(0).max(100).nullable(),
  letter: HealthLetterSchema.nullable(),
  lastReportAt: z.iso.datetime().nullable(),
  /** Every dimension, in `HEALTH_DIMENSIONS` order. */
  dimensions: z.array(HeatmapCellSchema).length(HEALTH_DIMENSIONS.length).readonly(),
  /** Every scorecard, in `SCORECARD_IDS` order. */
  scorecards: z.array(HeatmapScorecardSchema).length(SCORECARD_IDS.length).readonly(),
});
export type PortfolioHeatmapRow = z.infer<typeof PortfolioHeatmapRowSchema>;

/** `GET /api/v1/portfolio/heatmap` */
export const PortfolioHeatmapSchema = z.object({
  evaluatedAt: z.iso.datetime(),
  dimensions: z.array(HealthDimensionSchema).length(HEALTH_DIMENSIONS.length).readonly(),
  scorecards: z.array(ScorecardIdSchema).length(SCORECARD_IDS.length).readonly(),
  /** Projects in the workspace; more than `projects.length` exactly when `truncated`. */
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  truncated: z.boolean(),
  projects: z.array(PortfolioHeatmapRowSchema).max(HEATMAP_PROJECT_LIMIT).readonly(),
});
export type PortfolioHeatmap = z.infer<typeof PortfolioHeatmapSchema>;
