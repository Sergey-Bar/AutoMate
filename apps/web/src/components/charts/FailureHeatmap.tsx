import React from 'react';
import { cn } from '@automate/ui';
import type { HeatmapRow } from '../../lib/qa.js';
import { shortDate } from '../../lib/insights.js';
import { tickIndices } from '../TrendChart.js';
import { ChartLegend } from './ChartLegend.js';

/**
 * Where failures cluster: one row per suite, one cell per day.
 *
 * ## Intensity is the share of runs that failed, in five steps
 *
 * A count would make a busy suite look worse than a quiet one that fails every time, so the
 * cell is the failed *share* of that day's runs, stepped rather than continuous: five steps
 * can be told apart, a gradient of thirty cannot. A day with no runs is an empty well, not a
 * green cell — no run is not a pass. Pointing at a cell reads it out below the grid; the
 * whole grid is also a visually hidden table.
 */
export const HEAT_STEPS = [
  { key: 'none', label: 'No runs', className: 'bg-surface-muted' },
  { key: 'clean', label: 'All passed', className: 'bg-chart-pass/40' },
  { key: 'low', label: 'Under a third failed', className: 'bg-chart-fail/30' },
  { key: 'mid', label: 'Under two thirds failed', className: 'bg-chart-fail/60' },
  { key: 'high', label: 'Most failed', className: 'bg-chart-fail' },
] as const;

export function heatStep(cell: { runs: number; failed: number }): (typeof HEAT_STEPS)[number] {
  const [none, clean, low, mid, high] = HEAT_STEPS;
  if (cell.runs === 0) return none;
  const share = cell.failed / cell.runs;
  if (share === 0) return clean;
  if (share < 1 / 3) return low;
  if (share < 2 / 3) return mid;
  return high;
}

export function FailureHeatmap({
  rows,
  dates,
}: {
  rows: readonly HeatmapRow[];
  dates: readonly string[];
}): React.ReactElement {
  const [active, setActive] = React.useState<{ row: number; day: number } | null>(null);
  const ticks = tickIndices(dates.length, 5);
  const focus = active === null ? undefined : rows[active.row];
  const cell = active === null ? undefined : focus?.cells[active.day];
  const readout =
    focus === undefined || cell === undefined || active === null
      ? 'Point at a cell for its day'
      : `${focus.suite} · ${shortDate(dates[active.day] ?? '')}: ${String(cell.failed)} of ${String(cell.runs)} run${cell.runs === 1 ? '' : 's'} failed`;
  return (
    <figure data-testid="failure-heatmap" className="m-0 flex min-h-0 flex-1 flex-col gap-2">
      <div
        aria-hidden="true"
        className="grid min-h-0 flex-1 grid-cols-[minmax(4rem,8rem)_minmax(0,1fr)] gap-x-2 gap-y-1"
        style={{ gridTemplateRows: `repeat(${String(rows.length)}, minmax(0, 1fr)) auto` }}
        onPointerLeave={() => setActive(null)}
      >
        {rows.map((row, rowIndex) => (
          <React.Fragment key={row.suite}>
            <span
              className="flex min-w-0 items-center truncate font-mono text-xs"
              title={row.suite}
            >
              {row.suite}
            </span>
            <div
              className="grid min-h-3 gap-0.5"
              style={{ gridTemplateColumns: `repeat(${String(dates.length)}, minmax(0, 1fr))` }}
            >
              {row.cells.map((entry, dayIndex) => (
                <span
                  key={dates[dayIndex] ?? dayIndex}
                  data-testid="heat-cell"
                  data-step={heatStep(entry).key}
                  onPointerEnter={() => setActive({ row: rowIndex, day: dayIndex })}
                  className={cn(
                    'rounded-sm',
                    heatStep(entry).className,
                    active?.row === rowIndex && active.day === dayIndex && 'ring-2 ring-fg',
                  )}
                />
              ))}
            </div>
          </React.Fragment>
        ))}
        <span />
        <div className="relative h-4 text-xs text-fg-muted">
          {ticks.map((index) => (
            <span
              key={dates[index] ?? index}
              className="absolute whitespace-nowrap"
              style={{
                left: `${String(((index + 0.5) / Math.max(1, dates.length)) * 100)}%`,
                transform: `translateX(${index === 0 ? '0' : index === dates.length - 1 ? '-100%' : '-50%'})`,
              }}
            >
              {shortDate(dates[index] ?? '')}
            </span>
          ))}
        </div>
      </div>
      <p aria-hidden="true" data-testid="heat-readout" className="shrink-0 truncate text-xs">
        {readout}
      </p>
      <ChartLegend
        entries={HEAT_STEPS.map((step) => ({ label: step.label, tone: toneFor(step.key) }))}
        className="hidden sm:flex"
      />
      <div className="sr-only">
        <table>
          <caption>Failed runs by suite and day</caption>
          <thead>
            <tr>
              <th scope="col">Suite</th>
              {dates.map((date) => (
                <th key={date} scope="col">
                  {date}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.suite}>
                <th scope="row">{row.suite}</th>
                {row.cells.map((entry, index) => (
                  <td
                    key={dates[index] ?? index}
                  >{`${String(entry.failed)} of ${String(entry.runs)}`}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** The legend draws each step as a text-colour swatch, so it needs the text form of the step. */
function toneFor(key: (typeof HEAT_STEPS)[number]['key']): string {
  return {
    none: 'text-surface-muted',
    clean: 'text-chart-pass/40',
    low: 'text-chart-fail/30',
    mid: 'text-chart-fail/60',
    high: 'text-chart-fail',
  }[key];
}
