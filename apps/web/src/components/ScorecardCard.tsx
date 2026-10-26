import React from 'react';
import { ArrowRight, StatusDot, cn } from '@automate/ui';
import type { Scorecard, ScorecardMetric } from '@automate/shared-contracts';
import {
  METRIC_STATUS_DOT,
  METRIC_STATUS_TONE,
  METRIC_STATUS_WORD,
  SCORECARD_STATUS_DOT,
  SCORECARD_STATUS_TONE,
  SCORECARD_STATUS_WORD,
  formatMetricChange,
  formatMetricValue,
  isUnmeasured,
  trendVerdict,
  unmeasuredSentence,
} from '../lib/scorecard-view.js';
import { Delta } from './kit.js';

/**
 * One scorecard: its verdict, its score and what limited it, every metric, and why it failed.
 *
 * ## A number nobody measured is drawn as no number
 *
 * An `insufficient` or `not_configured` metric has no value on the wire, and here it has no
 * colour either: it is muted and says so in words. The same for the card — a scorecard with
 * too little data shows the sentence where the score would be, never a zero.
 *
 * ## A trend is only better in the metric's own direction
 *
 * `direction` comes with every metric, and the arrow's verdict is derived from it, so a
 * falling lead time reads as better and a falling deploy rate as worse.
 */
export function ScorecardCard({
  scorecard,
  href,
  compact = false,
  headingLevel = 2,
}: {
  scorecard: Scorecard;
  /** Where the scorecard's own page is. Drawn as a link when given. */
  href?: string | undefined;
  /** Score, limiter and reasons only: for a row of scorecards beside the grade. */
  compact?: boolean;
  headingLevel?: 2 | 3;
}): React.ReactElement {
  const id = React.useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section
      aria-labelledby={id}
      data-testid={`scorecard-${scorecard.id}`}
      data-status={scorecard.status}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <Heading id={id} className="text-xs font-medium uppercase tracking-wider text-fg-muted">
          {scorecard.title}
        </Heading>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 text-xs font-medium',
            SCORECARD_STATUS_TONE[scorecard.status],
          )}
          data-testid="scorecard-status"
        >
          <StatusDot status={SCORECARD_STATUS_DOT[scorecard.status]} />
          {SCORECARD_STATUS_WORD[scorecard.status]}
        </span>
      </div>
      <ScoreLine scorecard={scorecard} />
      {compact ? null : <MetricList metrics={scorecard.metrics} />}
      <Reasons scorecard={scorecard} />
      <p className="max-w-measure text-xs text-fg-muted">
        {`Over ${String(scorecard.windowDays)} days`}
      </p>
      {href === undefined ? null : (
        <a
          href={href}
          className="inline-flex min-h-11 items-center gap-1 self-start rounded-md text-sm underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {`Open ${scorecard.title}`}
          <ArrowRight size={14} aria-hidden="true" />
        </a>
      )}
    </section>
  );
}

function ScoreLine({ scorecard }: { scorecard: Scorecard }): React.ReactElement {
  const sentence = unmeasuredSentence(scorecard.status);
  if (scorecard.score === null) {
    return (
      <p data-testid="scorecard-score" className="max-w-measure text-sm text-fg-muted">
        {sentence ?? 'No score.'}
      </p>
    );
  }
  const limiter = scorecard.metrics.find((metric) => metric.key === scorecard.cappedBy);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span
        data-testid="scorecard-score"
        className={cn(
          'text-3xl font-semibold tabular-nums tracking-tight',
          SCORECARD_STATUS_TONE[scorecard.status],
        )}
      >
        {scorecard.score.toFixed(0)}
        <span className="ml-1 text-sm font-normal text-fg-muted">/ 100</span>
      </span>
      <span data-testid="scorecard-capped" className="text-xs text-fg-muted">
        {`Limited by ${limiter?.label ?? scorecard.cappedBy ?? 'nothing'}`}
      </span>
    </div>
  );
}

function MetricList({
  metrics,
}: {
  metrics: readonly ScorecardMetric[];
}): React.ReactElement | null {
  if (metrics.length === 0) return null;
  return (
    <ul className="divide-y divide-border" aria-label="Metrics">
      {metrics.map((metric) => (
        <MetricRow key={metric.key} metric={metric} />
      ))}
    </ul>
  );
}

function targetText(metric: ScorecardMetric): string | null {
  if (metric.target === null) return null;
  const bound = metric.direction === 'higher-better' ? '≥' : '≤';
  return `target ${bound} ${formatMetricValue(metric.target, metric.unit)}`;
}

function MetricValue({ metric }: { metric: ScorecardMetric }): React.ReactElement {
  if (metric.value === null || isUnmeasured(metric.status)) {
    return (
      <span className="text-xs text-fg-muted" data-testid="metric-value">
        {METRIC_STATUS_WORD[metric.status]}
      </span>
    );
  }
  return (
    <span
      data-testid="metric-value"
      className={cn('text-sm font-medium tabular-nums', METRIC_STATUS_TONE[metric.status])}
    >
      {formatMetricValue(metric.value, metric.unit)}
    </span>
  );
}

function MetricTrend({ metric }: { metric: ScorecardMetric }): React.ReactElement | null {
  if (metric.trend === null || isUnmeasured(metric.status)) return null;
  return (
    <Delta
      text={formatMetricChange(metric.trend, metric.unit)}
      verdict={trendVerdict(metric.trend, metric.direction)}
      rising={metric.trend === 0 ? null : metric.trend > 0}
    />
  );
}

function MetricRow({ metric }: { metric: ScorecardMetric }): React.ReactElement {
  const target = targetText(metric);
  const details = [
    target,
    metric.band === null ? null : metric.band,
    metric.sampleSize === null ? null : `n = ${String(metric.sampleSize)}`,
  ].filter((part): part is string => part !== null);
  return (
    <li
      data-testid={`metric-${metric.key}`}
      data-status={metric.status}
      className="flex items-start justify-between gap-3 py-2"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm">
          <StatusDot status={METRIC_STATUS_DOT[metric.status]} />
          <span className="truncate" title={metric.summary}>
            {metric.label}
          </span>
        </p>
        <p className="max-w-measure text-xs text-fg-muted">{metric.summary}</p>
        {details.length === 0 ? null : (
          <p className="text-xs tabular-nums text-fg-muted">{details.join(' · ')}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <MetricValue metric={metric} />
        <MetricTrend metric={metric} />
      </div>
    </li>
  );
}

function Reasons({ scorecard }: { scorecard: Scorecard }): React.ReactElement | null {
  if (scorecard.reasons.length === 0) return null;
  return (
    <ul
      aria-label={`Why ${scorecard.title} ${scorecard.status === 'fail' ? 'fails' : 'is flagged'}`}
      data-testid="scorecard-reasons"
      className="space-y-1 text-sm"
    >
      {scorecard.reasons.map((reason) => (
        <li key={reason} className="flex items-start gap-2">
          <StatusDot status={scorecard.status === 'fail' ? 'bad' : 'unknown'} className="mt-1.5" />
          <span className="min-w-0 max-w-measure">{reason}</span>
        </li>
      ))}
    </ul>
  );
}
