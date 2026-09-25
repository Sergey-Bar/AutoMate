import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderWithProviders, screen, userEvent, waitFor } from '../../test/test-utils';

type RouteFactoryOptions = {
  component?: React.ComponentType;
  validateSearch?: (search: Record<string, unknown>) => unknown;
};

const {
  navigateMock,
  routeComponents,
  routeValidators,
  searchState,
  useRunsMock,
  useRunTestsMock,
  useTestMock,
  useCategoriesMock,
  useFingerprintCategoriesMock,
  usePlaywrightConfigMock,
  showToastMock,
  toastSuccessMock,
  toastErrorMock,
  toastPromiseMock,
  clipboardWriteTextMock,
  workspaceState,
  capturedTooltipProps,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  routeComponents: new Map<string, React.ComponentType>(),
  capturedTooltipProps: [] as Array<Record<string, unknown>>,
  routeValidators: new Map<string, (search: Record<string, unknown>) => unknown>(),
  searchState: new Map<string, Record<string, unknown>>(),
  useRunsMock: vi.fn(),
  useRunTestsMock: vi.fn(),
  useTestMock: vi.fn(),
  useCategoriesMock: vi.fn(),
  useFingerprintCategoriesMock: vi.fn(),
  usePlaywrightConfigMock: vi.fn(),
  showToastMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastPromiseMock: vi.fn(),
  clipboardWriteTextMock: vi.fn(),
  workspaceState: { activeWorkspaceId: null as string | null },
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

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
  function registerRoute(path: string, options: RouteFactoryOptions) {
    if (options.component) routeComponents.set(path, options.component);
    if (options.validateSearch) routeValidators.set(path, options.validateSearch);
    return {
      ...options,
      useSearch: () => searchState.get(path) ?? {},
    };
  }

  return {
    Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to, ...rest }, children),
    createFileRoute: (path: string) => (options: RouteFactoryOptions) => registerRoute(path, options),
    createLazyFileRoute: (path: string) => (options: RouteFactoryOptions) => registerRoute(path, options),
    useNavigate: () => navigateMock,
    useRouter: () => ({ navigate: navigateMock }),
    useSearch: (opts?: { from?: string }) => searchState.get(opts?.from ?? '/settings/') ?? {},
    useParams: () => ({}),
    useLoaderData: () => ({}),
    useMatch: () => ({ params: {}, search: {} }),
    Outlet: () => React.createElement('div', { 'data-testid': 'outlet' }),
    routeContext: {},
  };
});

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode | ((w: number, h: number) => React.ReactNode) }) =>
    React.createElement('div', { 'data-testid': 'responsive-container' }, typeof children === 'function' ? children(800, 400) : children),
  AreaChart: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'area-chart' }, children),
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: (props: Record<string, unknown>) => {
    capturedTooltipProps.push(props);
    return null;
  },
  Legend: () => null,
  Cell: () => null,
  Pie: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children ?? null),
  PieChart: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'pie-chart' }, children),
  BarChart: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'bar-chart' }, children),
  Bar: ({ children }: { children?: React.ReactNode }) => React.createElement('div', { 'data-testid': 'bar' }, children),
  CartesianGrid: () => null,
}));

vi.mock('@nivo/heatmap', () => ({
  ResponsiveHeatMap: ({ data }: { data: unknown[] }) => React.createElement('div', { 'data-testid': 'nivo-heatmap', 'data-rows': data.length }),
}));

vi.mock('react-arborist', () => ({
  Tree: ({ data }: { data: unknown[] }) => React.createElement('div', { 'data-testid': 'tree', 'data-count': data.length }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    promise: toastPromiseMock,
    info: vi.fn(),
    warning: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value?: string; onChange?: (v: string | undefined) => void }) =>
    React.createElement('textarea', {
      'aria-label': 'Monaco Editor',
      value: value ?? '',
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
    }),
}));

vi.mock('shiki', () => ({
  getHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue('<pre><code>highlighted</code></pre>'),
  }),
}));

vi.mock('cmdk', () => ({
  Command: ({ children }: { children?: React.ReactNode }) => React.createElement('div', { 'data-testid': 'cmdk-command' }, children),
  CommandInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', props),
  CommandList: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
  CommandItem: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
  CommandGroup: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
  CommandSeparator: () => React.createElement('hr'),
  CommandEmpty: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
  CommandDialog: ({ children }: { children?: React.ReactNode }) => React.createElement('div', {}, children),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } & Record<string, string | number | undefined>) => {
      let value = opts?.defaultValue ?? key;
      if (opts) {
        for (const [name, raw] of Object.entries(opts)) {
          if (name === 'defaultValue' || raw === undefined) continue;
          value = value.replaceAll(`{{${name}}}`, String(raw));
        }
      }
      return value;
    },
    i18n: {} as never,
  }),
}));

vi.mock('@/components/shared/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/FeatureGate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/shared/Skeleton', () => ({
  ChartGridSkeleton: () => React.createElement('div', { 'data-testid': 'chart-grid-skeleton' }, 'Chart loading'),
  TestListSkeleton: () => React.createElement('div', { 'data-testid': 'test-list-skeleton' }, 'Tests loading'),
  Skeleton: () => React.createElement('div', { 'data-testid': 'skeleton' }, 'loading'),
}));

vi.mock('@/components/shared/FilterBar', () => ({
  FilterBar: ({ search, onSearch, onStatusFilter, onTagFilter }: {
    search: string;
    onSearch: (v: string) => void;
    onStatusFilter: (v: Array<'passed' | 'failed' | 'flaky' | 'skipped' | 'running'>) => void;
    onTagFilter: (v: string) => void;
  }) => (
    React.createElement('div', {},
      React.createElement('input', {
        'aria-label': 'Search tests',
        value: search,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onSearch(e.target.value),
      }),
      React.createElement('button', { type: 'button', onClick: () => onStatusFilter(['failed']) }, 'Set failed filter'),
      React.createElement('button', { type: 'button', onClick: () => onTagFilter('@smoke') }, 'Set smoke tag'),
    )
  ),
}));

vi.mock('@/components/shared/EmptyState', () => ({
  EmptyState: ({ title, description, cta, onCta }: { title: string; description?: string; cta?: string; onCta?: () => void }) =>
    React.createElement('div', {},
      React.createElement('p', {}, title),
      description ? React.createElement('p', {}, description) : null,
      cta ? React.createElement('button', { type: 'button', onClick: onCta }, cta) : null,
    ),
}));

vi.mock('@/components/shared/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => React.createElement('span', {}, status),
}));

vi.mock('@/components/analytics/DateRangePicker', () => ({
  DateRangePicker: ({ days, onChange }: { days: number; onChange: (days: number) => void }) =>
    React.createElement('button', { type: 'button', onClick: () => onChange(90) }, `days:${days}`),
}));

vi.mock('@/components/analytics/PassRateChart', () => ({
  PassRateChart: ({ data }: { data: unknown[] }) => React.createElement('div', { 'data-testid': 'pass-rate-chart' }, `points:${data.length}`),
}));

vi.mock('@/components/analytics/DurationChart', () => ({
  DurationChart: ({ data }: { data: unknown[] }) => React.createElement('div', { 'data-testid': 'duration-chart' }, `points:${data.length}`),
}));

vi.mock('@/components/analytics/FlakyLeaderboard', () => ({
  FlakyLeaderboard: ({ data }: { data: unknown[] }) => React.createElement('div', { 'data-testid': 'flaky-chart' }, `rows:${data.length}`),
}));

vi.mock('@/components/analytics/SlowestTests', () => ({
  SlowestTests: ({ data }: { data: unknown[] }) => React.createElement('div', { 'data-testid': 'slow-chart' }, `rows:${data.length}`),
}));

vi.mock('@/components/analytics/FailureHeatmap', () => ({
  FailureHeatmap: ({ data }: { data: unknown[] }) => React.createElement('div', { 'data-testid': 'failure-heatmap' }, `rows:${data.length}`),
}));

vi.mock('@/components/analytics/WorkerGantt', () => ({
  WorkerGantt: ({ tests }: { tests: unknown[] }) => React.createElement('div', { 'data-testid': 'worker-gantt' }, `tests:${tests.length}`),
}));

vi.mock('@/components/tests/BulkActionBar', () => ({
  BulkActionBar: ({ count, onRerun, onCopy, onExportGrep, onClear }: {
    count: number;
    onRerun: () => void;
    onCopy: () => void;
    onExportGrep: () => void;
    onClear: () => void;
  }) => React.createElement('div', {},
    React.createElement('p', {}, `${count} selected`),
    React.createElement('button', { type: 'button', onClick: onRerun }, 'Re-run selected'),
    React.createElement('button', { type: 'button', onClick: onCopy }, 'Copy selected'),
    React.createElement('button', { type: 'button', onClick: onExportGrep }, 'Export grep'),
    React.createElement('button', { type: 'button', onClick: onClear }, 'Clear selected'),
  ),
}));

vi.mock('@/components/tests/TestDetail', () => ({
  TestDetail: ({ test }: { test: { title: string } }) => React.createElement('div', { 'data-testid': 'test-detail' }, test.title),
}));

vi.mock('@/components/tests/QuarantineButton', () => ({
  QuarantineButton: () => React.createElement('button', { type: 'button' }, 'Quarantine'),
}));

vi.mock('@/components/tests/KnownFailureBadge', () => ({
  KnownFailureBadge: () => React.createElement('span', {}, 'Known Failure'),
}));

vi.mock('@/components/tests/TestHistoryTimeline', () => ({
  HistoryDotsDisplay: ({ dots }: { dots: unknown[] }) => React.createElement('span', {}, `dots:${dots.length}`),
}));

vi.mock('@/components/tests/QuarantineTable', () => ({
  QuarantineTable: ({ rows, onRemove }: { rows: Array<{ id: string; testTitle: string }>; onRemove: (id: string) => void }) =>
    React.createElement('div', {}, rows.map((row) =>
      React.createElement('div', { key: row.id },
        React.createElement('span', {}, row.testTitle),
        React.createElement('button', { type: 'button', onClick: () => onRemove(row.id) }, `Remove ${row.id}`),
      ),
    )),
}));

vi.mock('@/components/artifacts/BaselineCard', () => ({
  BaselineCard: ({ baseline }: { baseline: { snapshotName: string } }) => React.createElement('div', {}, baseline.snapshotName),
}));

vi.mock('@/components/artifacts/BaselineBatchReview', () => ({
  BaselineBatchReview: ({ baselines }: { baselines: unknown[] }) => React.createElement('div', { 'data-testid': 'batch-review' }, `batch:${baselines.length}`),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    className,
    style,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    style?: React.CSSProperties;
    'aria-label'?: string;
  }) =>
    React.createElement('button', { type: 'button', onClick, disabled, className, style, 'aria-label': ariaLabel }, children),
}));

vi.mock('@/components/config/ProjectMatrix', () => ({
  ProjectMatrix: () => React.createElement('div', { 'data-testid': 'project-matrix' }, 'Project matrix'),
}));

vi.mock('@/components/tools/CodegenPanel', () => ({
  CodegenPanel: ({ isRunning }: { isRunning: boolean }) => React.createElement('div', { 'data-testid': 'codegen-panel' }, isRunning ? 'running' : 'idle'),
}));

vi.mock('@/components/settings/SettingsNav', () => ({
  SettingsNav: ({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: string) => void }) =>
    React.createElement('div', {},
      React.createElement('p', {}, `active:${activeTab}`),
      React.createElement('button', { type: 'button', onClick: () => onTabChange('display') }, 'Go display'),
    ),
}));

vi.mock('@/components/settings/GeneralSettings', () => ({ GeneralSettings: () => React.createElement('div', {}, 'General settings panel') }));
vi.mock('@/components/settings/DisplaySettings', () => ({ DisplaySettings: () => React.createElement('div', {}, 'Display settings panel') }));
vi.mock('@/components/settings/SchedulerSettings', () => ({ SchedulerSettings: () => React.createElement('div', {}, 'Scheduler settings panel') }));
vi.mock('@/components/settings/IntegrationSettings', () => ({ IntegrationSettings: () => React.createElement('div', {}, 'Integration settings panel') }));
vi.mock('@/components/settings/WebhookConfig', () => ({ WebhookConfig: () => React.createElement('div', {}, 'Webhook settings panel') }));
vi.mock('@/components/settings/EmailSettings', () => ({ EmailSettings: () => React.createElement('div', {}, 'Email settings panel') }));
vi.mock('@/components/settings/QualityGateSettings', () => ({ QualityGateSettings: () => React.createElement('div', {}, 'Quality gate settings panel') }));
vi.mock('@/components/settings/QuarantineSettings', () => ({ QuarantineSettings: () => React.createElement('div', {}, 'Quarantine settings panel') }));
vi.mock('@/components/settings/AISettings', () => ({ AISettings: () => React.createElement('div', {}, 'AI settings panel') }));
vi.mock('@/components/settings/WorkspaceSettings', () => ({ WorkspaceSettings: () => React.createElement('div', {}, 'Workspace settings panel') }));
vi.mock('@/components/settings/CategorySettings', () => ({ CategorySettings: () => React.createElement('div', {}, 'Category settings panel') }));
vi.mock('@/components/settings/PRIntegrationSettings', () => ({ PRIntegrationSettings: () => React.createElement('div', {}, 'PR integration settings panel') }));

vi.mock('@/hooks/useRun', () => ({
  useRuns: (...args: unknown[]) => useRunsMock(...args),
  useRunTests: (...args: unknown[]) => useRunTestsMock(...args),
  useTest: (...args: unknown[]) => useTestMock(...args),
}));

vi.mock('@/hooks/useCategories', () => ({
  useCategories: (...args: unknown[]) => useCategoriesMock(...args),
  useFingerprintCategories: (...args: unknown[]) => useFingerprintCategoriesMock(...args),
}));

vi.mock('@/hooks/usePlaywrightConfig', () => ({
  usePlaywrightConfig: (...args: unknown[]) => usePlaywrightConfigMock(...args),
}));

vi.mock('@/store/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { activeWorkspaceId: string | null }) => T) => selector(workspaceState),
}));

vi.mock('@/lib/showToast', () => ({
  showToast: (...args: unknown[]) => showToastMock(...args),
}));

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function getRouteComponent(path: string): React.ComponentType {
  const component = routeComponents.get(path);
  if (!component) throw new Error(`Route component not registered for ${path}`);
  return component;
}

function validateSearchValue(path: string, input: Record<string, unknown>): unknown {
  const validator = routeValidators.get(path);
  if (!validator) throw new Error(`Missing validator for ${path}`);

  if (typeof validator === 'function') return validator(input);

  const maybeSchema = validator as unknown as { parse?: (v: Record<string, unknown>) => unknown };
  if (typeof maybeSchema.parse === 'function') {
    const parse = maybeSchema.parse;
    if (typeof parse === 'function') {
      return parse(input);
    }
  }

  throw new Error(`Unsupported validator shape for ${path}`);
}

beforeAll(async () => {
  await import('../analytics/index');
  await import('../analytics/index.lazy');
  await import('../tests/index');
  await import('../tests/quarantine');
  await import('../baselines/index');
  await import('../config/index');
  await import('../settings/index');
  await import('../tools/codegen');
});

beforeEach(() => {
  vi.clearAllMocks();
  searchState.clear();
  workspaceState.activeWorkspaceId = null;
  toastPromiseMock.mockImplementation((promise: Promise<unknown>) => promise);

  useRunsMock.mockReturnValue({ data: [{ id: 'run-1234567890', durationMs: 12_000 }] });
  useRunTestsMock.mockReturnValue({ data: [], isLoading: false });
  useTestMock.mockReturnValue({ data: undefined });
  useCategoriesMock.mockReturnValue({ data: [] });
  useFingerprintCategoriesMock.mockReturnValue({ data: [] });
  usePlaywrightConfigMock.mockReturnValue({
    config: { path: 'playwright.config.ts', content: 'export default {}' },
    isLoading: false,
    error: null,
    save: vi.fn().mockResolvedValue(undefined),
    isSaving: false,
  });

  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboardWriteTextMock.mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe('analytics route definition', () => {
  it('accepts numeric days in search', () => {
    const result = validateSearchValue('/analytics/', { days: 14 }) as { days?: number };
    expect(result.days).toBe(14);
  });

  it('coerces invalid days to undefined', () => {
    const result = validateSearchValue('/analytics/', { days: 'bad-value' }) as { days?: number };
    expect(result.days).toBeUndefined();
  });

  it('keeps days undefined when omitted', () => {
    const result = validateSearchValue('/analytics/', {}) as { days?: number };
    expect(result.days).toBeUndefined();
  });
});

describe('analytics page route component', () => {
  it('renders charts with loaded analytics data', async () => {
    searchState.set('/analytics/', { days: 30 });
    useCategoriesMock.mockReturnValue({ data: [{ id: 'c1', name: 'Regression', color: '#ef4444' }] });
    useFingerprintCategoriesMock.mockReturnValue({ data: [{ fingerprint: 'fp-1', categoryId: 'c1' }] });

    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/pass-rate')) return jsonResponse([{ date: '2026-03-01', chromium: 99 }]);
      if (url.includes('/api/analytics/duration')) return jsonResponse([{ date: '2026-03-01', p50: 300, p95: 900 }]);
      if (url.includes('/api/analytics/flaky')) return jsonResponse([{ title: 'flaky test', file: 'a.spec.ts', flakyCount: 2, totalRuns: 10, flakyRate: 20 }]);
      if (url.includes('/api/analytics/slow')) return jsonResponse([{ title: 'slow test', file: 'b.spec.ts', avgDurationMs: 1800, p95DurationMs: 2500 }]);
      if (url.includes('/api/analytics/heatmap')) return jsonResponse([{ id: 'suite.spec.ts', data: [{ x: '2026-03-01', y: 1 }] }]);
      if (url.includes('/api/analytics/gantt')) return jsonResponse([{ title: 't1', file: 'a.spec.ts', status: 'passed', workerIndex: 0, durationMs: 200, startTime: 10 }]);
      return jsonResponse({});
    });

    const AnalyticsPage = getRouteComponent('/analytics/');
    renderWithProviders(React.createElement(AnalyticsPage));

    expect(await screen.findByText('analytics.title')).toBeInTheDocument();
    expect(await screen.findByTestId('pass-rate-chart')).toBeInTheDocument();
    expect(screen.getByTestId('duration-chart')).toBeInTheDocument();
    expect(screen.getByTestId('failure-heatmap')).toBeInTheDocument();
    expect(screen.getByTestId('flaky-chart')).toBeInTheDocument();
    expect(screen.getByTestId('slow-chart')).toBeInTheDocument();
    expect(screen.getByText('analytics.failuresByCategory')).toBeInTheDocument();
  });

  it('navigates when date range changes', async () => {
    searchState.set('/analytics/', { days: 7 });
    useCategoriesMock.mockReturnValue({ data: [] });
    useFingerprintCategoriesMock.mockReturnValue({ data: [] });

    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/pass-rate')) return jsonResponse([]);
      if (url.includes('/api/analytics/duration')) return jsonResponse([]);
      if (url.includes('/api/analytics/flaky')) return jsonResponse([]);
      if (url.includes('/api/analytics/slow')) return jsonResponse([]);
      if (url.includes('/api/analytics/heatmap')) return jsonResponse([]);
      if (url.includes('/api/analytics/gantt')) return jsonResponse([]);
      return jsonResponse({});
    });

    const AnalyticsPage = getRouteComponent('/analytics/');
    renderWithProviders(React.createElement(AnalyticsPage));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'days:7' }));

    const navArg = navigateMock.mock.calls[0]?.[0] as { search?: (prev: Record<string, unknown>) => Record<string, unknown> };
    expect(typeof navArg.search).toBe('function');
    expect(navArg.search!({ days: 7 })).toEqual({ days: 90 });
  });

  it('shows no-categories state when categories are missing', async () => {
    searchState.set('/analytics/', { days: 30 });
    useCategoriesMock.mockReturnValue({ data: [] });
    useFingerprintCategoriesMock.mockReturnValue({ data: [] });

    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/pass-rate')) return jsonResponse([{ date: '2026-03-01', chromium: 100 }]);
      if (url.includes('/api/analytics/duration')) return jsonResponse([{ date: '2026-03-01', p50: 1, p95: 2 }]);
      if (url.includes('/api/analytics/flaky')) return jsonResponse([]);
      if (url.includes('/api/analytics/slow')) return jsonResponse([]);
      if (url.includes('/api/analytics/heatmap')) return jsonResponse([]);
      if (url.includes('/api/analytics/gantt')) return jsonResponse([]);
      return jsonResponse({});
    });

    const AnalyticsPage = getRouteComponent('/analytics/');
    renderWithProviders(React.createElement(AnalyticsPage));

    expect(await screen.findByText('analytics.noCategories')).toBeInTheDocument();
  });

  it('shows error alert and retries queries', async () => {
    searchState.set('/analytics/', { days: 30 });
    useCategoriesMock.mockReturnValue({ data: [] });
    useFingerprintCategoriesMock.mockReturnValue({ data: [] });

    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/pass-rate')) return jsonResponse({ error: 'boom' }, 500);
      if (url.includes('/api/analytics/duration')) return jsonResponse([]);
      if (url.includes('/api/analytics/flaky')) return jsonResponse([]);
      if (url.includes('/api/analytics/slow')) return jsonResponse([]);
      if (url.includes('/api/analytics/heatmap')) return jsonResponse([]);
      if (url.includes('/api/analytics/gantt')) return jsonResponse([]);
      return jsonResponse({});
    });

    const AnalyticsPage = getRouteComponent('/analytics/');
    renderWithProviders(React.createElement(AnalyticsPage));

    const retryButton = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(retryButton);

    await waitFor(() => {
      const passRateCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/analytics/pass-rate'));
      expect(passRateCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('navigates with preset from localStorage when presetsEnabled is true and no preset in URL', async () => {
    searchState.set('/analytics/', { days: 30 });
    useCategoriesMock.mockReturnValue({ data: [] });
    useFingerprintCategoriesMock.mockReturnValue({ data: [] });

    localStorage.setItem('analytics-preset', 'qa-lead');

    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/features')) return jsonResponse({ 'role-based-views': true });
      if (url.includes('/api/analytics/pass-rate')) return jsonResponse([]);
      if (url.includes('/api/analytics/duration')) return jsonResponse([]);
      if (url.includes('/api/analytics/flaky')) return jsonResponse([]);
      if (url.includes('/api/analytics/slow')) return jsonResponse([]);
      if (url.includes('/api/analytics/heatmap')) return jsonResponse([]);
      if (url.includes('/api/analytics/gantt')) return jsonResponse([]);
      if (url.includes('/api/quarantine/pending')) return jsonResponse([]);
      return jsonResponse({});
    });

    const AnalyticsPage = getRouteComponent('/analytics/');
    renderWithProviders(React.createElement(AnalyticsPage));

    await waitFor(() => {
      const replaceCalls = navigateMock.mock.calls.filter((c) => {
        const arg = c[0] as { replace?: boolean };
        return arg?.replace === true;
      });
      expect(replaceCalls.length).toBeGreaterThanOrEqual(1);
    });

    localStorage.removeItem('analytics-preset');
  });

  it('uses preset from URL when presetsEnabled is true and presetParam is valid', async () => {
    searchState.set('/analytics/', { days: 30, preset: 'qa-lead' });
    useCategoriesMock.mockReturnValue({ data: [] });
    useFingerprintCategoriesMock.mockReturnValue({ data: [] });

    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/features')) return jsonResponse({ 'role-based-views': true });
      if (url.includes('/api/analytics/')) return jsonResponse([]);
      if (url.includes('/api/quarantine/pending')) return jsonResponse([]);
      return jsonResponse({});
    });

    const AnalyticsPage = getRouteComponent('/analytics/');
    renderWithProviders(React.createElement(AnalyticsPage));

    expect(await screen.findByText('analytics.title')).toBeInTheDocument();
    // No replace navigate should occur since presetParam is already set
    const replaceCalls = navigateMock.mock.calls.filter((c) => {
      const arg = c[0] as { replace?: boolean };
      return arg?.replace === true;
    });
    expect(replaceCalls.length).toBe(0);
  });

  it('skips navigate when saved preset is not a valid ANALYTICS_PRESETS key', async () => {
    searchState.set('/analytics/', { days: 30 });
    useCategoriesMock.mockReturnValue({ data: [] });
    useFingerprintCategoriesMock.mockReturnValue({ data: [] });

    localStorage.setItem('analytics-preset', 'invalid-preset');

    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/features')) return jsonResponse({ 'role-based-views': true });
      if (url.includes('/api/analytics/')) return jsonResponse([]);
      return jsonResponse({});
    });

    const AnalyticsPage = getRouteComponent('/analytics/');
    renderWithProviders(React.createElement(AnalyticsPage));

    expect(await screen.findByText('analytics.title')).toBeInTheDocument();
    // No replace navigation since saved preset is invalid
    const replaceCalls = navigateMock.mock.calls.filter((c) => {
      const arg = c[0] as { replace?: boolean };
      return arg?.replace === true;
    });
    expect(replaceCalls.length).toBe(0);

    localStorage.removeItem('analytics-preset');
  });

  it('includes workspaceId in fetch params when activeWorkspaceId is set', async () => {
    searchState.set('/analytics/', { days: 30 });
    workspaceState.activeWorkspaceId = 'ws-test-1';
    useCategoriesMock.mockReturnValue({ data: [] });
    useFingerprintCategoriesMock.mockReturnValue({ data: [] });

    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/')) return jsonResponse([]);
      return jsonResponse({});
    });

    const AnalyticsPage = getRouteComponent('/analytics/');
    renderWithProviders(React.createElement(AnalyticsPage));

    await screen.findByText('analytics.title');

    await waitFor(() => {
      const passRateCalls = fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('/api/analytics/pass-rate'),
      );
      expect(passRateCalls.length).toBeGreaterThan(0);
      expect(String(passRateCalls[0]?.[0])).toContain('workspaceId=ws-test-1');
    });
  });

  it('shows no-fingerprints message when categories exist but no fingerprints match', async () => {
    searchState.set('/analytics/', { days: 30 });
    // Categories exist but fpCats reference non-existent category → chartData is empty
    useCategoriesMock.mockReturnValue({ data: [{ id: 'cat-1', name: 'Regression', color: '#ef4444' }] });
    useFingerprintCategoriesMock.mockReturnValue({ data: [{ fingerprint: 'fp-x', categoryId: 'non-existent' }] });

    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/pass-rate')) return jsonResponse([{ date: '2026-03-01', chromium: 100 }]);
      if (url.includes('/api/analytics/')) return jsonResponse([]);
      return jsonResponse({});
    });

    const AnalyticsPage = getRouteComponent('/analytics/');
    renderWithProviders(React.createElement(AnalyticsPage));

    expect(await screen.findByText('analytics.noFingerprints')).toBeInTheDocument();
  });

  it('shows no gantt widget when there are no runs', async () => {
    searchState.set('/analytics/', { days: 30 });
    // No runs → latestRunId is undefined → gantt widget renders null
    useRunsMock.mockReturnValue({ data: [] });
    useCategoriesMock.mockReturnValue({ data: [] });
    useFingerprintCategoriesMock.mockReturnValue({ data: [] });

    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/')) return jsonResponse([]);
      return jsonResponse({});
    });

    const AnalyticsPage = getRouteComponent('/analytics/');
    renderWithProviders(React.createElement(AnalyticsPage));

    expect(await screen.findByText('analytics.title')).toBeInTheDocument();
    // No gantt fetch should occur since latestRunId is undefined
    const ganttCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/api/analytics/gantt'),
    );
    expect(ganttCalls.length).toBe(0);
  });

  it('shows WorkerGanttCard with null durationMs when run has no durationMs', async () => {
    searchState.set('/analytics/', { days: 30 });
    // Run with no durationMs → totalDurationMs defaults to 0
    useRunsMock.mockReturnValue({ data: [{ id: 'run-no-duration' }] });
    useCategoriesMock.mockReturnValue({ data: [] });
    useFingerprintCategoriesMock.mockReturnValue({ data: [] });

    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/gantt')) return jsonResponse([
        { title: 'test1', file: 'a.spec.ts', status: 'passed', workerIndex: 0, durationMs: 100, startTime: 0 },
      ]);
      if (url.includes('/api/analytics/')) return jsonResponse([]);
      return jsonResponse({});
    });

    const AnalyticsPage = getRouteComponent('/analytics/');
    renderWithProviders(React.createElement(AnalyticsPage));

    expect(await screen.findByText('analytics.title')).toBeInTheDocument();
    // WorkerGanttCard rendered: run?.durationMs ?? 0 = 0 (covers ?? 0 branch)
    await waitFor(() => {
      const ganttCalls = fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('/api/analytics/gantt'),
      );
      expect(ganttCalls.length).toBeGreaterThan(0);
    });
  });
});


describe('tests explorer route component', () => {
  function setTestData(overrides?: {
    tests?: Array<{
      id: string;
      title: string;
      file: string;
      status: 'passed' | 'failed' | 'flaky' | 'skipped' | 'running';
      durationMs: number;
      tags: string;
      stableId: string | null;
    }>;
    history?: Record<string, Array<{ status: string }>>;
    triggerRunReject?: boolean;
  }) {
    const tests = overrides?.tests ?? [
      {
        id: 't1',
        title: 'login works',
        file: 'tests/login.spec.ts',
        status: 'failed',
        durationMs: 900,
        tags: '["@smoke","@auth","@critical"]',
        stableId: 'stable-login',
      },
      {
        id: 't2',
        title: 'checkout works',
        file: 'tests/checkout.spec.ts',
        status: 'passed',
        durationMs: 700,
        tags: '["@checkout"]',
        stableId: 'stable-checkout',
      },
    ];

    const history = overrides?.history ?? {
      'stable-login': [{ status: 'failed' }, { status: 'passed' }],
      'stable-checkout': [{ status: 'passed' }],
    };

    useRunsMock.mockReturnValue({ data: [{ id: 'run-1' }] });
    useRunTestsMock.mockReturnValue({
      data: tests,
      isLoading: false,
    });
    useTestMock.mockImplementation((_runId: string, testId: string) => ({
      data: testId
        ? {
            id: testId,
            runId: 'run-1',
            suiteId: null,
            title: testId === 't1' ? 'login works' : 'checkout works',
            file: testId === 't1' ? 'tests/login.spec.ts' : 'tests/checkout.spec.ts',
            line: 10,
            column: 1,
            status: 'failed',
            durationMs: 900,
            tags: '["@smoke"]',
            annotations: '[]',
            retryCount: 1,
            expectedStatus: 'passed',
            workerIndex: 0,
            stableId: 'stable-login',
            results: [],
          }
        : undefined,
    }));
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/api/tests/history/batch') && (init?.method ?? 'GET') === 'POST') {
        return jsonResponse(history);
      }
      if (url.includes('/api/runs/trigger') && (init?.method ?? 'GET') === 'POST') {
        if (overrides?.triggerRunReject) {
          return Promise.reject(new Error('trigger failed'));
        }
        return jsonResponse({ runId: 'run-rerun' });
      }
      return jsonResponse({});
    });
  }

  it('filters test list from search params', async () => {
    setTestData();
    searchState.set('/tests/', { search: 'login', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    expect(await screen.findByText('login works')).toBeInTheDocument();
    expect(screen.queryByText('checkout works')).not.toBeInTheDocument();
  });

  it('updates status filter through router navigate', async () => {
    setTestData();
    searchState.set('/tests/', { search: '', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Set failed filter' }));

    const navArg = navigateMock.mock.calls[0]?.[0] as { search?: (prev: Record<string, unknown>) => Record<string, unknown> };
    if (!navArg.search) throw new Error('Missing search updater');

    expect(navArg.search({})).toEqual({ status: 'failed' });
  });

  it('shows selected test detail on row click', async () => {
    setTestData();
    searchState.set('/tests/', { search: '', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    const user = userEvent.setup();
    await user.click(await screen.findByText('login works'));

    expect(await screen.findByTestId('test-detail')).toHaveTextContent('login works');
  });

  it('handles bulk copy and rerun actions for checked tests', async () => {
    setTestData();
    searchState.set('/tests/', { search: '', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Select login works'));

    expect(await screen.findByText('1 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy selected' }));
    expect(showToastMock).toHaveBeenCalledWith('Copied to clipboard');

    await user.click(screen.getByRole('button', { name: 'Re-run selected' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/runs/trigger',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(showToastMock).toHaveBeenCalledWith('Re-running 1 test(s)');
  });

  it('renders empty state when no tests exist', async () => {
    setTestData({ tests: [], history: {} });
    searchState.set('/tests/', { search: '', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    expect(await screen.findByText('tests.noTests')).toBeInTheDocument();
    expect(screen.getByText('tests.runTestsFirst')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tests.clearFilters' })).not.toBeInTheDocument();
  });

  it('renders no-match state and clears filters from CTA', async () => {
    setTestData();
    searchState.set('/tests/', { search: 'zzz-no-match', status: 'failed', tag: '@smoke' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    expect(await screen.findByText('tests.noMatchFilters')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'tests.clearFilters' }));

    const searchUpdaters = navigateMock.mock.calls
      .map((call) => (call[0] as { search?: unknown }).search)
      .filter((search): search is (prev: Record<string, unknown>) => Record<string, unknown> => typeof search === 'function');

    const nextSearches = searchUpdaters.map((updater) => updater({ search: 'x', status: 'failed', tag: '@smoke' }));
    expect(nextSearches).toContainEqual({ search: 'x', status: undefined, tag: '@smoke' });
    expect(nextSearches).toContainEqual({ search: 'x', status: 'failed', tag: undefined });
  });

  it('shows placeholder panel before selecting a test', async () => {
    setTestData();
    searchState.set('/tests/', { search: '', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    expect(await screen.findByText('Select a test to view details')).toBeInTheDocument();
    expect(screen.getByText('Click a test from the list or use J/K to navigate')).toBeInTheDocument();
  });

  it('renders history dots and collapses extra tags into +N indicator', async () => {
    setTestData();
    searchState.set('/tests/', { search: '', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    expect(await screen.findByText('dots:2')).toBeInTheDocument();
    expect(screen.getByText('@smoke')).toBeInTheDocument();
    expect(screen.getByText('@auth')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('supports keyboard navigation with j and k keys', async () => {
    setTestData();
    searchState.set('/tests/', { search: '', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    await screen.findByText('login works');
    fireEvent.keyDown(window, { key: 'j' });
    expect(await screen.findByTestId('test-detail')).toHaveTextContent('login works');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(await screen.findByTestId('test-detail')).toHaveTextContent('checkout works');

    fireEvent.keyDown(window, { key: 'k' });
    expect(await screen.findByTestId('test-detail')).toHaveTextContent('login works');
  });

  it('ignores keyboard navigation while search input is focused', async () => {
    setTestData();
    searchState.set('/tests/', { search: '', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    const input = await screen.findByRole('textbox', { name: 'Search tests' });
    input.focus();
    fireEvent.keyDown(window, { key: 'j' });

    expect(screen.queryByTestId('test-detail')).not.toBeInTheDocument();
  });

  it('exports grep pattern and clears selected tests', async () => {
    setTestData();
    searchState.set('/tests/', { search: '', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Select login works'));
    await user.click(screen.getByLabelText('Select checkout works'));

    expect(await screen.findByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export grep' }));
    expect(showToastMock).toHaveBeenCalledWith('Exported grep pattern for 2 test(s)');

    await user.click(screen.getByRole('button', { name: 'Clear selected' }));
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
  });

  it('shows error toast when rerun trigger fails', async () => {
    setTestData({ triggerRunReject: true });
    searchState.set('/tests/', { search: '', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Select login works'));
    await user.click(screen.getByRole('button', { name: 'Re-run selected' }));

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith('Failed to start re-run', 'error');
    });
  });

  it('does not fetch history batch when tests have no stable ids', async () => {
    setTestData({
      tests: [
        {
          id: 't3',
          title: 'has no stable id',
          file: 'tests/no-stable.spec.ts',
          status: 'passed',
          durationMs: 123,
          tags: '[]',
          stableId: null,
        },
      ],
      history: {},
    });
    searchState.set('/tests/', { search: '', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    expect(await screen.findByText('has no stable id')).toBeInTheDocument();

    await waitFor(() => {
      const historyCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/tests/history/batch'));
      expect(historyCalls).toHaveLength(0);
    });
  });

  it('handles Enter key press when a test is selected covers empty branch', async () => {
    setTestData();
    searchState.set('/tests/', { search: '', status: '', tag: '' });

    const TestExplorerPage = getRouteComponent('/tests/');
    renderWithProviders(React.createElement(TestExplorerPage));

    await screen.findByText('login works');
    // Select a test first via j key
    fireEvent.keyDown(window, { key: 'j' });
    expect(await screen.findByTestId('test-detail')).toHaveTextContent('login works');

    // Press Enter with selectedTestId set — covers the `else if (e.key === 'Enter' && selectedTestId)` branch
    fireEvent.keyDown(window, { key: 'Enter' });
    // Empty block — no visible change expected, branch is covered
    expect(screen.getByTestId('test-detail')).toHaveTextContent('login works');
  });
});

describe('quarantine route component', () => {
  it('shows empty state and opens form from CTA', async () => {
    fetchMock.mockImplementation((input) => {
      if (String(input).includes('/api/quarantine')) return jsonResponse([]);
      return jsonResponse({});
    });

    const QuarantinePage = getRouteComponent('/tests/quarantine');
    renderWithProviders(React.createElement(QuarantinePage));

    expect(await screen.findByText('No quarantined tests')).toBeInTheDocument();

    const user = userEvent.setup();
    const addButtons = screen.getAllByRole('button', { name: 'Add to Quarantine' });
    await user.click(addButtons[1]);

    expect(screen.getByPlaceholderText('e.g. should display login form')).toBeInTheDocument();
  });

  it('submits new quarantine entry and resets form', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/quarantine') && method === 'GET') return jsonResponse([]);
      if (url.endsWith('/api/quarantine') && method === 'POST') return jsonResponse({ ok: true });
      return jsonResponse({});
    });

    const QuarantinePage = getRouteComponent('/tests/quarantine');
    renderWithProviders(React.createElement(QuarantinePage));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add to Quarantine' }));

    await user.type(screen.getByPlaceholderText('e.g. should display login form'), 'should render login');
    await user.type(screen.getByPlaceholderText('e.g. tests/auth/login.spec.ts'), 'tests/auth/login.spec.ts');
    await user.type(screen.getByPlaceholderText('Optional reason'), 'flaky in CI');
    await user.click(screen.getByRole('button', { name: 'Quarantine' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/quarantine',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Test quarantined');
  });

  it('removes a quarantined entry from the table', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/quarantine') && method === 'GET') {
        return jsonResponse([
          { id: 'q-1', testTitle: 'login works', testFile: 'tests/login.spec.ts', reason: null, quarantinedAt: '2026-03-08T00:00:00.000Z', quarantinedBy: 'user' },
        ]);
      }
      if (url.endsWith('/api/quarantine/q-1') && method === 'DELETE') return jsonResponse({ ok: true });
      return jsonResponse({});
    });

    const QuarantinePage = getRouteComponent('/tests/quarantine');
    renderWithProviders(React.createElement(QuarantinePage));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove q-1' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/quarantine/q-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Removed from quarantine');
  });

  it('submits with undefined reason when reason field is left empty', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (url.endsWith('/api/quarantine') && method === 'GET') return jsonResponse([]);
      if (url.endsWith('/api/quarantine') && method === 'POST') return jsonResponse({ ok: true });
      return jsonResponse({});
    });

    const QuarantinePage = getRouteComponent('/tests/quarantine');
    renderWithProviders(React.createElement(QuarantinePage));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add to Quarantine' }));
    await user.type(screen.getByPlaceholderText('e.g. should display login form'), 'my test title');
    await user.type(screen.getByPlaceholderText('e.g. tests/auth/login.spec.ts'), 'tests/a.spec.ts');
    // Leave reason blank — covers formReason || undefined false branch
    await user.click(screen.getByRole('button', { name: 'Quarantine' }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((c) =>
        (c[1] as RequestInit | undefined)?.method === 'POST'
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1] as RequestInit).body as string) as { reason?: string };
      expect(body.reason).toBeUndefined();
    });
  });

  it('returns early from handleSubmit when title and file fields are both empty', async () => {
    fetchMock.mockImplementation(() => jsonResponse([]));

    const QuarantinePage = getRouteComponent('/tests/quarantine');
    renderWithProviders(React.createElement(QuarantinePage));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add to Quarantine' }));

    // Submit with empty fields using fireEvent to bypass HTML5 required validation
    const form = document.querySelector('form');
    if (form) fireEvent.submit(form);

    // No POST should have been made
    await new Promise((r) => setTimeout(r, 50));
    const postCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'POST'
    );
    expect(postCalls).toHaveLength(0);
  });

  it('shows Saving text on the submit button while addMutation is pending', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (url.endsWith('/api/quarantine') && method === 'GET') return jsonResponse([]);
      if (url.endsWith('/api/quarantine') && method === 'POST') return new Promise(() => {});
      return jsonResponse({});
    });

    const QuarantinePage = getRouteComponent('/tests/quarantine');
    renderWithProviders(React.createElement(QuarantinePage));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add to Quarantine' }));
    await user.type(screen.getByPlaceholderText('e.g. should display login form'), 'pending test');
    await user.type(screen.getByPlaceholderText('e.g. tests/auth/login.spec.ts'), 'tests/a.spec.ts');
    await user.click(screen.getByRole('button', { name: 'Quarantine' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
    });
  });

  it('renders flakiness breakdown chart and calls tooltip formatter to cover branch', async () => {
    capturedTooltipProps.length = 0;
    const breakdown = { timing: 3, environment: 1, data: 0, assertion_drift: 2, unknown: 1, total: 7 };
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/flakiness-breakdown')) return jsonResponse(breakdown);
      if (url.includes('/api/quarantine')) return jsonResponse([
        { id: 'q-1', testTitle: 'login works', testFile: 'tests/login.spec.ts', reason: null, quarantinedAt: '2026-03-08T00:00:00.000Z', quarantinedBy: 'system', flakinessCategory: 'timing', categoryConfidence: 0.8, categoryEvidence: [] },
      ]);
      return jsonResponse({});
    });

    const QuarantinePage = getRouteComponent('/tests/quarantine');
    renderWithProviders(React.createElement(QuarantinePage));

    await waitFor(() => {
      expect(screen.getByText('Flakiness Breakdown')).toBeInTheDocument();
    });

    // The Tooltip should have been rendered with a formatter — call it to cover the branch
    await waitFor(() => {
      expect(capturedTooltipProps.length).toBeGreaterThan(0);
    });
    const tooltip = capturedTooltipProps.at(-1)!;
    expect(typeof tooltip.formatter).toBe('function');
    const result = (tooltip.formatter as (v: number) => [string, string])(5);
    expect(result).toEqual(['5', 'Count']);
  });

  it('shows empty filter message when no rows match the selected category', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/flakiness-breakdown')) return jsonResponse({ timing: 2, environment: 0, data: 0, assertion_drift: 0, unknown: 0, total: 2 });
      if (url.includes('/api/quarantine')) return jsonResponse([
        { id: 'q-1', testTitle: 'timing test', testFile: 'tests/a.spec.ts', reason: null, quarantinedAt: '2026-03-08T00:00:00.000Z', quarantinedBy: 'system', flakinessCategory: 'timing', categoryConfidence: 0.7, categoryEvidence: [] },
      ]);
      return jsonResponse({});
    });

    const QuarantinePage = getRouteComponent('/tests/quarantine');
    renderWithProviders(React.createElement(QuarantinePage));

    await screen.findByText('timing test');

    // Click 'Environment' filter — no rows have that category
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Environment' }));

    await waitFor(() => {
      expect(screen.getByText('No quarantined tests match the selected category filter.')).toBeInTheDocument();
    });
  });

  it('shows "No classified data yet" when breakdown total > 0 but all categories are zero', async () => {
    const breakdown = { timing: 0, environment: 0, data: 0, assertion_drift: 0, unknown: 0, total: 5 };
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/flakiness-breakdown')) return jsonResponse(breakdown);
      if (url.includes('/api/quarantine')) return jsonResponse([
        { id: 'q-1', testTitle: 'login works', testFile: 'tests/login.spec.ts', reason: null, quarantinedAt: '2026-03-08T00:00:00.000Z', quarantinedBy: 'system', flakinessCategory: 'unknown', categoryConfidence: 0.3, categoryEvidence: [] },
      ]);
      return jsonResponse({});
    });

    const QuarantinePage = getRouteComponent('/tests/quarantine');
    renderWithProviders(React.createElement(QuarantinePage));

    await waitFor(() => {
      expect(screen.getByText('No classified data yet')).toBeInTheDocument();
    });
  });

  it('filters rows by category when a category filter button is clicked', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/flakiness-breakdown')) return jsonResponse({ timing: 1, environment: 0, data: 0, assertion_drift: 0, unknown: 1, total: 2 });
      if (url.includes('/api/quarantine')) return jsonResponse([
        { id: 'q-1', testTitle: 'timing test', testFile: 'tests/a.spec.ts', reason: null, quarantinedAt: '2026-03-08T00:00:00.000Z', quarantinedBy: 'system', flakinessCategory: 'timing', categoryConfidence: 0.7, categoryEvidence: [] },
        { id: 'q-2', testTitle: 'unknown test', testFile: 'tests/b.spec.ts', reason: null, quarantinedAt: '2026-03-08T00:00:00.000Z', quarantinedBy: 'system', flakinessCategory: 'unknown', categoryConfidence: 0.3, categoryEvidence: [] },
      ]);
      return jsonResponse({});
    });

    const QuarantinePage = getRouteComponent('/tests/quarantine');
    renderWithProviders(React.createElement(QuarantinePage));

    // Wait for rows to load
    await screen.findByText('timing test');
    expect(screen.getByText('unknown test')).toBeInTheDocument();

    // Click the "Timing" filter button
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Timing' }));

    // Only timing test should be visible
    await waitFor(() => {
      expect(screen.getByText('timing test')).toBeInTheDocument();
      expect(screen.queryByText('unknown test')).not.toBeInTheDocument();
    });
  });

  it('filters rows with null flakinessCategory as "unknown" (covers ?? fallback branch)', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/analytics/flakiness-breakdown')) return jsonResponse({ timing: 0, environment: 0, data: 0, assertion_drift: 0, unknown: 1, total: 1 });
      if (url.includes('/api/quarantine')) return jsonResponse([
        { id: 'q-1', testTitle: 'null-category test', testFile: 'tests/a.spec.ts', reason: null, quarantinedAt: '2026-03-08T00:00:00.000Z', quarantinedBy: 'system', flakinessCategory: null, categoryConfidence: null, categoryEvidence: null },
      ]);
      return jsonResponse({});
    });

    const QuarantinePage = getRouteComponent('/tests/quarantine');
    renderWithProviders(React.createElement(QuarantinePage));

    await screen.findByText('null-category test');

    // Click 'Unknown' filter — row has null flakinessCategory, exercising the ?? 'unknown' fallback
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Unknown' }));

    await waitFor(() => {
      expect(screen.getByText('null-category test')).toBeInTheDocument();
    });
  });
});

describe('baselines route component', () => {
  const baselinesPayload = [
    {
      id: 'b-1',
      testFile: 'tests/login.spec.ts',
      snapshotName: 'login-expected.png',
      expectedPath: '/exp/login.png',
      actualPath: '/act/login.png',
      diffPath: '/diff/login.png',
      hasActual: true,
      hasDiff: true,
      expectedSizeBytes: 1200,
    },
    {
      id: 'b-2',
      testFile: 'tests/checkout.spec.ts',
      snapshotName: 'checkout-expected.png',
      expectedPath: '/exp/checkout.png',
      actualPath: null,
      diffPath: null,
      hasActual: false,
      hasDiff: false,
      expectedSizeBytes: 900,
    },
  ];

  it('renders grouped baseline cards and changed filter', async () => {
    fetchMock.mockImplementation((input) => {
      if (String(input).includes('/api/baselines')) return jsonResponse(baselinesPayload);
      return jsonResponse({});
    });

    const BaselinesPage = getRouteComponent('/baselines/');
    renderWithProviders(React.createElement(BaselinesPage));

    expect(await screen.findByText('login-expected.png')).toBeInTheDocument();
    expect(screen.getByText('checkout-expected.png')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Changed (1)' }));

    expect(screen.getByText('login-expected.png')).toBeInTheDocument();
    expect(screen.queryByText('checkout-expected.png')).not.toBeInTheDocument();
  });

  it('accepts all changed baselines', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/baselines') && method === 'GET') return jsonResponse(baselinesPayload);
      if (url.endsWith('/api/baselines/accept-all') && method === 'POST') return jsonResponse({ accepted: 1 });
      return jsonResponse({});
    });

    const BaselinesPage = getRouteComponent('/baselines/');
    renderWithProviders(React.createElement(BaselinesPage));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Accept All (1)' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/baselines/accept-all', expect.objectContaining({ method: 'POST' }));
    });
    expect(toastPromiseMock).toHaveBeenCalledTimes(1);
  });

  it('opens batch review modal for changed baselines', async () => {
    fetchMock.mockImplementation((input) => {
      if (String(input).includes('/api/baselines')) return jsonResponse(baselinesPayload);
      return jsonResponse({});
    });

    const BaselinesPage = getRouteComponent('/baselines/');
    renderWithProviders(React.createElement(BaselinesPage));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Batch Review (1)' }));

    expect(await screen.findByTestId('batch-review')).toHaveTextContent('batch:1');
  });

  it('shows empty-state when there are no baselines', async () => {
    fetchMock.mockImplementation((input) => {
      if (String(input).includes('/api/baselines')) return jsonResponse([]);
      return jsonResponse({});
    });

    const BaselinesPage = getRouteComponent('/baselines/');
    renderWithProviders(React.createElement(BaselinesPage));

    expect(await screen.findByText('No baselines found')).toBeInTheDocument();
  });
});

describe('config route component', () => {
  it('renders visual tab with project matrix by default', () => {
    const ConfigPage = getRouteComponent('/config/');
    renderWithProviders(React.createElement(ConfigPage));

    expect(screen.getByText('Playwright Config')).toBeInTheDocument();
    expect(screen.getByTestId('project-matrix')).toBeInTheDocument();
  });

  it('switches to editor tab and saves edited config', async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    usePlaywrightConfigMock.mockReturnValue({
      config: { path: 'playwright.config.ts', content: 'export default { retries: 0 }' },
      isLoading: false,
      error: null,
      save: saveMock,
      isSaving: false,
    });

    const ConfigPage = getRouteComponent('/config/');
    renderWithProviders(React.createElement(ConfigPage));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Editor' }));

    const textarea = await screen.findByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'export default { retries: 2 }' } });

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveMock).toHaveBeenCalledWith('export default { retries: 2 }');
  });

  it('shows editor load error', async () => {
    usePlaywrightConfigMock.mockReturnValue({
      config: undefined,
      isLoading: false,
      error: new Error('config unavailable'),
      save: vi.fn(),
      isSaving: false,
    });

    const ConfigPage = getRouteComponent('/config/');
    renderWithProviders(React.createElement(ConfigPage));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Editor' }));

    expect(await screen.findByText('Could not load playwright config.')).toBeInTheDocument();
    expect(screen.getByText('config unavailable')).toBeInTheDocument();
  });
});

describe('settings route component', () => {
  it('defaults validateSearch tab to general when tab is empty string', () => {
    const result = validateSearchValue('/settings/', { tab: '' }) as { tab: string };

    expect(result).toEqual({ tab: 'general' });
  });

  it('keeps validateSearch tab when provided', () => {
    const result = validateSearchValue('/settings/', { tab: 'display' }) as { tab: string };

    expect(result).toEqual({ tab: 'display' });
  });

  it('defaults validateSearch tab to general when tab is missing', () => {
    const result = validateSearchValue('/settings/', {}) as { tab: string };

    expect(result).toEqual({ tab: 'general' });
  });

  it('renders general settings tab by default', () => {
    searchState.set('/settings/', { tab: 'general' });

    const SettingsPage = getRouteComponent('/settings/');
    renderWithProviders(React.createElement(SettingsPage));

    expect(screen.getByText('settings.title')).toBeInTheDocument();
    expect(screen.getByText('General settings panel')).toBeInTheDocument();
    expect(screen.getByText('active:general')).toBeInTheDocument();
  });

  it('falls back to general settings for unknown tab', () => {
    searchState.set('/settings/', { tab: 'unknown-tab' });

    const SettingsPage = getRouteComponent('/settings/');
    renderWithProviders(React.createElement(SettingsPage));

    expect(screen.getByText('General settings panel')).toBeInTheDocument();
  });

  it('navigates when tab changes from settings nav', async () => {
    searchState.set('/settings/', { tab: 'general' });

    const SettingsPage = getRouteComponent('/settings/');
    renderWithProviders(React.createElement(SettingsPage));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Go display' }));

    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings', search: { tab: 'display' }, replace: true });
  });

  it('falls back to general tab when useSearch returns no tab value (covers || general on line 50)', () => {
    // beforeEach clears searchState → no entry for /settings/ → useSearch returns {}
    // → tab is undefined → activeTab = undefined || 'general' covers the falsy branch
    const SettingsPage = getRouteComponent('/settings/');
    renderWithProviders(React.createElement(SettingsPage));

    expect(screen.getByText('settings.title')).toBeInTheDocument();
    expect(screen.getByText('General settings panel')).toBeInTheDocument();
  });
});

describe('codegen route component', () => {
  it('starts recording with selected controls', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/codegen/status') && method === 'GET') return jsonResponse({ running: false, pid: null });
      if (url.endsWith('/api/codegen/start') && method === 'POST') return jsonResponse({ started: true });
      return jsonResponse({});
    });

    const CodegenPage = getRouteComponent('/tools/codegen');
    renderWithProviders(React.createElement(CodegenPage));

    const user = userEvent.setup();
    const urlInput = await screen.findByDisplayValue('http://localhost:3000');
    await user.clear(urlInput);
    await user.type(urlInput, 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'firefox' }));
    await user.selectOptions(screen.getByRole('combobox'), 'python');
    await user.click(screen.getByRole('button', { name: 'Start Recording' }));

    const startCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/codegen/start'));
      expect(call).toBeTruthy();
      return call;
    });

    const payload = JSON.parse(String(startCall?.[1]?.body));
    expect(payload).toEqual({ url: 'https://example.com', browser: 'firefox', language: 'python' });
    expect(toastSuccessMock).toHaveBeenCalledWith('Codegen started — browser window will open');
  });

  it('shows running state and stops recording', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/codegen/status') && method === 'GET') return jsonResponse({ running: true, pid: 4567 });
      if (url.endsWith('/api/codegen/stop') && method === 'POST') return jsonResponse({ stopped: true });
      return jsonResponse({});
    });

    const CodegenPage = getRouteComponent('/tools/codegen');
    renderWithProviders(React.createElement(CodegenPage));

    expect(await screen.findByText('● Recording')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Stop Recording' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/codegen/stop', expect.objectContaining({ method: 'POST' }));
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Codegen stopped');
  });

  it('shows error toast when start fails', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/codegen/status') && method === 'GET') return jsonResponse({ running: false, pid: null });
      if (url.endsWith('/api/codegen/start') && method === 'POST') return jsonResponse({ error: 'cannot start' }, 500);
      return jsonResponse({});
    });

    const CodegenPage = getRouteComponent('/tools/codegen');
    renderWithProviders(React.createElement(CodegenPage));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start Recording' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Failed to start codegen');
    });
  });

  it('shows error toast when stop codegen request fails (covers onError on line 64)', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (url.endsWith('/api/codegen/status') && method === 'GET') return jsonResponse({ running: true, pid: 9999 });
      if (url.endsWith('/api/codegen/stop') && method === 'POST') return jsonResponse({ error: 'stop failed' }, 500);
      return jsonResponse({});
    });

    const CodegenPage = getRouteComponent('/tools/codegen');
    renderWithProviders(React.createElement(CodegenPage));

    expect(await screen.findByText('● Recording')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Stop Recording' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Failed to stop codegen');
    });
  });
});

describe('route wiring coverage checks', () => {
  it('registers component for tests route', () => {
    expect(routeComponents.has('/tests/')).toBe(true);
  });

  it('registers component for baselines route', () => {
    expect(routeComponents.has('/baselines/')).toBe(true);
  });

  it('registers component for settings route', () => {
    expect(routeComponents.has('/settings/')).toBe(true);
  });
});
