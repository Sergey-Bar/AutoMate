import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderWithProviders, screen, userEvent, waitFor, within } from '../../test/test-utils';
import { Skeleton, TestListSkeleton, ChartGridSkeleton, DetailPaneSkeleton, TextSkeleton, CardSkeleton, SettingsSkeleton } from '../shared/Skeleton';
import { EmptyState } from '../shared/EmptyState';
import { BaselineBatchReview } from '../artifacts/BaselineBatchReview';
import { StepTree } from '../tests/StepTree';
import { TestTree } from '../tests/TestTree';
import { ShortcutsModal } from '../shared/ShortcutsModal';
import { SuggestedQueries } from '../layout/SuggestedQueries';
import { SlowestTests } from '../analytics/SlowestTests';
import { PassRateChart } from '../analytics/PassRateChart';
import { VideoPlayer } from '../artifacts/VideoPlayer';
import { RunTrigger } from '../runs/RunTrigger';
import { IntegrationSettings } from '../settings/IntegrationSettings';

const mocks = vi.hoisted(() => {
  const navigate = vi.fn();
  const startRun = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();
  const toastPromise = vi.fn((promise: Promise<unknown>) => promise);

  const xAxisProps: Array<Record<string, unknown>> = [];
  const yAxisProps: Array<Record<string, unknown>> = [];
  const tooltipProps: Array<Record<string, unknown>> = [];
  const areaProps: Array<Record<string, unknown>> = [];
  const barProps: Array<Record<string, unknown>> = [];

  const treeToggles = new Map<string, ReturnType<typeof vi.fn>>();

  return {
    navigate,
    startRun,
    toastSuccess,
    toastError,
    toastPromise,
    xAxisProps,
    yAxisProps,
    tooltipProps,
    areaProps,
    barProps,
    treeToggles,
  };
});

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_target: unknown, prop: string) => {
      return ({ initial: _initial, animate: _animate, exit: _exit, variants: _variants, whileHover: _whileHover, whileTap: _whileTap, transition: _transition, layout: _layout, layoutId: _layoutId, ...rest }: Record<string, unknown>) => {
        const tags = ['div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td', 'form', 'ul', 'nav', 'header', 'footer', 'main', 'aside', 'article', 'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4', 'path', 'circle', 'rect'];
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

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) => React.createElement('a', { href: to ?? '', ...rest }, children),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ navigate: vi.fn() }),
  useSearch: () => ({}),
  useParams: () => ({}),
  Outlet: () => React.createElement('div', { 'data-testid': 'router-outlet' }),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'responsive-container' }, children),
  AreaChart: ({ children, data }: { children: React.ReactNode; data?: unknown[] }) => React.createElement('div', { 'data-testid': 'area-chart', 'data-points': data?.length ?? 0 }, children),
  Area: (props: Record<string, unknown>) => {
    mocks.areaProps.push(props);
    return React.createElement('div', { 'data-testid': `area-${String(props.dataKey ?? '')}` });
  },
  BarChart: ({ children, data }: { children: React.ReactNode; data?: unknown[] }) => React.createElement('div', { 'data-testid': 'bar-chart', 'data-points': data?.length ?? 0 }, children),
  Bar: (props: Record<string, unknown>) => {
    mocks.barProps.push(props);
    return React.createElement('div', { 'data-testid': `bar-${String(props.dataKey ?? '')}` }, props.children as React.ReactNode);
  },
  XAxis: (props: Record<string, unknown>) => {
    mocks.xAxisProps.push(props);
    return React.createElement('div', { 'data-testid': 'x-axis' });
  },
  YAxis: (props: Record<string, unknown>) => {
    mocks.yAxisProps.push(props);
    return React.createElement('div', { 'data-testid': 'y-axis' });
  },
  Tooltip: (props: Record<string, unknown>) => {
    mocks.tooltipProps.push(props);
    return React.createElement('div', { 'data-testid': 'tooltip' });
  },
  CartesianGrid: () => React.createElement('div', { 'data-testid': 'cartesian-grid' }),
  Legend: () => React.createElement('div', { 'data-testid': 'legend' }),
  Cell: () => React.createElement('div', { 'data-testid': 'cell' }),
}));

vi.mock('@nivo/heatmap', () => ({
  ResponsiveHeatMap: ({ data }: { data: unknown[] }) => React.createElement('div', { 'data-testid': 'heatmap', 'data-rows': data.length }),
}));

vi.mock('react-arborist', () => ({
  Tree: ({ data, children }: { data: Array<{ id: string; children?: unknown[] }>; children: ((props: unknown) => React.ReactNode) | React.ComponentType<unknown> }) => {
    const renderNode = (nodeData: { id: string; children?: unknown[]; [k: string]: unknown }) => {
      const toggle = mocks.treeToggles.get(nodeData.id) ?? vi.fn();
      mocks.treeToggles.set(nodeData.id, toggle);

      const node = {
        data: nodeData,
        isInternal: Array.isArray(nodeData.children) && nodeData.children.length > 0,
        isOpen: true,
        toggle,
      };

      const nodeProps = {
        node,
        style: {},
        dragHandle: null,
      };

      const rendered = typeof children === 'function'
        ? (children as (props: unknown) => React.ReactNode)(nodeProps)
        : React.createElement(children as React.ComponentType<Record<string, unknown>>, nodeProps as Record<string, unknown>);

      return React.createElement(
        'div',
        { key: nodeData.id, 'data-testid': 'tree-node', 'data-node-id': nodeData.id },
        rendered,
        Array.isArray(nodeData.children) ? nodeData.children.map((child) => renderNode(child as { id: string; children?: unknown[]; [k: string]: unknown })) : null,
      );
    };

    return React.createElement('div', { 'data-testid': 'tree', 'data-count': data.length }, data.map((d) => renderNode(d as { id: string; children?: unknown[]; [k: string]: unknown })));
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: vi.fn(),
    warning: vi.fn(),
    promise: mocks.toastPromise,
  },
  Toaster: () => null,
}));

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
}));

vi.mock('cmdk', () => ({
  Command: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  CommandInput: (props: Record<string, unknown>) => React.createElement('input', props),
  CommandList: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  CommandItem: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => React.createElement('div', props, children),
  CommandGroup: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  CommandEmpty: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('@monaco-editor/react', () => ({
  default: () => React.createElement('div', { 'data-testid': 'monaco-editor' }),
}));

vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({ codeToHtml: vi.fn(), dispose: vi.fn() }),
  getHighlighter: vi.fn().mockResolvedValue({ codeToHtml: vi.fn(), dispose: vi.fn() }),
}));

vi.mock('xterm', () => ({
  Terminal: vi.fn(),
}));

vi.mock('xterm-addon-fit', () => ({
  FitAddon: vi.fn(),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(),
}));

vi.mock('@/hooks/useRun', () => ({
  startRun: (...args: unknown[]) => mocks.startRun(...args),
  useRunTests: () => ({ data: [] }),
}));

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.xAxisProps.length = 0;
  mocks.yAxisProps.length = 0;
  mocks.tooltipProps.length = 0;
  mocks.areaProps.length = 0;
  mocks.barProps.length = 0;
  mocks.treeToggles.clear();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse({})));
});

describe('coverage gaps', () => {
  describe('Skeleton variants', () => {
    it('renders test, chart, detail, text, card and settings skeleton compositions', () => {
      const { container, rerender } = render(<TestListSkeleton />);
      const testItems = container.querySelectorAll('.skeleton-shimmer');
      expect(testItems.length).toBe(10);
      expect((testItems[0] as HTMLElement).style.width).toBe('100%');
      expect((testItems[4] as HTMLElement).style.width).toBe('78%');

      rerender(<ChartGridSkeleton />);
      expect(container.querySelectorAll('.skeleton-shimmer').length).toBe(6);
      expect(container.querySelectorAll('.lg\\:col-span-2').length).toBe(2);

      rerender(<DetailPaneSkeleton />);
      expect(container.querySelectorAll('.skeleton-shimmer').length).toBe(12);

      rerender(<TextSkeleton lines={10} />);
      const textLines = container.querySelectorAll('.skeleton-shimmer');
      expect(textLines.length).toBe(10);
      expect((textLines[0] as HTMLElement).style.width).toBe('100%');
      expect((textLines[8] as HTMLElement).style.width).toBe('100%');

      rerender(<CardSkeleton count={2} />);
      expect(container.querySelectorAll('.skeleton-shimmer').length).toBe(6);

      rerender(<SettingsSkeleton />);
      expect(container.querySelectorAll('.skeleton-shimmer').length).toBe(19);
    });

    it('applies custom inline background override on base Skeleton', () => {
      const { container } = render(<Skeleton style={{ width: '42%' }} />);
      const node = container.querySelector('.skeleton-shimmer') as HTMLElement;
      expect(node.style.width).toBe('42%');
      expect(node.className).toContain('bg-bg-surface');
    });
  });

  describe('EmptyState illustrations', () => {
    it('renders each advanced illustration variant', () => {
      const { container, rerender } = render(<EmptyState title="Inbox" illustration="inbox" />);
      expect(container.querySelector('path[d="M20 8L24 2L28 8"]')).not.toBeNull();

      rerender(<EmptyState title="Search" illustration="search" />);
      expect(container.querySelector('line[x1="29.07"]')).not.toBeNull();

      rerender(<EmptyState title="Chart" illustration="chart" />);
      expect(container.querySelectorAll('rect[width="4"]').length).toBe(7);

      rerender(<EmptyState title="Grid" illustration="grid" />);
      expect(container.querySelectorAll('rect[stroke-dasharray="3 2"]').length).toBe(4);

      rerender(<EmptyState title="Shield" illustration="shield" />);
      expect(container.querySelector('path[d="M24 4L8 12V24C8 34 24 44 24 44C24 44 40 34 40 24V12L24 4Z"]')).not.toBeNull();
    });
  });

  describe('BaselineBatchReview keyboard + batch accept', () => {
    const baselines = [
      {
        id: 'b1',
        testFile: 'tests/a.spec.ts',
        snapshotName: 'a.png',
        expectedPath: '/exp/a.png',
        actualPath: '/act/a.png',
        diffPath: '/diff/a.png',
        hasActual: true,
        hasDiff: true,
        expectedSizeBytes: 1,
      },
      {
        id: 'b2',
        testFile: 'tests/b.spec.ts',
        snapshotName: 'b.png',
        expectedPath: '/exp/b.png',
        actualPath: '/act/b.png',
        diffPath: null,
        hasActual: true,
        hasDiff: false,
        expectedSizeBytes: 1,
      },
    ];

    it('supports arrow key navigation and Accept All Remaining toast promise', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/baselines/')) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      });
      vi.stubGlobal('fetch', fetchMock);

      renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);
      expect(screen.getByText('a.png')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(screen.getByText('b.png')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(screen.getByText('a.png')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Accept All \(2\)/i }));
      await waitFor(() => {
        expect(mocks.toastPromise).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('/api/baselines/b1/accept', { method: 'POST' });
        expect(fetchMock).toHaveBeenCalledWith('/api/baselines/b2/accept', { method: 'POST' });
      });
    });

    it('ignores keyboard shortcuts when event target is input-like', () => {
      renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);
      const tempInput = document.createElement('input');
      document.body.appendChild(tempInput);
      tempInput.focus();
      fireEvent.keyDown(tempInput, { key: 'ArrowRight' });
      expect(screen.getByText('a.png')).toBeInTheDocument();
      document.body.removeChild(tempInput);
    });

    it('shows error toast when individual baseline accept fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 500 }))
      ));
      renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);
      fireEvent.keyDown(window, { key: 'a' });
      await waitFor(() => {
        expect(mocks.toastError).toHaveBeenCalledWith('Failed to accept baseline');
      });
    });

    it('calls onClose when all baselines are reviewed via skip', async () => {
      const onClose = vi.fn();
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      ));
      renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={onClose} />);

      // Skip b1 → advance finds b2 (undecided) → goes to b2
      fireEvent.keyDown(window, { key: 'r' });
      await waitFor(() => expect(screen.getByText('b.png')).toBeInTheDocument());

      // Skip b2 → advance: nothing forward, b1 decided → all decided → onClose
      fireEvent.keyDown(window, { key: 'r' });
      await waitFor(() => {
        expect(mocks.toastSuccess).toHaveBeenCalledWith('All baselines reviewed!');
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe('StepTree and TestTree node branches', () => {
    it('renders step node icon branches and allows internal toggle click', async () => {
      render(
        <StepTree
          steps={[
            {
              title: 'parent',
              category: 'group',
              durationMs: 1200,
              steps: [
                { title: 'err', category: 'action', error: { message: 'x' }, steps: [] },
                { title: 'loading', category: 'action', durationMs: undefined, steps: [] },
              ],
            },
          ]}
        />,
      );

      await userEvent.click(document.querySelector('.lucide-chevron-right') as Element);
      const toggle = mocks.treeToggles.get('0-parent');
      expect(toggle).toBeDefined();
      expect(toggle?.mock.calls.length).toBe(1);
      expect(screen.getByText('1.2s')).toBeInTheDocument();
    });

    it('groups tests by worker including Unknown and handles group/test clicks', async () => {
      const onSelect = vi.fn();
      render(
        <TestTree
          groupBy="worker"
          selectedId="t2"
          onSelect={onSelect}
          tests={[
            {
              id: 't1',
              runId: 'r',
              suiteId: null,
              title: 'unknown worker',
              file: 'apps/client/tests/a.spec.ts',
              line: 1,
              column: 1,
              status: 'passed',
              durationMs: 100,
              tags: [],
              annotations: [],
              retryCount: 0,
              expectedStatus: 'passed',
              workerIndex: null,
              stableId: 's1',
              retries: 0,
            },
            {
              id: 't2',
              runId: 'r',
              suiteId: null,
              title: 'worker one',
              file: 'apps/client/tests/b.spec.ts',
              line: 1,
              column: 1,
              status: 'failed',
              durationMs: 0,
              tags: [],
              annotations: [],
              retryCount: 0,
              expectedStatus: 'failed',
              workerIndex: 1,
              stableId: 's2',
              retries: 0,
            },
          ]}
        />,
      );

      expect(screen.getByText('Unknown (1)')).toBeInTheDocument();
      expect(screen.getByText('Worker 1 (1)')).toBeInTheDocument();

      await userEvent.click(screen.getByText('Worker 1 (1)'));
      expect(mocks.treeToggles.get('group-Worker 1')?.mock.calls.length).toBe(1);

      await userEvent.click(screen.getByText('worker one'));
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }));

      const selectedRow = screen.getByText('worker one').closest('div');
      expect(selectedRow?.className).toContain('border-l-border-focus');
    });
  });

  describe('ShortcutsModal native dialog', () => {
    it('uses native dialog element with showModal', () => {
      const onClose = vi.fn();
      render(<ShortcutsModal onClose={onClose} />);
      
      const dialog = document.querySelector('dialog') as HTMLDialogElement | null;
      expect(dialog).toBeInTheDocument();
      
      // Verify the dialog is open (has open attribute from showModal)
      // Note: vitest/jsdom doesn't fully support showModal, but we can check the element exists
      // and has proper accessibility attributes
      expect(dialog?.getAttribute('id')).toBeNull(); // dialog doesn't have an id attribute
      
      // Verify close button exists and works
      const closeButton = screen.getByRole('button', { name: 'Close shortcuts' });
      expect(closeButton).toBeInTheDocument();
      
      fireEvent.click(closeButton);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('SuggestedQueries history branches', () => {
    it('renders history rows with singular/plural result labels and handles selection', async () => {
      const onSelect = vi.fn();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === '/api/nl-query/history?limit=5') {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  id: 1,
                  userQuery: 'last failures',
                  generatedSql: 'select 1',
                  resultCount: 1,
                  userId: null,
                  createdAt: '2026-03-08T00:00:00.000Z',
                },
                {
                  id: 2,
                  userQuery: 'slow tests',
                  generatedSql: 'select 2',
                  resultCount: 2,
                  userId: null,
                  createdAt: '2026-03-08T00:00:00.000Z',
                },
              ]),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<SuggestedQueries onSelect={onSelect} />);

      expect(await screen.findByText('Recent Queries')).toBeInTheDocument();
      expect(screen.getByText('1 result')).toBeInTheDocument();
      expect(screen.getByText('2 results')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /last failures/i }));
      expect(onSelect).toHaveBeenCalledWith('last failures');
    });

    it('keeps static suggestions usable when history endpoint is non-ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: true }), { status: 500 }))),
      );
      const onSelect = vi.fn();
      render(<SuggestedQueries onSelect={onSelect} />);

      const button = await screen.findByRole('button', { name: /Flaky tests this week/i });
      await userEvent.click(button);
      expect(onSelect).toHaveBeenCalledWith('Flaky tests this week');
    });

    it('silently handles network error for history without crashing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
      const onSelect = vi.fn();
      render(<SuggestedQueries onSelect={onSelect} />);
      const button = await screen.findByRole('button', { name: /Flaky tests this week/i });
      expect(button).toBeInTheDocument();
    });
  });

  describe('SlowestTests and PassRateChart formatter branches', () => {
    it('exposes slowest chart axis and tooltip formatter behavior', () => {
      render(
        <SlowestTests
          data={[
            {
              title: 'a very long test title that should truncate',
              file: 'apps/client/tests/very-long.spec.ts',
              avgDurationMs: 3456,
              p95DurationMs: 6789,
            },
          ]}
        />,
      );

      const xAxis = mocks.xAxisProps.at(-1);
      const tooltip = mocks.tooltipProps.at(-1);

      expect(typeof xAxis?.tickFormatter).toBe('function');
      expect((xAxis?.tickFormatter as (v: number) => string)(1500)).toBe('1.5s');

      expect(typeof tooltip?.formatter).toBe('function');
      expect((tooltip?.formatter as (v: number, n: string) => [string, string])(2500, 'avgDurationMs')).toEqual(['2.50s', 'avg']);
      expect((tooltip?.formatter as (v: number, n: string) => [string, string])(2500, 'p95DurationMs')).toEqual(['2.50s', 'p95']);

      expect((tooltip?.labelFormatter as (_: unknown, p: Array<{ payload?: { title?: string } }>) => string)('', [{ payload: { title: 'full title' } }])).toBe('full title');
    });

    it('exposes pass-rate y-axis and tooltip formatter behavior', () => {
      render(
        <PassRateChart
          data={[{ date: '2026-03-08', chromium: 98.123 }]}
          projects={['chromium']}
        />,
      );

      const yAxis = mocks.yAxisProps.at(-1);
      const tooltip = mocks.tooltipProps.at(-1);
      expect((yAxis?.tickFormatter as (v: number) => string)(87)).toBe('87%');
      expect(yAxis?.domain).toEqual([0, 100]);
      expect((tooltip?.formatter as (v: number) => [string])(88.234)).toEqual(['88.2%']);
      expect(screen.getByTestId('area-chromium')).toBeInTheDocument();
    });
  });

  describe('VideoPlayer scrubber + marker seeking', () => {
    it('updates duration/time from media events and seeks from scrubber and markers', async () => {
      const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
      const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

      const { container } = render(
        <VideoPlayer
          path="videos/sample.mp4"
          totalDurationMs={5000}
          steps={[
            { title: 'step one', category: 'test.step', startTime: 1000, steps: [] },
            { title: 'step two', category: 'test.step', startTime: 4000, error: { message: 'x' }, steps: [] },
          ]}
        />,
      );

      const video = container.querySelector('video') as HTMLVideoElement;
      Object.defineProperty(video, 'duration', { value: 12.5, configurable: true });
      Object.defineProperty(video, 'currentTime', { value: 0, writable: true, configurable: true });

      fireEvent(video, new Event('loadedmetadata'));
      Object.defineProperty(video, 'currentTime', { value: 3, writable: true, configurable: true });
      fireEvent(video, new Event('timeupdate'));
      expect(screen.getByText('3.0s / 12.5s')).toBeInTheDocument();

      await userEvent.click(screen.getAllByRole('button')[0]);
      expect(playSpy).toHaveBeenCalledTimes(1);
      fireEvent(video, new Event('ended'));
      await userEvent.click(screen.getAllByRole('button')[0]);
      expect(playSpy).toHaveBeenCalledTimes(2);
      expect(pauseSpy).toHaveBeenCalledTimes(0);

      const scrubber = container.querySelector('.relative.h-2') as HTMLElement;
      vi.spyOn(scrubber, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        width: 200,
        height: 10,
        top: 0,
        left: 0,
        right: 200,
        bottom: 10,
        toJSON: () => ({}),
      });
      fireEvent.click(scrubber, { clientX: 100 });
      expect(video.currentTime).toBeCloseTo(6.25, 2);

      await userEvent.click(container.querySelector('[title="step one"]') as Element);
      expect(video.currentTime).toBeCloseTo(2.5, 2);

      playSpy.mockRestore();
      pauseSpy.mockRestore();
    });
  });

  describe('RunTrigger uncovered options', () => {
    it('sends trace/toggle options and omits empty grep when starting run', async () => {
      mocks.startRun.mockResolvedValue({ runId: 'run-42' });
      const onClose = vi.fn();

      render(<RunTrigger onClose={onClose} />);

      const grepInput = screen.getByPlaceholderText('e.g. @smoke|login');
      fireEvent.change(grepInput, { target: { value: 'login' } });

      await userEvent.selectOptions(screen.getByDisplayValue('On first retry'), 'on');
      await userEvent.click(screen.getByLabelText('Last failed only'));
      await userEvent.click(screen.getByLabelText('Update snapshots'));
      await userEvent.click(screen.getByText('Run Tests ↵'));

      await waitFor(() => {
        expect(mocks.startRun).toHaveBeenCalledWith(
          expect.objectContaining({
            grep: 'login',
            trace: 'on',
            lastFailed: true,
            updateSnapshots: true,
          }),
        );
      });
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/runs/$runId', params: { runId: 'run-42' } });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('IntegrationSettings uncovered sections', () => {
    it('saves Teams, Jira, and GitHub payloads and supports Slack test success', { timeout: 15_000 }, async () => {
      const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === '/api/integrations/config' && (!init || init.method === undefined)) {
          return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
        }
        if (url === '/api/integrations/test/slack' && init?.method === 'POST') {
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }
        if (url === '/api/integrations/config' && init?.method === 'PUT') {
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      });
      vi.stubGlobal('fetch', fetchMock);

      renderWithProviders(<IntegrationSettings />);

      await userEvent.type(await screen.findByPlaceholderText('https://outlook.office.com/webhook/…'), 'https://teams.example/webhook');
      const teamsSection = screen.getByText('Microsoft Teams').closest('div');
      expect(teamsSection).not.toBeNull();
      await userEvent.click(within(teamsSection as HTMLElement).getByRole('button', { name: 'Save' }));

      await userEvent.type(screen.getByPlaceholderText('https://org.atlassian.net'), 'https://jira.example.net');
      await userEvent.type(screen.getByPlaceholderText('email@example.com'), 'qa@example.net');
      await userEvent.type(screen.getByPlaceholderText('API Token'), 'jira-token');
      await userEvent.type(screen.getByPlaceholderText('Project key (e.g. QA)'), 'QA');
      const jiraSection = screen.getByText('Jira').closest('div');
      expect(jiraSection).not.toBeNull();
      await userEvent.click(within(jiraSection as HTMLElement).getByRole('button', { name: 'Save' }));

      await userEvent.type(screen.getByPlaceholderText('ghp_…'), 'ghp_test');
      await userEvent.type(screen.getByPlaceholderText('Owner'), 'acme');
      await userEvent.type(screen.getByPlaceholderText('Repo'), 'dashboard');
      const githubSection = screen.getByText('GitHub').closest('div');
      expect(githubSection).not.toBeNull();
      await userEvent.click(within(githubSection as HTMLElement).getByRole('button', { name: 'Save' }));

      await userEvent.click(screen.getByRole('button', { name: 'Test' }));

      await waitFor(() => {
        const putCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/integrations/config' && c[1]?.method === 'PUT');
        expect(putCalls.length).toBeGreaterThanOrEqual(3);

        const bodies = putCalls.map((c) => JSON.parse(String(c[1]?.body)) as Record<string, unknown>);
        expect(bodies.some((b) => Object.prototype.hasOwnProperty.call(b, 'teams'))).toBe(true);
        expect(bodies.some((b) => Object.prototype.hasOwnProperty.call(b, 'jira'))).toBe(true);
        expect(bodies.some((b) => Object.prototype.hasOwnProperty.call(b, 'github'))).toBe(true);
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Test message sent to Slack');
      });
    });
  });
});
