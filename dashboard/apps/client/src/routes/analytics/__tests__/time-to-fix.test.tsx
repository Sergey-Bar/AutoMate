import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../test/test-utils';
import { TtfKpiCards } from '@/components/analytics/TtfKpiCards.js';
import { TtfTrendChart } from '@/components/analytics/TtfTrendChart.js';

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_target: unknown, prop: string) => {
      return ({ initial: _initial, animate: _animate, exit: _exit, variants: _variants, whileHover: _whileHover, whileTap: _whileTap, transition: _transition, layout: _layout, layoutId: _layoutId, ...rest }: Record<string, unknown>) => {
        const tags = ['div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td', 'form', 'ul', 'nav', 'header', 'footer', 'main', 'aside', 'article', 'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4'];
        const Tag = typeof prop === 'string' && tags.includes(prop) ? prop : 'div';
        return React.createElement(Tag, rest);
      };
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useMotionValue: (init: number) => ({ get: () => init, set: vi.fn(), on: vi.fn() }),
  useTransform: (_v: unknown, _input: unknown, output: number[]) => ({ get: () => output?.[0] ?? 0 }),
  useSpring: (v: unknown) => v,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode | ((w: number, h: number) => React.ReactNode) }) =>
    React.createElement('div', { 'data-testid': 'responsive-container' }, typeof children === 'function' ? children(400, 300) : children),
  LineChart: ({ children, data }: { children: React.ReactNode; data?: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'line-chart', 'data-points': data?.length ?? 0 }, children),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (_opts: unknown) => _opts,
  createLazyFileRoute: (_path: string) => (opts: { component: React.ComponentType }) => opts,
  useNavigate: () => vi.fn(),
}));

const mockUseQuery = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
}));

const defaultStats = {
  avgTtfMs: 3600000,
  medianTtfMs: 3200000,
  p95TtfMs: 7200000,
  activeCount: 3,
  resolvedCount: 5,
  byCategory: { timing: { avgTtfMs: 3600000, count: 3 } },
  trend: [
    { week: '2026-W01', avgTtfMs: 3600000, resolvedCount: 2 },
    { week: '2026-W02', avgTtfMs: 5400000, resolvedCount: 3 },
  ],
};

async function importDashboard() {
  const mod = await import('../time-to-fix.lazy.js');
  return mod.default;
}

describe('TimeToFixDashboard', () => {
  it('renders loading state', async () => {
    mockUseQuery.mockReturnValue({ isLoading: true, data: undefined, isError: false });
    const TimeToFixDashboard = await importDashboard();
    render(React.createElement(TimeToFixDashboard));
    expect(screen.queryByTestId('ttf-loading')).not.toBeNull();
  });

  it('renders KPI cards with data', async () => {
    mockUseQuery.mockReturnValue({ isLoading: false, data: defaultStats, isError: false });
    const TimeToFixDashboard = await importDashboard();
    render(React.createElement(TimeToFixDashboard));
    // avgTtfMs=3600000 → "1h"
    expect(screen.queryByTestId('kpi-avg-ttf')).not.toBeNull();
    expect(screen.queryByText('1h')).not.toBeNull();
  });

  it('renders trend chart', async () => {
    mockUseQuery.mockReturnValue({ isLoading: false, data: defaultStats, isError: false });
    const TimeToFixDashboard = await importDashboard();
    render(React.createElement(TimeToFixDashboard));
    expect(screen.queryByTestId('ttf-trend-chart')).not.toBeNull();
  });

  it('renders empty state when no resolved tests', async () => {
    const emptyStats = {
      ...defaultStats,
      avgTtfMs: 0,
      medianTtfMs: 0,
      p95TtfMs: 0,
      resolvedCount: 0,
      trend: [],
    };
    mockUseQuery.mockReturnValue({ isLoading: false, data: emptyStats, isError: false });
    const TimeToFixDashboard = await importDashboard();
    render(React.createElement(TimeToFixDashboard));
    expect(screen.queryByTestId('ttf-trend-empty')).not.toBeNull();
  });

  it('renders cost estimate', async () => {
    const statsWithActive = { ...defaultStats, activeCount: 5 };
    mockUseQuery.mockReturnValue({ isLoading: false, data: statsWithActive, isError: false });
    const TimeToFixDashboard = await importDashboard();
    render(React.createElement(TimeToFixDashboard));
    // default 100/hr * 2hr * 5 = $1000
    expect(screen.queryByTestId('cost-value')).not.toBeNull();
    expect(screen.queryByText('$1,000')).not.toBeNull();
  });
});

describe('TtfKpiCards', () => {
  it('renders all 5 KPI cards', () => {
    render(
      React.createElement(TtfKpiCards, {
        avgTtfMs: 3600000,
        medianTtfMs: 1800000,
        p95TtfMs: 7200000,
        activeCount: 4,
        resolvedCount: 10,
      }),
    );
    expect(screen.queryByTestId('kpi-avg-ttf')).not.toBeNull();
    expect(screen.queryByTestId('kpi-median-ttf')).not.toBeNull();
    expect(screen.queryByTestId('kpi-p95-ttf')).not.toBeNull();
    expect(screen.queryByTestId('kpi-active')).not.toBeNull();
    expect(screen.queryByTestId('kpi-resolved')).not.toBeNull();
  });

  it('formats durations correctly', () => {
    render(
      React.createElement(TtfKpiCards, {
        avgTtfMs: 5400000, // 1h 30m
        medianTtfMs: 2700000, // 45m
        p95TtfMs: 259200000, // 3d
        activeCount: 2,
        resolvedCount: 7,
      }),
    );
    expect(screen.queryByText('1h 30m')).not.toBeNull();
    expect(screen.queryByText('45m')).not.toBeNull();
    expect(screen.queryByText('3d')).not.toBeNull();
  });

  it('renders zero durations as 0m', () => {
    render(
      React.createElement(TtfKpiCards, {
        avgTtfMs: 0,
        medianTtfMs: 0,
        p95TtfMs: 0,
        activeCount: 0,
        resolvedCount: 0,
      }),
    );
    // three "0m" values
    const zeroms = screen.queryAllByText('0m');
    expect(zeroms.length).toBeGreaterThanOrEqual(3);
  });
});

describe('TtfTrendChart', () => {
  it('renders empty state when data is empty', () => {
    render(React.createElement(TtfTrendChart, { data: [] }));
    expect(screen.queryByTestId('ttf-trend-empty')).not.toBeNull();
  });

  it('renders chart when data is provided', () => {
    const data = [
      { week: '2026-W01', avgTtfMs: 3600000, resolvedCount: 1 },
      { week: '2026-W02', avgTtfMs: 7200000, resolvedCount: 2 },
    ];
    render(React.createElement(TtfTrendChart, { data }));
    expect(screen.queryByTestId('ttf-trend-chart')).not.toBeNull();
    expect(screen.queryByTestId('responsive-container')).not.toBeNull();
  });
});

describe('cost estimate interaction', () => {
  it('updates cost when hourly rate input changes', async () => {
    const statsWithActive = { ...defaultStats, activeCount: 5 };
    mockUseQuery.mockReturnValue({ isLoading: false, data: statsWithActive, isError: false });
    const TimeToFixDashboard = await importDashboard();
    render(React.createElement(TimeToFixDashboard));

    const input = screen.getByLabelText('Hourly rate ($)');
    fireEvent.change(input, { target: { value: '200' } });
    // 5 * 2 * 200 = $2000
    expect(screen.queryByText('$2,000')).not.toBeNull();
  });
});
