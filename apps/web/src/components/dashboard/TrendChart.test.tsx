/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import { TrendChart } from './TrendChart.js';
import type { TrendDataPoint } from './TrendChart.js';

const twoPoints: TrendDataPoint[] = [
  { date: '2024-01-01', value: 80 },
  { date: '2024-01-07', value: 95 },
];

const threePoints: TrendDataPoint[] = [
  { date: '2024-01-01', value: 50 },
  { date: '2024-01-04', value: 75 },
  { date: '2024-01-07', value: 100 },
];

describe('TrendChart', () => {
  it('renders empty state when data is empty', () => {
    render(<TrendChart data={[]} />);
    expect(screen.getByTestId('trend-chart-empty')).toBeInTheDocument();
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('does not render chart container in empty state', () => {
    render(<TrendChart data={[]} />);
    expect(screen.queryByTestId('trend-chart')).toBeNull();
  });

  it('renders chart container when data is provided', () => {
    render(<TrendChart data={twoPoints} />);
    expect(screen.getByTestId('trend-chart')).toBeInTheDocument();
  });

  it('does not render empty state when data is provided', () => {
    render(<TrendChart data={twoPoints} />);
    expect(screen.queryByTestId('trend-chart-empty')).toBeNull();
  });

  it('renders a bar for each data point', () => {
    render(<TrendChart data={threePoints} />);
    expect(screen.getByTestId('trend-bar-0')).toBeInTheDocument();
    expect(screen.getByTestId('trend-bar-1')).toBeInTheDocument();
    expect(screen.getByTestId('trend-bar-2')).toBeInTheDocument();
  });

  it('renders correct bar height percentage (value / maxValue * 100)', () => {
    render(<TrendChart data={[{ date: '2024-01-01', value: 50 }]} maxValue={100} />);
    expect(screen.getByTestId('trend-bar-0')).toHaveStyle({ height: '50%' });
  });

  it('clamps bar height to 100% when value exceeds maxValue', () => {
    render(<TrendChart data={[{ date: '2024-01-01', value: 150 }]} maxValue={100} />);
    expect(screen.getByTestId('trend-bar-0')).toHaveStyle({ height: '100%' });
  });

  it('clamps bar height to 0% for negative value', () => {
    render(<TrendChart data={[{ date: '2024-01-01', value: -5 }]} maxValue={100} />);
    expect(screen.getByTestId('trend-bar-0')).toHaveStyle({ height: '0%' });
  });

  it('uses effectiveMax of 1 when maxValue is 0', () => {
    render(<TrendChart data={[{ date: '2024-01-01', value: 1 }]} maxValue={0} />);
    // value / 1 * 100 = 100%
    expect(screen.getByTestId('trend-bar-0')).toHaveStyle({ height: '100%' });
  });

  it('uses effectiveMax of 1 when maxValue is negative', () => {
    render(<TrendChart data={[{ date: '2024-01-01', value: 1 }]} maxValue={-10} />);
    expect(screen.getByTestId('trend-bar-0')).toHaveStyle({ height: '100%' });
  });

  it('renders the label when provided', () => {
    render(<TrendChart data={twoPoints} label="Pass Rate %" />);
    expect(screen.getByText('Pass Rate %')).toBeInTheDocument();
  });

  it('uses default label "Value" which appears in aria-label', () => {
    render(<TrendChart data={twoPoints} />);
    const chart = screen.getByRole('img');
    expect(chart).toHaveAttribute('aria-label', 'Value trend chart');
  });

  it('renders aria-label combining label and "trend chart"', () => {
    render(<TrendChart data={twoPoints} label="Pass Rate" />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Pass Rate trend chart');
  });

  it('renders first and last date labels', () => {
    render(<TrendChart data={twoPoints} />);
    expect(screen.getByText('2024-01-01')).toBeInTheDocument();
    expect(screen.getByText('2024-01-07')).toBeInTheDocument();
  });

  it('applies custom barColor class to bars', () => {
    render(<TrendChart data={twoPoints} barColor="bg-green-500" />);
    const bar = screen.getByTestId('trend-bar-0');
    expect(bar).toHaveClass('bg-green-500');
  });

  it('applies default barColor bg-blue-500 when not specified', () => {
    render(<TrendChart data={twoPoints} />);
    expect(screen.getByTestId('trend-bar-0')).toHaveClass('bg-blue-500');
  });

  it('renders a single data point without error', () => {
    render(<TrendChart data={[{ date: '2024-01-01', value: 42 }]} />);
    expect(screen.getByTestId('trend-bar-0')).toBeInTheDocument();
    expect(screen.getByTestId('trend-bar-0')).toHaveStyle({ height: '42%' });
  });

  it('sets bar title to "date: value"', () => {
    render(<TrendChart data={[{ date: '2024-01-01', value: 80 }]} />);
    // The parent div of the bar has title
    expect(screen.getByTitle('2024-01-01: 80')).toBeInTheDocument();
  });

  it('bar has aria-label with date and value', () => {
    render(<TrendChart data={[{ date: '2024-01-01', value: 80 }]} />);
    expect(screen.getByTestId('trend-bar-0')).toHaveAttribute('aria-label', '2024-01-01: 80');
  });

  it('renders zero-value bar at 0%', () => {
    render(<TrendChart data={[{ date: '2024-01-01', value: 0 }]} />);
    expect(screen.getByTestId('trend-bar-0')).toHaveStyle({ height: '0%' });
  });
});
