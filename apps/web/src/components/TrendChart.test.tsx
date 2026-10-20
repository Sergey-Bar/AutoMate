/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SEGMENTS, TrendChart, areaPoints, lineSegments, tickIndices } from './TrendChart';
import type { TrendBucket } from '../lib/qa';

function bucket(date: string, runs: number, passRate: number | null): TrendBucket {
  return {
    date,
    runs,
    passed: 0,
    failed: 0,
    flaky: 0,
    other: 0,
    passRate,
    avgDurationMs: null,
    tests: 0,
    testsFailed: 0,
  };
}

/** jsdom has no `PointerEvent`, so a pointer is a mouse event under a pointer type name. */
function point(target: HTMLElement, type: string, clientX: number): void {
  fireEvent(target, new MouseEvent(type, { bubbles: true, clientX }));
}

describe('the trend chart', () => {
  it('breaks the line on a day with no verdict, rather than plotting 0%', () => {
    const segments = lineSegments(
      [
        bucket('2026-10-01', 1, 100),
        bucket('2026-10-02', 1, 50),
        bucket('2026-10-03', 1, null),
        bucket('2026-10-04', 1, 0),
      ],
      25,
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]).toBe('12.50,0.00 37.50,20.00');
    // A single day is drawn as a short flat stroke so it is visible at all.
    expect(segments[1]).toBe('81.25,40.00 93.75,40.00');
  });

  it('names an empty window rather than drawing nothing silently', () => {
    render(<TrendChart buckets={[bucket('2026-10-01', 0, null)]} data-testid="chart" />);
    expect(within(screen.getByTestId('chart')).getByRole('img')).toHaveAccessibleName(
      'No runs in the last 1 days.',
    );
    expect(screen.queryAllByTestId('trend-line')).toHaveLength(0);
    // The data is still in the document, for a reader who cannot see the picture.
    expect(screen.getByRole('table', { name: 'Daily runs and pass rate' })).toHaveTextContent(
      '2026-10-01',
    );
  });

  it('draws nothing but axes for no buckets at all', () => {
    render(<TrendChart buckets={[]} />);
    expect(screen.queryAllByTestId('trend-bar')).toHaveLength(0);
    expect(screen.queryAllByTestId('trend-tick')).toHaveLength(0);
  });

  it('spaces at most seven date ticks, always keeping the first and last day', () => {
    expect(tickIndices(0, 7)).toEqual([]);
    expect(tickIndices(3, 7)).toEqual([0, 1, 2]);
    expect(tickIndices(30, 7)).toEqual([0, 5, 10, 15, 19, 24, 29]);
    expect(tickIndices(8, 7)).toHaveLength(7);
  });

  it('stacks each day by verdict, so a red stripe shows before any number is read', () => {
    render(
      <TrendChart
        buckets={[
          { ...bucket('2026-10-01', 4, 50), passed: 2, failed: 1, other: 1 },
          { ...bucket('2026-10-02', 2, 100), passed: 2 },
        ]}
      />,
    );
    const [first, second] = screen.getAllByTestId('trend-bar');
    expect(within(first as HTMLElement).queryAllByTestId('trend-passed')).toHaveLength(1);
    expect(within(first as HTMLElement).queryAllByTestId('trend-failed')).toHaveLength(1);
    expect(within(first as HTMLElement).queryAllByTestId('trend-other')).toHaveLength(1);
    // A verdict with no runs draws no zero-height sliver.
    expect(within(second as HTMLElement).queryAllByTestId('trend-failed')).toHaveLength(0);
    expect(screen.getAllByTestId('trend-point')).toHaveLength(2);
    expect(screen.getAllByTestId('trend-tick').map((tick) => tick.textContent)).toHaveLength(2);
  });

  it('reads out the day under the pointer, and clears when the pointer leaves', () => {
    render(
      <TrendChart
        buckets={[
          { ...bucket('2026-10-01', 3, 67), passed: 2, failed: 1, avgDurationMs: 1500 },
          bucket('2026-10-02', 1, null),
          { ...bucket('2026-10-03', 5, 100), passed: 5 },
          bucket('2026-10-04', 2, 0),
        ]}
      />,
    );
    const hit = screen.getByTestId('trend-hit');
    hit.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 100, right: 400, bottom: 100 }) as DOMRect;
    expect(screen.queryByTestId('trend-tooltip')).not.toBeInTheDocument();

    point(hit, 'pointermove', 50);
    const tooltip = screen.getByTestId('trend-tooltip');
    expect(tooltip).toHaveTextContent('Runs3');
    expect(tooltip).toHaveTextContent('Passed2');
    expect(tooltip).toHaveTextContent('Failed1');
    expect(tooltip).toHaveStyle({ transform: 'translateX(0)' });
    expect(screen.getByTestId('trend-guide')).toHaveAttribute('x', '0');

    point(hit, 'pointerdown', 250);
    expect(screen.getByTestId('trend-tooltip')).toHaveTextContent('Runs5');
    expect(screen.getByTestId('trend-tooltip')).toHaveStyle({ transform: 'translateX(-50%)' });

    // Past the right edge clamps to the last day, and the readout flips to its left.
    point(hit, 'pointermove', 900);
    expect(screen.getByTestId('trend-tooltip')).toHaveTextContent('Runs2');
    expect(screen.getByTestId('trend-tooltip')).toHaveStyle({ transform: 'translateX(-100%)' });

    fireEvent.pointerLeave(hit);
    expect(screen.queryByTestId('trend-tooltip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trend-guide')).not.toBeInTheDocument();
  });

  it('ignores a pointer over a box with no width', () => {
    render(<TrendChart buckets={[bucket('2026-10-01', 1, 100)]} />);
    const hit = screen.getByTestId('trend-hit');
    hit.getBoundingClientRect = () => ({ left: 0, width: 0 }) as DOMRect;
    point(hit, 'pointermove', 10);
    expect(screen.queryByTestId('trend-tooltip')).not.toBeInTheDocument();
  });
});

describe('the trend chart palette', () => {
  it('draws flaky runs as their own segment, in their own colour, and reads them out', () => {
    render(
      <TrendChart
        buckets={[{ ...bucket('2026-10-01', 4, 50), passed: 1, failed: 1, flaky: 1, other: 1 }]}
      />,
    );
    const [bar] = screen.getAllByTestId('trend-bar');
    const flaky = within(bar as HTMLElement).getByTestId('trend-flaky');
    expect(flaky).toHaveClass('text-chart-flaky');
    // Every segment is a chart token, never a status colour at an opacity.
    for (const segment of SEGMENTS) expect(segment.tone).toMatch(/^text-chart-/u);
    const hit = screen.getByTestId('trend-hit');
    hit.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    fireEvent(hit, new MouseEvent('pointermove', { bubbles: true, clientX: 10 }));
    expect(screen.getByTestId('trend-tooltip')).toHaveTextContent('Flaky1');
    expect(screen.getByRole('table', { name: 'Daily runs and pass rate' })).toHaveTextContent(
      'Flaky',
    );
  });

  it('names one legend entry per segment, plus the line', () => {
    const { container } = render(<TrendChart buckets={[bucket('2026-10-01', 1, 100)]} />);
    const legend = container.querySelector('figcaption');
    expect(legend?.textContent).toBe(
      ['Pass rate', ...SEGMENTS.map((segment) => `${segment.label} runs`)].join(''),
    );
  });

  it('fills the area under each line segment from a gradient it defines', () => {
    const { container } = render(
      <TrendChart buckets={[bucket('2026-10-01', 1, 100), bucket('2026-10-02', 1, 50)]} />,
    );
    const [area] = screen.getAllByTestId('trend-area');
    const gradient = container.querySelector('linearGradient');
    expect(gradient?.id).toMatch(/^trend-area-[a-zA-Z0-9]+$/u);
    expect(area).toHaveAttribute('fill', `url(#${gradient?.id ?? ''})`);
    expect(areaPoints('25.00,0.00 75.00,20.00')).toBe('25.00,40 25.00,0.00 75.00,20.00 75.00,40');
  });
});
