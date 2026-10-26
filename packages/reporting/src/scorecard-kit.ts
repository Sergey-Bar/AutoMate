import type { Scorecard, ScorecardMetric } from '@automate/shared-contracts';

/**
 * The small pieces the supply-chain and test-effectiveness scorecards share, so the rules
 * every scorecard keeps — an unmeasured metric has no value, a score names what limited it,
 * a window is a whole number of days the contract accepts — are written once.
 */

export interface MetricShape {
  key: string;
  label: string;
  unit: ScorecardMetric['unit'];
  direction: ScorecardMetric['direction'];
  target: number | null;
}

/** A metric nobody measured: no value, no trend, and the sentence that says why. */
export function unmeasuredMetric(
  shape: MetricShape,
  status: 'insufficient' | 'not_configured',
  summary: string,
  sampleSize: number | null = null,
): ScorecardMetric {
  return {
    ...shape,
    value: null,
    trend: null,
    sampleSize,
    band: null,
    status,
    summary,
  };
}

/** A measured metric. `value` must be finite; the builders only pass numbers they computed. */
export function measuredMetric(
  shape: MetricShape,
  reading: {
    value: number;
    status: 'good' | 'warn' | 'bad';
    summary: string;
    sampleSize?: number | null;
  },
): ScorecardMetric {
  return {
    ...shape,
    value: reading.value,
    trend: null,
    sampleSize: reading.sampleSize ?? null,
    band: null,
    status: reading.status,
    summary: reading.summary,
  };
}

/** Days the contract accepts: a whole number from 1 to 366, whatever the caller passed. */
export function windowOf(days: number): number {
  return Number.isFinite(days) ? Math.min(366, Math.max(1, Math.round(days))) : 1;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The lowest of the scored points, and its key; `null` when nothing was scored. */
export function weakest(
  scored: readonly { key: string; points: number }[],
): { key: string; points: number } | null {
  let low: { key: string; points: number } | null = null;
  for (const entry of scored) if (low === null || entry.points < low.points) low = entry;
  return low;
}

/**
 * The card's status from what was measured: nothing measured is `not_configured`, something
 * measured but nothing scored is `insufficient`, a broken rule is `fail`.
 */
export function cardStatus(
  metrics: readonly ScorecardMetric[],
  scoredCount: number,
  reasons: readonly string[],
): Scorecard['status'] {
  const measured = metrics.some((metric) => metric.status !== 'not_configured');
  if (!measured) return 'not_configured';
  if (reasons.length > 0) return 'fail';
  return scoredCount === 0 ? 'insufficient' : 'pass';
}

export function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** One reading of a card: its metric, its points when scored, and its broken rule if any. */
export interface Reading {
  metric: ScorecardMetric;
  /** Points out of 100, when the reading is scored and measured. */
  points: number | null;
  reason: string | null;
}

/** A reading with nothing measured: no points and no reason. */
export function absent(
  shape: MetricShape,
  status: 'insufficient' | 'not_configured',
  summary: string,
  sampleSize: number | null = null,
): Reading {
  return {
    metric: unmeasuredMetric(shape, status, summary, sampleSize),
    points: null,
    reason: null,
  };
}

/**
 * Readings into a card. The score is `combine` over the scored points (by default the
 * weakest), `cappedBy` is the lowest scored reading, and every broken rule is a reason.
 */
export function assemble(
  readings: readonly Reading[],
  head: Pick<Scorecard, 'id' | 'title' | 'dimension' | 'evaluatedAt' | 'windowDays'>,
  combine: (scored: readonly { key: string; points: number }[]) => number | null = (scored) =>
    weakest(scored)?.points ?? null,
): Scorecard {
  const metrics = readings.map((reading) => reading.metric);
  const scored = readings.flatMap((reading) =>
    reading.points === null ? [] : [{ key: reading.metric.key, points: reading.points }],
  );
  const reasons = readings.flatMap((reading) => (reading.reason === null ? [] : [reading.reason]));
  const score = scored.length === 0 ? null : combine(scored);
  return {
    ...head,
    status: cardStatus(metrics, scored.length, reasons),
    score: score === null ? null : round1(Math.min(100, Math.max(0, score))),
    cappedBy: score === null ? null : (weakest(scored)?.key ?? null),
    metrics,
    reasons,
  };
}
