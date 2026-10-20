import React from 'react';
import { cn } from '@automate/ui';

/**
 * A chart legend: one swatch and one label per series, in the series' own token colour.
 *
 * Shared by the history chart and the heatmap so a swatch means the same thing on every
 * chart in the product. The swatch is an SVG `rect` filled with `currentColor` rather than
 * a background, so the token is the only place the colour is decided.
 */
export interface LegendEntry {
  label: string;
  /** A `text-chart-*` utility. */
  tone: string;
  /** `line` draws a short stroke, for a line series; `swatch` a filled square. */
  shape?: 'line' | 'swatch';
  opacity?: number;
}

export function ChartLegend({
  entries,
  className,
}: {
  entries: readonly LegendEntry[];
  className?: string;
}): React.ReactElement {
  return (
    <div
      data-testid="chart-legend"
      className={cn('flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted', className)}
    >
      {entries.map((entry) => (
        <span key={entry.label} className="inline-flex items-center gap-1.5">
          <svg aria-hidden="true" viewBox="0 0 12 12" className={cn('h-3 w-3', entry.tone)}>
            {entry.shape === 'line' ? (
              <rect y={5} width={12} height={2} rx={1} fill="currentColor" />
            ) : (
              <rect
                width={12}
                height={12}
                rx={3}
                fill="currentColor"
                fillOpacity={entry.opacity ?? 1}
              />
            )}
          </svg>
          {entry.label}
        </span>
      ))}
    </div>
  );
}
