import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LeaderboardsPage, type LeaderboardEntry } from './leaderboards.js';

const mockEntries: LeaderboardEntry[] = [
  {
    testId: 't1',
    testName: 'should render login form',
    suiteName: 'Auth',
    failureCount: 42,
    avgDurationMs: 1200,
    flakinessScore: 0.8,
  },
  {
    testId: 't2',
    testName: 'should submit payment',
    suiteName: 'Checkout',
    failureCount: 10,
    avgDurationMs: 4500,
    flakinessScore: 0.5,
  },
  {
    testId: 't3',
    testName: 'should load dashboard',
    suiteName: 'Dashboard',
    failureCount: 5,
    avgDurationMs: 8200,
    flakinessScore: 0.35,
  },
  {
    testId: 't4',
    testName: 'should export CSV',
    suiteName: 'Reports',
    failureCount: 2,
    avgDurationMs: 500,
    flakinessScore: 0.15,
  },
];

describe('LeaderboardsPage', () => {
  it('renders empty state when entries array is empty', () => {
    render(<LeaderboardsPage entries={[]} />);
    expect(screen.getByTestId('leaderboards-empty')).toBeInTheDocument();
    expect(screen.getByText('No Data')).toBeInTheDocument();
  });

  it('renders the leaderboard page when entries are provided', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    expect(screen.getByTestId('leaderboards-page')).toBeInTheDocument();
  });

  it('renders the page heading', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    expect(screen.getByText('Test Leaderboards')).toBeInTheDocument();
  });

  it('renders all test rows', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    expect(screen.getByTestId('leaderboard-row-t1')).toBeInTheDocument();
    expect(screen.getByTestId('leaderboard-row-t2')).toBeInTheDocument();
    expect(screen.getByTestId('leaderboard-row-t3')).toBeInTheDocument();
    expect(screen.getByTestId('leaderboard-row-t4')).toBeInTheDocument();
  });

  it('renders sort control buttons', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    expect(screen.getByTestId('sort-controls')).toBeInTheDocument();
    expect(screen.getByTestId('sort-failures')).toBeInTheDocument();
    expect(screen.getByTestId('sort-slowest')).toBeInTheDocument();
    expect(screen.getByTestId('sort-flaky')).toBeInTheDocument();
  });

  it('defaults to sorting by failureCount descending (highest first)', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    const rows = screen.getAllByRole('row');
    // t1 has failureCount=42 (highest) → first data row
    expect(rows[1]).toHaveTextContent('should render login form');
  });

  it('sorts by avgDurationMs (slowest first) when Slowest is clicked', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    fireEvent.click(screen.getByTestId('sort-slowest'));
    const rows = screen.getAllByRole('row');
    // t3 has avgDurationMs=8200 (highest)
    expect(rows[1]).toHaveTextContent('should load dashboard');
  });

  it('sorts by flakinessScore (flakiest first) when Most Flaky is clicked', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    fireEvent.click(screen.getByTestId('sort-flaky'));
    const rows = screen.getAllByRole('row');
    // t1 has flakinessScore=0.8 (highest)
    expect(rows[1]).toHaveTextContent('should render login form');
  });

  it('re-sorts back to failureCount after switching to slowest and back', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    fireEvent.click(screen.getByTestId('sort-slowest'));
    fireEvent.click(screen.getByTestId('sort-failures'));
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('should render login form');
  });

  it('renders duration in seconds format for avgDurationMs >= 1000', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    expect(screen.getByText('1.2s')).toBeInTheDocument();
    expect(screen.getByText('4.5s')).toBeInTheDocument();
    expect(screen.getByText('8.2s')).toBeInTheDocument();
  });

  it('renders duration in ms format for avgDurationMs < 1000', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    expect(screen.getByText('500ms')).toBeInTheDocument();
  });

  it('renders danger FlakinessBadge for flakinessScore >= 0.7', () => {
    render(<LeaderboardsPage entries={[{ ...mockEntries[0], flakinessScore: 0.8 }]} />);
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('renders warning FlakinessBadge for flakinessScore >= 0.4 and < 0.7', () => {
    render(<LeaderboardsPage entries={[{ ...mockEntries[1], flakinessScore: 0.5 }]} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('renders secondary FlakinessBadge for flakinessScore < 0.4', () => {
    render(<LeaderboardsPage entries={[{ ...mockEntries[2], flakinessScore: 0.35 }]} />);
    expect(screen.getByText('35%')).toBeInTheDocument();
  });

  it('renders exact 0.7 boundary as danger FlakinessBadge', () => {
    render(<LeaderboardsPage entries={[{ ...mockEntries[0], flakinessScore: 0.7 }]} />);
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('renders exact 0.4 boundary as warning FlakinessBadge', () => {
    render(<LeaderboardsPage entries={[{ ...mockEntries[0], flakinessScore: 0.4 }]} />);
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('renders danger failure badge for failureCount > 20', () => {
    render(<LeaderboardsPage entries={[mockEntries[0]]} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders warning failure badge for failureCount <= 20', () => {
    render(<LeaderboardsPage entries={[mockEntries[1]]} />);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders rank numbers starting from 1', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('1');
    expect(rows[1]).toHaveTextContent('2');
    expect(rows[2]).toHaveTextContent('3');
    expect(rows[3]).toHaveTextContent('4');
  });

  it('rank numbers update after re-sort', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    fireEvent.click(screen.getByTestId('sort-slowest'));
    const rows = screen.getAllByRole('row').slice(1);
    // After sort by slowest, t3 is rank 1, t2 is rank 2, t1 is rank 3, t4 is rank 4
    expect(rows[0]).toHaveTextContent('1');
    expect(rows[1]).toHaveTextContent('2');
  });

  it('renders suite names in the table', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    expect(screen.getByText('Auth')).toBeInTheDocument();
    expect(screen.getByText('Checkout')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
  });

  it('renders test names in the table', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    expect(screen.getByText('should render login form')).toBeInTheDocument();
    expect(screen.getByText('should submit payment')).toBeInTheDocument();
  });

  it('uses default MOCK_DATA when no entries prop is provided', () => {
    render(<LeaderboardsPage />);
    expect(screen.getByTestId('leaderboards-page')).toBeInTheDocument();
    expect(screen.getByTestId('leaderboard-row-t1')).toBeInTheDocument();
  });

  it('renders header columns', () => {
    render(<LeaderboardsPage entries={mockEntries} />);
    expect(screen.getByText('#')).toBeInTheDocument();
    expect(screen.getByText('Test Name')).toBeInTheDocument();
    expect(screen.getByText('Suite')).toBeInTheDocument();
    expect(screen.getByText('Failures')).toBeInTheDocument();
    expect(screen.getByText('Avg Duration')).toBeInTheDocument();
    expect(screen.getByText('Flakiness')).toBeInTheDocument();
  });

  it('single entry renders rank 1', () => {
    render(<LeaderboardsPage entries={[mockEntries[0]]} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('1');
  });
});
