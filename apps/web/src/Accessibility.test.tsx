import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoBlockingAxeViolations } from './test-axe.js';
import { RunExplorer } from './components/dashboard/RunExplorer.js';
import { EmptyState as WebEmptyState } from './components/shared/EmptyState.js';
import { ErrorState } from './components/shared/ErrorState.js';
import { LoadingState } from './components/shared/LoadingState.js';
import { RunList } from './components/RunList.js';
import { Sidebar } from './components/Sidebar.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { NavBar } from './components/NavBar.js';
import { ThemeProvider } from './theme/ThemeProvider.js';
import { makeApi, makeRun } from './test-utils.js';

Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });

/** Renders a component inside a memory router, which most of the app requires. */
function renderRouted(element: React.ReactNode, initialPath = '/dashboard') {
  const rootRoute = createRootRoute({ component: () => <>{element}</> });
  const router = createRouter({ routeTree: rootRoute });
  router.update({ history: createMemoryHistory({ initialEntries: [initialPath] }) });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('axe sweep over the client components', () => {
  /**
   * If this passes silently the sweep below is decoration, so it comes first and
   * names the case it is proving: a button with no accessible name is the classic
   * serious violation.
   */
  it('proves the sweep can see a real violation', async () => {
    const { container } = render(<button data-testid="unnamed" />);
    await expect(expectNoBlockingAxeViolations(container)).rejects.toThrow(/button-name/);
  });

  it('reports no violations for the navigation bar', async () => {
    const { container } = renderRouted(
      <ThemeProvider>
        <NavBar />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('nav-bar')).toBeInTheDocument());
    await expectNoBlockingAxeViolations(container);
  });

  it('reports no violations for the sidebar', async () => {
    const { container } = renderRouted(<Sidebar />);
    await waitFor(() => expect(screen.getByTestId('sidebar')).toBeInTheDocument());
    await expectNoBlockingAxeViolations(container);
  });

  it('reports no violations for a populated run list', async () => {
    const { container } = render(
      <RunList
        api={makeApi({
          getRuns: vi.fn().mockResolvedValue([
            makeRun({ id: 'run-1', projectId: 'project-a', phase: 'running' }),
            makeRun({
              id: 'run-2',
              projectId: 'project-b',
              phase: 'complete',
              outcome: 'passed',
            }),
          ]),
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('run-item-run-1')).toBeInTheDocument());
    await expectNoBlockingAxeViolations(container);
  });

  it('reports no violations for the theme toggle', async () => {
    const { container } = render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    await expectNoBlockingAxeViolations(container);
  });

  it('reports no violations for the shared empty, error and loading states', async () => {
    const { container } = render(
      <div>
        <WebEmptyState
          title="No execution evidence"
          description="No canonical runs are available."
          action={{ label: 'Open Command Center', onClick: () => {} }}
        />
        <ErrorState message="API unavailable" onRetry={() => {}} />
        <LoadingState />
      </div>,
    );
    await expectNoBlockingAxeViolations(container);
  });

  it('reports no violations for the run evidence explorer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            result: {
              identity: { runId: 'run-1' },
              status: 'complete',
              proof: { state: 'verified' },
              completeness: { state: 'complete' },
              attempts: [{ testId: 't1', index: 0, title: 'smoke', status: 'passed' }],
              evidence: ['trace.zip'],
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const { container } = render(<RunExplorer runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('run-explorer')).toBeInTheDocument());
    await expectNoBlockingAxeViolations(container);
  });
});

describe('NavBar keyboard operation', () => {
  it('marks the current page for assistive technology, not only by colour', async () => {
    renderRouted(
      <ThemeProvider>
        <NavBar />
      </ThemeProvider>,
      '/dashboard',
    );
    await waitFor(() => expect(screen.getByTestId('nav-bar')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Release Command Center' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('cycles the theme with Enter on the focused button', async () => {
    const user = userEvent.setup();
    localStorage.setItem('automate-theme', 'light');
    renderRouted(
      <ThemeProvider>
        <NavBar />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('theme-toggle')).toBeInTheDocument());

    screen.getByTestId('theme-toggle').focus();
    await user.keyboard('{Enter}');

    expect(localStorage.getItem('automate-theme')).toBe('dark');
  });
});
