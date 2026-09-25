import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, render, screen, waitFor, fireEvent, userEvent, act } from '../../../test/test-utils';
import type { CompareRow, Run, TestWithResults } from '../../../lib/types';
import { CIStatusBadge } from '../CIStatusBadge';
import { CompareTable } from '../CompareTable';
import { FailureFingerprints } from '../FailureFingerprints';
import { GateBadge } from '../GateBadge';
import { LiveTerminal } from '../LiveTerminal';
import { RunCard } from '../RunCard';
import { RunComparePicker } from '../RunComparePicker';
import { RunProgress } from '../RunProgress';
import { RunTrigger } from '../RunTrigger';
import { SourceBadge } from '../SourceBadge';

const mocks = vi.hoisted(() => {
  const terminalInstances: Array<Record<string, unknown>> = [];

  return {
    navigate: vi.fn(),
    startRun: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
    toastWarning: vi.fn(),
    useRuns: vi.fn(),
    useRunTests: vi.fn(),
    useRunFingerprints: vi.fn(),
    useCategories: vi.fn(),
    useFingerprintCategories: vi.fn(),
    assignCategoryMutate: vi.fn(),
    terminalInstances,
    runStoreState: {
      terminalOutput: [] as string[],
      clearTerminal: vi.fn(),
    },
  };
});

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_target: unknown, prop: string) => {
      return ({ initial: _initial, animate: _animate, exit: _exit, variants: _variants, whileHover: _whileHover, whileTap: _whileTap, transition: _transition, layout: _layout, layoutId: _layoutId, hidden: _hidden, visible: _visible, ...rest }: Record<string, unknown>) => {
        const validTags = ['div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td', 'form', 'ul', 'nav', 'header', 'footer', 'main', 'aside', 'article', 'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4'];
        const Tag = typeof prop === 'string' && validTags.includes(prop) ? prop : 'div';
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
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string } & Record<string, unknown>) => React.createElement('a', { href: to, ...rest }, children),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ navigate: vi.fn() }),
  useSearch: () => ({}),
  useParams: () => ({}),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function TerminalMock() {
    const instance: Record<string, unknown> = {
      open: vi.fn(),
      write: vi.fn(),
      writeln: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn(),
      onScroll: vi.fn((cb: () => void) => {
        instance.__onScroll = cb;
      }),
      loadAddon: vi.fn(),
      scrollToBottom: vi.fn(),
      clear: vi.fn(),
      element: document.createElement('div'),
    };
    mocks.terminalInstances.push(instance);
    return instance;
  }),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function FitAddonMock() {
    return {
    fit: vi.fn(),
    dispose: vi.fn(),
    };
  }),
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn(function SearchAddonMock() {
    return { dispose: vi.fn() };
  }),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(function WebLinksAddonMock() {
    return { dispose: vi.fn() };
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
    warning: mocks.toastWarning,
  },
  Toaster: () => null,
}));

vi.mock('@/hooks/useRun', () => ({
  useRuns: (...args: unknown[]) => mocks.useRuns(...args),
  useRunTests: (...args: unknown[]) => mocks.useRunTests(...args),
  useRunFingerprints: (...args: unknown[]) => mocks.useRunFingerprints(...args),
  startRun: (...args: unknown[]) => mocks.startRun(...args),
}));

vi.mock('@/hooks/useCategories', () => ({
  useCategories: (...args: unknown[]) => mocks.useCategories(...args),
  useFingerprintCategories: (...args: unknown[]) => mocks.useFingerprintCategories(...args),
  useAssignCategory: () => ({ mutate: mocks.assignCategoryMutate }),
}));

vi.mock('@/store/runStore', () => ({
  useRunStore: (selector: (state: { terminalOutput: string[]; clearTerminal: () => void }) => unknown) => selector(mocks.runStoreState),
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

describe('runs components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.ResizeObserver = class ResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as unknown as typeof ResizeObserver;

    mocks.terminalInstances.length = 0;
    mocks.runStoreState.terminalOutput = [];
    mocks.runStoreState.clearTerminal = vi.fn();
    mocks.useRuns.mockReturnValue({ data: [] });
    mocks.useRunTests.mockReturnValue({ data: [] });
    mocks.useRunFingerprints.mockReturnValue({ data: [], isLoading: false });
    mocks.useCategories.mockReturnValue({ data: [] });
    mocks.useFingerprintCategories.mockReturnValue({ data: [] });

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  describe('CIStatusBadge', () => {
    it('renders nothing when commitSha is missing', () => {
      const { container } = renderWithProviders(<CIStatusBadge />);
      expect(container).toBeEmptyDOMElement();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('renders success badge and opens CI URL on click', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ provider: 'github', status: 'success', url: 'https://ci.example/run/1' }),
          { status: 200 },
        ),
      );
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      renderWithProviders(<CIStatusBadge commitSha="abc123" />);

      const button = await screen.findByRole('button', { name: /CI: Passed/i });
      expect(fetchMock).toHaveBeenCalledWith('/api/ci/status?sha=abc123');
      expect(button).toHaveAttribute('title', 'Open github CI run');

      await userEvent.click(button);
      expect(openSpy).toHaveBeenCalledWith('https://ci.example/run/1', '_blank', 'noopener,noreferrer');
    });

    it('renders disabled button when CI URL is unavailable', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ provider: 'github', status: 'failure', url: null }),
          { status: 200 },
        ),
      );

      renderWithProviders(<CIStatusBadge commitSha="def456" />);

      const button = await screen.findByRole('button', { name: /CI: Failed/i });
      expect(button).toBeDisabled();
      expect(button).not.toHaveAttribute('title');
    });

    it('renders nothing when provider is missing in response', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ provider: null, status: 'success', url: 'https://ci.example/run/2' }),
          { status: 200 },
        ),
      );

      const { container } = renderWithProviders(<CIStatusBadge commitSha="zzz999" />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('CompareTable', () => {
    const rows: CompareRow[] = [
      {
        title: 'should handle checkout',
        file: 'tests/checkout.spec.ts',
        statusA: 'passed',
        statusB: 'failed',
        durationA: 1000,
        durationB: 2000,
        changeType: 'new_failure',
      },
      {
        title: 'should render dashboard',
        file: 'tests/dashboard.spec.ts',
        statusA: 'passed',
        statusB: 'passed',
        durationA: 1200,
        durationB: 1100,
        changeType: 'unchanged',
      },
    ];

    it('renders all rows when changedOnly is false', () => {
      render(<CompareTable rows={rows} changedOnly={false} />);

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('should handle checkout')).toBeInTheDocument();
      expect(screen.getByText('should render dashboard')).toBeInTheDocument();
      expect(screen.getByText('New Failure')).toBeInTheDocument();
    });

    it('filters unchanged rows when changedOnly is true', () => {
      render(<CompareTable rows={rows} changedOnly />);

      expect(screen.getByText('should handle checkout')).toBeInTheDocument();
      expect(screen.queryByText('should render dashboard')).not.toBeInTheDocument();
    });

    it('shows no-differences state when changedOnly has no changed rows', () => {
      render(<CompareTable rows={[rows[1]]} changedOnly />);

      expect(screen.getByText('No differences between these runs.')).toBeInTheDocument();
    });

    it('shows select-runs prompt when not changedOnly and empty rows', () => {
      render(<CompareTable rows={[]} changedOnly={false} />);

      expect(screen.getByText('Select two runs to compare.')).toBeInTheDocument();
    });

 it('has complete ARIA table roles for accessibility', () => {
      render(<CompareTable rows={rows} changedOnly={false} />);

      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();

      // rowgroup on thead and tbody
      const rowgroups = table.querySelectorAll('[role="rowgroup"]');
      expect(rowgroups).toHaveLength(2);

      // columnheader on th elements
      const columnHeaders = table.querySelectorAll('[role="columnheader"]');
      expect(columnHeaders).toHaveLength(6);

      // row on tr elements (1 header + 2 data rows)
      const tableRows = table.querySelectorAll('[role="row"]');
      expect(tableRows).toHaveLength(3);

      // cell on td elements (6 columns × 2 data rows = 12)
      const cells = table.querySelectorAll('[role="cell"]');
      expect(cells).toHaveLength(12);
    });
  });

  describe('FailureFingerprints', () => {
    const tests: TestWithResults[] = [
      {
        id: 'test-1',
        runId: 'run-1',
        suiteId: null,
        title: 'fails login API',
        file: 'tests/auth.spec.ts',
        line: 1,
        column: 1,
        status: 'failed',
        durationMs: 100,
        tags: [],
        annotations: [],
        retryCount: 0,
        expectedStatus: 'passed',
        workerIndex: 0,
        stableId: 'stable-1',
        retries: 0,
        results: [],
      },
      {
        id: 'test-2',
        runId: 'run-1',
        suiteId: null,
        title: 'fails payments API',
        file: 'tests/payments.spec.ts',
        line: 2,
        column: 1,
        status: 'failed',
        durationMs: 110,
        tags: [],
        annotations: [],
        retryCount: 0,
        expectedStatus: 'passed',
        workerIndex: 1,
        stableId: 'stable-2',
        retries: 0,
        results: [],
      },
    ];

    it('renders loading skeleton while fingerprint query is loading', () => {
      mocks.useRunFingerprints.mockReturnValue({ data: undefined, isLoading: true });

      const { container } = render(<FailureFingerprints runId="run-1" tests={tests} />);
      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('renders nothing when there are no fingerprint groups', () => {
      mocks.useRunFingerprints.mockReturnValue({ data: [], isLoading: false });

      const { container } = render(<FailureFingerprints runId="run-1" tests={tests} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders summary with unique errors and affected failures', () => {
      mocks.useRunFingerprints.mockReturnValue({
        data: [
          { fingerprint: 'fp-1', count: 2, errorMessage: 'TypeError: boom', testIds: ['test-1', 'test-2'] },
          { fingerprint: 'fp-2', count: 1, errorMessage: 'TimeoutError: slow page', testIds: ['test-1'] },
        ],
        isLoading: false,
      });

      render(<FailureFingerprints runId="run-1" tests={tests} />);
      expect(screen.getByText('2 unique errors caused 3 failures')).toBeInTheDocument();
    });

    it('expands a fingerprint and calls onSelectTest when test is clicked', async () => {
      const onSelectTest = vi.fn();
      mocks.useRunFingerprints.mockReturnValue({
        data: [
          { fingerprint: 'fp-1', count: 2, errorMessage: 'TypeError: boom', testIds: ['test-1', 'test-2'] },
        ],
        isLoading: false,
      });

      render(<FailureFingerprints runId="run-1" tests={tests} onSelectTest={onSelectTest} />);

      await userEvent.click(screen.getByRole('button', { name: /TypeError: boom/i }));
      const testBtn = screen.getByRole('button', { name: /fails login API/i });
      await userEvent.click(testBtn);

      expect(onSelectTest).toHaveBeenCalledWith('test-1');
    });

    it('assigns selected defect category for a fingerprint', async () => {
      mocks.useRunFingerprints.mockReturnValue({
        data: [{ fingerprint: 'fp-1', count: 2, errorMessage: 'TypeError: boom', testIds: ['test-1'] }],
        isLoading: false,
      });
      mocks.useCategories.mockReturnValue({
        data: [
          { id: 'cat-1', name: 'Network', color: '#f00' },
          { id: 'cat-2', name: 'Database', color: '#0f0' },
        ],
      });
      mocks.useFingerprintCategories.mockReturnValue({
        data: [{ fingerprint: 'fp-1', categoryId: 'cat-1' }],
      });

      render(<FailureFingerprints runId="run-1" tests={tests} />);

      const select = screen.getByRole('combobox', { name: /Defect category/i });
      fireEvent.change(select, { target: { value: 'cat-2' } });

      expect(mocks.assignCategoryMutate).toHaveBeenCalledWith({ fingerprint: 'fp-1', categoryId: 'cat-2' });
    });
  });

  describe('GateBadge', () => {
    it('renders nothing for null and skipped statuses', () => {
      const { container: c1 } = render(<GateBadge gateStatus={null} />);
      const { container: c2 } = render(<GateBadge gateStatus="skipped" />);

      expect(c1).toBeEmptyDOMElement();
      expect(c2).toBeEmptyDOMElement();
    });

    it('renders PASS label by default for passed gate', () => {
      render(<GateBadge gateStatus="passed" />);
      expect(screen.getByText('Gate: PASS')).toBeInTheDocument();
      expect(screen.getByText('Gate: PASS')).toHaveClass('text-[10px]');
    });

    it('renders FAIL label with md sizing classes when requested', () => {
      render(<GateBadge gateStatus="failed" size="md" />);
      const badge = screen.getByText('Gate: FAIL');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('text-xs');
    });
  });

  describe('LiveTerminal', () => {
    it('initializes terminal and loads addons on mount', async () => {
      render(<LiveTerminal />);

      await waitFor(() => expect(mocks.terminalInstances).toHaveLength(1));
      const terminal = mocks.terminalInstances[0];

      expect(terminal.open).toHaveBeenCalledTimes(1);
      expect(terminal.loadAddon).toHaveBeenCalledTimes(3);
      expect(terminal.onScroll).toHaveBeenCalledTimes(1);
    });

    it('writes new output chunks and auto-scrolls to bottom', async () => {
      mocks.runStoreState.terminalOutput = ['line-1\n', 'line-2\n'];
      const { rerender } = render(<LiveTerminal />);

      await waitFor(() => expect(mocks.terminalInstances).toHaveLength(1));
      const terminal = mocks.terminalInstances[0];

      await waitFor(() => expect(terminal.write).toHaveBeenCalledTimes(2));
      expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);

      mocks.runStoreState.terminalOutput = ['line-1\n', 'line-2\n', 'line-3\n'];
      rerender(<LiveTerminal />);

      await waitFor(() => expect(terminal.write).toHaveBeenCalledTimes(3));
    });

    it('copies full terminal output to clipboard', async () => {
      mocks.runStoreState.terminalOutput = ['hello ', 'world'];
      render(<LiveTerminal />);

      await userEvent.click(screen.getByRole('button', { name: /Copy all/i }));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world');
    });

    it('clears xterm state and run store output', async () => {
      render(<LiveTerminal />);
      await waitFor(() => expect(mocks.terminalInstances).toHaveLength(1));

      const terminal = mocks.terminalInstances[0];
      await userEvent.click(screen.getByRole('button', { name: /Clear/i }));

      expect(terminal.clear).toHaveBeenCalledTimes(1);
      expect(mocks.runStoreState.clearTerminal).toHaveBeenCalledTimes(1);
    });

    it('shows jump-to-bottom action when viewport is scrolled up', async () => {
      const { container } = render(<LiveTerminal />);
      await waitFor(() => expect(mocks.terminalInstances).toHaveLength(1));
      const terminal = mocks.terminalInstances[0] as Record<string, unknown>;

      const host = container.querySelector('.flex-1.min-h-0.p-2');
      expect(host).not.toBeNull();

      const viewport = document.createElement('div');
      viewport.className = 'xterm-viewport';
      Object.defineProperty(viewport, 'scrollTop', { value: 0, writable: true });
      Object.defineProperty(viewport, 'clientHeight', { value: 100, writable: true });
      Object.defineProperty(viewport, 'scrollHeight', { value: 300, writable: true });
      host?.appendChild(viewport);

      const onScroll = terminal.__onScroll as (() => void) | undefined;
      expect(onScroll).toBeTypeOf('function');
      await act(async () => {
        onScroll?.();
      });

      const jumpButton = await screen.findByRole('button', { name: /Jump to bottom/i });
      await userEvent.click(jumpButton);

      expect(terminal.scrollToBottom).toHaveBeenCalled();
    });
  });

  describe('RunCard', () => {
    const runFixture: Run = {
      id: 'run-abcdef1234',
      startedAt: '2026-03-08T10:00:00.000Z',
      finishedAt: null,
      status: 'running',
      total: 20,
      passed: 15,
      failed: 3,
      flaky: 2,
      skipped: 0,
      durationMs: 12_500,
      branch: 'main',
      commitSha: 'abc123',
      commitMessage: 'msg',
      triggeredBy: 'ci',
      config: null,
      rawArgs: null,
    };

    it('renders run identity, status details, and run metrics', () => {
      render(<RunCard run={runFixture} />);

      expect(screen.getByRole('link')).toHaveAttribute('href', '/runs/$runId');
      expect(screen.getByText('run-abcd')).toBeInTheDocument();
      expect(screen.getByText('main')).toBeInTheDocument();
      expect(screen.getByText('15 passed')).toBeInTheDocument();
      expect(screen.getByText('3 failed')).toBeInTheDocument();
      expect(screen.getByText('2 flaky')).toBeInTheDocument();
      expect(screen.getByText('12.5s')).toBeInTheDocument();
    });

    it('omits failed and flaky counters when values are zero', () => {
      render(
        <RunCard
          run={{
            ...runFixture,
            failed: 0,
            flaky: 0,
          }}
        />,
      );

      expect(screen.queryByText(/failed$/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/flaky$/i)).not.toBeInTheDocument();
    });

    it('hides branch chip when branch is null', () => {
      render(<RunCard run={{ ...runFixture, branch: null }} />);
      expect(screen.queryByText('main')).not.toBeInTheDocument();
    });

    it('renders relative started time text', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-08T10:01:00.000Z'));

      render(<RunCard run={runFixture} />);
      expect(screen.getByText('1m ago')).toBeInTheDocument();

      vi.useRealTimers();
    });
  });

  describe('RunComparePicker', () => {
    const runA: Run = {
      id: 'run-a-123456',
      startedAt: '2026-03-08T10:00:00.000Z',
      finishedAt: null,
      status: 'passed',
      total: 10,
      passed: 10,
      failed: 0,
      flaky: 0,
      skipped: 0,
      durationMs: 1000,
      branch: 'main',
      commitSha: 'sha-a',
      commitMessage: null,
      triggeredBy: null,
      config: null,
      rawArgs: null,
    };
    const runB: Run = {
      ...runA,
      id: 'run-b-654321',
      branch: 'feature/login',
      status: 'failed',
      commitSha: 'sha-b',
    };

    it('shows placeholder when no run is selected', () => {
      mocks.useRuns.mockReturnValue({ data: [runA, runB] });
      render(<RunComparePicker label="Baseline" selectedRunId={null} onSelect={vi.fn()} />);

      expect(screen.getByText('Select run…')).toBeInTheDocument();
    });

    it('shows selected run short id in trigger button', () => {
      mocks.useRuns.mockReturnValue({ data: [runA, runB] });
      render(<RunComparePicker label="Candidate" selectedRunId={runB.id} onSelect={vi.fn()} />);

      expect(screen.getByText('run-b-65')).toBeInTheDocument();
    });

    it('filters available runs using search input', async () => {
      mocks.useRuns.mockReturnValue({ data: [runA, runB] });
      render(<RunComparePicker label="Baseline" selectedRunId={null} onSelect={vi.fn()} />);

      await userEvent.click(screen.getByRole('button', { name: /Baseline:/i }));
      const search = screen.getByPlaceholderText('Search runs…');
      await userEvent.type(search, 'feature');

      // Filtering is debounced — wait for it to apply
      await waitFor(() => {
        expect(screen.getByText('run-b-65')).toBeInTheDocument();
        expect(screen.queryByText('run-a-12')).not.toBeInTheDocument();
      });
    });

    it('calls onSelect and closes popover when a run is picked', async () => {
      const onSelect = vi.fn();
      mocks.useRuns.mockReturnValue({ data: [runA, runB] });

      render(<RunComparePicker label="Baseline" selectedRunId={null} onSelect={onSelect} />);
      await userEvent.click(screen.getByRole('button', { name: /Baseline:/i }));
      await userEvent.click(screen.getByRole('button', { name: /run-b-65/i }));

      expect(onSelect).toHaveBeenCalledWith(runB.id);
      expect(screen.queryByPlaceholderText('Search runs…')).not.toBeInTheDocument();
    });
  });

  describe('RunProgress', () => {
    it('exposes ARIA progress semantics with computed progress value', () => {
      render(<RunProgress passed={7} failed={1} total={10} />);

      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '80');
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '100');
    });

    it('uses running color when there are no failures', () => {
      const { container } = render(<RunProgress passed={5} failed={0} total={10} />);
      const fill = container.querySelector('.h-full');
      expect(fill).toHaveStyle({ background: 'var(--color-running)' });
    });

    it('uses flaky and fail colors as failure ratio increases', () => {
      const { container, rerender } = render(<RunProgress passed={97} failed={3} total={100} />);
      let fill = container.querySelector('.h-full');
      expect(fill).toHaveStyle({ background: 'var(--color-flaky)' });

      rerender(<RunProgress passed={80} failed={20} total={100} />);
      fill = container.querySelector('.h-full');
      expect(fill).toHaveStyle({ background: 'var(--color-fail)' });
    });
  });

  describe('RunTrigger', () => {
    it('renders dialog controls and default field values', () => {
      render(<RunTrigger onClose={vi.fn()} />);

      expect(screen.getByRole('dialog', { name: /New Run/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'On first retry' })).toBeInTheDocument();
      expect(screen.getByText('Parallel workers: 4')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Run Tests/i })).toBeInTheDocument();
    });

    it('closes when Escape key is pressed', () => {
      const onClose = vi.fn();
      render(<RunTrigger onClose={onClose} />);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('updates retries, workers and checkbox options through user input', async () => {
      render(<RunTrigger onClose={vi.fn()} />);

      const workers = screen.getByRole('slider') as HTMLInputElement;
      fireEvent.change(workers, { target: { value: '8' } });
      expect(screen.getByText('Parallel workers: 8')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: '2 retries' }));
      expect(screen.getByRole('button', { name: '2 retries' })).toHaveAttribute('aria-pressed', 'true');

      const headed = screen.getByLabelText('Headed') as HTMLInputElement;
      const lastFailed = screen.getByLabelText('Last failed only') as HTMLInputElement;

      await userEvent.click(headed);
      await userEvent.click(lastFailed);

      expect(headed.checked).toBe(true);
      expect(lastFailed.checked).toBe(true);
    });

    it('starts run successfully, notifies user, navigates and closes', async () => {
      const onClose = vi.fn();
      mocks.startRun.mockResolvedValueOnce({ runId: 'run-999' });

      render(<RunTrigger onClose={onClose} />);
      await userEvent.click(screen.getByRole('button', { name: /Run Tests/i }));

      await waitFor(() => expect(mocks.startRun).toHaveBeenCalledTimes(1));
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Run started');
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/runs/$runId', params: { runId: 'run-999' } });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows error toast when run start fails', async () => {
      mocks.startRun.mockRejectedValueOnce(new Error('network down'));

      render(<RunTrigger onClose={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: /Run Tests/i }));

      await waitFor(() => {
        expect(mocks.toastError).toHaveBeenCalledWith('Failed to start run: network down');
      });
    });
  });

  describe('SourceBadge', () => {
    it('renders BLOB badge for blob source', () => {
      render(<SourceBadge source="blob" />);
      expect(screen.getByText('BLOB')).toBeInTheDocument();
    });

    it('renders nothing for live or null source', () => {
      const { container: c1 } = render(<SourceBadge source="live" />);
      const { container: c2 } = render(<SourceBadge source={null} />);

      expect(c1).toBeEmptyDOMElement();
      expect(c2).toBeEmptyDOMElement();
    });
  });

  describe('CompareTable — all changeType variants', () => {
    it('renders all changeType variants with correct badges and border classes', () => {
      const allVariants: CompareRow[] = [
        { title: 'test-fixed', file: 'a.spec.ts', statusA: 'failed', statusB: 'passed', durationA: 500, durationB: 400, changeType: 'fixed' },
        { title: 'test-regression', file: 'b.spec.ts', statusA: 'passed', statusB: 'failed', durationA: 600, durationB: 700, changeType: 'regression' },
        { title: 'test-added', file: 'c.spec.ts', statusA: null, statusB: 'passed', durationA: null, durationB: 300, changeType: 'added' },
        { title: 'test-removed', file: 'd.spec.ts', statusA: 'passed', statusB: null, durationA: 400, durationB: null, changeType: 'removed' },
        { title: 'test-unchanged', file: 'e.spec.ts', statusA: 'passed', statusB: 'passed', durationA: 100, durationB: 110, changeType: 'unchanged' },
      ];

      render(<CompareTable rows={allVariants} changedOnly={false} />);

      expect(screen.getByText('Fixed')).not.toBeNull();
      expect(screen.getByText('Regression')).not.toBeNull();
      expect(screen.getByText('Added')).not.toBeNull();
      expect(screen.getByText('Removed')).not.toBeNull();
      // unchanged has no badge text (shows —)
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    });

    it('renders em-dash for null statusA/statusB', () => {
      const row: CompareRow[] = [
        { title: 'null-status', file: 'f.spec.ts', statusA: null, statusB: null, durationA: null, durationB: null, changeType: 'new_failure' },
      ];
      render(<CompareTable rows={row} changedOnly={false} />);
      // null status shows —
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    });
  });
});

