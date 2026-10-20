/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { TrendChart, lineSegments } from './TrendChart';
import type { TrendBucket } from '../lib/qa';

function bucket(date: string, runs: number, passRate: number | null): TrendBucket {
  return {
    date,
    runs,
    passed: 0,
    failed: 0,
    other: 0,
    passRate,
    avgDurationMs: null,
    tests: 0,
    testsFailed: 0,
  };
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
  });
});
