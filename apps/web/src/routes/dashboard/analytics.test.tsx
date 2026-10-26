import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Route, AnalyticsPage, allTimePassRate } from './analytics.js';
import type { ApiClient, AnalyticsSummary } from '../../lib/api.js';
import { makeQa } from '../../test-utils.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AnalyticsPage', () => {
  it('renders loading state initially', () => {
    const mockApi = {
      getAnalyticsSummary: vi.fn(() => new Promise<AnalyticsSummary>(() => {})),
    } as unknown as ApiClient;

    render(<AnalyticsPage api={mockApi} />);
    expect(screen.getByTestId('analytics-loading')).toBeInTheDocument();
  });

  it('renders error state if API fails', async () => {
    const mockApi = {
      getAnalyticsSummary: vi.fn(() => Promise.reject(new Error('Failed to fetch'))),
    } as unknown as ApiClient;

    render(<AnalyticsPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('analytics-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Error Loading Analytics')).toBeInTheDocument();
  });

  it('renders analytics data correctly', async () => {
    const mockData: AnalyticsSummary = {
      totalRuns: 150,
      passRate: 95,
      avgDurationMs: 1200,
    };

    const mockApi = {
      getAnalyticsSummary: vi.fn(() => Promise.resolve(mockData)),
    } as unknown as ApiClient;

    render(<AnalyticsPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('stat-total-runs')).toHaveTextContent('150');
    expect(screen.getByTestId('stat-pass-rate')).toHaveTextContent('95%');
    expect(screen.getByTestId('stat-pass-rate')).toHaveTextContent('reporter-uploaded runs');
    expect(screen.getByTestId('stat-avg-duration')).toHaveTextContent('1.2 s');
  });

  it('does not call an empty history a 0% pass rate', async () => {
    // The summary answers `passRate: 0` when no run completed; drawn as 0% that claims every
    // run failed. With no run, there is no rate.
    const mockApi = {
      getAnalyticsSummary: vi.fn(async () => ({ totalRuns: 0, passRate: 0, avgDurationMs: null })),
    } as unknown as ApiClient;
    render(<AnalyticsPage api={mockApi} />);
    const passRate = await screen.findByTestId('stat-pass-rate');
    expect(passRate).toHaveTextContent('not measured');
    expect(passRate).not.toHaveTextContent('%');
  });

  it('reads a null pass rate from a newer server as not measured', () => {
    expect(allTimePassRate({ totalRuns: 4, passRate: null })).toBe('not measured');
    expect(allTimePassRate({ totalRuns: 4, passRate: 50 })).toBe('50');
  });

  it('does not call runs that are all still executing a 0% pass rate', async () => {
    // The server used to answer `passRate: 0` here, and with `totalRuns` above zero the
    // page drew it as "0": every run failed. It now answers `null`.
    const mockApi = {
      getAnalyticsSummary: vi.fn(async () => ({
        totalRuns: 3,
        passRate: null,
        avgDurationMs: null,
      })),
    } as unknown as ApiClient;
    render(<AnalyticsPage api={mockApi} />);
    const passRate = await screen.findByTestId('stat-pass-rate');
    expect(passRate).toHaveTextContent('not measured');
  });

  it('reads the chosen window from the trend, day by day, and refetches on a new window', async () => {
    const qa = makeQa();
    const mockApi = {
      getAnalyticsSummary: vi.fn(async () => ({ totalRuns: 1, passRate: 100, avgDurationMs: 5 })),
    } as unknown as ApiClient;
    render(<AnalyticsPage api={mockApi} qa={qa} />);
    await waitFor(() => expect(screen.getByTestId('analytics-trend')).toBeInTheDocument());
    expect(screen.getByTestId('stat-window-runs')).toHaveTextContent('12');
    expect(screen.getByTestId('stat-window-pass-rate')).toHaveTextContent('90.0%');
    expect(screen.getByTestId('stat-window-failed')).toHaveTextContent('of 100 executed');
    // Newest day first, and a day with no verdict reads as a dash, not 0%.
    const rows = within(screen.getByTestId('analytics-days')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Sep 22');
    expect(rows[2]).toHaveTextContent('—');
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(qa.getTrend).toHaveBeenLastCalledWith(7));
  });

  it('keeps the all-time figures when the trend cannot be read', async () => {
    const qa = makeQa({
      getTrend: vi.fn(async () => {
        throw new Error('trend offline');
      }),
    });
    const mockApi = {
      getAnalyticsSummary: vi.fn(async () => ({ totalRuns: 4, passRate: 50, avgDurationMs: null })),
    } as unknown as ApiClient;
    render(<AnalyticsPage api={mockApi} qa={qa} />);
    await waitFor(() =>
      expect(screen.getByTestId('analytics-trend-state')).toHaveTextContent('trend offline'),
    );
    expect(screen.getByTestId('stat-total-runs')).toHaveTextContent('4');
    expect(screen.getByTestId('stat-window-runs')).toHaveTextContent('—');
    expect(screen.getByTestId('analytics-days')).toHaveTextContent('Waiting for run history');
  });

  it('handles null average duration', async () => {
    const mockData: AnalyticsSummary = {
      totalRuns: 5,
      passRate: 0,
      avgDurationMs: null,
    };

    const mockApi = {
      getAnalyticsSummary: vi.fn(() => Promise.resolve(mockData)),
    } as unknown as ApiClient;

    render(<AnalyticsPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
    });

    // **The word, not `N/A`.** A missing measurement is a state rather than a value, and
    // `PERF-1` is an open row because some of these numbers have never been recorded. The
    // second assertion is what keeps this from being a test of absence: a screen that
    // rendered nothing at all would satisfy the first.
    const duration = screen.getByTestId('stat-avg-duration');
    expect(duration).toHaveTextContent('not measured');
    expect(duration.textContent).not.toContain('N/A');
  });

  // --- Additional test for full branch coverage ---

  it('renders empty state when data is null after loading', async () => {
    const mockApi = {
      getAnalyticsSummary: vi.fn(() => Promise.resolve(null as unknown as AnalyticsSummary)),
    } as unknown as ApiClient;

    render(<AnalyticsPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('analytics-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('No Data')).toBeInTheDocument();
  });

  // --- Route callback coverage ---

  it('Route getParentRoute callback returns a defined value', () => {
    const options = Route.options as unknown as {
      getParentRoute: () => unknown;
      component: () => React.ReactNode;
    };
    expect(options.getParentRoute()).toBeDefined();
  });

  it('Route component factory renders AnalyticsPage with default client', async () => {
    const options = Route.options as unknown as {
      component: () => React.ReactNode;
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ totalRuns: 3, passRate: 75, avgDurationMs: 400 }),
      }),
    );
    render(<>{options.component()}</>);
    await waitFor(() => {
      expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
    });
  });
});
