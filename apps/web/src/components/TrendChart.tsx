import React from 'react';
import type { TrendBucket } from '../lib/qa.js';
import { orDash, formatPercent, shortDate } from '../lib/insights.js';

/**
 * Pass rate as a line over run volume as bars, one column per day.
 *
 * ## Inline SVG, and no chart library
 *
 * Two series and a date axis do not justify a 200 kB dependency and a second visual
 * language. The geometry is a `viewBox` the panel stretches, with
 * `vector-effect: non-scaling-stroke` so the line keeps its weight at any width, and the
 * date labels are HTML under the plot rather than SVG text, because text in a stretched
 * `viewBox` is stretched with it.
 *
 * ## The two scales are not one scale
 *
 * The bars are counts and the line is a percentage, so each has its own axis and the
 * legend names both. A day with runs but no verdict — every run cancelled — draws its bar
 * and **breaks the line**, rather than plotting a 0% that no run produced.
 *
 * ## A picture, with its data beside it
 *
 * The SVG is `role="img"` with a summary sentence, and the series itself is a visually
 * hidden table, because "pass rate went from 60% to 92%" is the reading and a screen
 * reader cannot get it from a polyline.
 */
const WIDTH = 100;
const HEIGHT = 40;

export function TrendChart({
  buckets,
  'data-testid': testId,
}: {
  buckets: readonly TrendBucket[];
  'data-testid'?: string;
}): React.ReactElement {
  const maxRuns = Math.max(1, ...buckets.map((bucket) => bucket.runs));
  const step = WIDTH / Math.max(1, buckets.length);
  const segments = lineSegments(buckets, step);
  const rated = buckets.filter((bucket) => bucket.passRate !== null);
  const first = rated[0]?.passRate ?? null;
  const last = rated.at(-1)?.passRate ?? null;
  const totalRuns = buckets.reduce((sum, bucket) => sum + bucket.runs, 0);
  const summary =
    totalRuns === 0
      ? `No runs in the last ${String(buckets.length)} days.`
      : `${String(totalRuns)} runs over ${String(buckets.length)} days. Pass rate from ${orDash(first, formatPercent)} to ${orDash(last, formatPercent)}.`;
  const labelled = [buckets[0], buckets[Math.floor(buckets.length / 2)], buckets.at(-1)];

  return (
    <figure data-testid={testId} className="m-0 flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 gap-2">
        <div
          aria-hidden="true"
          className="flex flex-col justify-between text-xs text-fg-muted tabular-nums"
        >
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <svg
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          preserveAspectRatio="none"
          className="h-full min-h-0 w-full flex-1"
        >
          <g className="text-border">
            {[0, HEIGHT / 2, HEIGHT].map((y) => (
              <line
                key={y}
                x1={0}
                x2={WIDTH}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <g className="text-border-strong">
            {buckets.map((bucket, index) => {
              const height = (bucket.runs / maxRuns) * HEIGHT * 0.9;
              return (
                <rect
                  key={bucket.date}
                  data-testid="trend-bar"
                  x={index * step + step * 0.2}
                  y={HEIGHT - height}
                  width={step * 0.6}
                  height={height}
                  fill="currentColor"
                />
              );
            })}
          </g>
          <g className="text-accent">
            {segments.map((points) => (
              <polyline
                key={points}
                data-testid="trend-line"
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        </svg>
        <div
          aria-hidden="true"
          className="flex flex-col justify-between text-xs text-fg-muted tabular-nums"
        >
          <span>{maxRuns}</span>
          <span>0</span>
        </div>
      </div>
      <div aria-hidden="true" className="mt-1 flex justify-between pl-9 pr-6 text-xs text-fg-muted">
        {labelled.map((bucket, index) => (
          <span key={`${String(index)}-${bucket?.date ?? ''}`}>
            {bucket === undefined ? '' : shortDate(bucket.date)}
          </span>
        ))}
      </div>
      <figcaption className="mt-2 flex gap-4 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded-full bg-accent" />
          Pass rate
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm bg-border-strong"
          />
          Runs per day
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>Daily runs and pass rate</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Runs</th>
            <th scope="col">Pass rate</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.date}>
              <th scope="row">{bucket.date}</th>
              <td>{bucket.runs}</td>
              <td>{orDash(bucket.passRate, formatPercent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** One polyline per unbroken run of days that had a verdict. */
export function lineSegments(buckets: readonly TrendBucket[], step: number): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  buckets.forEach((bucket, index) => {
    if (bucket.passRate === null) {
      if (current.length > 0) segments.push(current.join(' '));
      current = [];
      return;
    }
    const x = index * step + step / 2;
    const y = HEIGHT - (bucket.passRate / 100) * HEIGHT;
    current.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  });
  if (current.length > 0) segments.push(current.join(' '));
  // A single day is a point with no length, so it is drawn as a short flat stroke.
  return segments.map((points) => (points.includes(' ') ? points : widen(points, step)));
}

function widen(point: string, step: number): string {
  const [x = '0', y = '0'] = point.split(',');
  const left = Math.max(0, Number(x) - step / 4).toFixed(2);
  const right = Math.min(WIDTH, Number(x) + step / 4).toFixed(2);
  return `${left},${y} ${right},${y}`;
}
