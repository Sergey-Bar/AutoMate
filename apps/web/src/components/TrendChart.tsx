import React from 'react';
import { cn } from '@automate/ui';
import type { TrendBucket } from '../lib/qa.js';
import { formatDuration, formatPercent, orDash, shortDate } from '../lib/insights.js';

/**
 * Pass rate as a line over run volume as stacked bars, one column per day.
 *
 * ## What a reader gets at a glance, and what on hover
 *
 * Each day's bar is split into **passed, failed and other** — the colour carries the
 * verdict, so a red stripe is visible before any number is read. The pass-rate line rides
 * on top with a point on every day that had a verdict. Pointing at a day draws a guide and
 * a readout with that day's runs, verdicts, pass rate and duration; the same figures are a
 * visually hidden table for a screen reader, because a polyline is not readable aloud.
 *
 * ## Inline SVG, and no chart library
 *
 * Two series and a date axis do not justify a 200 kB dependency and a second visual
 * language. The geometry is a `viewBox` the panel stretches, with
 * `vector-effect: non-scaling-stroke` so lines keep their weight at any width; every label
 * is HTML positioned by percentage, because text in a stretched `viewBox` is stretched too.
 *
 * ## The two scales are not one scale
 *
 * The bars are counts (right axis) and the line is a percentage (left axis). A day with
 * runs but no verdict — every run cancelled — draws its bar and **breaks the line**, rather
 * than plotting a 0% that no run produced.
 */
const WIDTH = 100;
const HEIGHT = 40;
const GRID = [100, 75, 50, 25, 0] as const;

const SEGMENTS = [
  { key: 'passed', label: 'Passed', tone: 'text-success', opacity: 0.55 },
  { key: 'failed', label: 'Failed', tone: 'text-danger', opacity: 0.85 },
  { key: 'other', label: 'Other', tone: 'text-fg-muted', opacity: 0.35 },
] as const;

/** At most `count` evenly spaced indices, always including the first and the last. */
export function tickIndices(length: number, count: number): number[] {
  if (length <= 0) return [];
  if (length <= count) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (count - 1);
  return [...new Set(Array.from({ length: count }, (_, index) => Math.round(index * step)))];
}

export function TrendChart({
  buckets,
  'data-testid': testId,
}: {
  buckets: readonly TrendBucket[];
  'data-testid'?: string;
}): React.ReactElement {
  const [active, setActive] = React.useState<number | null>(null);
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
  const ticks = tickIndices(buckets.length, 7);
  const center = (index: number) => ((index + 0.5) / Math.max(1, buckets.length)) * 100;
  const hovered = active === null ? undefined : buckets[active];

  const track = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || buckets.length === 0) return;
    const index = Math.floor(((event.clientX - box.left) / box.width) * buckets.length);
    if (!Number.isFinite(index)) return;
    setActive(Math.min(buckets.length - 1, Math.max(0, index)));
  };

  return (
    <figure data-testid={testId} className="m-0 flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 gap-2">
        <div
          aria-hidden="true"
          className="relative w-8 shrink-0 text-right text-xs tabular-nums text-fg-muted"
        >
          {GRID.map((value) => (
            <span
              key={value}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${String(100 - value)}%` }}
            >
              {value}%
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
            <g className="text-border">
              {GRID.map((value) => {
                const y = HEIGHT - (value / 100) * HEIGHT;
                return (
                  <line
                    key={value}
                    x1={0}
                    x2={WIDTH}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    strokeWidth={1}
                    strokeDasharray={value === 0 ? undefined : '2 3'}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>
            {active === null ? null : (
              <rect
                data-testid="trend-guide"
                className="text-fg"
                x={active * step}
                y={0}
                width={step}
                height={HEIGHT}
                fill="currentColor"
                fillOpacity={0.06}
              />
            )}
            {buckets.map((bucket, index) => {
              let floor = HEIGHT;
              return (
                <g key={bucket.date} data-testid="trend-bar">
                  {SEGMENTS.map((segment) => {
                    const count = bucket[segment.key];
                    const height = (count / maxRuns) * HEIGHT * 0.88;
                    floor -= height;
                    return count === 0 ? null : (
                      <rect
                        key={segment.key}
                        data-testid={`trend-${segment.key}`}
                        className={segment.tone}
                        x={index * step + step * 0.2}
                        y={floor}
                        width={step * 0.6}
                        height={height}
                        fill="currentColor"
                        fillOpacity={segment.opacity}
                      />
                    );
                  })}
                </g>
              );
            })}
            <g className="text-accent">
              {segments.map((points) => (
                <polyline
                  key={points}
                  data-testid="trend-line"
                  points={points}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {/*
                A zero-length stroke with a round cap is a circle that survives the
                stretched `viewBox`, where a `<circle>` would be drawn as an ellipse.
              */}
              {buckets.map((bucket, index) =>
                bucket.passRate === null ? null : (
                  <line
                    key={bucket.date}
                    data-testid="trend-point"
                    x1={index * step + step / 2}
                    x2={index * step + step / 2}
                    y1={HEIGHT - (bucket.passRate / 100) * HEIGHT}
                    y2={HEIGHT - (bucket.passRate / 100) * HEIGHT}
                    stroke="currentColor"
                    strokeWidth={active === index ? 10 : 7}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ),
              )}
            </g>
          </svg>
          {/*
            The pointer layer. Hidden from assistive technology because everything it
            reveals is already in the table below the figure.
          */}
          <div
            aria-hidden="true"
            data-testid="trend-hit"
            className="absolute inset-0"
            onPointerMove={track}
            onPointerDown={track}
            onPointerLeave={() => setActive(null)}
          />
          {hovered === undefined || active === null ? null : (
            <div
              aria-hidden="true"
              data-testid="trend-tooltip"
              className="pointer-events-none absolute top-1 z-popover min-w-40 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs shadow-elevation-2"
              style={{
                left: `${String(center(active))}%`,
                transform: `translateX(${center(active) > 70 ? '-100%' : center(active) < 30 ? '0' : '-50%'})`,
              }}
            >
              <div className="font-medium text-fg">{shortDate(hovered.date)}</div>
              <dl className="m-0 mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
                <dt className="text-fg-muted">Runs</dt>
                <dd className="m-0 text-right">{hovered.runs}</dd>
                <dt className="text-success">Passed</dt>
                <dd className="m-0 text-right">{hovered.passed}</dd>
                <dt className="text-danger">Failed</dt>
                <dd className="m-0 text-right">{hovered.failed}</dd>
                <dt className="text-fg-muted">Pass rate</dt>
                <dd className="m-0 text-right">{orDash(hovered.passRate, formatPercent)}</dd>
                <dt className="text-fg-muted">Avg time</dt>
                <dd className="m-0 text-right">{orDash(hovered.avgDurationMs, formatDuration)}</dd>
              </dl>
            </div>
          )}
        </div>
        <div
          aria-hidden="true"
          className="relative w-6 shrink-0 text-xs tabular-nums text-fg-muted"
        >
          <span className="absolute left-0 -translate-y-1/2" style={{ top: '12%' }}>
            {maxRuns}
          </span>
          <span className="absolute left-0 -translate-y-1/2" style={{ top: '100%' }}>
            0
          </span>
        </div>
      </div>
      <div aria-hidden="true" className="relative ml-10 mr-8 mt-2 h-4 text-xs text-fg-muted">
        {ticks.map((index, position) => {
          const bucket = buckets[index];
          if (bucket === undefined) return null;
          const at = center(index);
          return (
            <span
              key={bucket.date}
              data-testid="trend-tick"
              // A phone keeps every other tick, so seven dates never print over each other.
              className={cn(
                'absolute whitespace-nowrap',
                ticks.length > 4 && position % 2 === 1 && 'hidden sm:inline',
              )}
              style={{
                left: `${String(at)}%`,
                transform: `translateX(${index === 0 ? '0' : index === buckets.length - 1 ? '-100%' : '-50%'})`,
              }}
            >
              {shortDate(bucket.date)}
            </span>
          );
        })}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded-full bg-accent" />
          Pass rate
        </span>
        {SEGMENTS.map((segment) => (
          <span key={segment.key} className="inline-flex items-center gap-1.5">
            <svg aria-hidden="true" viewBox="0 0 10 10" className={`h-2.5 w-2.5 ${segment.tone}`}>
              <rect
                width={10}
                height={10}
                rx={2}
                fill="currentColor"
                fillOpacity={segment.opacity}
              />
            </svg>
            {segment.label} runs
          </span>
        ))}
      </figcaption>
      {/*
        `sr-only` on the wrapper, not the table: a table ignores `height: 1px` and grows to its
        rows, so an absolutely positioned 30-row table makes the whole page scroll.
      */}
      <div className="sr-only">
        <table>
          <caption>Daily runs and pass rate</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Runs</th>
              <th scope="col">Passed</th>
              <th scope="col">Failed</th>
              <th scope="col">Pass rate</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.date}>
                <th scope="row">{bucket.date}</th>
                <td>{bucket.runs}</td>
                <td>{bucket.passed}</td>
                <td>{bucket.failed}</td>
                <td>{orDash(bucket.passRate, formatPercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
