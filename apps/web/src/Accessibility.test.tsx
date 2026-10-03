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
import { EmptyState, Alert, AlertDescription, AlertTitle, Skeleton } from '@automate/ui';
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

  /**
   * The three states a screen can be in, from `packages/ui`.
   *
   * **The application no longer has its own copies.** `components/shared/` held
   * `EmptyState`, `ErrorState` and `LoadingState` — hand-rolled, three different
   * shapes, imported by nothing except their own test file, so "the shared states" in
   * the sweep below were components no screen rendered. `ErrorState` and
   * `LoadingState` have no `packages/ui` counterpart by name and did not get one:
   * `Alert variant="danger"` is the error state, and `Skeleton` is the loading one.
   * `components/shared/shared-states.test.tsx` covers all three; this case is the axe
   * sweep over the same components, which is a different question.
   */
  it('reports no violations for the shared empty, error and loading states', async () => {
    const { container } = render(
      <div>
        <EmptyState
          title="No execution evidence"
          description="No canonical runs are available."
          action={<button type="button">Open Command Center</button>}
        />
        <Alert variant="danger">
          <AlertTitle>Evidence unavailable</AlertTitle>
          <AlertDescription>The API did not answer.</AlertDescription>
        </Alert>
        <Skeleton data-testid="loading" />
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

  /**
   * The cycle order is `dark → light → system → dark`, which is `THEMES` in
   * `ThemeProvider.tsx` and the order a reader meets from the provider's default of
   * `system`.
   *
   * **The expectation changed, and the old one was wrong.** This asserted
   * `light → dark`, which was the order of the *inline* copy `NavBar` used to
   * render — a second control with its own idea of what "toggle" meant, which no
   * other test disagreed with because `ThemeToggle.test.tsx` mocked the hook and
   * never saw the other component. `NavBar` now renders `ThemeToggle`, so the two
   * cycles are one cycle. The assertion is kept here rather than left to
   * `ThemeToggle.test.tsx` because this is the one that renders the real provider
   * and the real storage, and a mocked cycle proves the arithmetic rather than the
   * wiring.
   */
  it('cycles the theme on Enter, from the theme the provider read out of storage', async () => {
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

    // `light` advances to `system`, which is `THEMES[2]`.
    expect(localStorage.getItem('automate-theme')).toBe('system');
  });

  /**
   * One control for one setting.
   *
   * `NavBar` carried an inline button with the same `data-testid="theme-toggle"` as
   * `ThemeToggle.tsx`, and `getByTestId` returns the first match rather than
   * complaining — so a suite asserting on the toggle could have been asserting on
   * either one, and neither test would have said so. `getAllByTestId` plus a length
   * of one is the assertion that would have caught it, because it fails on a
   * duplicate instead of choosing.
   */
  it('renders exactly one theme control', async () => {
    renderRouted(
      <ThemeProvider>
        <NavBar />
      </ThemeProvider>,
    );
    // `waitFor` rather than a bare `getAllByTestId`: `renderRouted` mounts through a
    // memory router, so the outlet is not in the document on the first tick. A
    // synchronous query here would fail for a reason unrelated to what it asserts.
    await waitFor(() => expect(screen.getAllByTestId('theme-toggle')).toHaveLength(1));
  });

  it('gives the theme control a name that says where pressing it lands', async () => {
    // Not "Toggle theme": a name that does not say which theme is active and which
    // one comes next makes the control's effect something the reader has to discover
    // by pressing it.
    renderRouted(
      <ThemeProvider>
        <NavBar />
      </ThemeProvider>,
    );
    const toggle = await screen.findByTestId('theme-toggle');
    expect(toggle).toHaveAccessibleName(/Theme: .*\. Switch to .*\./);
  });
});
