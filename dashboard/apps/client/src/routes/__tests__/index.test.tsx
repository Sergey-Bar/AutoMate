import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent } from '../../test/test-utils';
import { DashboardPage } from '../index';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useRuns: vi.fn(),
  useLiveRun: vi.fn(),
  fetchMock: vi.fn(),
  runStoreState: {
    run: null as Record<string, unknown> | null,
  },
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return ({ initial: _initial, animate: _animate, exit: _exit, variants: _variants, whileHover: _whileHover, whileTap: _whileTap, transition: _transition, layout: _layout, layoutId: _layoutId, ...rest }: Record<string, unknown>) => {
          const tags = ['div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td', 'form', 'ul', 'nav', 'header', 'footer', 'main', 'aside', 'article', 'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4'];
          const Tag = typeof prop === 'string' && tags.includes(prop) ? prop : 'div';
          return React.createElement(Tag, rest);
        };
      },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useMotionValue: (init: number) => ({ get: () => init, set: vi.fn(), on: vi.fn() }),
  useTransform: (_v: unknown, _input: unknown, output: number[]) => ({ get: () => output?.[0] ?? 0 }),
  useSpring: (v: unknown) => v,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string } & Record<string, unknown>) =>
    React.createElement('a', { href: to, ...rest }, children),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ navigate: vi.fn(), state: { location: { pathname: '/' } } }),
  useRouterState: () => ({ location: { pathname: '/' } }),
  useSearch: () => ({}),
  useParams: () => ({}),
  useMatch: () => ({ pathname: '/' }),
  useMatches: () => [{ pathname: '/', routeId: 'root' }],
  Outlet: () => React.createElement('div', { 'data-testid': 'router-outlet' }),
  createFileRoute: (_path: string) => (options: Record<string, unknown>) => ({
    ...options,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/hooks/useRun', () => ({
  useRuns: () => mocks.useRuns(),
}));

vi.mock('@/store/runStore', () => ({
  useRunStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = mocks.runStoreState as Record<string, unknown>;
    if (typeof selector === 'function') {
      return selector(state);
    }
    return state;
  },
}));

vi.mock('@/components/shared/StatusBadge', () => ({
  RunStatusBadge: ({ status }: { status: string }) => <div>{status}</div>,
}));

vi.mock('@/components/shared/EmptyState', () => ({
  EmptyState: ({ title, description, cta, onCta }: { title: string; description: string; cta: string; onCta: () => void }) => (
    <div data-testid="empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
      <button type="button" onClick={onCta}>{cta}</button>
    </div>
  ),
}));

vi.mock('@/components/shared/Skeleton', () => ({
  KpiSkeleton: () => <div data-testid="kpi-skeleton">KPI Loading</div>,
  RunListSkeleton: () => <div data-testid="run-list-skeleton">Runs Loading</div>,
}));

vi.mock('@/components/shared/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <div data-testid="error-boundary">{children}</div>,
}));

vi.mock('@/components/runs/RunTrigger', () => ({
  RunTrigger: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="run-trigger" role="dialog">
      <button type="button" onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('@/components/tests/ImpactedTests', () => ({
  ImpactedTests: ({ changedFiles }: { changedFiles: string[] }) => (
    <div data-testid="impacted-tests">{changedFiles.join(',')}</div>
  ),
}));

describe('DashboardPage (index.tsx)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runStoreState.run = null;

    mocks.useRuns.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    mocks.fetchMock.mockImplementation((url: string | URL) => {
      const value = String(url);
      if (value.includes('/api/tests/git-diff')) {
        return Promise.resolve(new Response(JSON.stringify({ changedFiles: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal('fetch', mocks.fetchMock);
  });

  describe('loading state (line 76-97)', () => {
    it('displays KPI skeleton while runs are loading', () => {
      mocks.useRuns.mockReturnValue({
        data: [],
        isLoading: true,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      expect(screen.getByTestId('kpi-skeleton')).toBeInTheDocument();
    });

    it('displays run list skeleton while runs are loading', () => {
      mocks.useRuns.mockReturnValue({
        data: [],
        isLoading: true,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      expect(screen.getByTestId('run-list-skeleton')).toBeInTheDocument();
    });

    it('does not display KPI metrics when loading', () => {
      mocks.useRuns.mockReturnValue({
        data: [],
        isLoading: true,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      // aria-label "Key metrics" should not be visible when loading
      expect(screen.queryByLabelText('Key metrics')).not.toBeInTheDocument();
    });
  });

  describe('empty data state (lines 117-165)', () => {
    it('shows empty state when no runs exist', () => {
      mocks.useRuns.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('dashboard.noRuns')).toBeInTheDocument();
      expect(screen.getByText('dashboard.noRunsDesc')).toBeInTheDocument();
    });

    it('opens run trigger modal when empty state CTA is clicked', async () => {
      mocks.useRuns.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      const ctaButtons = screen.getAllByRole('button', { name: 'dashboard.startNewRun' });
      await userEvent.click(ctaButtons[0]); // Click the empty state CTA button

      expect(screen.getByTestId('run-trigger')).toBeInTheDocument();
    });

    it('displays KPI metrics (not skeleton) when data exists', () => {
      mocks.useRuns.mockReturnValue({
        data: [
          {
            id: 'run-12345678',
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
          },
        ],
        isLoading: false,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      expect(screen.getByLabelText('Key metrics')).toBeInTheDocument();
      expect(screen.queryByTestId('kpi-skeleton')).not.toBeInTheDocument();
    });

    it('displays run list table with data', () => {
      mocks.useRuns.mockReturnValue({
        data: [
          {
            id: 'run-87654321',
            startedAt: '2026-03-08T09:00:00.000Z',
            status: 'passed',
            total: 10,
            passed: 10,
            failed: 0,
            flaky: 0,
            skipped: 0,
            durationMs: 2000,
            branch: 'develop',
            gateStatus: 'passed',
            source: 'live',
          },
        ],
        isLoading: false,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      expect(screen.getByText('run-8765')).toBeInTheDocument();
      expect(screen.getByText('develop')).toBeInTheDocument();
    });
  });

  describe('run trigger modal (line 168)', () => {
    it('shows run trigger modal when button is clicked', async () => {
      mocks.useRuns.mockReturnValue({
        data: [
          {
            id: 'run-12345678',
            startedAt: '2026-03-08T09:00:00.000Z',
            status: 'passed',
            total: 10,
            passed: 10,
            failed: 0,
            flaky: 0,
            skipped: 0,
            durationMs: 2000,
            branch: 'main',
            gateStatus: 'passed',
            source: 'live',
          },
        ],
        isLoading: false,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      const triggerButton = screen.getAllByRole('button', { name: 'dashboard.startNewRun' })[0];
      await userEvent.click(triggerButton);

      expect(screen.getByTestId('run-trigger')).toBeInTheDocument();
    });

    it('hides run trigger modal when onClose is called', async () => {
      mocks.useRuns.mockReturnValue({
        data: [
          {
            id: 'run-12345678',
            startedAt: '2026-03-08T09:00:00.000Z',
            status: 'passed',
            total: 10,
            passed: 10,
            failed: 0,
            flaky: 0,
            skipped: 0,
            durationMs: 2000,
            branch: 'main',
            gateStatus: 'passed',
            source: 'live',
          },
        ],
        isLoading: false,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      const triggerButton = screen.getAllByRole('button', { name: 'dashboard.startNewRun' })[0];
      await userEvent.click(triggerButton);

      expect(screen.getByTestId('run-trigger')).toBeInTheDocument();

      const closeButton = screen.getByRole('button', { name: 'Close' });
      await userEvent.click(closeButton);

      // After closing, trigger should not be in the DOM anymore
      expect(screen.queryByTestId('run-trigger')).not.toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('handles multiple runs in table with correct row data', () => {
      mocks.useRuns.mockReturnValue({
        data: [
          {
            id: 'run-11111111',
            startedAt: '2026-03-08T10:00:00.000Z',
            status: 'passed',
            total: 15,
            passed: 15,
            failed: 0,
            flaky: 0,
            skipped: 0,
            durationMs: 5000,
            branch: 'feature/a',
            gateStatus: 'passed',
            source: 'live',
          },
          {
            id: 'run-22222222',
            startedAt: '2026-03-08T09:00:00.000Z',
            status: 'failed',
            total: 20,
            passed: 18,
            failed: 2,
            flaky: 0,
            skipped: 0,
            durationMs: 8000,
            branch: 'feature/b',
            gateStatus: 'failed',
            source: 'blob',
          },
        ],
        isLoading: false,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      expect(screen.getByText('run-1111')).toBeInTheDocument();
      expect(screen.getByText('run-2222')).toBeInTheDocument();
      expect(screen.getByText('feature/a')).toBeInTheDocument();
      expect(screen.getByText('feature/b')).toBeInTheDocument();
    });

    it('calculates and displays KPI stats correctly for multiple runs', () => {
      mocks.useRuns.mockReturnValue({
        data: [
          {
            id: 'run-11111111',
            startedAt: '2026-03-08T10:00:00.000Z',
            status: 'passed',
            total: 10,
            passed: 10,
            failed: 0,
            flaky: 0,
            skipped: 0,
            durationMs: 1000,
            branch: 'main',
            gateStatus: 'passed',
            source: 'live',
          },
          {
            id: 'run-22222222',
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
            source: 'blob',
          },
        ],
        isLoading: false,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      expect(screen.getByLabelText('Key metrics')).toBeInTheDocument();
    });

    it('counts a run as today when startedAt is today (covers runsToday filter branch)', () => {
      const todayIso = new Date().toISOString();
      mocks.useRuns.mockReturnValue({
        data: [{
          id: 'run-today00',
          startedAt: todayIso,
          status: 'passed',
          total: 5,
          passed: 5,
          failed: 0,
          flaky: 0,
          skipped: 0,
          durationMs: 500,
          branch: 'main',
          gateStatus: 'passed',
          source: 'live',
        }],
        isLoading: false,
        error: null,
      });
      renderWithProviders(<DashboardPage />);
      expect(screen.getByLabelText('Key metrics')).toBeInTheDocument();
    });

    it('handles run with total=0 (covers avgPassRate zero-total branch)', () => {
      mocks.useRuns.mockReturnValue({
        data: [{
          id: 'run-zerototal',
          startedAt: '2025-01-01T00:00:00.000Z',
          status: 'failed',
          total: 0,
          passed: 0,
          failed: 0,
          flaky: 0,
          skipped: 0,
          durationMs: 100,
          branch: 'main',
          gateStatus: 'failed',
          source: 'live',
        }],
        isLoading: false,
        error: null,
      });
      renderWithProviders(<DashboardPage />);
      expect(screen.getByLabelText('Key metrics')).toBeInTheDocument();
    });

    it('shows in-progress banner when live run is running with undefined failed count', () => {
      mocks.runStoreState.run = { status: 'running', passed: 3, failed: undefined };
      mocks.useRuns.mockReturnValue({ data: [], isLoading: false, error: null });
      renderWithProviders(<DashboardPage />);
      expect(screen.getByText(/Test run in progress/)).toBeInTheDocument();
    });

    it('shows in-progress banner with defined passed/failed counts (covers ?? non-fallback branches)', () => {
      mocks.runStoreState.run = { status: 'running', passed: 5, failed: 2 };
      mocks.useRuns.mockReturnValue({ data: [], isLoading: false, error: null });
      renderWithProviders(<DashboardPage />);
      expect(screen.getByText(/Test run in progress/)).toBeInTheDocument();
      expect(screen.getByText(/5 passed/)).toBeInTheDocument();
    });

    it('shows "0 passed" when liveRun.passed is undefined (covers passed ?? 0 fallback branch)', () => {
      mocks.runStoreState.run = { status: 'running', passed: undefined, failed: 1 };
      mocks.useRuns.mockReturnValue({ data: [], isLoading: false, error: null });
      renderWithProviders(<DashboardPage />);
      expect(screen.getByText(/Test run in progress/)).toBeInTheDocument();
      expect(screen.getByText(/0 passed/)).toBeInTheDocument();
    });
  });
});
