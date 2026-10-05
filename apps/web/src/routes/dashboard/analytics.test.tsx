import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Route, AnalyticsPage } from './analytics.js';
import type { ApiClient, AnalyticsSummary } from '../../lib/api.js';

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
    expect(screen.getByTestId('stat-avg-duration')).toHaveTextContent('1200ms');
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
