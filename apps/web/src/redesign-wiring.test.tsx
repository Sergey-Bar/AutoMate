/// <reference types="vitest/globals" />
import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { ProjectGate } from './components/ProjectGate';
import { useViewportRows } from './components/kit';
import { Route as healthRoute } from './routes/dashboard/health';
import { Route as runnerRoute } from './routes/dashboard/runner';
import { Route as toolboxRoute } from './routes/dashboard/toolbox';
import { Route as quarantineRoute } from './routes/dashboard/quarantine';
import { RunsListPage } from './routes/dashboard/index';
import { MemoryRouter } from './router';
import { TEST_PROJECT, makeApi, makeQa, makeRun } from './test-utils';

/**
 * The wiring the redesign added between screens: the shared project choice, the
 * viewport-sized pager, the route factories, and the runs page's launch dialog.
 */
const SECOND = { ...TEST_PROJECT, id: 'project-2', name: 'Shop' };

Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });

/** A screen inside a memory router, because the runs page links to its runs. */
function routed(element: React.ReactNode) {
  const root = createRootRoute({ component: () => <>{element}</> });
  const router = createRouter({ routeTree: root });
  router.update({ history: createMemoryHistory({ initialEntries: ['/dashboard/runs'] }) });
  return router;
}

function Subject({ qa }: { qa: ReturnType<typeof makeQa> }) {
  return (
    <ProjectGate qa={qa} title="Gate">
      {(project, switcher) => (
        <div>
          <span data-testid="subject">{project.name}</span>
          {switcher}
        </div>
      )}
    </ProjectGate>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('choosing a project', () => {
  it('offers no switcher for one project, because a choice of one is not a control', async () => {
    render(<Subject qa={makeQa()} />);
    await waitFor(() => expect(screen.getByTestId('subject')).toHaveTextContent('Automate'));
    expect(screen.queryByTestId('project-switcher')).not.toBeInTheDocument();
  });

  it('switches project, remembers it, and opens on it next time', async () => {
    const qa = makeQa({ listProjects: vi.fn(async () => [TEST_PROJECT, SECOND]) });
    const { unmount } = render(<Subject qa={qa} />);
    await waitFor(() => expect(screen.getByTestId('project-switcher')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('project-switcher'), { target: { value: 'project-2' } });
    expect(screen.getByTestId('subject')).toHaveTextContent('Shop');
    expect(localStorage.getItem('automate-project')).toBe('project-2');
    unmount();
    render(<Subject qa={qa} />);
    await waitFor(() => expect(screen.getByTestId('subject')).toHaveTextContent('Shop'));
  });

  it('falls back to the first project when the remembered one is gone', async () => {
    localStorage.setItem('automate-project', 'deleted');
    render(<Subject qa={makeQa({ listProjects: vi.fn(async () => [TEST_PROJECT, SECOND]) })} />);
    await waitFor(() => expect(screen.getByTestId('subject')).toHaveTextContent('Automate'));
  });

  it('keeps working when storage refuses to be read or written', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      render(<Subject qa={makeQa({ listProjects: vi.fn(async () => [TEST_PROJECT, SECOND]) })} />);
      await waitFor(() => expect(screen.getByTestId('project-switcher')).toBeInTheDocument());
      fireEvent.change(screen.getByTestId('project-switcher'), { target: { value: 'project-2' } });
      expect(screen.getByTestId('subject')).toHaveTextContent('Shop');
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe('a page sized to the viewport', () => {
  it('fits as many rows as the window allows, never fewer than the minimum, and follows a resize', () => {
    const height = window.innerHeight;
    try {
      Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
      const { result } = renderHook(() => useViewportRows(200, 50));
      expect(result.current).toBe(16);
      act(() => {
        Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
        window.dispatchEvent(new Event('resize'));
      });
      expect(result.current).toBe(4);
    } finally {
      Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
    }
  });
});

describe('the new routes', () => {
  it.each([
    ['/dashboard/runner', 'runner-page'],
    ['/dashboard/health', 'health-page'],
    ['/dashboard/toolbox', 'toolbox-page'],
  ])('mounts %s with its own client', async (path, testId) => {
    expect([healthRoute, runnerRoute, toolboxRoute, quarantineRoute]).toHaveLength(4);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/projects')) {
          return new Response(JSON.stringify({ projects: [TEST_PROJECT] }), { status: 200 });
        }
        if (url.endsWith('/api/v1/runs')) return new Response('[]', { status: 200 });
        return new Response(JSON.stringify({ error: { message: 'not here' } }), { status: 404 });
      }),
    );
    render(<MemoryRouter initialEntries={[path]} />);
    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
  });
});

describe('the runs page launch dialog', () => {
  it('opens the launch form, refreshes the list after a launch, and closes', async () => {
    const getRuns = vi.fn(async () => [makeRun({ id: 'r1' })]);
    const createRun = vi.fn(async () => makeRun({ id: 'created' }));
    render(
      <RouterProvider router={routed(<RunsListPage api={makeApi({ getRuns, createRun })} />)} />,
    );
    await waitFor(() => expect(screen.getByTestId('launch-run-open')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('launch-run-open'));
    for (const [id, value] of [
      ['launch-project-id', 'p'],
      ['launch-environment-id', 'e'],
      ['launch-release-id', 'r'],
      ['launch-branch', 'main'],
      ['launch-commit', 'abc'],
    ] as const) {
      fireEvent.change(screen.getByTestId(id), { target: { value } });
    }
    fireEvent.click(screen.getByTestId('launch-run-submit'));
    await waitFor(() => expect(screen.getByTestId('launch-run-created')).toBeInTheDocument());
    await waitFor(() => expect(getRuns.mock.calls.length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open'),
    );
  });
});
