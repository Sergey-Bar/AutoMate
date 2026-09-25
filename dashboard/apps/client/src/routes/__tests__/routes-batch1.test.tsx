import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderWithProviders, screen, userEvent, waitFor } from '../../test/test-utils';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  routeSearch: new Map<string, Record<string, unknown>>(),
  routeParams: new Map<string, Record<string, string>>(),
  routeNavigate: new Map<string, (...args: unknown[]) => unknown>(),
  useRuns: vi.fn(),
  useRun: vi.fn(),
  useRunTests: vi.fn(),
  useTest: vi.fn(),
  useRunCompare: vi.fn(),
  abortRun: vi.fn(),
  useLiveRun: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  captureException: vi.fn(),
  fetchMock: vi.fn(),
  runStoreState: {
    run: null as Record<string, unknown> | null,
    tests: {} as Record<string, Record<string, unknown>>,
  },
}));

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

vi.mock('@tanstack/react-router', () => {
  const createRoute = (path: string) => (options: Record<string, unknown>) => ({
    ...options,
    useSearch: () => mocks.routeSearch.get(path) ?? {},
    useParams: () => mocks.routeParams.get(path) ?? {},
    useNavigate: () => mocks.routeNavigate.get(path) ?? mocks.navigate,
  });

  return {
    Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string } & Record<string, unknown>) => React.createElement('a', { href: to, ...rest }, children),
    Outlet: () => React.createElement('div', { 'data-testid': 'router-outlet' }),
    createRootRouteWithContext: () => (options: Record<string, unknown>) => ({ ...options }),
    createFileRoute: createRoute,
    createLazyFileRoute: createRoute,
    useNavigate: () => mocks.navigate,
    useRouter: () => ({ navigate: mocks.navigate }),
    useSearch: () => ({}),
    useParams: () => ({}),
    useLoaderData: () => undefined,
    useMatch: () => ({ params: {} }),
  };
});

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'recharts-responsive' }, children),
  AreaChart: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'recharts-area-chart' }, children),
  Area: () => React.createElement('div', { 'data-testid': 'recharts-area' }),
  XAxis: () => React.createElement('div', { 'data-testid': 'recharts-xaxis' }),
  YAxis: () => React.createElement('div', { 'data-testid': 'recharts-yaxis' }),
  Tooltip: () => React.createElement('div', { 'data-testid': 'recharts-tooltip' }),
  Legend: () => React.createElement('div', { 'data-testid': 'recharts-legend' }),
  PieChart: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'recharts-pie-chart' }, children),
  Pie: () => React.createElement('div', { 'data-testid': 'recharts-pie' }),
  Cell: () => React.createElement('div', { 'data-testid': 'recharts-cell' }),
  BarChart: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'recharts-bar-chart' }, children),
  Bar: () => React.createElement('div', { 'data-testid': 'recharts-bar' }),
  CartesianGrid: () => React.createElement('div', { 'data-testid': 'recharts-grid' }),
  LineChart: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'recharts-line-chart' }, children),
  Line: () => React.createElement('div', { 'data-testid': 'recharts-line' }),
}));

vi.mock('@nivo/heatmap', () => ({
  ResponsiveHeatMap: () => React.createElement('div', { 'data-testid': 'nivo-heatmap' }),
}));

vi.mock('xterm', () => ({
  Terminal: vi.fn(function TerminalMock() {
    return { open: vi.fn(), dispose: vi.fn(), write: vi.fn(), loadAddon: vi.fn() };
  }),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function TerminalMock() {
    return { open: vi.fn(), dispose: vi.fn(), write: vi.fn(), loadAddon: vi.fn() };
  }),
}));

vi.mock('xterm-addon-fit', () => ({
  FitAddon: vi.fn(function FitAddonMock() {
    return { fit: vi.fn(), dispose: vi.fn() };
  }),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function FitAddonMock() {
    return { fit: vi.fn(), dispose: vi.fn() };
  }),
}));

vi.mock('react-arborist', () => ({
  Tree: ({ children }: { children?: React.ReactNode }) => React.createElement('div', { 'data-testid': 'arborist-tree' }, children),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
  Toaster: () => React.createElement('div', { 'data-testid': 'toaster' }),
}));

vi.mock('@sentry/react', () => ({
  captureException: mocks.captureException,
}));

vi.mock('cmdk', () => ({
  Command: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  CommandInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', props),
  CommandList: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  CommandItem: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => React.createElement('div', rest, children),
  CommandEmpty: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  CommandGroup: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  CommandSeparator: () => React.createElement('hr'),
}));

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value?: string }) => React.createElement('div', { 'data-testid': 'monaco-editor' }, value ?? ''),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: () => React.createElement('main', { 'data-testid': 'app-shell' }, 'app-shell'),
}));

vi.mock('@/components/shared/NotFoundPage', () => ({
  NotFoundPage: () => React.createElement('div', { 'data-testid': 'not-found-page' }, 'not-found'),
}));

vi.mock('@/hooks/useRun', () => ({
  useRuns: (...args: unknown[]) => mocks.useRuns(...args),
  useRun: (...args: unknown[]) => mocks.useRun(...args),
  useRunTests: (...args: unknown[]) => mocks.useRunTests(...args),
  useTest: (...args: unknown[]) => mocks.useTest(...args),
  useRunCompare: (...args: unknown[]) => mocks.useRunCompare(...args),
  abortRun: (...args: unknown[]) => mocks.abortRun(...args),
}));

vi.mock('@/hooks/useLiveRun', () => ({
  useLiveRun: (...args: unknown[]) => mocks.useLiveRun(...args),
}));

vi.mock('@/store/runStore', () => ({
  useRunStore: (selector: (state: { run: Record<string, unknown> | null; tests: Record<string, Record<string, unknown>> }) => unknown) => selector(mocks.runStoreState),
}));

vi.mock('@/components/shared/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/shared/StatusBadge', () => ({
  RunStatusBadge: ({ status }: { status: string }) => React.createElement('span', null, `status:${status}`),
  StatusBadge: ({ status }: { status: string }) => React.createElement('span', null, `status:${status}`),
}));

vi.mock('@/components/shared/EmptyState', () => ({
  EmptyState: ({ title, description, cta, onCta }: { title: string; description?: string; cta?: string; onCta?: () => void }) => React.createElement('div', null,
    React.createElement('h3', null, title),
    description ? React.createElement('p', null, description) : null,
    cta ? React.createElement('button', { type: 'button', onClick: onCta }, cta) : null,
  ),
}));

vi.mock('@/components/shared/Skeleton', () => ({
  KpiSkeleton: () => React.createElement('div', null, 'kpi-skeleton'),
  RunListSkeleton: () => React.createElement('div', null, 'run-list-skeleton'),
  TestListSkeleton: () => React.createElement('div', null, 'test-list-skeleton'),
}));

vi.mock('@/components/tests/ImpactedTests', () => ({
  ImpactedTests: ({ changedFiles }: { changedFiles: string[] }) => React.createElement('div', null, `impacted:${changedFiles.length}`),
}));

vi.mock('@/components/runs/RunTrigger', () => ({
  RunTrigger: ({ onClose }: { onClose: () => void }) => React.createElement('div', { role: 'dialog' },
    React.createElement('span', null, 'run-trigger'),
    React.createElement('button', { type: 'button', onClick: onClose }, 'close-trigger'),
  ),
}));

vi.mock('@/components/runs/GateBadge', () => ({
  GateBadge: ({ gateStatus }: { gateStatus: string | null }) => React.createElement('span', null, `gate:${gateStatus ?? 'none'}`),
}));

vi.mock('@/components/runs/SourceBadge', () => ({
  SourceBadge: ({ source }: { source: string | null }) => React.createElement('span', null, `source:${source ?? 'none'}`),
}));

vi.mock('@/components/runs/CIStatusBadge', () => ({
  CIStatusBadge: ({ commitSha }: { commitSha?: string | null }) => React.createElement('span', null, `ci:${commitSha ?? 'none'}`),
}));

vi.mock('@/components/runs/RunProgress', () => ({
  RunProgress: ({ passed, failed, total }: { passed: number; failed: number; total: number }) => React.createElement('div', null, `progress:${passed}/${failed}/${total}`),
}));

vi.mock('@/components/runs/LiveTerminal', () => ({
  LiveTerminal: () => React.createElement('div', null, 'live-terminal'),
}));

vi.mock('@/components/runs/FailureFingerprints', () => ({
  FailureFingerprints: () => React.createElement('div', null, 'failure-fingerprints'),
}));

vi.mock('@/components/analytics/ErrorClusterCard', () => ({
  ErrorClustersSection: ({ clusters }: { clusters: Array<{ clusterId: string }> }) => React.createElement('div', null, `error-clusters:${clusters.length}`),
}));

vi.mock('@/components/shared/FilterBar', () => ({
  FilterBar: ({
    search,
    onSearch,
    onStatusFilter,
    onTagFilter,
  }: {
    search: string;
    onSearch: (v: string) => void;
    onStatusFilter: (v: Array<'passed' | 'failed' | 'flaky' | 'skipped' | 'running'>) => void;
    onTagFilter: (v: string) => void;
  }) => React.createElement('div', null,
    React.createElement('input', {
      'aria-label': 'Search tests',
      value: search,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onSearch(e.target.value),
    }),
    React.createElement('button', { type: 'button', onClick: () => onStatusFilter(['failed']) }, 'filter-failed'),
    React.createElement('button', { type: 'button', onClick: () => onTagFilter('@smoke') }, 'filter-smoke'),
    React.createElement('button', { type: 'button', onClick: () => onTagFilter('') }, 'clear-tag-filter'),
  ),
}));

vi.mock('@/components/tests/TestRow', () => ({
  TestRow: ({ test, onClick, isSelected }: { test: { title: string }; onClick: () => void; isSelected: boolean }) => React.createElement('button', { type: 'button', onClick, 'aria-pressed': isSelected }, test.title),
}));

vi.mock('@/components/tests/TestDetail', () => ({
  TestDetail: ({ test, initialTab, onTabChange }: { test: { title: string }; initialTab?: string; onTabChange: (t: string) => void }) => React.createElement('section', null,
    React.createElement('h3', null, `detail:${test.title}`),
    React.createElement('p', null, `initial-tab:${initialTab ?? 'none'}`),
    React.createElement('button', { type: 'button', onClick: () => onTabChange('terminal') }, 'open-terminal-tab'),
    React.createElement('button', { type: 'button', onClick: () => onTabChange('screenshots') }, 'open-screenshots-tab'),
  ),
}));

vi.mock('@/components/tests/TestTree', () => ({
  TestTree: ({ tests, onSelect }: { tests: Array<{ id: string; title: string }>; onSelect: (t: { id: string }) => void }) => React.createElement('div', null,
    React.createElement('span', null, `test-tree:${tests.length}`),
    tests[0] ? React.createElement('button', { type: 'button', onClick: () => onSelect(tests[0]) }, 'select-tree-first') : null,
  ),
}));

vi.mock('@/components/shared/ErrorAlert', () => ({
  ErrorAlert: ({ error, onRetry }: { error: unknown; onRetry: () => void }) => React.createElement('div', null,
    React.createElement('p', null, `error:${String(error)}`),
    React.createElement('button', { type: 'button', onClick: onRetry }, 'retry-run'),
  ),
}));

vi.mock('@/components/runs/RunComparePicker', () => ({
  RunComparePicker: ({ label, selectedRunId, onSelect }: { label: string; selectedRunId: string | null; onSelect: (id: string | null) => void }) => React.createElement('div', null,
    React.createElement('span', null, `${label}:${selectedRunId ?? 'none'}`),
    React.createElement('button', { type: 'button', onClick: () => onSelect(`${label.toLowerCase()}-picked`) }, `select-${label}`),
  ),
}));

vi.mock('@/components/runs/CompareTable', () => ({
  CompareTable: ({ rows, changedOnly }: { rows: Array<{ title: string }>; changedOnly: boolean }) => React.createElement('div', null,
    React.createElement('div', null, `compare-rows:${rows.length}`),
    React.createElement('div', null, `changed-only:${String(changedOnly)}`),
    rows.map((row) => React.createElement('div', { key: row.title }, row.title)),
  ),
}));

import { Route as RootRoute } from '../__root';
import { DashboardPage } from '../index';
import { Route as RunIdRoute } from '../runs/$runId';
import { RunDetailPage } from '../runs/$runId.lazy';
import { CompareRunsPage } from '../runs/compare';
import { RunsPage } from '../runs/index';

describe('routes batch 1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.routeSearch.clear();
    mocks.routeParams.clear();
    mocks.routeNavigate.clear();

    mocks.useRuns.mockReturnValue({ data: [], isLoading: false });
    mocks.useRun.mockReturnValue({ data: null, isLoading: false, error: null, refetch: vi.fn() });
    mocks.useRunTests.mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() });
    mocks.useTest.mockReturnValue({ data: null });
    mocks.useRunCompare.mockReturnValue({ data: [], isLoading: false });
    mocks.useLiveRun.mockReturnValue({ connectionState: 'connected' });
    mocks.abortRun.mockResolvedValue(undefined);

    mocks.runStoreState.run = null;
    mocks.runStoreState.tests = {};

    mocks.fetchMock.mockImplementation((url: string | URL) => {
      const value = String(url);
      if (value.includes('/api/tests/git-diff')) {
        return Promise.resolve(new Response(JSON.stringify({ changedFiles: [] }), { status: 200 }));
      }
      if (value.includes('/api/analytics/error-clusters')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal('fetch', mocks.fetchMock);

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  describe('__root route', () => {
    it('defines a root route with component', () => {
      const rootConfig = RootRoute as unknown as { component?: unknown };
      expect(rootConfig.component).toBeTypeOf('function');
    });

    it('defines a root route with notFound component', () => {
      const rootConfig = RootRoute as unknown as { notFoundComponent?: unknown };
      expect(rootConfig.notFoundComponent).toBeTypeOf('function');
    });

    it('renders root component from route config', () => {
      const rootConfig = RootRoute as unknown as { component?: React.ComponentType };
      const RootComponent = rootConfig.component;
      expect(RootComponent).toBeTypeOf('function');
      if (!RootComponent) {
        throw new Error('Root component is missing in route config');
      }

      renderWithProviders(React.createElement(RootComponent));
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });
  });

  describe('dashboard route /', () => {
    it('shows empty state and opens run trigger from CTA', async () => {
      mocks.useRuns.mockReturnValue({ data: [], isLoading: false });

      renderWithProviders(<DashboardPage />);
      expect(screen.getByText('dashboard.noRuns')).toBeInTheDocument();

      await userEvent.click(screen.getAllByRole('button', { name: 'dashboard.startNewRun' })[0]);
      expect(screen.getByRole('dialog')).toHaveTextContent('run-trigger');
    });

    it('renders KPI area and recent runs row data', () => {
      mocks.useRuns.mockReturnValue({
        data: [{
          id: 'run-11111111-abcd',
          startedAt: '2026-03-08T09:00:00.000Z',
          status: 'passed',
          total: 10,
          passed: 9,
          failed: 1,
          flaky: 0,
          skipped: 0,
          durationMs: 2000,
          branch: 'main',
          gateStatus: 'passed',
          source: 'live',
        }],
        isLoading: false,
      });

      renderWithProviders(<DashboardPage />);
      expect(screen.getByLabelText('Key metrics')).toBeInTheDocument();
      expect(screen.getByText('run-1111')).toBeInTheDocument();
      expect(screen.getByText('main')).toBeInTheDocument();
    });

    it('navigates to run detail when recent run row is clicked', async () => {
      mocks.useRuns.mockReturnValue({
        data: [{
          id: 'run-22222222-efgh',
          startedAt: '2026-03-08T09:00:00.000Z',
          status: 'failed',
          total: 8,
          passed: 6,
          failed: 2,
          flaky: 0,
          skipped: 0,
          durationMs: 3000,
          branch: 'feature/login',
          gateStatus: 'failed',
          source: 'blob',
        }],
        isLoading: false,
      });

      renderWithProviders(<DashboardPage />);
      const rowCell = screen.getByText('run-2222');
      const row = rowCell.closest('tr');
      expect(row).not.toBeNull();

      fireEvent.click(row as HTMLElement);
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/runs/$runId', params: { runId: 'run-22222222-efgh' } });
    });

    it('shows impacted tests banner when git diff has changed files', async () => {
      mocks.fetchMock.mockImplementation((url: string | URL) => {
        const value = String(url);
        if (value.includes('/api/tests/git-diff')) {
          return Promise.resolve(new Response(JSON.stringify({ changedFiles: ['src/routes/index.tsx'] }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      });

      renderWithProviders(<DashboardPage />);
      expect(await screen.findByText('impacted:1')).toBeInTheDocument();
    });

    it('triggers RunTrigger from EmptyState onCta and closes it via onClose', async () => {
      mocks.useRuns.mockReturnValue({ data: [], isLoading: false });
      renderWithProviders(<DashboardPage />);

      // Two buttons have name 'dashboard.startNewRun': [0]=header button, [1]=EmptyState CTA
      // Click [1] to cover the EmptyState onCta arrow function on line 165
      await userEvent.click(screen.getAllByRole('button', { name: 'dashboard.startNewRun' })[1]);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Close dialog to cover the RunTrigger onClose arrow function on line 170
      await userEvent.click(screen.getByRole('button', { name: 'close-trigger' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shows live run indicator when liveRun.status is running (covers lines 67-70)', () => {
      mocks.useRuns.mockReturnValue({ data: [], isLoading: false });
      mocks.runStoreState.run = { status: 'running', passed: 3, failed: 1 };
      renderWithProviders(<DashboardPage />);
      expect(screen.getByText(/Test run in progress/i)).toBeInTheDocument();
    });

    it('renders dash for null branch and handles null durationMs (covers lines 89, 147)', () => {
      mocks.useRuns.mockReturnValue({
        data: [{
          id: 'run-nullfields-001',
          startedAt: '2026-01-01T10:00:00.000Z',
          status: 'passed',
          total: 5,
          passed: 4,
          failed: 1,
          flaky: 0,
          skipped: 0,
          durationMs: null,
          branch: null,
          gateStatus: null,
          source: 'live',
        }],
        isLoading: false,
      });
      renderWithProviders(<DashboardPage />);
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('renders KPI when runs is undefined (covers ?? 0 right side on line 94)', () => {
      mocks.useRuns.mockReturnValue({ data: undefined, isLoading: false });
      renderWithProviders(<DashboardPage />);
      expect(screen.getByLabelText('Key metrics')).toBeInTheDocument();
    });

    it('returns empty changedFiles when git-diff responds with non-ok status (covers line 44)', async () => {
      mocks.fetchMock.mockImplementation((url: string | URL) => {
        if (String(url).includes('/api/tests/git-diff')) {
          return Promise.resolve(new Response('error', { status: 500 }));
        }
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      });
      mocks.useRuns.mockReturnValue({ data: [], isLoading: false });
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.queryByText(/impacted:/)).not.toBeInTheDocument();
      });
    });
  });

  describe('runs route /runs', () => {
    it('shows loading skeleton while runs query is loading', () => {
      mocks.useRuns.mockReturnValue({ data: [], isLoading: true });

      renderWithProviders(<RunsPage />);
      expect(screen.getByText('run-list-skeleton')).toBeInTheDocument();
    });

    it('renders runs table with export CSV link and run link', () => {
      mocks.useRuns.mockReturnValue({
        data: [{
          id: 'run-33333333-ijkl',
          startedAt: '2026-03-08T09:00:00.000Z',
          status: 'passed',
          total: 12,
          passed: 12,
          failed: 0,
          flaky: 0,
          skipped: 0,
          durationMs: 1000,
          branch: 'main',
          commitSha: 'abcdef1234567',
          gateStatus: 'passed',
          source: 'live',
        }],
        isLoading: false,
      });

      renderWithProviders(<RunsPage />);
      expect(screen.getByRole('link', { name: 'runs.exportCsv' })).toHaveAttribute('href', '/api/runs/export.csv');
      expect(screen.getByRole('link', { name: 'run-3333' })).toHaveAttribute('href', '/runs/$runId');
      expect(screen.getByText('abcdef1')).toBeInTheDocument();
      expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    });

    it('paginates runs with default page size and next/previous controls', async () => {
      const runs = Array.from({ length: 25 }, (_, idx) => {
        const i = idx + 1;
        return {
          id: `id${String(i).padStart(6, '0')}-run`,
          startedAt: '2026-03-08T09:00:00.000Z',
          finishedAt: null,
          status: i % 2 === 0 ? 'passed' : 'failed',
          total: i,
          passed: Math.max(0, i - 1),
          failed: i % 3 === 0 ? 1 : 0,
          flaky: 0,
          skipped: 0,
          durationMs: i * 100,
          branch: 'main',
          commitSha: `abcdef${String(i).padStart(2, '0')}`,
          commitMessage: null,
          triggeredBy: null,
          config: null,
          rawArgs: null,
          gateStatus: 'passed',
          source: 'live',
        };
      });

      mocks.useRuns.mockReturnValue({ data: runs, isLoading: false });
      renderWithProviders(<RunsPage />);

      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'id000001' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'id000021' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'id000021' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'id000001' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'id000001' })).toBeInTheDocument();
    });

    it('toggles sorting on sortable headers', async () => {
      mocks.useRuns.mockReturnValue({
        data: [
          {
            id: 'id000002-run',
            startedAt: '2026-03-08T09:00:00.000Z',
            finishedAt: null,
            status: 'passed',
            total: 10,
            passed: 10,
            failed: 0,
            flaky: 0,
            skipped: 0,
            durationMs: 1000,
            branch: 'main',
            commitSha: 'bbbbbbb1',
            commitMessage: null,
            triggeredBy: null,
            config: null,
            rawArgs: null,
            gateStatus: 'passed',
            source: 'live',
          },
          {
            id: 'id000001-run',
            startedAt: '2026-03-08T08:00:00.000Z',
            finishedAt: null,
            status: 'failed',
            total: 1,
            passed: 0,
            failed: 1,
            flaky: 0,
            skipped: 0,
            durationMs: 2000,
            branch: 'dev',
            commitSha: 'aaaaaaa1',
            commitMessage: null,
            triggeredBy: null,
            config: null,
            rawArgs: null,
            gateStatus: 'failed',
            source: 'blob',
          },
        ],
        isLoading: false,
      });

      renderWithProviders(<RunsPage />);

      const idLinks = () => screen.getAllByRole('link').filter((link) => /^id\d{6}$/.test(link.textContent ?? ''));
      expect(idLinks()[0]).toHaveTextContent('id000002');

      const totalHeader = screen.getByRole('button', { name: /^Total$/i });

      await userEvent.click(totalHeader);
      expect(idLinks()[0]).toHaveTextContent('id000001');

      await userEvent.click(totalHeader);
      expect(idLinks()[0]).toHaveTextContent('id000002');

      await userEvent.click(totalHeader);
      expect(idLinks()[0]).toHaveTextContent('id000002');
    });

    it('toggles column visibility from columns dropdown', async () => {
      mocks.useRuns.mockReturnValue({
        data: [{
          id: 'run-33333333-ijkl',
          startedAt: '2026-03-08T09:00:00.000Z',
          finishedAt: null,
          status: 'passed',
          total: 12,
          passed: 12,
          failed: 0,
          flaky: 0,
          skipped: 0,
          durationMs: 1000,
          branch: 'main',
          commitSha: 'abcdef1234567',
          commitMessage: null,
          triggeredBy: null,
          config: null,
          rawArgs: null,
          gateStatus: 'passed',
          source: 'live',
        }],
        isLoading: false,
      });

      renderWithProviders(<RunsPage />);
      expect(screen.getByRole('columnheader', { name: /Commit/i })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Commit' }));

      expect(screen.queryByRole('columnheader', { name: /Commit/i })).not.toBeInTheDocument();
    });

    it('opens run trigger when clicking new run button', async () => {
      renderWithProviders(<RunsPage />);

      await userEvent.click(screen.getAllByRole('button', { name: /runs.newRun/i })[0]);
      expect(screen.getByRole('dialog')).toHaveTextContent('run-trigger');
    });

    it('opens run trigger from empty-state CTA', async () => {
      mocks.useRuns.mockReturnValue({ data: [], isLoading: false });
      renderWithProviders(<RunsPage />);

      await userEvent.click(screen.getByRole('button', { name: 'runs.newRun' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders run row when durationMs is null (covers ?? -1 branch on line 121)', () => {
      mocks.useRuns.mockReturnValue({
        data: [{
          id: 'run-null-dur-11',
          startedAt: '2026-01-01T10:00:00.000Z',
          status: 'passed',
          total: 1,
          passed: 1,
          failed: 0,
          flaky: 0,
          skipped: 0,
          durationMs: null,
          branch: 'main',
          commitSha: null,
          gateStatus: null,
          source: 'live',
        }],
        isLoading: false,
      });
      renderWithProviders(<RunsPage />);
      expect(screen.getByRole('link', { name: 'run-null' })).toBeInTheDocument();
    });

    it('closes run trigger dialog from close button (covers onClose on line 327)', async () => {
      renderWithProviders(<RunsPage />);
      await userEvent.click(screen.getAllByRole('button', { name: /runs.newRun/i })[0]);
      expect(screen.getByRole('dialog')).toHaveTextContent('run-trigger');

      await userEvent.click(screen.getByRole('button', { name: 'close-trigger' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('sorts by Duration with null durationMs row triggering ?? -1 accessor (covers line 121)', async () => {
      mocks.useRuns.mockReturnValue({
        data: [
          {
            id: 'dur-run-aa001',
            startedAt: '2026-01-01T10:00:00.000Z',
            status: 'passed',
            total: 2,
            passed: 2,
            failed: 0,
            flaky: 0,
            skipped: 0,
            durationMs: 5000,
            branch: 'main',
            commitSha: 'aaa1111',
            gateStatus: 'passed',
            source: 'live',
          },
          {
            id: 'dur-run-bb002',
            startedAt: '2026-01-01T09:00:00.000Z',
            status: 'passed',
            total: 1,
            passed: 1,
            failed: 0,
            flaky: 0,
            skipped: 0,
            durationMs: null,
            branch: 'dev',
            commitSha: null,
            gateStatus: null,
            source: 'blob',
          },
        ],
        isLoading: false,
      });
      renderWithProviders(<RunsPage />);
      // Click Duration sort button — calls accessor (row) => row.durationMs ?? -1 for each row
      // The null durationMs row uses ?? -1 right side (covers branch)
      await userEvent.click(screen.getByRole('button', { name: 'Duration' }));
      expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
    });
  });

  describe('run search schema route /runs/$runId', () => {
    it('parses valid search params for test and tab', () => {
      const runIdConfig = RunIdRoute as unknown as { validateSearch?: { parse: (input: unknown) => unknown } };
      const parsed = runIdConfig.validateSearch?.parse({ testId: 'test-1', tab: 'terminal' });
      expect(parsed).toEqual({ testId: 'test-1', tab: 'terminal' });
    });

    it('coerces invalid search param types to undefined via catch', () => {
      const runIdConfig = RunIdRoute as unknown as { validateSearch?: { parse: (input: unknown) => unknown } };
      const parsed = runIdConfig.validateSearch?.parse({ testId: 123, tab: false });
      expect(parsed).toEqual({ testId: undefined, tab: undefined });
    });

    it('ignores unknown search keys', () => {
      const runIdConfig = RunIdRoute as unknown as { validateSearch?: { parse: (input: unknown) => unknown } };
      const parsed = runIdConfig.validateSearch?.parse({ random: 'value' });
      expect(parsed).toEqual({});
    });
  });

  describe('run detail route /runs/$runId.lazy', () => {
    const buildRun = (overrides: Record<string, unknown> = {}) => ({
      id: 'run-55555555',
      startedAt: '2026-03-08T09:00:00.000Z',
      status: 'passed',
      total: 3,
      passed: 2,
      failed: 1,
      flaky: 0,
      skipped: 0,
      durationMs: 1200,
      branch: 'main',
      commitSha: 'abcdef1234567',
      gateStatus: 'passed',
      source: 'live',
      ...overrides,
    });

    const buildTests = () => ([
      {
        id: 'test-a',
        title: 'login works',
        file: 'tests/login.spec.ts',
        status: 'passed',
        tags: '["@smoke"]',
        annotations: '[]',
        retryCount: 0,
      },
      {
        id: 'test-b',
        title: 'checkout fails',
        file: 'tests/checkout.spec.ts',
        status: 'failed',
        tags: '["@checkout"]',
        annotations: '[]',
        retryCount: 0,
      },
    ]);

    it('shows loading skeleton when run is loading', () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-44444444' });
      mocks.useRun.mockReturnValue({ data: null, isLoading: true, error: null, refetch: vi.fn() });

      renderWithProviders(<RunDetailPage />);
      expect(screen.getByText('test-list-skeleton')).toBeInTheDocument();
    });

    it('shows error alert when run fails to load', () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-44444444' });
      mocks.useRun.mockReturnValue({ data: null, isLoading: false, error: new Error('missing'), refetch: vi.fn() });

      renderWithProviders(<RunDetailPage />);
      expect(screen.getByText('error:Error: missing')).toBeInTheDocument();
    });

    it('renders run header and allows selecting a test to open detail panel', async () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-55555555' });
      mocks.useRun.mockReturnValue({
        data: {
          id: 'run-55555555',
          startedAt: '2026-03-08T09:00:00.000Z',
          status: 'passed',
          total: 2,
          passed: 1,
          failed: 1,
          flaky: 0,
          skipped: 0,
          durationMs: 1200,
          branch: 'main',
          commitSha: 'abcdef1234567',
          gateStatus: 'passed',
          source: 'live',
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mocks.useRunTests.mockReturnValue({
        data: [
          {
            id: 'test-a',
            title: 'login works',
            file: 'tests/login.spec.ts',
            status: 'passed',
            tags: '[]',
            annotations: '[]',
            retryCount: 0,
          },
          {
            id: 'test-b',
            title: 'checkout fails',
            file: 'tests/checkout.spec.ts',
            status: 'failed',
            tags: '[]',
            annotations: '[]',
            retryCount: 0,
          },
        ],
        isLoading: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<RunDetailPage />);
      expect(screen.getByText('Run run-5555')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'login works' }));
      expect(screen.getByText('detail:login works')).toBeInTheDocument();
      expect(mocks.navigate).toHaveBeenCalled();
      const firstCallArg = mocks.navigate.mock.calls[0]?.[0] as { search?: unknown };
      expect(typeof firstCallArg.search).toBe('function');
    });

    it('toggles terminal panel visibility from terminal button', async () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-66666666' });
      mocks.useRun.mockReturnValue({
        data: {
          id: 'run-66666666',
          startedAt: '2026-03-08T09:00:00.000Z',
          status: 'passed',
          total: 1,
          passed: 1,
          failed: 0,
          flaky: 0,
          skipped: 0,
          durationMs: 500,
          branch: null,
          commitSha: null,
          gateStatus: null,
          source: null,
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      renderWithProviders(<RunDetailPage />);
      expect(screen.queryByText('live-terminal')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Terminal/i }));
      expect(screen.getByText('live-terminal')).toBeInTheDocument();
    });

    it('aborts a running run and shows success toast', async () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-77777777' });
      mocks.useRun.mockReturnValue({
        data: {
          id: 'run-77777777',
          startedAt: '2026-03-08T09:00:00.000Z',
          status: 'running',
          total: 4,
          passed: 2,
          failed: 1,
          flaky: 0,
          skipped: 0,
          durationMs: 1000,
          branch: 'main',
          commitSha: 'abc1234',
          gateStatus: 'failed',
          source: 'live',
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      renderWithProviders(<RunDetailPage />);
      await userEvent.click(screen.getByRole('button', { name: /Abort/i }));

      await waitFor(() => {
        expect(mocks.abortRun).toHaveBeenCalledWith('run-77777777');
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Run aborted');
    });

    it('shows run-not-found error state and retries load', async () => {
      const refetchRun = vi.fn();
      mocks.routeParams.set('/runs/$runId', { runId: 'run-not-found' });
      mocks.useRun.mockReturnValue({ data: null, isLoading: false, error: null, refetch: refetchRun });

      renderWithProviders(<RunDetailPage />);
      expect(screen.getByText('error:Run not found')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'retry-run' }));
      expect(refetchRun).toHaveBeenCalledTimes(1);
    });

    it('renders running state indicators, failure sections and error clusters', async () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-running-1' });
      mocks.useRun.mockReturnValue({
        data: buildRun({
          id: 'run-running-1',
          status: 'running',
          failed: 4,
          total: 6,
          passed: 1,
          gateStatus: 'failed',
        }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });
      mocks.useLiveRun.mockReturnValue({ connectionState: 'disconnected' });

      renderWithProviders(<RunDetailPage />);

      expect(screen.getByText('progress:1/4/6')).toBeInTheDocument();
      expect(screen.getByText('disconnected')).toBeInTheDocument();
      expect(screen.getByText('failure-fingerprints')).toBeInTheDocument();
      expect(await screen.findByText('error-clusters:0')).toBeInTheDocument();
      expect(mocks.fetchMock).toHaveBeenCalledWith('/api/analytics/error-clusters?runId=run-running-1');
    });

    it('refetches run and tests when ws reconnect event matches run id', () => {
      const refetchRun = vi.fn();
      const refetchTests = vi.fn();
      mocks.routeParams.set('/runs/$runId', { runId: 'run-reconnect-1' });
      mocks.useRun.mockReturnValue({ data: buildRun({ id: 'run-reconnect-1' }), isLoading: false, error: null, refetch: refetchRun });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: refetchTests });

      renderWithProviders(<RunDetailPage />);

      window.dispatchEvent(new CustomEvent('ws:reconnected', { detail: { runId: 'run-other' } }));
      expect(refetchRun).not.toHaveBeenCalled();
      expect(refetchTests).not.toHaveBeenCalled();

      window.dispatchEvent(new CustomEvent('ws:reconnected', { detail: { runId: 'run-reconnect-1' } }));
      expect(refetchRun).toHaveBeenCalledTimes(1);
      expect(refetchTests).toHaveBeenCalledTimes(1);
    });

    it('supports keyboard navigation and clears selected test on Escape', async () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-kbd-1' });
      mocks.useRun.mockReturnValue({ data: buildRun({ id: 'run-kbd-1' }), isLoading: false, error: null, refetch: vi.fn() });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });

      renderWithProviders(<RunDetailPage />);

      fireEvent.keyDown(window, { key: 'j' });
      expect(screen.getByText('detail:login works')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'ArrowDown' });
      expect(screen.getByText('detail:checkout fails')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByText('detail:checkout fails')).not.toBeInTheDocument();
    });

    it('shows empty-state descriptions for running and completed runs', () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-empty-1' });
      mocks.useRun.mockReturnValue({
        data: buildRun({ id: 'run-empty-1', status: 'running', failed: 0, passed: 0, total: 0 }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mocks.useRunTests.mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() });

      const first = renderWithProviders(<RunDetailPage />);
      expect(screen.getByText('Tests will appear as they execute.')).toBeInTheDocument();
      first.unmount();

      mocks.useRun.mockReturnValue({
        data: buildRun({ id: 'run-empty-1', status: 'cancelled', failed: 0, passed: 0, total: 0 }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderWithProviders(<RunDetailPage />);
      expect(screen.getByText('No tests were recorded for this run.')).toBeInTheDocument();
    });

    it('shows filtered empty state and supports tree selection flow', async () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-tree-1' });
      mocks.useRun.mockReturnValue({ data: buildRun({ id: 'run-tree-1' }), isLoading: false, error: null, refetch: vi.fn() });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });

      renderWithProviders(<RunDetailPage />);

      await userEvent.click(screen.getByRole('button', { name: 'filter-failed' }));
      await userEvent.click(screen.getByRole('button', { name: 'filter-smoke' }));
      expect(screen.getByText('Try adjusting your filters.')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'clear-tag-filter' }));
      await userEvent.click(screen.getByTitle('Tree view'));
      expect(screen.getByText('test-tree:1')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'select-tree-first' }));
      expect(screen.getByText('detail:checkout fails')).toBeInTheDocument();
    });

    it('uses selected test detail data from useTest and forwards tab interactions', async () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-detail-1' });
      mocks.routeSearch.set('/runs/$runId', { testId: 'test-a', tab: 'trace' });
      mocks.useRun.mockReturnValue({ data: buildRun({ id: 'run-detail-1' }), isLoading: false, error: null, refetch: vi.fn() });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });
      mocks.useTest.mockReturnValue({
        data: {
          id: 'test-a',
          title: 'detail from api',
          file: 'tests/login.spec.ts',
          status: 'failed',
          tags: 'invalid-json',
          annotations: 'invalid-json',
          retryCount: 2,
          results: [],
        },
      });

      renderWithProviders(<RunDetailPage />);

      expect(screen.getByText('detail:detail from api')).toBeInTheDocument();
      expect(screen.getByText('initial-tab:trace')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'open-screenshots-tab' }));
      const latestNavigate = mocks.navigate.mock.calls.at(-1)?.[0] as { search?: unknown };
      expect(typeof latestNavigate.search).toBe('function');
    });

    it('copies permalink, toggles terminal open-close, and shows abort error toast on failure', async () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-actions-1' });
      mocks.useRun.mockReturnValue({
        data: buildRun({ id: 'run-actions-1', status: 'running', failed: 0, passed: 0, total: 1 }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });
      mocks.abortRun.mockRejectedValueOnce(new Error('abort-failed'));

      renderWithProviders(<RunDetailPage />);

      const copyButton = screen.getByRole('button', { name: 'Copy run permalink' });
      await userEvent.click(copyButton);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/runs/run-actions-1');
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Run link copied');

      const terminalButton = screen.getByRole('button', { name: /Terminal/i });
      await userEvent.click(terminalButton);
      expect(screen.getByText('live-terminal')).toBeInTheDocument();
      await userEvent.click(terminalButton);
      expect(screen.queryByText('live-terminal')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Abort/i }));
      await waitFor(() => {
        expect(mocks.toastError).toHaveBeenCalledWith('Failed to abort run');
      });
    });

    it('renders run export links with expected urls', () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-export-1' });
      mocks.useRun.mockReturnValue({ data: buildRun({ id: 'run-export-1' }), isLoading: false, error: null, refetch: vi.fn() });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });

      renderWithProviders(<RunDetailPage />);

      expect(screen.getByRole('link', { name: /Export CSV/i })).toHaveAttribute('href', '/api/runs/run-export-1/tests/export.csv');
      expect(screen.getByRole('link', { name: /Export HTML/i })).toHaveAttribute('href', '/api/runs/run-export-1/report.html');
      expect(screen.getByRole('link', { name: /Export PDF/i })).toHaveAttribute('href', '/api/runs/run-export-1/report.pdf');
    });

    it('filters tests by file path when search does not match title', async () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-file-filter' });
      mocks.useRun.mockReturnValue({ data: buildRun({ id: 'run-file-filter' }), isLoading: false, error: null, refetch: vi.fn() });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });

      renderWithProviders(<RunDetailPage />);

      const user = userEvent.setup();
      const searchInput = await screen.findByLabelText('Search tests');
      // 'checkout.spec' matches file 'tests/checkout.spec.ts' but NOT title 'login works'
      await user.type(searchInput, 'checkout.spec');

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'checkout fails' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'login works' })).not.toBeInTheDocument();
      });
    });

    it('clicking list view button after switching to tree view resets view mode', async () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-viewmode-toggle' });
      mocks.useRun.mockReturnValue({ data: buildRun({ id: 'run-viewmode-toggle' }), isLoading: false, error: null, refetch: vi.fn() });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });

      renderWithProviders(<RunDetailPage />);

      const user = userEvent.setup();
      await user.click(await screen.findByTitle('Tree view'));
      expect(screen.getByText('test-tree:2')).toBeInTheDocument();

      // Click List view — covers the onClick={() => setViewMode('list')} branch
      await user.click(screen.getByTitle('List view'));
      expect(screen.getByRole('button', { name: 'login works' })).toBeInTheDocument();
    });

    it('shows inline test-list skeleton when run is loaded but tests are still loading', () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-tl-1' });
      mocks.useRun.mockReturnValue({ data: buildRun({ id: 'run-tl-1' }), isLoading: false, error: null, refetch: vi.fn() });
      mocks.useRunTests.mockReturnValue({ data: [], isLoading: true, refetch: vi.fn() });

      renderWithProviders(<RunDetailPage />);
      // testsLoading=true while run data is available → TestListSkeleton rendered inline (line 416)
      expect(screen.getByText('test-list-skeleton')).toBeInTheDocument();
    });

    it('deselects test on second click of already-selected row (covers ?? null branch on line 444)', async () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-deselect-2' });
      mocks.useRun.mockReturnValue({ data: buildRun({ id: 'run-deselect-2' }), isLoading: false, error: null, refetch: vi.fn() });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });
      mocks.useTest.mockReturnValue({ data: null });

      renderWithProviders(<RunDetailPage />);
      const user = userEvent.setup();

      // First click: select test → selectedTestId = 'test-a'
      await user.click(await screen.findByRole('button', { name: 'login works' }));
      expect(screen.getByText('detail:login works')).toBeInTheDocument();

      // Second click on same test: test.id === selectedTestId → handleSelectTest(null) → deselects
      await user.click(screen.getByRole('button', { name: 'login works' }));
      await waitFor(() => {
        expect(screen.queryByText('detail:login works')).not.toBeInTheDocument();
      });
    });

    it('merges liveRun with undefined fields covering ?? right sides at lines 73,204-206,244,340-345,350,359', () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-livemerge-88' });
      mocks.useRun.mockReturnValue({
        data: buildRun({ id: 'run-livemerge-88', failed: 5, flaky: 1, total: 10, passed: 4, skipped: 0 }),
        isLoading: false, error: null, refetch: vi.fn(),
      });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });
      // liveRun.status='running' with undefined numeric fields
      // → activeRun = {...run, ...liveRun} where activeRun.total/passed/failed/flaky/skipped/durationMs = undefined
      // → all the ?? right sides at lines 340-345 and 204-206 get triggered
      mocks.runStoreState.run = {
        id: 'run-livemerge-88',
        status: 'running',
        total: undefined,
        passed: undefined,
        failed: undefined,
        flaky: undefined,
        skipped: undefined,
        durationMs: undefined,
      };

      renderWithProviders(<RunDetailPage />);
      // liveRun.status='running' → line 73 TRUE branch covered
      // isRunning=true → RunProgress rendered, lines 204-206 ?? right sides covered
      // run.flaky=1>0 → 'text-flaky' colorClass TRUE covered (line 343)
      // (activeRun.failed ?? run.failed)=5>0 → FailureFingerprints (line 350 TRUE covered)
      // (activeRun.failed ?? run.failed)=5>3 → ErrorClusters (line 359 TRUE covered)
      expect(screen.getByText('failure-fingerprints')).toBeInTheDocument();
    });

    it('renders run detail with zero failures (covers run.failed>0 FALSE and >0 FALSE at lines 342,350)', () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-no-fail-99' });
      mocks.useRun.mockReturnValue({
        data: buildRun({ id: 'run-no-fail-99', failed: 0, passed: 3, flaky: 0 }),
        isLoading: false, error: null, refetch: vi.fn(),
      });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });

      renderWithProviders(<RunDetailPage />);
      // run.failed=0 → run.failed>0=FALSE → colorClass=undefined (FALSE branch covered)
      // (activeRun?.failed ?? run.failed)=0>0=FALSE → no FailureFingerprints (line 350 FALSE covered)
      expect(screen.queryByText('failure-fingerprints')).not.toBeInTheDocument();
    });

    it('handles rawTests null using empty array fallback (covers ?? [] right side on line 78)', () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-null-tests-77' });
      mocks.useRun.mockReturnValue({
        data: buildRun({ id: 'run-null-tests-77' }),
        isLoading: false, error: null, refetch: vi.fn(),
      });
      mocks.useRunTests.mockReturnValue({ data: null, isLoading: false, refetch: vi.fn() });

      renderWithProviders(<RunDetailPage />);
      // rawTests=null → null ?? [] = [] covers right side of ?? on line 78
      expect(screen.getByText('Run run-null')).toBeInTheDocument();
    });

    it('applies liveTests update to a test (covers liveUpdate TRUE branch on line 80)', () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-livetests-66' });
      mocks.useRun.mockReturnValue({
        data: buildRun({ id: 'run-livetests-66' }),
        isLoading: false, error: null, refetch: vi.fn(),
      });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });
      // Set live update for test-a → liveUpdate is truthy → merged = {...t, ...liveUpdate} on line 80
      mocks.runStoreState.tests = { 'test-a': { status: 'running' } };

      renderWithProviders(<RunDetailPage />);
      // liveUpdate exists → line 80 TRUE branch covered
      expect(screen.getByRole('button', { name: 'login works' })).toBeInTheDocument();
    });

    it('handles tests with null tags/annotations/retryCount (covers ?? branches on lines 83-85)', () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-nullfields-55' });
      mocks.useRun.mockReturnValue({
        data: buildRun({ id: 'run-nullfields-55' }),
        isLoading: false, error: null, refetch: vi.fn(),
      });
      mocks.useRunTests.mockReturnValue({
        data: [{
          id: 'test-nullfields',
          title: 'null fields test',
          file: 'tests/null.spec.ts',
          status: 'passed',
          tags: null,
          annotations: null,
          retryCount: null,
        }],
        isLoading: false,
        refetch: vi.fn(),
      });

      renderWithProviders(<RunDetailPage />);
      // tags=null → null ?? '[]' right side covered (line 83)
      // annotations=null → null ?? '[]' right side covered (line 84)
      // retryCount=null → null ?? 0 right side covered (line 85)
      expect(screen.getByRole('button', { name: 'null fields test' })).toBeInTheDocument();
    });

    it('ArrowDown with empty filteredTests returns early (covers ids.length===0 TRUE on line 151)', () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-emptykeys-44' });
      mocks.useRun.mockReturnValue({
        data: buildRun({ id: 'run-emptykeys-44' }),
        isLoading: false, error: null, refetch: vi.fn(),
      });
      mocks.useRunTests.mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() });

      renderWithProviders(<RunDetailPage />);
      // filteredTests=[] → ids.length===0 → early return on line 151 (TRUE branch covered)
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      expect(screen.queryByText(/detail:/)).not.toBeInTheDocument();
    });

    it('Escape key deselects currently selected test (covers Escape branch on line 162)', async () => {
      mocks.routeParams.set('/runs/$runId', { runId: 'run-escape-55' });
      mocks.useRun.mockReturnValue({
        data: buildRun({ id: 'run-escape-55' }),
        isLoading: false, error: null, refetch: vi.fn(),
      });
      mocks.useRunTests.mockReturnValue({ data: buildTests(), isLoading: false, refetch: vi.fn() });

      renderWithProviders(<RunDetailPage />);
      const user = userEvent.setup();
      // First select a test
      await user.click(await screen.findByRole('button', { name: 'login works' }));
      expect(screen.getByText('detail:login works')).toBeInTheDocument();
      // Press Escape → e.key==='Escape' && selectedTestId truthy → handleSelectTest(null)
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByText('detail:login works')).not.toBeInTheDocument();
      });
    });
  });

  describe('compare route /runs/compare', () => {
    it('renders compare rows and summary when two runs are selected', () => {
      mocks.routeSearch.set('/runs/compare', { a: 'run-a', b: 'run-b', changedOnly: false });
      mocks.useRunCompare.mockReturnValue({
        data: [
          { title: 'test one', file: 'a.ts', statusA: 'passed', statusB: 'failed', durationA: 10, durationB: 30, changeType: 'new_failure' },
          { title: 'test two', file: 'b.ts', statusA: 'failed', statusB: 'passed', durationA: 40, durationB: 20, changeType: 'fixed' },
          { title: 'test three', file: 'c.ts', statusA: 'passed', statusB: 'passed', durationA: 5, durationB: 5, changeType: 'unchanged' },
        ],
        isLoading: false,
      });
      mocks.useRun
        .mockReturnValueOnce({ data: { total: 10, passed: 8 } })
        .mockReturnValueOnce({ data: { total: 10, passed: 9 } });

      renderWithProviders(<CompareRunsPage />);
      expect(screen.getByText('compare-rows:3')).toBeInTheDocument();
      expect(screen.getByText(/Pass rate:/)).toBeInTheDocument();
      expect(screen.getByText('1 new failure')).toBeInTheDocument();
      expect(screen.getByText('1 fixed')).toBeInTheDocument();
    });

    it('filters unchanged rows when changedOnly is true', () => {
      mocks.routeSearch.set('/runs/compare', { a: 'run-a', b: 'run-b', changedOnly: true });
      mocks.useRunCompare.mockReturnValue({
        data: [
          { title: 'changed test', file: 'a.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'regression' },
          { title: 'same test', file: 'b.ts', statusA: 'passed', statusB: 'passed', durationA: 2, durationB: 2, changeType: 'unchanged' },
        ],
        isLoading: false,
      });

      renderWithProviders(<CompareRunsPage />);
      expect(screen.getByText('compare-rows:1')).toBeInTheDocument();
      expect(screen.getByText('changed-only:true')).toBeInTheDocument();
      expect(screen.queryByText('same test')).not.toBeInTheDocument();
    });

    it('updates compare search via picker and checkbox interactions', async () => {
      const compareNavigate = vi.fn();
      mocks.routeSearch.set('/runs/compare', { a: undefined, b: undefined, changedOnly: false });
      mocks.routeNavigate.set('/runs/compare', compareNavigate);

      renderWithProviders(<CompareRunsPage />);

      await userEvent.click(screen.getByRole('button', { name: 'select-Run A' }));
      await userEvent.click(screen.getByRole('button', { name: 'select-Run B' }));
      await userEvent.click(screen.getByRole('checkbox', { name: /Changed only/i }));

      expect(compareNavigate).toHaveBeenCalledTimes(3);
      const latest = compareNavigate.mock.calls[2]?.[0] as { search?: unknown };
      expect(typeof latest.search).toBe('function');
    });

    it('exports CSV with blob URL when export button is clicked', async () => {
      mocks.routeSearch.set('/runs/compare', { a: 'run-a', b: 'run-b', changedOnly: false });
      mocks.useRunCompare.mockReturnValue({
        data: [
          { title: 'export me', file: 'x.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'new_failure' },
        ],
        isLoading: false,
      });

      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:comparison-csv');
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

      renderWithProviders(<CompareRunsPage />);
      await userEvent.click(screen.getByRole('button', { name: /Export CSV/i }));

      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:comparison-csv');
    });

    it('invokes run B navigate search callback and returns updated params', async () => {
      const compareNavigate = vi.fn();
      mocks.routeSearch.set('/runs/compare', { a: undefined, b: undefined, changedOnly: false });
      mocks.routeNavigate.set('/runs/compare', compareNavigate);
      mocks.useRunCompare.mockReturnValue({ data: [], isLoading: false });

      renderWithProviders(<CompareRunsPage />);

      await userEvent.click(screen.getByRole('button', { name: 'select-Run B' }));

      const navArg = compareNavigate.mock.calls[0]?.[0] as { search?: (prev: Record<string, unknown>) => Record<string, unknown> };
      expect(typeof navArg?.search).toBe('function');
      const result = navArg.search?.({});
      expect(result).toMatchObject({ b: 'run b-picked' });
    });

    it('renders plural new failures and plural regressions summary text', () => {
      mocks.routeSearch.set('/runs/compare', { a: 'run-a', b: 'run-b', changedOnly: false });
      mocks.useRunCompare.mockReturnValue({
        data: [
          { title: 't1', file: 'a.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'new_failure' },
          { title: 't2', file: 'b.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'new_failure' },
          { title: 't3', file: 'c.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'regression' },
          { title: 't4', file: 'd.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'regression' },
        ],
        isLoading: false,
      });
      mocks.useRun.mockReturnValue({ data: null });

      renderWithProviders(<CompareRunsPage />);
      expect(screen.getByText('2 new failures')).toBeInTheDocument();
      expect(screen.getByText('2 regressions')).toBeInTheDocument();
    });
  });
});
