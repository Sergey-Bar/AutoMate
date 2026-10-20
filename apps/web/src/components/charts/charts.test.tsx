/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FailureHeatmap, HEAT_STEPS, heatStep } from './FailureHeatmap';
import { HISTORY_SERIES, HistoryChart, historySegments } from './HistoryChart';
import { ChartLegend } from './ChartLegend';
import { makeHistory } from '../../test-utils';

describe('the failure heatmap', () => {
  it('steps a cell by the share of its runs that failed, and leaves a day with no runs empty', () => {
    expect(heatStep({ runs: 0, failed: 0 }).key).toBe('none');
    expect(heatStep({ runs: 4, failed: 0 }).key).toBe('clean');
    expect(heatStep({ runs: 4, failed: 1 }).key).toBe('low');
    expect(heatStep({ runs: 4, failed: 2 }).key).toBe('mid');
    expect(heatStep({ runs: 3, failed: 2 }).key).toBe('high');
    expect(heatStep({ runs: 1, failed: 1 }).key).toBe('high');
    // A busy suite failing once is lighter than a quiet one failing every time.
    expect(heatStep({ runs: 10, failed: 1 }).key).toBe('low');
    for (const step of HEAT_STEPS.slice(2)) expect(step.className).toMatch(/chart-fail/u);
  });

  it('reads out the cell under the pointer, and keeps the whole grid as a table', () => {
    render(
      <FailureHeatmap
        dates={['2026-09-20', '2026-09-21']}
        rows={[
          {
            suite: 'e2e',
            failed: 1,
            cells: [
              { runs: 2, failed: 1 },
              { runs: 1, failed: 0 },
            ],
          },
          {
            suite: 'unit',
            failed: 0,
            cells: [
              { runs: 0, failed: 0 },
              { runs: 1, failed: 0 },
            ],
          },
        ]}
      />,
    );
    const cells = screen.getAllByTestId('heat-cell');
    expect(cells.map((cell) => cell.dataset['step'])).toEqual(['mid', 'clean', 'none', 'clean']);
    expect(screen.getByTestId('heat-readout')).toHaveTextContent('Point at a cell for its day');
    fireEvent.pointerEnter(cells[0] as HTMLElement);
    expect(screen.getByTestId('heat-readout')).toHaveTextContent('e2e · ');
    expect(screen.getByTestId('heat-readout')).toHaveTextContent('1 of 2 runs failed');
    expect(cells[0]).toHaveClass('ring-2');
    fireEvent.pointerEnter(cells[3] as HTMLElement);
    expect(screen.getByTestId('heat-readout')).toHaveTextContent('0 of 1 run failed');
    fireEvent.pointerLeave(screen.getByTestId('failure-heatmap').firstElementChild as HTMLElement);
    expect(screen.getByTestId('heat-readout')).toHaveTextContent('Point at a cell');
    expect(screen.getByRole('table', { name: 'Failed runs by suite and day' })).toHaveTextContent(
      '1 of 2',
    );
  });
});

describe('the history chart', () => {
  it('draws coverage and health as two lines, broken where a reading has no value', () => {
    const points = makeHistory().points;
    expect(historySegments(points, 'coverage')).toHaveLength(1);
    const gap = [
      ...points.slice(0, 2),
      { ...points[2]!, coverage: null },
      { ...points[2]!, at: '2026-09-27T10:00:00.000Z' },
      { ...points[2]!, at: '2026-09-28T10:00:00.000Z' },
    ];
    expect(historySegments(gap, 'coverage')).toHaveLength(2);
    expect(historySegments(points.slice(0, 1), 'healthScore')).toEqual([]);
    expect(HISTORY_SERIES.map((series) => series.tone)).toEqual(['text-chart-1', 'text-chart-3']);
  });

  it('names its range for a screen reader, and keeps every reading in a table', () => {
    render(<HistoryChart points={makeHistory().points} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Coverage from 88.1% to 90.3%; health score from 61.0 to 66.5.',
    );
    expect(screen.getAllByTestId('history-coverage')).toHaveLength(1);
    expect(
      screen.getByRole('table', { name: 'Coverage and health score readings' }),
    ).toHaveTextContent('89.4%');
  });

  it('describes an empty history and a reading with no coverage', () => {
    const { unmount } = render(<HistoryChart points={[]} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('No readings yet.');
    unmount();
    render(
      <HistoryChart
        points={[
          {
            at: '2026-09-20T00:00:00.000Z',
            coverage: null,
            healthScore: null,
            maturity: 1,
            flakyTests: 0,
          },
        ]}
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Coverage from — to —; health score from — to —.',
    );
  });
});

describe('the chart legend', () => {
  it('draws a stroke for a line series and a square for a swatch', () => {
    const { container } = render(
      <ChartLegend
        entries={[
          { label: 'Line', tone: 'text-chart-1', shape: 'line' },
          { label: 'Swatch', tone: 'text-chart-2', opacity: 0.5 },
        ]}
      />,
    );
    const rects = container.querySelectorAll('rect');
    expect(rects[0]).toHaveAttribute('height', '2');
    expect(rects[1]).toHaveAttribute('fill-opacity', '0.5');
    expect(screen.getByTestId('chart-legend')).toHaveTextContent('LineSwatch');
  });
});
