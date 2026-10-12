import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Route, AnalyticsPage } from './analytics.js';
import type { ApiClient, AnalyticsSummary, KpiSummary } from '../../lib/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The two methods the screen actually calls, stubbed together.
 *
 * **A mock that covers one of them is a mock of a screen that no longer
 * exists.** This screen reads the analytics summary and the KPI endpoint, and a
 * partial double used to make the second read a `TypeError` on `undefined` —
 * reported as a blank screen rather than as a missing stub.
 */
function analyticsApi(
  analytics: Partial<AnalyticsSummary> | Error,
  kpis: KpiSummary | Error = { kpis: [] },
): ApiClient {
  return {
    getAnalyticsSummary:
      analytics instanceof Error
        ? vi.fn(() => Promise.reject(analytics))
        : vi.fn(() => Promise.resolve(analytics as AnalyticsSummary)),
    getKpiSummary:
      kpis instanceof Error
        ? vi.fn(() => Promise.reject(kpis))
        : vi.fn(() => Promise.resolve(kpis)),
  } as unknown as ApiClient;
}

const SUMMARY: AnalyticsSummary = { totalRuns: 150, passRate: 95, avgDurationMs: 1200 };

describe('AnalyticsPage', () => {
  it('renders loading state initially', () => {
    const mockApi = analyticsApi(SUMMARY);

    render(<AnalyticsPage api={mockApi} />);
    expect(screen.getByTestId('analytics-loading')).toBeInTheDocument();
  });

  it('renders error state if API fails', async () => {
    const mockApi = analyticsApi(new Error('Failed to fetch'));

    render(<AnalyticsPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('analytics-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Error Loading Analytics')).toBeInTheDocument();
  });

  it('renders analytics data correctly', async () => {
    render(<AnalyticsPage api={analyticsApi(SUMMARY)} />);

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

    render(<AnalyticsPage api={analyticsApi(mockData)} />);

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
      getKpiSummary: vi.fn(() => Promise.resolve({ kpis: [] })),
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

/**
 * The KPI grid, the consumer that ends GLASS-3.
 *
 * **Each assertion is about a unit, not a value.** The defect this closes was a
 * percent sign decided per call site, so what these tests pin is that only a
 * `percent` KPI gets one — through the screen, where a reader would have seen
 * the wrong thing.
 */
describe('AnalyticsPage KPIs', () => {
  const KPIS: KpiSummary = {
    kpis: [
      {
        id: 'pass-rate',
        label: 'Pass rate',
        value: 95,
        unit: 'percent',
        denominator: 40,
        qualifier: null,
      },
      {
        id: 'total-runs',
        label: 'Total runs',
        value: 1284,
        unit: 'count',
        denominator: null,
        qualifier: null,
      },
      {
        id: 'avg-duration',
        label: 'Average duration',
        value: 4200,
        unit: 'duration_ms',
        denominator: 9,
        qualifier: 'Across 9 runs that recorded one.',
      },
    ],
  };

  it('formats each KPI from the unit the server declared', async () => {
    render(<AnalyticsPage api={analyticsApi(SUMMARY, KPIS)} />);
    const grid = await screen.findByTestId('kpi-grid');
    expect(grid).toBeInTheDocument();
    // A percent, a count, and a duration — each spelled by the shared formatter,
    // and none of them spelled here. `0.5%` cannot appear in this file.
    expect(screen.getByTestId('kpi-pass-rate')).toHaveTextContent('95%');
    expect(screen.getByTestId('kpi-total-runs')).toHaveTextContent('1,284');
    expect(screen.getByTestId('kpi-avg-duration')).toHaveTextContent('4.2s');
  });

  it('carries the qualifier and the denominator onto the card', async () => {
    render(<AnalyticsPage api={analyticsApi(SUMMARY, KPIS)} />);
    await screen.findByTestId('kpi-grid');
    // The qualifier is the number's own sentence, and the denominator is what it
    // was computed over: a rate without it is a percentage of nothing.
    expect(screen.getByTestId('kpi-avg-duration')).toHaveTextContent(
      'Across 9 runs that recorded one.',
    );
    expect(screen.getByTestId('kpi-pass-rate')).toHaveTextContent('of 40');
  });

  it('shows not measured for a KPI whose measurement never happened', async () => {
    render(
      <AnalyticsPage
        api={analyticsApi(
          { totalRuns: 0, passRate: 0, avgDurationMs: null },
          {
            kpis: [
              {
                id: 'pass-rate',
                label: 'Pass rate',
                value: null,
                unit: 'percent',
                denominator: 0,
                qualifier: 'No run has completed, so there is no rate to report.',
              },
            ],
          },
        )}
      />,
    );
    await screen.findByTestId('kpi-grid');
    expect(screen.getByTestId('kpi-pass-rate')).toHaveTextContent('not measured');
    // **Not `0%`.** An empty install has no rate, and printing zero would be a
    // measurement nobody took.
    expect(screen.getByTestId('kpi-pass-rate')).not.toHaveTextContent('0%');
  });

  it('keeps the summary standing when the KPI endpoint dies', async () => {
    // A partial failure is a partial failure. The three summary numbers came from
    // their own endpoint and are still true; blanking the screen would report a
    // loss of information nobody suffered.
    render(<AnalyticsPage api={analyticsApi(SUMMARY, new Error('kpis down'))} />);
    await screen.findByTestId('analytics-page');
    expect(screen.getByTestId('stat-pass-rate')).toHaveTextContent('95%');
    expect(screen.getByTestId('kpi-error')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-grid')).not.toBeInTheDocument();
  });
});
