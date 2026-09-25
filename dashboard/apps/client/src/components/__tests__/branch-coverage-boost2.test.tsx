/**
 * branch-coverage-boost2.test.tsx
 *
 * Second round of targeted branch coverage — fills the remaining gaps to push
 * overall branch coverage from ~84% to ≥90%.
 *
 * Files targeted (by source path under apps/client/src/):
 *   - routes/runs/compare.tsx           (regressions, plural labels, loading, passRateA null)
 *   - components/ui/Tooltip.tsx         (side='bottom', open/hover state)
 *   - components/layout/Breadcrumbs.tsx (resolveLabel null, crumbs.length===0)
 *   - components/tests/StabilityBadge.tsx (null/dash early return, unknown grade fallback)
 *   - components/runs/CIStatusBadge.tsx (no commitSha, no provider, no url, unknown status)
 *   - components/tests/AiExplainButton.tsx (aiEnabled===false, error state)
 *   - routes/tests/quarantine.tsx       (handleSubmit guard, remove mutation)
 *   - components/tests/SelectedTests.tsx (branches in action handlers)
 *   - components/shared/ShortcutsModal.tsx (null dialog guard in useEffect)
 *   - components/tests/TestActionBar.tsx (branches)
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  renderWithProviders,
  screen,
  waitFor,
} from '../../test/test-utils';

// ─── Global mocks ──────────────────────────────────────────────────────────────

vi.mock('framer-motion', () => {
  const ReactMod = require('react');
  return {
    motion: new Proxy({} as Record<string, unknown>, {
      get: (_target: unknown, prop: string) => {
        return ({
          initial: _i,
          animate: _a,
          exit: _ex,
          variants: _v,
          whileHover: _wh,
          whileTap: _wt,
          transition: _tr,
          layout: _l,
          layoutId: _li,
          ...rest
        }: Record<string, unknown>) => {
          const tags = ['div', 'span', 'button', 'p', 'li', 'ul', 'nav', 'a', 'section'];
          const Tag = typeof prop === 'string' && tags.includes(prop) ? prop : 'div';
          return ReactMod.createElement(Tag, rest);
        };
      },
    }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement(React.Fragment, null, children),
    useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
    useMotionValue: (init: number) => ({ get: () => init, set: vi.fn() }),
    useTransform: (_v: unknown, _i: unknown, out: number[]) => ({
      get: () => out?.[0] ?? 0,
    }),
    useSpring: (v: unknown) => v,
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    promise: vi.fn(),
  },
  Toaster: () => React.createElement('div', { 'data-testid': 'toaster' }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// CompareRunsPage — uncovered branches in compare.tsx
// ─────────────────────────────────────────────────────────────────────────────

const compareMocks = vi.hoisted(() => ({
  useRunCompare: vi.fn(),
  useRun: vi.fn(),
  navigate: vi.fn(),
  routeSearch: { a: undefined as string | undefined, b: undefined as string | undefined, changedOnly: false },
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: Record<string, unknown>) => ({
    ...opts,
    useSearch: () => compareMocks.routeSearch,
    useNavigate: () => compareMocks.navigate,
    useParams: () => ({}),
    useRouter: () => ({ navigate: compareMocks.navigate }),
  }),
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string } & Record<string, unknown>) =>
    React.createElement('a', { href: to, ...rest }, children),
  useMatches: () => [],
  useNavigate: () => compareMocks.navigate,
  useRouter: () => ({ navigate: compareMocks.navigate }),
  useSearch: () => ({}),
  useParams: () => ({}),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let result = (opts?.defaultValue as string | undefined) ?? key;
      if (opts) {
        Object.entries(opts).forEach(([k, v]) => {
          if (k !== 'defaultValue') {
            result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
          }
        });
      }
      return result;
    },
    i18n: {},
  }),
}));

vi.mock('@/hooks/useRun', () => ({
  useRun: (...args: unknown[]) => compareMocks.useRun(...args),
  useRunCompare: (...args: unknown[]) => compareMocks.useRunCompare(...args),
  useRuns: () => ({ data: [] }),
  useRunTests: () => ({ data: [] }),
  useTest: () => ({ data: undefined }),
  abortRun: vi.fn(),
}));

vi.mock('@/components/shared/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/runs/RunComparePicker', () => ({
  RunComparePicker: ({ label, onSelect }: { label: string; selectedRunId: string | null; onSelect: (id: string | null) => void }) =>
    React.createElement(
      'button',
      { type: 'button', 'aria-label': `select-${label}`, onClick: () => onSelect('run-x') },
      label,
    ),
}));

vi.mock('@/components/runs/CompareTable', () => ({
  CompareTable: ({ rows, changedOnly }: { rows: Array<{ title: string }>; changedOnly: boolean }) =>
    React.createElement('div', null,
      React.createElement('div', null, `compare-rows:${rows.length}`),
      React.createElement('div', null, `changed-only:${changedOnly}`),
    ),
}));

import { CompareRunsPage } from '../../routes/runs/compare';

describe('CompareRunsPage — additional branches', () => {
  beforeEach(() => {
    compareMocks.useRun.mockReturnValue({ data: undefined });
    compareMocks.useRunCompare.mockReturnValue({ data: [], isLoading: false });
    compareMocks.routeSearch = { a: undefined, b: undefined, changedOnly: false };
  });

  it('shows regressions badge (line 129-133)', () => {
    compareMocks.routeSearch = { a: 'run-a', b: 'run-b', changedOnly: false };
    compareMocks.useRunCompare.mockReturnValue({
      data: [
        { title: 't1', file: 'a.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'regression' },
      ],
      isLoading: false,
    });
    compareMocks.useRun
      .mockReturnValueOnce({ data: { total: 10, passed: 8 } })
      .mockReturnValueOnce({ data: { total: 10, passed: 7 } });

    renderWithProviders(<CompareRunsPage />);
    expect(screen.getByText(/1 regression/)).toBeInTheDocument();
  });

  it('shows plural regressions (line 132: count !== 1)', () => {
    compareMocks.routeSearch = { a: 'run-a', b: 'run-b', changedOnly: false };
    compareMocks.useRunCompare.mockReturnValue({
      data: [
        { title: 't1', file: 'a.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'regression' },
        { title: 't2', file: 'b.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'regression' },
      ],
      isLoading: false,
    });
    compareMocks.useRun
      .mockReturnValueOnce({ data: { total: 10, passed: 8 } })
      .mockReturnValueOnce({ data: { total: 10, passed: 6 } });

    renderWithProviders(<CompareRunsPage />);
    expect(screen.getByText(/2 regressions/)).toBeInTheDocument();
  });

  it('shows plural new failures label (line 120: count !== 1)', () => {
    compareMocks.routeSearch = { a: 'run-a', b: 'run-b', changedOnly: false };
    compareMocks.useRunCompare.mockReturnValue({
      data: [
        { title: 't1', file: 'a.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'new_failure' },
        { title: 't2', file: 'b.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'new_failure' },
      ],
      isLoading: false,
    });
    compareMocks.useRun
      .mockReturnValueOnce({ data: { total: 10, passed: 8 } })
      .mockReturnValueOnce({ data: { total: 10, passed: 6 } });

    renderWithProviders(<CompareRunsPage />);
    expect(screen.getByText(/2 new failures/)).toBeInTheDocument();
  });

  it('shows loading state when isLoading && runIdA && runIdB (line 140)', () => {
    compareMocks.routeSearch = { a: 'run-a', b: 'run-b', changedOnly: false };
    compareMocks.useRunCompare.mockReturnValue({ data: [], isLoading: true });
    compareMocks.useRun.mockReturnValue({ data: undefined });

    renderWithProviders(<CompareRunsPage />);
    expect(screen.getByText(/Loading comparison/i)).toBeInTheDocument();
  });

  it('hides pass-rate when runA.total === 0 (passRateA null, lines 57-58)', () => {
    compareMocks.routeSearch = { a: 'run-a', b: 'run-b', changedOnly: false };
    compareMocks.useRunCompare.mockReturnValue({
      data: [
        { title: 't1', file: 'a.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'new_failure' },
      ],
      isLoading: false,
    });
    // total=0 → passRateA = null (no division)
    compareMocks.useRun
      .mockReturnValueOnce({ data: { total: 0, passed: 0 } })
      .mockReturnValueOnce({ data: { total: 0, passed: 0 } });

    renderWithProviders(<CompareRunsPage />);
    // Pass rate span should NOT appear when passRateA is null
    expect(screen.queryByText(/Pass rate:/)).not.toBeInTheDocument();
  });

  it('hides pass-rate when runA/runB data is undefined (passRateA null)', () => {
    compareMocks.routeSearch = { a: 'run-a', b: 'run-b', changedOnly: false };
    compareMocks.useRunCompare.mockReturnValue({
      data: [
        { title: 't1', file: 'a.ts', statusA: 'passed', statusB: 'failed', durationA: 1, durationB: 2, changeType: 'new_failure' },
      ],
      isLoading: false,
    });
    compareMocks.useRun.mockReturnValue({ data: undefined });

    renderWithProviders(<CompareRunsPage />);
    expect(screen.queryByText(/Pass rate:/)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip — side='bottom' branch
// ─────────────────────────────────────────────────────────────────────────────

import { Tooltip } from '../ui/Tooltip';

describe('Tooltip branches', () => {
  it('renders tooltip at top (default) on mouse enter', async () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Top tip" side="top">
        <button type="button">hover me</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole('button').parentElement!);
    await act(() => { vi.runAllTimers(); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders tooltip at bottom on mouse enter when side=bottom', async () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Bottom tip" side="bottom">
        <button type="button">hover me bottom</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole('button').parentElement!);
    await act(() => { vi.runAllTimers(); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Bottom tip');
    vi.useRealTimers();
  });

  it('hides tooltip on mouse leave', async () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Tip">
        <button type="button">btn</button>
      </Tooltip>,
    );
    const wrapper = screen.getByRole('button').parentElement!;
    fireEvent.mouseEnter(wrapper);
    await act(() => { vi.runAllTimers(); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('shows tooltip on focus and hides on blur', async () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Focus tip">
        <button type="button">focus me</button>
      </Tooltip>,
    );
    const wrapper = screen.getByRole('button').parentElement!;
    fireEvent.focus(wrapper);
    await act(() => { vi.runAllTimers(); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.blur(wrapper);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('does not show aria-describedby when closed', () => {
    render(
      <Tooltip content="Hidden">
        <button type="button">no hover</button>
      </Tooltip>,
    );
    const wrapper = screen.getByRole('button').parentElement!;
    expect(wrapper).not.toHaveAttribute('aria-describedby');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// StabilityBadge — null early return and unknown grade fallback
// ─────────────────────────────────────────────────────────────────────────────

import { StabilityBadge } from '../tests/StabilityBadge';

describe('StabilityBadge branches', () => {
  it('returns null when grade is empty string', () => {
    const { container } = render(<StabilityBadge grade="" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when grade is "—"', () => {
    const { container } = render(<StabilityBadge grade="—" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders with known grade A+', () => {
    render(<StabilityBadge grade="A+" />);
    expect(screen.getByText('A+')).toBeInTheDocument();
  });

  it('renders with known grade B', () => {
    render(<StabilityBadge grade="B" />);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('renders with unknown grade using fallback colors (line 32-33)', () => {
    render(<StabilityBadge grade="X" />);
    const badge = screen.getByText('X');
    expect(badge).toBeInTheDocument();
    // Unknown grade uses fallback color
    expect(badge).toHaveStyle({ color: 'var(--color-text-tertiary)' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CIStatusBadge — null returns and unknown status
// ─────────────────────────────────────────────────────────────────────────────

import { CIStatusBadge } from '../runs/CIStatusBadge';

describe('CIStatusBadge branches', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns null when no commitSha (enabled=false)', () => {
    const { container } = renderWithProviders(<CIStatusBadge commitSha={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when loading (no data yet)', () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ provider: 'github', status: 'success', url: 'http://ci.test' }), {
        status: 200,
      }),
    );
    const { container } = renderWithProviders(<CIStatusBadge commitSha="abc123" />);
    // While loading (before fetch resolves) → returns null
    expect(container.firstChild).toBeNull();
  });

  it('renders success badge with url when data resolves', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ provider: 'github', status: 'success', url: 'http://ci.example.com' }), {
        status: 200,
      }),
    );
    renderWithProviders(<CIStatusBadge commitSha="deadbeef" />);
    await waitFor(() => {
      expect(screen.getByText('CI: Passed')).toBeInTheDocument();
    });
    // Has url → button is clickable and shows SVG icon
    const btn = screen.getByRole('button');
    expect(btn).not.toBeDisabled();
  });

  it('renders badge with no url → button disabled', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ provider: 'github', status: 'failure', url: null }), {
        status: 200,
      }),
    );
    renderWithProviders(<CIStatusBadge commitSha="deadbeef2" />);
    await waitFor(() => {
      expect(screen.getByText('CI: Failed')).toBeInTheDocument();
    });
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('uses DEFAULT_STYLE for unknown status (line 71)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ provider: 'github', status: 'unknown_status', url: null }), {
        status: 200,
      }),
    );
    renderWithProviders(<CIStatusBadge commitSha="abc999" />);
    await waitFor(() => {
      expect(screen.getByText('CI: Unknown')).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AiExplainButton — aiEnabled===false early return, error state
// ─────────────────────────────────────────────────────────────────────────────

import { AiExplainButton } from '../tests/AiExplainButton';
import { useFeatureStore } from '@/store/featureStore';

describe('AiExplainButton branches', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns null when aiEnabled is false (line 50)', () => {
    useFeatureStore.setState({ flags: { 'ai-explain': false } as Record<string, boolean> });
    const { container } = renderWithProviders(
      <AiExplainButton error="Some error" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the Explain button when aiEnabled is true', () => {
    useFeatureStore.setState({ flags: { 'ai-explain': true } as Record<string, boolean> });
    renderWithProviders(<AiExplainButton error="test error" />);
    expect(screen.getByText('Explain')).toBeInTheDocument();
  });

  it('shows error message when mutation fails (line 123-131)', async () => {
    useFeatureStore.setState({ flags: { 'ai-explain': true } as Record<string, boolean> });
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'AI service unavailable' }), { status: 500 }),
    );

    renderWithProviders(<AiExplainButton error="test error" stack="stack trace" />);
    fireEvent.click(screen.getByText('Explain'));

    await waitFor(() => {
      expect(screen.getByText(/AI service unavailable/i)).toBeInTheDocument();
    });
  });

  it('shows result card on successful explain (lines 135+)', async () => {
    useFeatureStore.setState({ flags: { 'ai-explain': true } as Record<string, boolean> });
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ summary: 'Element not found', suggestion: 'Check selector', confidence: 0.92 }),
        { status: 200 },
      ),
    );

    renderWithProviders(<AiExplainButton error="test error" />);
    fireEvent.click(screen.getByText('Explain'));

    await waitFor(() => {
      expect(screen.getByText('Element not found')).toBeInTheDocument();
      expect(screen.getByText('Check selector')).toBeInTheDocument();
      expect(screen.getByText('92% confidence')).toBeInTheDocument();
    });
  });
});


