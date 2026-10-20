import { z } from 'zod/v4';

/**
 * Run history as a time series, and the two windows it is compared across.
 *
 * ## "Before" is the window of equal length immediately preceding "now"
 *
 * Not "all time", and not "the first run ever". A comparison against all of history
 * flattens every improvement into the long tail of the first month, and a comparison
 * of unequal windows compares run counts that differ only because one window is longer.
 * Two adjacent windows of the same length are the only comparison where a change in a
 * number is a change in the repository.
 */
export const TrendBucketSchema = z.object({
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  runs: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  /** Runs that ended without a test verdict: infrastructure, timeout, cancelled. */
  other: z.number().int().min(0),
  /** 0–100 over runs with a verdict, or `null` when the day had none. */
  passRate: z.number().min(0).max(100).nullable(),
  avgDurationMs: z.number().min(0).nullable(),
  tests: z.number().int().min(0),
  testsFailed: z.number().int().min(0),
});
export type TrendBucket = z.infer<typeof TrendBucketSchema>;

export const TrendWindowSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  runs: z.number().int().min(0),
  passRate: z.number().min(0).max(100).nullable(),
  failedRuns: z.number().int().min(0),
  avgDurationMs: z.number().min(0).nullable(),
  tests: z.number().int().min(0),
  testsFailed: z.number().int().min(0),
  flakyTests: z.number().int().min(0),
});
export type TrendWindow = z.infer<typeof TrendWindowSchema>;

export const AnalyticsTrendSchema = z.object({
  days: z.number().int().min(1),
  buckets: z.array(TrendBucketSchema),
  current: TrendWindowSchema,
  previous: TrendWindowSchema,
  /** True when the read stopped at its cap before reaching the start of `previous`. */
  truncated: z.boolean(),
});
export type AnalyticsTrend = z.infer<typeof AnalyticsTrendSchema>;
