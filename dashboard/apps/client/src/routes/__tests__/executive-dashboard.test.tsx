/**
 * executive-dashboard.test.tsx
 *
 * Tests for the /analytics/executive route (ExecutiveDashboard component).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/test-utils';

// ─── Hoisted state ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  searchState: new Map<string, Record<string, unknown>>(),
  routeComponents: new Map<string, React.ComponentType>(),
  fetchMock: vi.fn<typeof fetch>(),
}));

vi.stubGlobal('fetch', mocks.fetchMock);

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => {
  type RouteFactoryOptions = { component?: React.ComponentType };
  function registerRoute(path: string, options: RouteFactoryOptions) {
    if (options.component) mocks.routeComponents.set(path, options.component);
    return {
      ...options,
      useSearch: () => mocks.searchState.get(path) ?? {},
      useParams: () => ({}),
    };
  }
  return {
    Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to, ...rest }, children),
    createFileRoute: (path: string) => (options: RouteFactoryOptions) => registerRoute(path, options),
    createLazyFileRoute: (path: string) => (options: RouteFactoryOptions) => registerRoute(path, options),
    useNavigate: () => mocks.navigateMock,
    useRouter: () => ({ navigate: mocks.navigateMock }),
    useSearch: (opts?: { from?: string }) => mocks.searchState.get(opts?.from ?? '') ?? {},
    useParams: () => ({}),
  };
});

// ─── Default metrics fixture ──────────────────────────────────────────────────

const defaultMetrics = {
  qualityTrend: {
    currentPassRate: 92.5,
    previousPassRate: 90.0,
    changePct: 2.5,
    dataPoints: [
      { date: '2026-04-01', passRate: 90.0 },
      { date: '2026-04-15', passRate: 92.5 },
    ],
  },
  flakyTestCost: {
    flakyReruns: 42,
    estimatedMinutesWasted: 7,
    changeVsPrevious: -3,
  },
  quarantineEffectiveness: {
    quarantinedCount: 12,
    passRateBeforeQuarantine: 88.0,
    passRateAfterQuarantine: 92.5,
    improvementPct: 4.5,
  },
  escapedDefectRate: {
    totalRuns: 120,
    runsWithFailures: 18,
    rate: 15.0,
    changeVsPrevious: -5.0,
  },
  mttd: {
    avgDetectionMinutes: 3.5,
    changeVsPrevious: -0.5,
  },
  releaseFrequency: {
    runsPerWeek: 4.3,
    totalRuns: 120,
    changeVsPrevious: 0.7,
  },
};

function mockFetch(data: unknown, status = 200) {
  mocks.fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response);
}

// ─── Component loader (import once before all tests) ─────────────────────────

// Import happens at module load time; vitest caches it.
// We import here just to trigger the route registration before tests run.
import '../analytics/executive.lazy';

async function renderDashboard() {
  const Component = mocks.routeComponents.get('/analytics/executive');
  if (!Component) throw new Error('ExecutiveDashboard component not registered');
  return renderWithProviders(React.createElement(Component));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ExecutiveDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchState.clear();
    mocks.searchState.set('/analytics/executive', { period: '30d' });
  });

  it('renders page heading', async () => {
    mocks.fetchMock.mockReturnValue(new Promise(() => undefined)); // never resolves
    const { container } = await renderDashboard();
    expect(container.textContent).toContain('Executive Dashboard');
  });

  it('renders 6 metric cards on successful fetch', async () => {
    mockFetch(defaultMetrics);
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('metrics-grid')).toBeInTheDocument();
    });
    expect(screen.getByTestId('metric-quality-trend')).toBeInTheDocument();
    expect(screen.getByTestId('metric-flaky-cost')).toBeInTheDocument();
    expect(screen.getByTestId('metric-quarantine')).toBeInTheDocument();
    expect(screen.getByTestId('metric-escaped-defects')).toBeInTheDocument();
    expect(screen.getByTestId('metric-mttd')).toBeInTheDocument();
    expect(screen.getByTestId('metric-release-frequency')).toBeInTheDocument();
  });

  it('displays quality trend pass rate value', async () => {
    mockFetch(defaultMetrics);
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('metric-quality-trend')).toBeInTheDocument();
    });
    expect(screen.getByTestId('metric-quality-trend').textContent).toContain('92.5%');
  });

  it('renders error message when fetch fails', async () => {
    mockFetch({}, 500);
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert').textContent).toContain('Failed to load executive metrics');
  });

  it('renders period selector with 3 options', async () => {
    mocks.fetchMock.mockReturnValue(new Promise(() => undefined));
    await renderDashboard();
    expect(screen.getByTestId('period-30d')).toBeInTheDocument();
    expect(screen.getByTestId('period-60d')).toBeInTheDocument();
    expect(screen.getByTestId('period-90d')).toBeInTheDocument();
  });

  it('renders trend table when data points exist', async () => {
    mockFetch(defaultMetrics);
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('trend-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('trend-table').textContent).toContain('2026-04-01');
  });

  it('does not render trend table when no data points', async () => {
    const noTrendMetrics = {
      ...defaultMetrics,
      qualityTrend: { ...defaultMetrics.qualityTrend, dataPoints: [] },
    };
    mockFetch(noTrendMetrics);
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('metrics-grid')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('trend-table')).not.toBeInTheDocument();
  });

  it('shows MTTD in seconds for sub-minute values', async () => {
    const fastMetrics = {
      ...defaultMetrics,
      mttd: { avgDetectionMinutes: 0.5, changeVsPrevious: 0 },
    };
    mockFetch(fastMetrics);
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('metric-mttd')).toBeInTheDocument();
    });
    // 0.5 min × 60 = 30s
    expect(screen.getByTestId('metric-mttd').textContent).toContain('30s');
  });
});

