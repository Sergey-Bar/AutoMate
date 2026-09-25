import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TrendsPage } from './trends.js';
import type { RunRecord } from '../../services/mttr.js';

type DateRange = 7 | 30 | 90;

interface TrendPoint {
  date: string;
  value: number;
}

const makeTrends = (days: DateRange): TrendPoint[] =>
  Array.from({ length: days }, (_, i) => ({
    date: `Jan ${i + 1}`,
    value: 80 + (i % 15),
  }));

const makeRuns = (days: DateRange): RunRecord[] =>
  Array.from({ length: days }, (_, i) => ({
    timestamp: Date.now() - (days - 1 - i) * 86_400_000,
    status: i % 4 === 0 ? ('failed' as const) : ('passed' as const),
  }));

describe('TrendsPage', () => {
  it('renders the page container', () => {
    render(<TrendsPage getTrends={makeTrends} getRuns={makeRuns} />);
    expect(screen.getByTestId('trends-page')).toBeInTheDocument();
  });

  it('renders the page heading', () => {
    render(<TrendsPage getTrends={makeTrends} getRuns={makeRuns} />);
    expect(screen.getByText('Pass-Rate Trends')).toBeInTheDocument();
  });

  it('renders date-range selector with all three buttons', () => {
    render(<TrendsPage getTrends={makeTrends} getRuns={makeRuns} />);
    expect(screen.getByTestId('date-range-selector')).toBeInTheDocument();
    expect(screen.getByTestId('range-btn-7')).toBeInTheDocument();
    expect(screen.getByTestId('range-btn-30')).toBeInTheDocument();
    expect(screen.getByTestId('range-btn-90')).toBeInTheDocument();
  });

  it('labels date-range buttons correctly', () => {
    render(<TrendsPage getTrends={makeTrends} getRuns={makeRuns} />);
    expect(screen.getByText('Last 7d')).toBeInTheDocument();
    expect(screen.getByText('Last 30d')).toBeInTheDocument();
    expect(screen.getByText('Last 90d')).toBeInTheDocument();
  });

  it('calls getTrends and getRuns with 30-day range on mount (default)', () => {
    const getTrends = vi.fn(makeTrends);
    const getRuns = vi.fn(makeRuns);
    render(<TrendsPage getTrends={getTrends} getRuns={getRuns} />);
    expect(getTrends).toHaveBeenCalledWith(30);
    expect(getRuns).toHaveBeenCalledWith(30);
  });

  it('switches to 7-day range when 7d button is clicked', () => {
    const getTrends = vi.fn(makeTrends);
    const getRuns = vi.fn(makeRuns);
    render(<TrendsPage getTrends={getTrends} getRuns={getRuns} />);
    fireEvent.click(screen.getByTestId('range-btn-7'));
    expect(getTrends).toHaveBeenLastCalledWith(7);
    expect(getRuns).toHaveBeenLastCalledWith(7);
  });

  it('switches to 90-day range when 90d button is clicked', () => {
    const getTrends = vi.fn(makeTrends);
    const getRuns = vi.fn(makeRuns);
    render(<TrendsPage getTrends={getTrends} getRuns={getRuns} />);
    fireEvent.click(screen.getByTestId('range-btn-90'));
    expect(getTrends).toHaveBeenLastCalledWith(90);
    expect(getRuns).toHaveBeenLastCalledWith(90);
  });

  it('renders all three stat cards with correct titles', () => {
    render(<TrendsPage getTrends={makeTrends} getRuns={makeRuns} />);
    expect(screen.getByText('Avg Pass Rate')).toBeInTheDocument();
    expect(screen.getByText('Days ≥ 80%')).toBeInTheDocument();
    expect(screen.getByText('MTTR')).toBeInTheDocument();
  });

  it('shows N/A for MTTR when all runs pass (no recovery events)', () => {
    const getRunsAllPassed = (_days: DateRange): RunRecord[] => [
      { timestamp: Date.now(), status: 'passed' },
    ];
    render(<TrendsPage getTrends={makeTrends} getRuns={getRunsAllPassed} />);
    expect(screen.getByTestId('stat-mttr')).toHaveTextContent('N/A');
  });

  it('shows computed MTTR (not N/A) when failure-then-pass recovery exists', () => {
    const getRunsWithRecovery = (_days: DateRange): RunRecord[] => [
      { timestamp: 0, status: 'failed' },
      { timestamp: 60_000, status: 'passed' },
    ];
    render(<TrendsPage getTrends={makeTrends} getRuns={getRunsWithRecovery} />);
    expect(screen.getByTestId('stat-mttr')).not.toHaveTextContent('N/A');
  });

  it('renders the trend chart card', () => {
    render(<TrendsPage getTrends={makeTrends} getRuns={makeRuns} />);
    expect(screen.getByTestId('trend-chart-card')).toBeInTheDocument();
  });

  it('renders trend chart with bars when data is present', () => {
    render(<TrendsPage getTrends={makeTrends} getRuns={makeRuns} />);
    expect(screen.getByTestId('trend-chart')).toBeInTheDocument();
    expect(screen.getByTestId('trend-bar-0')).toBeInTheDocument();
  });

  it('renders trend-chart-empty when no trend data', () => {
    const emptyTrends = (_days: DateRange): TrendPoint[] => [];
    const emptyRuns = (_days: DateRange): RunRecord[] => [];
    render(<TrendsPage getTrends={emptyTrends} getRuns={emptyRuns} />);
    expect(screen.getByTestId('trend-chart-empty')).toBeInTheDocument();
  });

  it('avgPassRate is 0 when no trend data (emptyTrends)', () => {
    const emptyTrends = (_days: DateRange): TrendPoint[] => [];
    render(<TrendsPage getTrends={emptyTrends} getRuns={makeRuns} />);
    expect(screen.getByTestId('stat-avg-pass-rate')).toHaveTextContent('0%');
  });

  it('passCount is 0 when no trend data', () => {
    const emptyTrends = (_days: DateRange): TrendPoint[] => [];
    render(<TrendsPage getTrends={emptyTrends} getRuns={makeRuns} />);
    expect(screen.getByTestId('stat-good-days')).toHaveTextContent('0');
  });

  it('shows chart label with current range (30 days default)', () => {
    render(<TrendsPage getTrends={makeTrends} getRuns={makeRuns} />);
    expect(screen.getByText(/Last 30 days/)).toBeInTheDocument();
  });

  it('updates chart label after switching to 7-day range', () => {
    render(<TrendsPage getTrends={makeTrends} getRuns={makeRuns} />);
    fireEvent.click(screen.getByTestId('range-btn-7'));
    expect(screen.getByText(/Last 7 days/)).toBeInTheDocument();
  });

  it('updates chart label after switching to 90-day range', () => {
    render(<TrendsPage getTrends={makeTrends} getRuns={makeRuns} />);
    fireEvent.click(screen.getByTestId('range-btn-90'));
    expect(screen.getByText(/Last 90 days/)).toBeInTheDocument();
  });

  it('renders with default data generators when no props are provided', () => {
    render(<TrendsPage />);
    expect(screen.getByTestId('trends-page')).toBeInTheDocument();
    expect(screen.getByTestId('trend-chart')).toBeInTheDocument();
  });

  it('counts days >= 80% correctly in stat-good-days', () => {
    // All points at value=85, so all >= 80 → passCount = days
    const highTrends = (_days: DateRange): TrendPoint[] =>
      Array.from({ length: 7 }, (_, i) => ({ date: `Day ${i}`, value: 85 }));
    render(<TrendsPage getTrends={highTrends} getRuns={makeRuns} />);
    fireEvent.click(screen.getByTestId('range-btn-7'));
    expect(screen.getByTestId('stat-good-days')).toHaveTextContent('7');
  });

  it('counts days < 80% as 0 in stat-good-days when all values are low', () => {
    const lowTrends = (_days: DateRange): TrendPoint[] =>
      Array.from({ length: 7 }, (_, i) => ({ date: `Day ${i}`, value: 70 }));
    render(<TrendsPage getTrends={lowTrends} getRuns={makeRuns} />);
    fireEvent.click(screen.getByTestId('range-btn-7'));
    expect(screen.getByTestId('stat-good-days')).toHaveTextContent('0');
  });

  it('computes avgPassRate correctly from trend data', () => {
    // Two points: value 80 and 100 → avg = 90
    const twoPoints = (_days: DateRange): TrendPoint[] => [
      { date: 'Jan 1', value: 80 },
      { date: 'Jan 2', value: 100 },
    ];
    render(<TrendsPage getTrends={twoPoints} getRuns={makeRuns} />);
    expect(screen.getByTestId('stat-avg-pass-rate')).toHaveTextContent('90%');
  });
});
