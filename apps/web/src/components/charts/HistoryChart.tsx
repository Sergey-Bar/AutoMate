import React from 'react';
import type { ScanSnapshot } from '../../lib/qa.js';
import { orDash, shortDate } from '../../lib/insights.js';
import { ChartLegend } from './ChartLegend.js';

/**
 * Coverage and health score over time: two 0–100 lines on one scale.
 *
 * Both series are percentages, so they share the axis honestly — the reason a second axis
 * is never added here. A reading without a value (no coverage report that hour) breaks that
 * line rather than drawing it to zero. The same readings are a visually hidden table.
 */
const WIDTH = 100;
const HEIGHT = 40;
const GRID = [100, 50, 0] as const;

export const HISTORY_SERIES = [
  { key: 'coverage', label: 'Coverage', tone: 'text-chart-1' },
  { key: 'healthScore', label: 'Health score', tone: 'text-chart-3' },
] as const;

/** One polyline per unbroken run of readings that have the value. */
export function historySegments(
  points: readonly ScanSnapshot[],
  key: 'coverage' | 'healthScore',
): string[] {
  const step = points.length <= 1 ? 0 : WIDTH / (points.length - 1);
  const segments: string[][] = [[]];
  points.forEach((point, index) => {
    const value = point[key];
    if (value === null) {
      segments.push([]);
      return;
    }
    segments
      .at(-1)
      ?.push(`${(index * step).toFixed(2)},${(HEIGHT - (value / 100) * HEIGHT).toFixed(2)}`);
  });
  return segments.filter((segment) => segment.length > 1).map((segment) => segment.join(' '));
}

export function HistoryChart({ points }: { points: readonly ScanSnapshot[] }): React.ReactElement {
  const first = points[0];
  const last = points.at(-1);
  const summary =
    first === undefined || last === undefined
      ? 'No readings yet.'
      : `Coverage from ${orDash(first.coverage, (value) => `${value.toFixed(1)}%`)} to ${orDash(last.coverage, (value) => `${value.toFixed(1)}%`)}; health score from ${orDash(first.healthScore, (value) => value.toFixed(1))} to ${orDash(last.healthScore, (value) => value.toFixed(1))}.`;
  return (
    <figure data-testid="history-chart" className="m-0 flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 gap-2">
        <div
          aria-hidden="true"
          className="relative w-7 shrink-0 text-right text-xs tabular-nums text-fg-muted"
        >
          {GRID.map((value) => (
            <span
              key={value}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${String(100 - value)}%` }}
            >
              {value}
            </span>
          ))}
        </div>
        <div className="relative min-h-0 min-w-0 flex-1">
          <svg
            role="img"
            aria-label={summary}
            viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            <g className="text-chart-grid">
              {GRID.map((value) => (
                <line
                  key={value}
                  x1={0}
                  x2={WIDTH}
                  y1={HEIGHT - (value / 100) * HEIGHT}
                  y2={HEIGHT - (value / 100) * HEIGHT}
                  stroke="currentColor"
                  strokeDasharray={value === 0 ? undefined : '2 3'}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
            {HISTORY_SERIES.map((series) => (
              <g key={series.key} className={series.tone}>
                {historySegments(points, series.key).map((segment) => (
                  <polyline
                    key={segment}
                    data-testid={`history-${series.key}`}
                    points={segment}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.75}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            ))}
          </svg>
        </div>
      </div>
      <div aria-hidden="true" className="ml-9 mt-1 flex justify-between text-xs text-fg-muted">
        <span>{first === undefined ? '' : shortDate(first.at.slice(0, 10))}</span>
        <span>{last === undefined ? '' : shortDate(last.at.slice(0, 10))}</span>
      </div>
      <figcaption className="mt-2">
        <ChartLegend
          entries={HISTORY_SERIES.map((series) => ({ ...series, shape: 'line' as const }))}
        />
      </figcaption>
      <div className="sr-only">
        <table>
          <caption>Coverage and health score readings</caption>
          <thead>
            <tr>
              <th scope="col">Reading</th>
              <th scope="col">Coverage</th>
              <th scope="col">Health score</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.at}>
                <th scope="row">{point.at}</th>
                <td>{orDash(point.coverage, (value) => `${value.toFixed(1)}%`)}</td>
                <td>{orDash(point.healthScore, (value) => value.toFixed(1))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
