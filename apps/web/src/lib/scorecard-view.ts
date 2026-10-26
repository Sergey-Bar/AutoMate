import type {
  MetricStatus,
  MetricUnit,
  ScorecardMetric,
  ScorecardStatus,
} from '@automate/shared-contracts';
import { formatDuration, type Verdict } from './insights.js';

/**
 * How a scorecard is read on screen, as pure functions.
 *
 * Nothing here judges a number: the status, the score, `cappedBy` and the reasons arrive
 * computed by the server. These decide wording and tone, and the one rule worth stating is
 * the trend's — **a change is only called better in the metric's own direction**, so a
 * falling lead time is green and a falling deploy frequency is red.
 */

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const PLAIN = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function fixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

const FORMATTERS: Readonly<Record<MetricUnit, (value: number) => string>> = {
  count: (value) => PLAIN.format(value),
  percent: (value) => `${fixed(value, 1)}%`,
  // A ratio is 0–1 on the wire and read as a share.
  ratio: (value) => `${fixed(value * 100, 1)}%`,
  ms: (value) => formatDuration(value),
  hours: (value) => `${fixed(value, 1)} h`,
  days: (value) => `${fixed(value, 1)} d`,
  'per-day': (value) => `${fixed(value, 2)}/day`,
  'per-week': (value) => `${fixed(value, 1)}/week`,
  usd: (value) => `$${fixed(value, Math.abs(value) < 1 ? 4 : 2)}`,
  tokens: (value) => `${COMPACT.format(value)} tokens`,
  score: (value) => fixed(value, 0),
};

/** A metric's value in its own unit. The unit is the only thing formatting reads. */
export function formatMetricValue(value: number, unit: MetricUnit): string {
  return FORMATTERS[unit](value);
}

/** A signed change in the metric's unit: `+4.0%`, `−1.2 h`, `±0`. */
export function formatMetricChange(change: number, unit: MetricUnit): string {
  if (change === 0) return '±0';
  const sign = change > 0 ? '+' : '\u2212';
  return `${sign}${formatMetricValue(Math.abs(change), unit)}`;
}

/** Better or worse, read in the metric's own direction. `null` is unknown, never "same". */
export function trendVerdict(
  trend: number | null,
  direction: ScorecardMetric['direction'],
): Verdict {
  if (trend === null) return 'unknown';
  if (trend === 0) return 'same';
  const rising = trend > 0;
  return rising === (direction === 'higher-better') ? 'better' : 'worse';
}

/** Whether a metric has a value at all. An unmeasured one is never drawn as a pass. */
export function isUnmeasured(status: MetricStatus | ScorecardStatus): boolean {
  return status === 'insufficient' || status === 'not_configured';
}

export const METRIC_STATUS_WORD: Readonly<Record<MetricStatus, string>> = {
  good: 'good',
  warn: 'warning',
  bad: 'failing',
  insufficient: 'too little data',
  not_configured: 'not configured',
};

/** Colour is a verdict or nothing: an unmeasured metric is muted, never green. */
export const METRIC_STATUS_TONE: Readonly<Record<MetricStatus, string>> = {
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-danger',
  insufficient: 'text-fg-muted',
  not_configured: 'text-fg-muted',
};

export const METRIC_STATUS_DOT: Readonly<
  Record<MetricStatus, 'good' | 'warn' | 'bad' | 'unknown'>
> = {
  good: 'good',
  warn: 'warn',
  bad: 'bad',
  insufficient: 'unknown',
  not_configured: 'unknown',
};

export const SCORECARD_STATUS_WORD: Readonly<Record<ScorecardStatus, string>> = {
  pass: 'Pass',
  fail: 'Fail',
  insufficient: 'Too little data',
  not_configured: 'Not configured',
};

export const SCORECARD_STATUS_DOT: Readonly<Record<ScorecardStatus, 'good' | 'bad' | 'unknown'>> = {
  pass: 'good',
  fail: 'bad',
  insufficient: 'unknown',
  not_configured: 'unknown',
};

export const SCORECARD_STATUS_TONE: Readonly<Record<ScorecardStatus, string>> = {
  pass: 'text-success',
  fail: 'text-danger',
  insufficient: 'text-fg-muted',
  not_configured: 'text-fg-muted',
};

/** The sentence an unmeasured scorecard shows where a score would be. */
export function unmeasuredSentence(status: ScorecardStatus): string | null {
  if (status === 'insufficient') return 'Too little data to score yet.';
  if (status === 'not_configured') return 'Not configured: no source reports on this yet.';
  return null;
}
