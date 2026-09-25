import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/test-utils';
import { DateRangePicker } from '../DateRangePicker';
import { DurationChart, type DurationPoint } from '../DurationChart';
import { ErrorClusterCard, ErrorClustersSection } from '../ErrorClusterCard';
import { FailureHeatmap, type HeatmapSerie } from '../FailureHeatmap';
import { FlakyLeaderboard, type FlakyTest } from '../FlakyLeaderboard';
import { FrequentFailures, type FrequentFailure } from '../FrequentFailures';
import { PassRateChart, type PassRatePoint } from '../PassRateChart';
import { SlowestTests, type SlowTest } from '../SlowestTests';
import { WorkerGantt } from '../WorkerGantt';

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
  LineChart: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'line-chart' }, children),
  BarChart: ({ children, data }: { children: React.ReactNode; data?: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'bar-chart', 'data-points': data?.length ?? 0 }, children),
  AreaChart: ({ children, data }: { children: React.ReactNode; data?: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'area-chart', 'data-points': data?.length ?? 0 }, children),
  ComposedChart: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'composed-chart' }, children),
  Line: () => null,
  Bar: () => null,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Cell: () => null,
  ReferenceLine: () => null,
  Scatter: () => null,
}));

vi.mock('@nivo/heatmap', () => ({
  ResponsiveHeatMap: ({ data }: { data: unknown[] }) => React.createElement('div', { 'data-testid': 'heatmap', 'data-rows': data?.length ?? 0 }),
}));

describe('analytics components', () => {
  describe('DateRangePicker', () => {
    it('renders all presets and selected state', () => {
      const onChange = vi.fn();
      render(<DateRangePicker days={30} onChange={onChange} />);

      expect(screen.queryByLabelText('Date range selector')).not.toBeNull();
      expect(screen.getByRole('button', { name: '7d' }).getAttribute('aria-pressed')).toBe('false');
      expect(screen.getByRole('button', { name: '30d' }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('button', { name: '90d' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('calls onChange when a preset is clicked', () => {
      const onChange = vi.fn();
      render(<DateRangePicker days={7} onChange={onChange} />);

      fireEvent.click(screen.getByRole('button', { name: '90d' }));
      expect(onChange).toHaveBeenCalledWith(90);
    });
  });

  describe('DurationChart', () => {
    const points: DurationPoint[] = [
      { date: '2026-03-01', p50: 1000, p95: 2500 },
      { date: '2026-03-02', p50: 1200, p95: 3000 },
      { date: '2026-03-03', p50: 900, p95: 2200 },
    ];

    it('renders responsive and area chart containers', () => {
      render(<DurationChart data={points} />);
      expect(screen.queryByTestId('responsive-container')).not.toBeNull();
      expect(screen.getByTestId('area-chart').getAttribute('data-points')).toBe('3');
    });

    it('renders with empty data without crashing', () => {
      render(<DurationChart data={[]} />);
      expect(screen.getByTestId('area-chart').getAttribute('data-points')).toBe('0');
    });
  });

  describe('ErrorClusterCard', () => {
    const cluster = {
      clusterId: 'cl-1',
      sampleError: 'TypeError: Cannot read properties of undefined',
      sampleStack: 'at test.spec.ts:10:5',
      testIds: ['t-1', 't-2', 't-3', 't-4', 't-5', 't-6'],
      count: 6,
    };

    it('starts collapsed and expands on click', () => {
      render(<ErrorClusterCard cluster={cluster} />);
      const toggle = screen.getByRole('button', { name: /Expand error cluster details/i });

      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText('at test.spec.ts:10:5')).toBeNull();

      fireEvent.click(toggle);
      expect(screen.queryByText('at test.spec.ts:10:5')).not.toBeNull();
      expect(screen.getByText(/Affected test IDs:/).textContent).toContain('t-1, t-2, t-3, t-4, t-5, +1 more');
    });

    it('shows singular and plural test count labels', () => {
      render(
        <>
          <ErrorClusterCard cluster={{ ...cluster, clusterId: 'one', count: 1 }} />
          <ErrorClusterCard cluster={{ ...cluster, clusterId: 'many', count: 2 }} />
        </>,
      );

      expect(screen.queryByText('1 test')).not.toBeNull();
      expect(screen.queryByText('2 tests')).not.toBeNull();
    });
  });

  describe('ErrorClustersSection', () => {
    it('returns null for empty clusters', () => {
      const { container } = render(<ErrorClustersSection clusters={[]} />);
      expect(container.innerHTML).toBe('');
    });

    it('renders heading and cards for clusters', () => {
      render(
        <ErrorClustersSection
          clusters={[
            { clusterId: 'a', sampleError: 'Err A', sampleStack: null, testIds: ['1'], count: 1 },
            { clusterId: 'b', sampleError: 'Err B', sampleStack: null, testIds: ['2'], count: 1 },
          ]}
        />,
      );

      expect(screen.queryByText('Error Clusters (2)')).not.toBeNull();
      expect(screen.queryByText('Err A')).not.toBeNull();
      expect(screen.queryByText('Err B')).not.toBeNull();
    });
  });

  describe('FailureHeatmap', () => {
    it('shows empty message when no data exists', () => {
      render(<FailureHeatmap data={[]} />);
      expect(screen.queryByText('No failure data yet')).not.toBeNull();
    });

    it('renders heatmap with row count', () => {
      const data: HeatmapSerie[] = [
        { id: 'file-a.spec.ts', data: [{ x: '2026-03-01', y: 2 }] },
        { id: 'file-b.spec.ts', data: [{ x: '2026-03-01', y: 1 }] },
      ];
      render(<FailureHeatmap data={data} />);

      expect(screen.getByTestId('heatmap').getAttribute('data-rows')).toBe('2');
    });
  });

  describe('FlakyLeaderboard', () => {
    const tableData: FlakyTest[] = [
      { title: 'login works', file: 'apps/client/tests/login.spec.ts', flakyCount: 3, totalRuns: 10, flakyRate: 30 },
      { title: 'checkout works', file: 'apps/client/tests/checkout.spec.ts', flakyCount: 1, totalRuns: 20, flakyRate: 5 },
      { title: 'profile update', file: 'apps/client/tests/profile.spec.ts', flakyCount: 5, totalRuns: 10, flakyRate: 50 },
    ];

    it('renders headers and all rows', () => {
      render(<FlakyLeaderboard data={tableData} />);
      expect(screen.queryByRole('columnheader', { name: /Test/i })).not.toBeNull();
      expect(screen.queryByRole('columnheader', { name: /Flaky/i })).not.toBeNull();
      expect(screen.queryByRole('columnheader', { name: /Runs/i })).not.toBeNull();
      expect(screen.queryByRole('columnheader', { name: /Rate/i })).not.toBeNull();

      expect(screen.queryByText('login works')).not.toBeNull();
      expect(screen.queryByText('checkout works')).not.toBeNull();
      expect(screen.queryByText('profile update')).not.toBeNull();
      expect(screen.queryByText('tests/login.spec.ts')).not.toBeNull();
    });

    it('applies default sort by flaky rate descending', () => {
      render(<FlakyLeaderboard data={tableData} />);
      const rows = screen.getAllByRole('row');

      expect(rows[1].textContent).toContain('profile update');
      expect(rows[2].textContent).toContain('login works');
      expect(rows[3].textContent).toContain('checkout works');
    });
  });

  describe('PassRateChart', () => {
    const series: PassRatePoint[] = [
      { date: '2026-03-01', chromium: 98.5, firefox: 96.2 },
      { date: '2026-03-02', chromium: 99.2, firefox: 94.8 },
    ];

    it('renders area chart with data', () => {
      render(<PassRateChart data={series} projects={['chromium', 'firefox']} />);
      expect(screen.queryByTestId('responsive-container')).not.toBeNull();
      expect(screen.getByTestId('area-chart').getAttribute('data-points')).toBe('2');
    });

    it('renders with no projects and empty data', () => {
      render(<PassRateChart data={[]} projects={[]} />);
      expect(screen.getByTestId('area-chart').getAttribute('data-points')).toBe('0');
    });
  });

  describe('SlowestTests', () => {
    const mkSlow = (i: number): SlowTest => ({
      title: `slow test ${i}`,
      file: `apps/client/tests/suite-${i}.spec.ts`,
      avgDurationMs: 1_000 + i,
      p95DurationMs: 2_000 + i,
    });

    it('renders bar chart container', () => {
      render(<SlowestTests data={[mkSlow(1), mkSlow(2)]} />);
      expect(screen.queryByTestId('responsive-container')).not.toBeNull();
      expect(screen.getByTestId('bar-chart').getAttribute('data-points')).toBe('2');
    });

    it('limits chart data to top 20 rows', () => {
      const data = Array.from({ length: 25 }, (_, i) => mkSlow(i + 1));
      render(<SlowestTests data={data} />);
      expect(screen.getByTestId('bar-chart').getAttribute('data-points')).toBe('20');
    });
  });

  describe('WorkerGantt', () => {
    it('shows empty state when no worker timing data is available', () => {
      render(<WorkerGantt tests={[]} totalDurationMs={0} />);
      expect(screen.queryByText(/No worker data/i)).not.toBeNull();
    });

    it('renders worker rows and legend', () => {
      const tests = [
        { title: 'A', file: 'a.spec.ts', status: 'passed', workerIndex: 0, durationMs: 500, startTime: 0 },
        { title: 'B', file: 'b.spec.ts', status: 'failed', workerIndex: 1, durationMs: 750, startTime: 600 },
      ];

      render(<WorkerGantt tests={tests} totalDurationMs={2_000} />);

      expect(screen.queryByText('W0')).not.toBeNull();
      expect(screen.queryByText('W1')).not.toBeNull();
      expect(screen.queryByText('passed')).not.toBeNull();
      expect(screen.queryByText('failed')).not.toBeNull();
      expect(screen.queryByText('skipped')).not.toBeNull();
      expect(screen.queryByText('flaky')).not.toBeNull();
    });
  });

  describe('FrequentFailures', () => {
    const tableData: FrequentFailure[] = [
      {
        errorMessage: 'TypeError: Cannot read properties of undefined (reading "foo")',
        count: 5,
        lastSeen: '2024-01-15T12:00:00.000Z',
        affectedTests: ['test-1', 'test-2', 'test-3', 'test-4', 'test-5'],
      },
      {
        errorMessage: 'Connection refused on port 5432',
        count: 2,
        lastSeen: '2024-01-14T12:00:00.000Z',
        affectedTests: ['test-6', 'test-7'],
      },
    ];

    it('renders column headers', () => {
      render(<FrequentFailures data={tableData} />);
      expect(screen.queryByRole('columnheader', { name: /Error/i })).not.toBeNull();
      expect(screen.queryByRole('columnheader', { name: /Count/i })).not.toBeNull();
      expect(screen.queryByRole('columnheader', { name: /Last Seen/i })).not.toBeNull();
      expect(screen.queryByRole('columnheader', { name: /Tests/i })).not.toBeNull();
    });

    it('renders data rows with counts', () => {
      render(<FrequentFailures data={tableData} />);
      // count=5 and tests=5 both appear in row 1; use queryAllByText
      expect(screen.queryAllByText('5').length).toBeGreaterThanOrEqual(1);
      // count=2 and tests=2 both appear in row 2; use queryAllByText
      expect(screen.queryAllByText('2').length).toBeGreaterThanOrEqual(1);
    });

    it('truncates long error messages to 60 chars', () => {
      const longMessage = 'A'.repeat(80);
      render(<FrequentFailures data={[{ errorMessage: longMessage, count: 1, lastSeen: '2024-01-15T12:00:00.000Z', affectedTests: [] }]} />);
      const cell = screen.queryByText(`${'A'.repeat(60)}…`);
      expect(cell).not.toBeNull();
    });

    it('applies default sort by count descending', () => {
      render(<FrequentFailures data={tableData} />);
      const rows = screen.getAllByRole('row');
      // First data row should be the one with count 5
      expect(rows[1].textContent).toContain('5');
    });
  });
});
