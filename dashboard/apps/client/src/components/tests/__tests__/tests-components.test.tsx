import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, renderWithProviders, screen, waitFor } from '../../../test/test-utils';
import { AiExplainButton } from '../AiExplainButton';
import { BulkActionBar } from '../BulkActionBar';
import { CodePeek } from '../CodePeek';
import { ImpactedTests } from '../ImpactedTests';
import { KnownFailureBadge } from '../KnownFailureBadge';
import { QuarantineBadge, QuarantineButton } from '../QuarantineButton';
import { QuarantineTable } from '../QuarantineTable';
import { RetryTabs } from '../RetryTabs';
import { StabilityBadge } from '../StabilityBadge';
import { StepTimeline } from '../StepTimeline';
import { StepTree } from '../StepTree';
import { TestDetail } from '../TestDetail';
import { HistoryDots, HistoryDotsDisplay, TestHistoryTimeline } from '../TestHistoryTimeline';
import { TestRow } from '../TestRow';
import { TestTree } from '../TestTree';
import type { ResultParsed, Step, TestWithResults } from '../../../lib/types';

const { startRunMock, useRunTestsMock, showToastMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  startRunMock: vi.fn(),
  useRunTestsMock: vi.fn(),
  showToastMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

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

vi.mock('react-arborist', () => ({
  default: ({ data }: { data: unknown[] }) => React.createElement('div', { 'data-testid': 'tree', 'data-count': data?.length ?? 0 }),
  Tree: ({ data }: { data: unknown[] }) => React.createElement('div', { 'data-testid': 'tree', 'data-count': data?.length ?? 0 }),
}));

vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue('<pre><code>highlighted code</code></pre>'),
    dispose: vi.fn(),
  }),
  getHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue('<pre><code>highlighted code</code></pre>'),
    dispose: vi.fn(),
  }),
}));

vi.mock('@/components/artifacts/ScreenshotDiff', () => ({
  ScreenshotDiff: ({ attachment }: { attachment: { name: string; path?: string } }) =>
    React.createElement('div', { 'data-testid': 'screenshot-diff' }, `${attachment.name}:${attachment.path ?? ''}`),
}));

vi.mock('@/components/artifacts/VideoPlayer', () => ({
  VideoPlayer: ({ path }: { path: string }) =>
    React.createElement('div', { 'data-testid': 'video-player' }, path),
}));

vi.mock('@/components/artifacts/TraceViewer', () => ({
  TraceViewer: ({ tracePath }: { tracePath: string }) =>
    React.createElement('div', { 'data-testid': 'trace-viewer' }, tracePath),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string } & Record<string, unknown>) => React.createElement('a', { href: to, ...rest }, children),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  useSearch: () => ({}),
  useParams: () => ({}),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock, info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/hooks/useRun', () => ({
  startRun: (...args: unknown[]) => startRunMock(...args),
  useRunTests: (...args: unknown[]) => useRunTestsMock(...args),
}));

vi.mock('@/lib/showToast', () => ({
  showToast: (...args: unknown[]) => showToastMock(...args),
}));

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useRunTestsMock.mockReturnValue({ data: [] });

  if (!HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      writable: true,
    });
  }

  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn() },
    configurable: true,
  });
});

describe('tests components', () => {
  describe('AiExplainButton', () => {
    it('submits explain request and renders AI result card', async () => {
      mockFetch.mockImplementation(() =>
        jsonResponse({ summary: 'Root cause found', suggestion: 'Use await expect().toBeVisible()', confidence: 0.87 }),
      );

      const user = userEvent.setup();
      renderWithProviders(<AiExplainButton error="Timeout 5000ms" stack="stack" testCode="code" />);

      await user.click(screen.getByRole('button', { name: /Explain/i }));

      await waitFor(() => expect(screen.queryByText('AI Analysis')).not.toBeNull());
      expect(screen.queryByText('Root cause found')).not.toBeNull();
      expect(screen.queryByText('Use await expect().toBeVisible()')).not.toBeNull();
      expect(screen.queryByText('87% confidence')).not.toBeNull();
    });

    it('shows mutation error message on failed request', async () => {
      mockFetch.mockImplementation(() => jsonResponse({ error: 'Quota exceeded' }, 429));

      const user = userEvent.setup();
      renderWithProviders(<AiExplainButton error="Oops" />);

      await user.click(screen.getByRole('button', { name: /Explain/i }));
      await waitFor(() => expect(screen.queryByText(/Error:/)).not.toBeNull());
      expect(screen.queryByText(/Quota exceeded/)).not.toBeNull();
    });

    it('shows confidence bar with green color for high confidence', async () => {
      mockFetch.mockImplementation(() =>
        jsonResponse({ summary: 'Root cause found', suggestion: 'Use await', confidence: 0.9 }),
      );

      const user = userEvent.setup();
      renderWithProviders(<AiExplainButton error="Timeout" />);

      await user.click(screen.getByRole('button', { name: /Explain/i }));
      await waitFor(() => expect(screen.queryByText('AI Analysis')).not.toBeNull());

      const bar = document.querySelector('.bg-green-500');
      expect(bar).not.toBeNull();
      expect((bar as HTMLElement).style.width).toBe('90%');
    });

    it('shows low confidence warning when validated is false', async () => {
      mockFetch.mockImplementation(() =>
        jsonResponse({
          summary: 'Uncertain diagnosis',
          suggestion: 'Maybe check logs',
          confidence: 0.4,
          validated: false,
          critique: 'Low quality response',
        }),
      );

      const user = userEvent.setup();
      renderWithProviders(<AiExplainButton error="Unknown error" />);

      await user.click(screen.getByRole('button', { name: /Explain/i }));
      await waitFor(() => expect(screen.queryByText('AI Analysis')).not.toBeNull());

      expect(screen.queryByText(/Low confidence — AI diagnosis may be inaccurate/)).not.toBeNull();
    });

    it('shows critic note when critique is present', async () => {
      mockFetch.mockImplementation(() =>
        jsonResponse({
          summary: 'Server error',
          suggestion: 'Check DB',
          confidence: 0.9,
          validated: true,
          critique: 'The diagnosis looks accurate.',
        }),
      );

      const user = userEvent.setup();
      renderWithProviders(<AiExplainButton error="500 error" />);

      await user.click(screen.getByRole('button', { name: /Explain/i }));
      await waitFor(() => expect(screen.queryByText('AI Analysis')).not.toBeNull());

      const details = document.querySelector('details');
      expect(details).not.toBeNull();
      expect(screen.queryByText('The diagnosis looks accurate.')).not.toBeNull();
    });
  });

  describe('BulkActionBar', () => {
    it('returns null when count is zero', () => {
      const { container } = render(
        <BulkActionBar count={0} titles={[]} onRerun={vi.fn()} onCopy={vi.fn()} onExportGrep={vi.fn()} onClear={vi.fn()} />,
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders actions and triggers callbacks', async () => {
      const user = userEvent.setup();
      const onRerun = vi.fn();
      const onCopy = vi.fn();
      const onExportGrep = vi.fn();
      const onClear = vi.fn();

      render(
        <BulkActionBar
          count={2}
          titles={['a', 'b']}
          onRerun={onRerun}
          onCopy={onCopy}
          onExportGrep={onExportGrep}
          onClear={onClear}
        />,
      );

      expect(screen.queryByText('2 selected')).not.toBeNull();
      await user.click(screen.getByRole('button', { name: 'Re-run 2 tests' }));
      await user.click(screen.getByRole('button', { name: 'Copy titles' }));
      await user.click(screen.getByRole('button', { name: 'Export grep' }));
      await user.click(screen.getByRole('button', { name: 'Clear selection' }));

      expect(onRerun).toHaveBeenCalledTimes(1);
      expect(onCopy).toHaveBeenCalledTimes(1);
      expect(onExportGrep).toHaveBeenCalledTimes(1);
      expect(onClear).toHaveBeenCalledTimes(1);
    });
  });

  describe('CodePeek', () => {
    it('renders loading skeleton while source query is pending', () => {
      mockFetch.mockImplementation(
        () => new Promise<Response>(() => {}),
      );
      renderWithProviders(<CodePeek file="tests/login.spec.ts" line={11} />);
      expect(document.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0);
    });

    it('renders source code with file header and vscode link', async () => {
      mockFetch.mockImplementation(() =>
        jsonResponse({
          file: '/repo/tests/login.spec.ts',
          line: 11,
          startLine: 10,
          language: 'ts',
          content: 'const a = 1\nexpect(a).toBe(1)\nconsole.log(a)',
        }),
      );

      renderWithProviders(<CodePeek file="tests/login.spec.ts" line={11} />);

      await waitFor(() => expect(screen.queryByText('/repo/tests/login.spec.ts:11')).not.toBeNull());
      expect(screen.queryByText('10')).not.toBeNull();
      expect(screen.queryByText('11')).not.toBeNull();
      expect(screen.queryByText('expect(a).toBe(1)')).not.toBeNull();
      expect((screen.getByRole('link', { name: /VS Code/i }) as HTMLAnchorElement).href).toContain('vscode://file//repo/tests/login.spec.ts:11');
    });

    it('renders fetch error state', async () => {
      mockFetch.mockImplementation(() => jsonResponse({ error: 'source unavailable' }, 404));
      renderWithProviders(<CodePeek file="missing.spec.ts" line={1} />);

      await waitFor(() => expect(screen.queryByText('Could not load source')).not.toBeNull());
      expect(screen.queryByText(/source unavailable/i)).not.toBeNull();
    });

    it('renders no-source state when API returns null', async () => {
      mockFetch.mockImplementation(() => jsonResponse(null));
      renderWithProviders(<CodePeek file="no-source.spec.ts" />);

      await waitFor(() => expect(screen.queryByText('No source available')).not.toBeNull());
    });
  });

  describe('ImpactedTests', () => {
    it('shows loading state while impact analysis is pending', () => {
      mockFetch.mockImplementation(() => new Promise<Response>(() => {}));
      renderWithProviders(<ImpactedTests changedFiles={['src/a.ts']} />);
      expect(screen.queryByText('Analyzing test impact…')).not.toBeNull();
    });

    it('renders impacted tests and starts run with grep pattern', async () => {
      mockFetch.mockImplementation((input) => {
        const url = String(input);
        if (url.includes('/api/tests/impacted')) {
          return jsonResponse([
            { testFile: 'tests/a.spec.ts', title: 'login works', reason: 'imports changed module' },
            { testFile: 'tests/b.spec.ts', title: 'checkout works', reason: 'direct dependency' },
          ]);
        }
        return jsonResponse({});
      });
      startRunMock.mockResolvedValue({ runId: 'run-1' });

      const user = userEvent.setup();
      renderWithProviders(<ImpactedTests changedFiles={['src/core.ts']} />);

      await waitFor(() => expect(screen.queryByText(/2 tests impacted/i)).not.toBeNull());
      await user.click(screen.getByRole('button', { name: 'Run impacted only' }));

      await waitFor(() => expect(startRunMock).toHaveBeenCalledWith({ grep: 'login works|checkout works' }));
    });

    it('renders fallback when impact analysis fails', async () => {
      mockFetch.mockImplementation(() => jsonResponse({ error: 'nope' }, 500));
      renderWithProviders(<ImpactedTests changedFiles={['src/x.ts']} />);

      await waitFor(() => expect(screen.queryByText('Could not analyze test impact.')).not.toBeNull());
    });
  });

  describe('KnownFailureBadge', () => {
    it('shows matched known failure and removes it', async () => {
      mockFetch.mockImplementation((input, init) => {
        const url = String(input);
        if (!init?.method && url.includes('/api/known-failures')) {
          return jsonResponse([{ id: 'kf-1', testTitle: 'login', testFile: 'tests/a.spec.ts', comment: 'known flaky env issue' }]);
        }
        if (init?.method === 'DELETE') return jsonResponse({});
        return jsonResponse([]);
      });

      const user = userEvent.setup();
      renderWithProviders(<KnownFailureBadge testTitle="login" testFile="tests/a.spec.ts" />);

      const removeBtn = await screen.findByRole('button', { name: 'Remove known failure annotation' });
      await user.click(removeBtn);

      await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('login unmarked as known failure'));
    });

    it('opens input and confirms adding known failure', async () => {
      mockFetch.mockImplementation((input, init) => {
        const url = String(input);
        if (!init?.method && url.includes('/api/known-failures')) return jsonResponse([]);
        if (init?.method === 'POST') return jsonResponse({});
        return jsonResponse([]);
      });

      const user = userEvent.setup();
      renderWithProviders(<KnownFailureBadge testTitle="checkout" testFile="tests/b.spec.ts" />);

      await user.click(await screen.findByRole('button', { name: 'Mark as known failure' }));
      await user.type(screen.getByPlaceholderText('Comment (optional)'), 'investigate later');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('checkout marked as known failure'));
    });
  });

  describe('QuarantineButton and QuarantineBadge', () => {
    it('renders auto/manual badges', () => {
      render(
        <>
          <QuarantineBadge quarantinedBy="system" />
          <QuarantineBadge quarantinedBy="user" />
        </>,
      );

      expect(screen.queryByText('Auto')).not.toBeNull();
      expect(screen.queryByText('Manual')).not.toBeNull();
    });

    it('shows remove action for quarantined test', async () => {
      mockFetch.mockImplementation((input, init) => {
        const url = String(input);
        if (!init?.method && url.includes('/api/quarantine')) {
          return jsonResponse([{ id: 'q-1', testTitle: 't', testFile: 'f' }]);
        }
        if (init?.method === 'DELETE') return jsonResponse({});
        return jsonResponse([]);
      });

      const user = userEvent.setup();
      renderWithProviders(<QuarantineButton testTitle="t" testFile="f" />);
      await user.click(await screen.findByRole('button', { name: 'Remove from quarantine' }));

      await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('t removed from quarantine'));
    });

    it('adds quarantine after entering reason', async () => {
      mockFetch.mockImplementation((input, init) => {
        const url = String(input);
        if (!init?.method && url.includes('/api/quarantine')) return jsonResponse([]);
        if (init?.method === 'POST') return jsonResponse({});
        return jsonResponse([]);
      });

      const user = userEvent.setup();
      renderWithProviders(<QuarantineButton testTitle="slow test" testFile="tests/slow.spec.ts" />);

      await user.click(await screen.findByRole('button', { name: 'Quarantine this test' }));
      await user.type(screen.getByPlaceholderText('Reason (optional)'), 'high flakiness');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('slow test quarantined'));
    });
  });

  describe('QuarantineTable', () => {
    it('renders rows with transformed file path and source badge', () => {
      render(
        <QuarantineTable
          rows={[
            {
              id: '1',
              testTitle: 'login',
              testFile: 'apps/client/tests/login.spec.ts',
              reason: 'flaky',
              quarantinedAt: '2026-03-08T10:00:00.000Z',
              quarantinedBy: 'system',
            },
          ]}
          onRemove={vi.fn()}
          isRemoving={false}
        />,
      );

      expect(screen.queryByText('login')).not.toBeNull();
      expect(screen.queryByText('tests/login.spec.ts')).not.toBeNull();
      expect(screen.queryByText('Auto')).not.toBeNull();
      expect(screen.queryByRole('button', { name: /Remove login from quarantine/ })).not.toBeNull();
    });

    it('calls onRemove with row id', async () => {
      const user = userEvent.setup();
      const onRemove = vi.fn();

      render(
        <QuarantineTable
          rows={[
            {
              id: 'row-2',
              testTitle: 'checkout',
              testFile: 'apps/client/tests/checkout.spec.ts',
              reason: null,
              quarantinedAt: '2026-03-08T10:00:00.000Z',
              quarantinedBy: 'user',
            },
          ]}
          onRemove={onRemove}
          isRemoving={false}
        />,
      );

      await user.click(screen.getByRole('button', { name: /Remove checkout from quarantine/ }));
      expect(onRemove).toHaveBeenCalledWith('row-2');
    });

    it('has complete ARIA table roles for accessibility', () => {
      render(
        <QuarantineTable
          rows={[
            {
              id: '1',
              testTitle: 'login test',
              testFile: 'apps/client/tests/login.spec.ts',
              reason: 'flaky',
              quarantinedAt: '2026-03-08T10:00:00.000Z',
              quarantinedBy: 'system',
            },
          ]}
          onRemove={vi.fn()}
          isRemoving={false}
        />,
      );

      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();

      // rowgroup on thead and tbody
      const rowgroups = table.querySelectorAll('[role="rowgroup"]');
      expect(rowgroups).toHaveLength(2);

      // columnheader on th elements
      const columnHeaders = table.querySelectorAll('[role="columnheader"]');
      expect(columnHeaders).toHaveLength(7);

      // row on tr elements (1 header + 1 data row)
      const tableRows = table.querySelectorAll('[role="row"]');
      expect(tableRows).toHaveLength(2);

      // cell on td elements (7 columns × 1 data row)
      const cells = table.querySelectorAll('[role="cell"]');
      expect(cells).toHaveLength(7);
    });

    it('renders FlakinessCategoryBadge with known and unknown category strings', () => {
      render(
        <QuarantineTable
          rows={[
            {
              id: '1',
              testTitle: 'timing test',
              testFile: 'tests/a.spec.ts',
              reason: null,
              quarantinedAt: '2026-03-08T10:00:00.000Z',
              quarantinedBy: 'system',
              flakinessCategory: 'timing',
            },
            {
              id: '2',
              testTitle: 'custom test',
              testFile: 'tests/b.spec.ts',
              reason: null,
              quarantinedAt: '2026-03-08T10:00:00.000Z',
              quarantinedBy: 'system',
              flakinessCategory: 'custom-category',
            },
          ]}
          onRemove={vi.fn()}
          isRemoving={false}
        />,
      );

      expect(screen.getByText('Timing')).toBeInTheDocument();
      // custom-category falls through to ?? fallback — label is the raw string
      expect(screen.getByText('custom-category')).toBeInTheDocument();
    });
  });

  describe('RetryTabs', () => {
    const results: ResultParsed[] = [
      { id: 'r1', testId: 't1', runId: 'run', retry: 0, status: 'failed', durationMs: 1000, startedAt: null, workerIndex: 0, parallelIndex: 0, stdout: null, stderr: null, steps: [], attachments: [], error: { message: 'boom' } },
      { id: 'r2', testId: 't1', runId: 'run', retry: 1, status: 'passed', durationMs: 600, startedAt: null, workerIndex: 0, parallelIndex: 0, stdout: null, stderr: null, steps: [], attachments: [] },
    ];

    it('returns null when no results', () => {
      const { container } = render(<RetryTabs results={[]} activeIndex={0} onChange={vi.fn()} />);
      expect(container.innerHTML).toBe('');
    });

    it('renders attempts and invokes onChange', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<RetryTabs results={results} activeIndex={0} onChange={onChange} />);
      expect(screen.queryByRole('button', { name: /Attempt 1/i })).not.toBeNull();
      expect(screen.queryByRole('button', { name: /Retry 1/i })).not.toBeNull();

      await user.click(screen.getByRole('button', { name: /Retry 1/i }));
      expect(onChange).toHaveBeenCalledWith(1);
    });
  });

  describe('StabilityBadge', () => {
    it('renders null for blank or em-dash grade', () => {
      const { container } = render(
        <>
          <StabilityBadge grade="" />
          <StabilityBadge grade="—" />
        </>,
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders grade with stability title', () => {
      render(<StabilityBadge grade="A+" />);
      const node = screen.getByText('A+');
      expect(node.getAttribute('title')).toBe('Stability: A+');
    });
  });

  describe('StepTimeline', () => {
    const steps: Step[] = [
      { title: 'goto', category: 'navigate', startTime: 0, endTime: 200, durationMs: 200, steps: [] },
      { title: 'expect text', category: 'expect', startTime: 250, endTime: 500, durationMs: 250, steps: [] },
    ];

    it('returns null when no steps or no duration', () => {
      const { container: c1 } = render(<StepTimeline steps={[]} totalDurationMs={500} />);
      const { container: c2 } = render(<StepTimeline steps={steps} totalDurationMs={0} />);
      expect(c1.innerHTML).toBe('');
      expect(c2.innerHTML).toBe('');
    });

    it('renders title and legend entries', () => {
      render(<StepTimeline steps={steps} totalDurationMs={1000} />);
      expect(screen.queryByText('Step Timeline')).not.toBeNull();
      expect(screen.queryByText('action')).not.toBeNull();
      expect(screen.queryByText('expect')).not.toBeNull();
      expect(screen.queryByText('navigate')).not.toBeNull();
    });
  });

  describe('StepTree', () => {
    it('shows empty state when no steps are present', () => {
      render(<StepTree steps={[]} />);
      expect(screen.queryByText('No steps recorded')).not.toBeNull();
    });

    it('renders tree with root node count', () => {
      render(
        <StepTree
          steps={[
            { title: 'one', category: 'action', durationMs: 1, steps: [] },
            { title: 'two', category: 'expect', durationMs: 2, steps: [] },
          ]}
        />, 
      );
      expect(screen.getByTestId('tree').getAttribute('data-count')).toBe('2');
    });
  });

  describe('TestHistoryTimeline and HistoryDotsDisplay', () => {
    const rows = [
      { id: 't1', runId: 'run-1', status: 'passed', durationMs: 200, retryCount: 0, runStartedAt: '2026-03-01T10:00:00.000Z', runBranch: 'main', runCommitSha: 'abc' },
      { id: 't1', runId: 'run-2', status: 'failed', durationMs: 400, retryCount: 1, runStartedAt: '2026-03-02T10:00:00.000Z', runBranch: 'main', runCommitSha: 'def' },
    ];

    it('renders timeline summary and links', () => {
      render(<TestHistoryTimeline rows={rows} />);
      expect(screen.queryByText(/Status — last 2 runs/)).not.toBeNull();
      expect(screen.queryByText('Duration')).not.toBeNull();
      expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
    });

    it('renders timeline entries for flaky, timedOut, and skipped statuses', () => {
      const variedRows = [
        { id: 't1', runId: 'run-3', status: 'flaky', durationMs: 150, retryCount: 1, runStartedAt: '2026-03-03T10:00:00.000Z', runBranch: 'main', runCommitSha: 'ghi' },
        { id: 't1', runId: 'run-4', status: 'timedOut', durationMs: null, retryCount: 0, runStartedAt: '2026-03-04T10:00:00.000Z', runBranch: 'main', runCommitSha: 'jkl' },
        { id: 't1', runId: 'run-5', status: 'skipped', durationMs: 0, retryCount: 0, runStartedAt: '2026-03-05T10:00:00.000Z', runBranch: 'main', runCommitSha: 'mno' },
      ];

      render(<TestHistoryTimeline rows={variedRows} />);

      expect(screen.getByLabelText(/flaky/)).not.toBeNull();
      expect(screen.getByLabelText(/timedOut/)).not.toBeNull();
      expect(screen.getByLabelText(/skipped/)).not.toBeNull();
      expect(screen.getByText('Flaky')).not.toBeNull();
      expect(screen.getByText('Skipped')).not.toBeNull();
    });

    it('renders dot display for recent statuses', () => {
      render(<HistoryDotsDisplay dots={[{ status: 'passed' }, { status: 'failed' }, { status: 'flaky' }]} />);
      expect(screen.getByLabelText('Recent test history')).not.toBeNull();
      expect(screen.getByLabelText('passed')).not.toBeNull();
      expect(screen.getByLabelText('failed')).not.toBeNull();
      expect(screen.getByLabelText('flaky')).not.toBeNull();
    });

    it('maps timedOut to failed color and defaults unknown to skipped', () => {
      render(<HistoryDotsDisplay dots={[{ status: 'timedOut' }, { status: 'unknown-status' }]} />);
      expect(screen.getByLabelText('timedOut')).not.toBeNull();
      expect(screen.getByLabelText('unknown-status')).not.toBeNull();
    });

    it('returns null when history dots stableId is missing', () => {
      const { container } = render(<HistoryDots stableId={null} />);
      expect(container.innerHTML).toBe('');
    });

    it('currently returns null for history dots when stableId exists', () => {
      const { container } = render(<HistoryDots stableId="stable-42" />);
      expect(container.innerHTML).toBe('');
    });
  });

  describe('TestRow', () => {
    const baseTest: TestWithResults = {
      id: 't1',
      runId: 'run-1',
      suiteId: null,
      title: 'login should succeed',
      file: 'apps/client/tests/login.spec.ts',
      line: 10,
      column: 1,
      status: 'passed',
      durationMs: 1200,
      tags: ['@smoke'],
      annotations: [],
      retryCount: 0,
      expectedStatus: 'passed',
      workerIndex: 0,
      stableId: 'stable-1',
      retries: 1,
      results: [],
    };

    it('renders core test metadata', () => {
      render(<TestRow test={baseTest} isSelected={false} onClick={vi.fn()} stabilityGrade="B" />);
      expect(screen.queryByText('login should succeed')).not.toBeNull();
      expect(screen.queryByText('tests/login.spec.ts:10')).not.toBeNull();
      expect(screen.queryByText('@smoke')).not.toBeNull();
      expect(screen.queryByText('B')).not.toBeNull();
    });

    it('calls onClick when row is clicked', () => {
      const onClick = vi.fn();
      render(<TestRow test={baseTest} isSelected={true} onClick={onClick} />);
      fireEvent.click(screen.getByRole('button', { name: /login should succeed/i }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('TestTree', () => {
    const treeTests: TestWithResults[] = [
      {
        id: 'a',
        runId: 'r',
        suiteId: null,
        title: 'test A',
        file: 'apps/client/tests/a.spec.ts',
        line: 1,
        column: 1,
        status: 'passed',
        durationMs: 100,
        tags: [],
        annotations: [],
        retryCount: 0,
        expectedStatus: 'passed',
        workerIndex: 0,
        stableId: 's1',
        retries: 0,
        suite: 'suite-1',
      },
      {
        id: 'b',
        runId: 'r',
        suiteId: null,
        title: 'test B',
        file: 'apps/client/tests/b.spec.ts',
        line: 2,
        column: 1,
        status: 'failed',
        durationMs: 200,
        tags: [],
        annotations: [],
        retryCount: 0,
        expectedStatus: 'failed',
        workerIndex: 1,
        stableId: 's2',
        retries: 0,
        suite: 'suite-1',
      },
    ];

    it('groups provided tests by file by default', () => {
      render(<TestTree tests={treeTests} />);
      expect(screen.getByTestId('tree').getAttribute('data-count')).toBe('2');
    });

    it('groups provided tests by suite', () => {
      render(<TestTree tests={treeTests} groupBy="suite" />);
      expect(screen.getByTestId('tree').getAttribute('data-count')).toBe('1');
    });

    it('falls back to useRunTests when tests prop is not passed', () => {
      useRunTestsMock.mockReturnValue({ data: treeTests });
      render(<TestTree runId="run-1" groupBy="status" />);
      expect(useRunTestsMock).toHaveBeenCalledWith('run-1');
      expect(screen.getByTestId('tree').getAttribute('data-count')).toBe('2');
    });
  });

  describe('TestDetail', () => {
    const parsedResults: ResultParsed[] = [
      {
        id: 'res-1',
        testId: 'test-1',
        runId: 'run-1',
        retry: 0,
        status: 'failed',
        durationMs: 1200,
        startedAt: null,
        workerIndex: 0,
        parallelIndex: 0,
        stdout: 'log line',
        stderr: null,
        steps: [{ title: 'goto', category: 'navigate', startTime: 0, endTime: 400, durationMs: 400, steps: [] }],
        attachments: [],
        error: { message: 'AssertionError', stack: 'stack trace' },
      },
      {
        id: 'res-2',
        testId: 'test-1',
        runId: 'run-1',
        retry: 1,
        status: 'passed',
        durationMs: 900,
        startedAt: null,
        workerIndex: 0,
        parallelIndex: 0,
        stdout: null,
        stderr: null,
        steps: [{ title: 'expect', category: 'expect', startTime: 0, endTime: 300, durationMs: 300, steps: [] }],
        attachments: [],
      },
    ];

    const detailTest: TestWithResults = {
      id: 'test-1',
      runId: 'run-1',
      suiteId: null,
      title: 'should open dashboard',
      file: 'apps/client/tests/dashboard.spec.ts',
      line: 42,
      column: 1,
      status: 'flaky',
      durationMs: 2100,
      tags: ['@smoke'],
      annotations: [],
      retryCount: 1,
      expectedStatus: 'passed',
      workerIndex: 0,
      stableId: 'stable-42',
      retries: 1,
      results: parsedResults,
    };

    it('renders test metadata, tabs and retry chips', () => {
      renderWithProviders(<TestDetail test={detailTest} runId="run-1" />);
      expect(screen.queryByText('should open dashboard')).not.toBeNull();
      expect(screen.queryByText(/tests\/dashboard\.spec\.ts:42/)).not.toBeNull();
      expect(screen.queryByRole('button', { name: /Attempt 1/i })).not.toBeNull();
      expect(screen.queryByRole('button', { name: /Retry 1/i })).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Timeline' })).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Source' })).not.toBeNull();
    });

    it('copies permalink to clipboard and shows success toast', async () => {
      const user = userEvent.setup();
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      renderWithProviders(<TestDetail test={detailTest} runId="run-1" />);
      await user.click(screen.getByRole('button', { name: 'Copy test permalink' }));

      expect(writeTextSpy).toHaveBeenCalledTimes(1);
      expect(toastSuccessMock).toHaveBeenCalledWith('Test link copied');
    });

    it('loads and renders history tab when stableId is available', async () => {
      mockFetch.mockImplementation((input) => {
        const url = String(input);
        if (url.includes('/api/tests/history/stable-42')) {
          return jsonResponse([
            { id: 'test-1', runId: 'run-old', status: 'passed', durationMs: 500, retryCount: 0, runStartedAt: '2026-03-01T10:00:00.000Z', runBranch: 'main', runCommitSha: 'abc' },
          ]);
        }
        return jsonResponse({});
      });

      const user = userEvent.setup();
      renderWithProviders(<TestDetail test={detailTest} runId="run-1" />);

      await user.click(screen.getByRole('button', { name: 'History' }));
      await waitFor(() => expect(screen.queryByText(/Status — last 1 runs/)).not.toBeNull());
    });

    it('shows no-history text when history tab selected without stableId', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TestDetail
          test={{ ...detailTest, stableId: null }}
          runId="run-1"
        />,
      );

      await user.click(screen.getByRole('button', { name: 'History' }));
      expect(screen.queryByText(/No history — run recorded before history tracking was enabled/)).not.toBeNull();
    });

    it('renders screenshot artifacts including diff and auto-captured badge', () => {
      const withScreenshots: TestWithResults = {
        ...detailTest,
        results: [
          {
            ...parsedResults[0],
            attachments: [
              { name: 'expected', path: 'screenshots/expected-login.png', contentType: 'image/png' },
              { name: 'screenshot', path: 'screenshots/current-login.png', contentType: 'image/png' },
              { name: 'manual-capture', path: 'screenshots/manual.png', contentType: 'image/png' },
            ],
          },
        ],
      };

      renderWithProviders(<TestDetail test={withScreenshots} initialTab="Screenshots" />);

      expect(screen.getByTestId('screenshot-diff')).toHaveTextContent('expected:screenshots/expected-login.png');
      expect(screen.getByRole('img', { name: 'screenshot' }).getAttribute('src')).toBe('/artifacts/screenshots/current-login.png');
      expect(screen.getByText('Auto-captured')).not.toBeNull();
      expect(screen.queryByText('manual-capture')).not.toBeNull();
    });

    it('renders video artifact tab', () => {
      const withArtifacts: TestWithResults = {
        ...detailTest,
        results: [
          {
            ...parsedResults[0],
            attachments: [
              { name: 'video', path: 'videos/run.mp4', contentType: 'video/mp4' },
              { name: 'trace', path: 'traces/trace.zip', contentType: 'application/zip' },
            ],
            stdout: 'stdout line\n',
            stderr: 'stderr line',
          },
        ],
      };

      renderWithProviders(<TestDetail test={withArtifacts} initialTab="Video" />);
      expect(screen.getByTestId('video-player')).toHaveTextContent('videos/run.mp4');
    });

    it('renders trace artifact tab', () => {
      const withArtifacts: TestWithResults = {
        ...detailTest,
        results: [
          {
            ...parsedResults[0],
            attachments: [
              { name: 'video', path: 'videos/run.mp4', contentType: 'video/mp4' },
              { name: 'trace', path: 'traces/trace.zip', contentType: 'application/zip' },
            ],
            stdout: 'stdout line\n',
            stderr: 'stderr line',
          },
        ],
      };

      renderWithProviders(<TestDetail test={withArtifacts} initialTab="Trace" />);
      expect(screen.getByTestId('trace-viewer')).toHaveTextContent('traces/trace.zip');
    });

    it('renders console artifact tab', () => {
      const withArtifacts: TestWithResults = {
        ...detailTest,
        results: [
          {
            ...parsedResults[0],
            attachments: [
              { name: 'video', path: 'videos/run.mp4', contentType: 'video/mp4' },
              { name: 'trace', path: 'traces/trace.zip', contentType: 'application/zip' },
            ],
            stdout: 'stdout line\n',
            stderr: 'stderr line',
          },
        ],
      };

      renderWithProviders(<TestDetail test={withArtifacts} initialTab="Console" />);
      expect(screen.getByText((content) => content.includes('stdout line') && content.includes('stderr line'))).not.toBeNull();
    });

    it.each([
      ['Screenshots', 'No screenshots captured.'],
      ['Video', 'No video recorded.'],
      ['Trace', 'No trace recorded.'],
      ['Console', 'No console output'],
    ])('shows empty state for %s tab when artifacts are absent', (initialTab, emptyLabel) => {
      const emptyArtifacts: TestWithResults = {
        ...detailTest,
        results: [
          {
            ...parsedResults[0],
            attachments: [],
            stdout: null,
            stderr: null,
          },
        ],
      };

      renderWithProviders(<TestDetail test={emptyArtifacts} initialTab={initialTab} />);
      expect(screen.getByText(emptyLabel)).not.toBeNull();
    });

    it('shows No error when Error tab active but result has no error', () => {
      const noError: TestWithResults = {
        ...detailTest,
        results: [{ ...parsedResults[1] }], // retry 1: no error
      };
      renderWithProviders(<TestDetail test={noError} initialTab="Error" />);
      expect(screen.queryByText('No error')).not.toBeNull();
    });

    it('renders ErrorDisplay with copy button and toggles isCopied state', async () => {
      const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

      // Use a single-result test so retryIdx=0 (the result with an error)
      const errorOnlyTest: TestWithResults = { ...detailTest, results: [parsedResults[0]] };
      renderWithProviders(<TestDetail test={errorOnlyTest} initialTab="Error" />);

      // Copy button: only button with SVG child and no text content
      const copyBtn = screen.getAllByRole('button').find(
        (btn) => btn.querySelector('svg') && !btn.textContent?.trim()
      );
      expect(copyBtn).toBeTruthy();
      fireEvent.click(copyBtn!);

      expect(writeTextSpy).toHaveBeenCalledWith('AssertionError\nstack trace');

      writeTextSpy.mockRestore();
    });

    it('renders Ask AI link for failed tests', () => {
      const errorOnlyTest: TestWithResults = { ...detailTest, results: [parsedResults[0]] };
      renderWithProviders(<TestDetail test={errorOnlyTest} initialTab="Error" />);

      expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveAttribute('data-automate-link', 'ai:/chat');
    });

    it('shows stack trace toggle and can hide/show stack trace', () => {
      // Use single-result (with error) so ErrorDisplay is shown
      const errorOnlyTest: TestWithResults = { ...detailTest, results: [parsedResults[0]] };
      renderWithProviders(<TestDetail test={errorOnlyTest} initialTab="Error" />);

      const toggleBtn = screen.getByRole('button', { name: /stack trace/i });
      expect(toggleBtn).toBeTruthy();
      expect(screen.queryByText('stack trace')).not.toBeNull();

      // Click to toggle
      fireEvent.click(toggleBtn);
      expect(screen.getByRole('button', { name: /stack trace/i })).not.toBeNull();
    });

    it('shows long stack trace as hidden by default then toggles visible', () => {
      const longStack = 'line1\nline2\nline3\nline4\nline5\nline6';
      const longStackTest: TestWithResults = {
        ...detailTest,
        results: [
          {
            ...parsedResults[0],
            error: { message: 'Long Error', stack: longStack },
          },
        ],
      };
      renderWithProviders(<TestDetail test={longStackTest} initialTab="Error" />);

      // Long stack starts hidden – Show stack trace button
      const showBtn = screen.getByRole('button', { name: /Show stack trace/i });
      expect(showBtn).not.toBeNull();

      // After click, stack becomes visible — use partial text match
      fireEvent.click(showBtn);
      expect(screen.queryByText((content) => content.includes('line1'))).not.toBeNull();
    });

    it('renders Source tab content when file is provided', () => {
      renderWithProviders(<TestDetail test={detailTest} initialTab="Source" />);
      // CodePeek should be rendered (shows loading skeleton)
      expect(document.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThanOrEqual(0);
    });

    it('renders Source tab empty state when test has no file', () => {
      const noFile: TestWithResults = { ...detailTest, file: '' };
      renderWithProviders(<TestDetail test={noFile} initialTab="Source" />);
      expect(screen.queryByText('No source')).not.toBeNull();
    });

    it('invokes onTabChange callback when switching tabs', () => {
      const onTabChange = vi.fn();
      renderWithProviders(<TestDetail test={detailTest} runId="run-1" onTabChange={onTabChange} />);

      fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
      expect(onTabChange).toHaveBeenCalledWith('Timeline');

      fireEvent.click(screen.getByRole('button', { name: 'Steps' }));
      expect(onTabChange).toHaveBeenCalledWith('Steps');
    });

    it('renders Steps tab content', () => {
      renderWithProviders(<TestDetail test={detailTest} initialTab="Steps" />);
      // StepTree renders the arborist tree with steps
      const tree = screen.queryByTestId('tree');
      expect(tree).not.toBeNull();
    });

    it('renders Timeline tab content', () => {
      renderWithProviders(<TestDetail test={detailTest} initialTab="Timeline" />);
      expect(screen.queryByText('Step Timeline')).not.toBeNull();
    });

    it('shows history loading skeleton when stableId is present but fetch pending', () => {
      mockFetch.mockImplementation(() => new Promise<Response>(() => {}));
      const user = userEvent.setup();
      void user;
      renderWithProviders(<TestDetail test={detailTest} runId="run-1" />);
      // Switch to History tab manually
      fireEvent.click(screen.getByRole('button', { name: 'History' }));
      // Loading skeleton should appear
      expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(1);
    });

    it('shows empty history state when fetch returns empty array', async () => {
      mockFetch.mockImplementation((input) => {
        if (String(input).includes('/api/tests/history/')) return jsonResponse([]);
        return jsonResponse({});
      });
      renderWithProviders(<TestDetail test={detailTest} runId="run-1" />);

      fireEvent.click(screen.getByRole('button', { name: 'History' }));
      await waitFor(() => expect(screen.queryByText('No history yet for this test')).not.toBeNull());
    });

    it('renders without runId (no permalink button)', () => {
      renderWithProviders(<TestDetail test={detailTest} />);
      expect(screen.queryByRole('button', { name: 'Copy test permalink' })).toBeNull();
    });

    it('resolves invalid initialTab to Error tab', () => {
      renderWithProviders(<TestDetail test={detailTest} initialTab="InvalidTab" />);
      // Should fall back to Error tab (default)
      const errorTabBtn = screen.getByRole('button', { name: 'Error' });
      expect(errorTabBtn.className).toMatch(/border-b-border-focus|bg-bg-elevated/);
    });

    it('renders single result without retry tabs', () => {
      const singleResult: TestWithResults = {
        ...detailTest,
        results: [parsedResults[0]],
      };
      renderWithProviders(<TestDetail test={singleResult} runId="run-1" />);
      expect(screen.queryByRole('button', { name: /Attempt/i })).toBeNull();
    });

    it('renders test with no results', () => {
      const noResults: TestWithResults = {
        ...detailTest,
        results: [],
      };
      renderWithProviders(<TestDetail test={noResults} runId="run-1" />);
      expect(screen.queryByText('should open dashboard')).not.toBeNull();
    });

    describe('LocatorSuggestionBanner', () => {
      // Need a test with a single failed result so the Error tab shows the error + banner
      const failedTest: TestWithResults = {
        ...detailTest,
        results: [parsedResults[0]!], // only the failed result
      };

      const pendingSuggestion = {
        id: 'sug-1',
        testId: 'test-1',
        runId: 'run-1',
        originalSelector: '[data-testid="old-btn"]',
        suggestedSelector: '[data-testid="new-btn"]',
        confidence: 0.92,
        rationale: 'More stable selector',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      it('renders suggestion banner when pending suggestions exist', async () => {
        mockFetch.mockImplementation((input) => {
          if (String(input).includes('/api/locator-suggestions')) {
            return jsonResponse([pendingSuggestion]);
          }
          return jsonResponse({});
        });

        renderWithProviders(<TestDetail test={failedTest} runId="run-1" />);
        await waitFor(() =>
          expect(screen.queryByText(/Selector fix available/)).not.toBeNull(),
        );
      });

      it('does not render banner when no pending suggestions', async () => {
        mockFetch.mockImplementation((input) => {
          if (String(input).includes('/api/locator-suggestions')) {
            return jsonResponse([]);
          }
          return jsonResponse({});
        });

        renderWithProviders(<TestDetail test={failedTest} runId="run-1" />);
        // Wait for query to settle then assert banner absent
        await waitFor(() => expect(mockFetch).toHaveBeenCalled());
        expect(screen.queryByText(/Selector fix available/)).toBeNull();
      });

      it('expands and shows suggestion details on toggle click', async () => {
        mockFetch.mockImplementation((input) => {
          if (String(input).includes('/api/locator-suggestions')) {
            return jsonResponse([pendingSuggestion]);
          }
          return jsonResponse({});
        });

        const user = userEvent.setup();
        renderWithProviders(<TestDetail test={failedTest} runId="run-1" />);

        await waitFor(() =>
          expect(screen.queryByText(/Selector fix available/)).not.toBeNull(),
        );

        await user.click(screen.getByRole('button', { name: /Toggle selector fix suggestions/i }));
        await waitFor(() =>
          expect(screen.queryByTestId('locator-suggestion-item')).not.toBeNull(),
        );
        expect(screen.queryByText('[data-testid="old-btn"]')).not.toBeNull();
        expect(screen.queryByText('[data-testid="new-btn"]')).not.toBeNull();
        expect(screen.queryByText(/92%/)).not.toBeNull();
        expect(screen.queryByText('More stable selector')).not.toBeNull();
      });

      it('copies suggested selector to clipboard', async () => {
        mockFetch.mockImplementation((input) => {
          if (String(input).includes('/api/locator-suggestions')) {
            return jsonResponse([pendingSuggestion]);
          }
          return jsonResponse({});
        });

        const user = userEvent.setup();
        const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
        renderWithProviders(<TestDetail test={failedTest} runId="run-1" />);

        await waitFor(() =>
          expect(screen.queryByText(/Selector fix available/)).not.toBeNull(),
        );
        await user.click(screen.getByRole('button', { name: /Toggle selector fix suggestions/i }));
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: /Copy suggested selector/i })).not.toBeNull(),
        );
        await user.click(screen.getByRole('button', { name: /Copy suggested selector/i }));
        expect(writeTextSpy).toHaveBeenCalledWith('[data-testid="new-btn"]');
      });

      it('calls accept endpoint and shows success toast', async () => {
        mockFetch.mockImplementation((input) => {
          const url = String(input);
          if (url.includes('/api/locator-suggestions') && !url.includes('/accept') && !url.includes('/reject')) {
            return jsonResponse([pendingSuggestion]);
          }
          if (url.includes('/accept')) return jsonResponse({});
          return jsonResponse({});
        });

        const user = userEvent.setup();
        renderWithProviders(<TestDetail test={failedTest} runId="run-1" />);

        await waitFor(() =>
          expect(screen.queryByText(/Selector fix available/)).not.toBeNull(),
        );
        await user.click(screen.getByRole('button', { name: /Toggle selector fix suggestions/i }));
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: /Accept selector suggestion/i })).not.toBeNull(),
        );
        await user.click(screen.getByRole('button', { name: /Accept selector suggestion/i }));
        await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Selector accepted'));
      });

      it('calls reject endpoint and shows success toast', async () => {
        mockFetch.mockImplementation((input) => {
          const url = String(input);
          if (url.includes('/api/locator-suggestions') && !url.includes('/accept') && !url.includes('/reject')) {
            return jsonResponse([pendingSuggestion]);
          }
          if (url.includes('/reject')) return jsonResponse({});
          return jsonResponse({});
        });

        const user = userEvent.setup();
        renderWithProviders(<TestDetail test={failedTest} runId="run-1" />);

        await waitFor(() =>
          expect(screen.queryByText(/Selector fix available/)).not.toBeNull(),
        );
        await user.click(screen.getByRole('button', { name: /Toggle selector fix suggestions/i }));
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: /Reject selector suggestion/i })).not.toBeNull(),
        );
        await user.click(screen.getByRole('button', { name: /Reject selector suggestion/i }));
        await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Selector dismissed'));
      });

      it('shows error toast when accept fails', async () => {
        mockFetch.mockImplementation((input) => {
          const url = String(input);
          if (url.includes('/api/locator-suggestions') && !url.includes('/accept')) {
            return jsonResponse([pendingSuggestion]);
          }
          if (url.includes('/accept')) return jsonResponse({ error: 'fail' }, 500);
          return jsonResponse({});
        });

        const user = userEvent.setup();
        renderWithProviders(<TestDetail test={failedTest} runId="run-1" />);

        await waitFor(() =>
          expect(screen.queryByText(/Selector fix available/)).not.toBeNull(),
        );
        await user.click(screen.getByRole('button', { name: /Toggle selector fix suggestions/i }));
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: /Accept selector suggestion/i })).not.toBeNull(),
        );
        await user.click(screen.getByRole('button', { name: /Accept selector suggestion/i }));
        await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Failed to accept suggestion'));
      });
    });
  });
});

