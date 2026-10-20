import type { TrendWindow } from './qa.js';

/**
 * "How we did before, and how we are doing now", as arithmetic the screens share.
 *
 * ## Every comparison knows which direction is good
 *
 * A rising pass rate is good and a rising duration is bad, and a screen that coloured
 * both green because both went up would be reporting the arrow rather than the
 * repository. So each metric declares its polarity once, here, and the verdict is
 * derived from the delta and the polarity together. "Runs" is `neutral`: more runs is
 * activity, not quality, and colouring it would be a judgement the number cannot make.
 *
 * ## No value is invented
 *
 * A window with no verdicts has no pass rate, and `null` stays `null` all the way to the
 * screen, which prints an em dash. Printing `0%` would claim every run failed.
 */
export type Polarity = 'higher-is-better' | 'lower-is-better' | 'neutral';
export type Verdict = 'better' | 'worse' | 'same' | 'unknown';

export interface Comparison {
  key: string;
  label: string;
  before: number | null;
  now: number | null;
  delta: number | null;
  verdict: Verdict;
  format: (value: number) => string;
}

interface Metric {
  key: keyof Omit<TrendWindow, 'from' | 'to'>;
  label: string;
  polarity: Polarity;
  format: (value: number) => string;
}

const METRICS: readonly Metric[] = [
  { key: 'passRate', label: 'Pass rate', polarity: 'higher-is-better', format: formatPercent },
  { key: 'runs', label: 'Runs', polarity: 'neutral', format: formatCount },
  { key: 'failedRuns', label: 'Failed runs', polarity: 'lower-is-better', format: formatCount },
  {
    key: 'avgDurationMs',
    label: 'Avg duration',
    polarity: 'lower-is-better',
    format: formatDuration,
  },
  { key: 'tests', label: 'Tests executed', polarity: 'higher-is-better', format: formatCount },
  { key: 'testsFailed', label: 'Failed tests', polarity: 'lower-is-better', format: formatCount },
  { key: 'flakyTests', label: 'Flaky tests', polarity: 'lower-is-better', format: formatCount },
];

export function verdictFor(delta: number | null, polarity: Polarity): Verdict {
  if (delta === null) return 'unknown';
  if (delta === 0 || polarity === 'neutral') return 'same';
  const improved = polarity === 'higher-is-better' ? delta > 0 : delta < 0;
  return improved ? 'better' : 'worse';
}

export function compareWindows(previous: TrendWindow, current: TrendWindow): Comparison[] {
  return METRICS.map((metric) => {
    const before = previous[metric.key];
    const now = current[metric.key];
    const delta = before === null || now === null ? null : round(now - before);
    return {
      key: metric.key,
      label: metric.label,
      before,
      now,
      delta,
      verdict: verdictFor(delta, metric.polarity),
      format: metric.format,
    };
  });
}

/** How many of the comparisons improved, and how many regressed. */
export function tally(comparisons: readonly Comparison[]): { better: number; worse: number } {
  return {
    better: comparisons.filter((entry) => entry.verdict === 'better').length,
    worse: comparisons.filter((entry) => entry.verdict === 'worse').length,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${String(Math.round(milliseconds))} ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(Math.round(seconds - minutes * 60))}s`;
}

/** A value, or the em dash that says there is no value. */
export function orDash(value: number | null, format: (value: number) => string): string {
  return value === null ? '—' : format(value);
}

/** A signed delta in the metric's own unit: `+4.0%`, `−3`, `+1.2 s`. */
export function formatDelta(comparison: Pick<Comparison, 'delta' | 'format'>): string {
  const { delta, format } = comparison;
  if (delta === null) return '—';
  if (delta === 0) return '±0';
  const sign = delta > 0 ? '+' : '\u2212';
  return `${sign}${format(Math.abs(delta))}`;
}

/** `2026-10-20` → `Oct 20`, in UTC so the label matches the bucket it names. */
export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
