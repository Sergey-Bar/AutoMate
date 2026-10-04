import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from '../router.js';
import { LaunchRunForm } from './dashboard.js';
import { makeApi, makeRun } from '../test-utils.js';

beforeAll(() => {
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
});

function fillLaunchForm(): void {
  fireEvent.change(screen.getByTestId('launch-project-id'), { target: { value: 'project-1' } });
  fireEvent.change(screen.getByTestId('launch-environment-id'), {
    target: { value: 'environment-1' },
  });
  fireEvent.change(screen.getByTestId('launch-release-id'), { target: { value: 'release-1' } });
  fireEvent.change(screen.getByTestId('launch-branch'), { target: { value: 'main' } });
  fireEvent.change(screen.getByTestId('launch-commit'), { target: { value: 'abc123' } });
  fireEvent.change(screen.getByTestId('launch-selection'), {
    target: { value: 'e2e/smoke.spec.ts' },
  });
}

describe('dashboard routes', () => {
  /**
   * One `useRuns` on `/dashboard/runs`, not two.
   *
   * `useRuns` opens the shared run-event stream and arms a five-second poller for as
   * long as it is mounted. The dashboard component used to call it **before** its
   * `if (!isExactDashboard) return <Outlet />` guard, so every child route ran a
   * second copy: two pollers, two list fetches per cycle while the stream was down,
   * and two sets of state that nothing reconciled. The code carried a comment saying
   * the fix cost a line of coverage, which is a trade a red ratchet is right to
   * refuse — so the fix and its test land together.
   *
   * Asserted on **`setInterval`**, not on the rendered output: two pollers and one
   * list render the same page, and the leak is the poller.
   */
  it('arms one run poller on the runs route, not one per level', async () => {
    // Counted as **live** intervals, not as calls. `clearInterval` has to be
    // intercepted too, or an effect that re-runs looks like three mounted pollers
    // when only one is still armed — and "how many are armed" is the claim.
    let nextId = 1;
    const live = new Map<number, () => void>();
    const arm = vi.spyOn(window, 'setInterval').mockImplementation(((
      handler: TimerHandler,
      ms?: number,
    ) => {
      if (ms !== 5_000 || typeof handler !== 'function') return 0 as unknown as number;
      const id = nextId;
      nextId += 1;
      live.set(id, handler as () => void);
      return id as unknown as number;
    }) as typeof window.setInterval);
    const disarm = vi.spyOn(window, 'clearInterval').mockImplementation(((id?: number) => {
      live.delete(id as unknown as number);
    }) as typeof window.clearInterval);
    const runListFetches = () =>
      vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(([input]) => String(input).endsWith('/api/v1/runs')).length;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 200 });
        if (url.endsWith('/api/v1/runs')) return new Response('[]', { status: 200 });
        return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
      }),
    );
    render(<MemoryRouter initialEntries={['/dashboard/runs']} />);
    await waitFor(() => expect(screen.getByTestId('runs-list-page')).toBeInTheDocument());

    expect(live.size, 'one armed poller per mounted useRuns').toBe(1);
    // And one initial list fetch, which is the other half of the same claim: two
    // mounted copies would fetch twice before either rendered.
    expect(runListFetches()).toBe(1);

    // One tick, one fetch. Two mounted copies would fetch twice per cycle.
    const before = runListFetches();
    for (const tick of live.values()) tick();
    await waitFor(() => expect(runListFetches()).toBe(before + 1));
    arm.mockRestore();
    disarm.mockRestore();
  });

  it('renders the cockpit at /dashboard and the launch form at /dashboard/runs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 200 });
        if (url.endsWith('/api/v1/runs')) return new Response('[]', { status: 200 });
        if (url.endsWith('/api/v1/projects')) {
          return new Response(JSON.stringify({ projects: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
      }),
    );

    render(<MemoryRouter initialEntries={['/dashboard']} />);
    // The registry answered with no projects, so the cockpit's onboarding state is
    // what a bare install renders. The screen is chosen here, not a sub-state: the
    // cockpit has a report state too, and `Cockpit.test.tsx` is what covers it.
    await waitFor(() => expect(screen.getByTestId('cockpit-onboarding')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Automate' })).toBeInTheDocument();
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
    // **A home page that asks you to fill in a form before it tells you anything is a
    // form.** The cockpit reports; the runs route asks for input. Both halves asserted,
    // because moving the form without moving the evidence would have left the cockpit
    // with an empty right-hand column.
    expect(screen.queryByTestId('launch-run-form')).not.toBeInTheDocument();
    cleanup();
  });

  it('hosts the launch form and the run evidence on /dashboard/runs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 200 });
        if (url.endsWith('/api/v1/runs')) return new Response('[]', { status: 200 });
        return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
      }),
    );
    render(<MemoryRouter initialEntries={['/dashboard/runs']} />);
    await waitFor(() => expect(screen.getByTestId('runs-list-page')).toBeInTheDocument());
    expect(screen.getByTestId('launch-run-form')).toBeInTheDocument();
    expect(screen.getByTestId('release-readiness')).toHaveTextContent('UNKNOWN');
    expect(screen.queryByTestId('cockpit')).not.toBeInTheDocument();
  });

  it('creates a canonical browser run with registered execution context', async () => {
    const createRun = vi.fn().mockResolvedValue(makeRun({ id: 'created-run' }));
    const onCreated = vi.fn();
    render(<LaunchRunForm api={makeApi({ createRun })} onCreated={onCreated} />);
    fillLaunchForm();
    fireEvent.click(screen.getByTestId('launch-run-submit'));

    await waitFor(() => expect(createRun).toHaveBeenCalledOnce());
    const request = createRun.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      projectId: 'project-1',
      environmentId: 'environment-1',
      releaseId: 'release-1',
      branch: 'main',
      commit: 'abc123',
      testType: 'browser',
      framework: 'playwright',
      source: 'web',
      selection: { paths: ['e2e/smoke.spec.ts'] },
    });
    expect(request.idempotencyKey).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('launch-run-created')).toHaveTextContent('Run queued'),
    );
    expect(screen.getByRole('link', { name: 'created-run' })).toHaveAttribute(
      'href',
      '/dashboard/runs/created-run',
    );
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it('renders persisted readiness and recent canonical runs', async () => {
    const run = makeRun({ id: 'recent-run', projectId: 'registered-project', phase: 'running' });
    const readiness = {
      releaseId: 'release-1',
      decision: 'ready' as const,
      browser: 'passed' as const,
      domains: {
        browser: 'passed' as const,
        api: 'not_configured' as const,
        mobile: 'not_configured' as const,
        performance: 'not_configured' as const,
        security: 'not_configured' as const,
        accessibility: 'not_configured' as const,
        other: 'not_configured' as const,
      },
      latestRunId: run.id,
      gate: null,
      evaluatedAt: '2026-09-25T00:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 200 });
        if (url.endsWith('/api/v1/runs'))
          return new Response(JSON.stringify([run]), { status: 200 });
        if (url.endsWith('/api/v1/releases/release-1/readiness')) {
          return new Response(JSON.stringify(readiness), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
      }),
    );
    render(<MemoryRouter initialEntries={['/dashboard/runs']} />);
    await waitFor(() => expect(screen.getByTestId('release-readiness')).toHaveTextContent('READY'));
    expect(screen.getByTestId('release-readiness')).toHaveTextContent('browserPASSED');
    expect(screen.getByTestId('release-readiness')).toHaveTextContent('apiNOT_CONFIGURED');
    expect(screen.getByRole('link', { name: /recent-run/iu })).toHaveAttribute(
      'href',
      '/dashboard/runs/recent-run',
    );
  });

  it('shows the runs error state without placeholder success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 200 });
        return new Response(JSON.stringify({ error: { message: 'run store unavailable' } }), {
          status: 503,
        });
      }),
    );
    render(<MemoryRouter initialEntries={['/dashboard/runs']} />);
    await waitFor(() =>
      expect(screen.getByTestId('runs-list-error')).toHaveTextContent('run store unavailable'),
    );
    expect(screen.queryByText(/all systems operational/iu)).not.toBeInTheDocument();
  });

  it('reuses the launch idempotency key after a failed submission', async () => {
    const createRun = vi.fn().mockRejectedValue(new Error('temporary failure'));
    render(<LaunchRunForm api={makeApi({ createRun })} onCreated={vi.fn()} />);
    fillLaunchForm();
    fireEvent.click(screen.getByTestId('launch-run-submit'));
    // **The settled state, not the call.** `toHaveBeenCalledOnce` is satisfied the
    // instant the request is issued — before the rejection is handled and before
    // `isSubmitting` goes back to false — and `Button` renders a real `disabled`
    // while loading, so a click fired at that moment is dropped by the DOM rather
    // than by React. The old condition therefore raced: it passed only when the
    // rejection happened to be processed before the next poll, and it failed on the
    // `Local Release Gate`'s first ever run, which is the whole history of this
    // test being executed at load.
    //
    // The error alert is rendered *after* both `setError` and the reset, so waiting
    // for it is what "the first submission finished" looks like from outside. It
    // also asserts more than the call count did: a form that swallowed the failure
    // and left itself loading forever now fails here rather than passing.
    await waitFor(() =>
      expect(screen.getByTestId('launch-run-error')).toHaveTextContent('temporary failure'),
    );
    expect(screen.getByTestId('launch-run-submit')).toBeEnabled();
    expect(createRun).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('launch-run-submit'));
    await waitFor(() => expect(createRun).toHaveBeenCalledTimes(2));
    expect(createRun.mock.calls[0]?.[0].idempotencyKey).toBe(
      createRun.mock.calls[1]?.[0].idempotencyKey,
    );
  });

  it('shows launch failures without claiming success', async () => {
    const createRun = vi.fn().mockRejectedValue(new Error('release is not registered'));
    render(<LaunchRunForm api={makeApi({ createRun })} onCreated={vi.fn()} />);
    fillLaunchForm();
    fireEvent.click(screen.getByTestId('launch-run-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('launch-run-error')).toHaveTextContent('release is not registered'),
    );
    expect(screen.queryByTestId('launch-run-created')).not.toBeInTheDocument();
  });

  it('announces a run status change from a live region', async () => {
    const runs = [makeRun({ id: 'live-run', projectId: 'registered-project', phase: 'queued' })];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 200 });
        if (url.endsWith('/api/v1/runs'))
          return new Response(JSON.stringify(runs), { status: 200 });
        if (url.endsWith('/api/v1/releases/release-1/readiness')) {
          return new Response(JSON.stringify({ releaseId: 'release-1', decision: 'ready' }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
      }),
    );
    render(<MemoryRouter initialEntries={['/dashboard/runs']} />);
    await waitFor(() => expect(screen.getByTestId('run-status-live-run')).toBeInTheDocument());

    // The badge is a polite live region, so the status flip is spoken. Without
    // it the only signal that a run finished is a colour and a word changing
    // under a user who was not told to look.
    const status = screen.getByTestId('run-status-live-run');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('queued');
  });

  it('confines the live region to the status badge, not the whole run card', async () => {
    const runs = [makeRun({ id: 'live-run', projectId: 'registered-project', phase: 'queued' })];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 200 });
        if (url.endsWith('/api/v1/runs'))
          return new Response(JSON.stringify(runs), { status: 200 });
        return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
      }),
    );
    render(<MemoryRouter initialEntries={['/dashboard/runs']} />);
    await waitFor(() => expect(screen.getByTestId('run-status-live-run')).toBeInTheDocument());

    const status = screen.getByTestId('run-status-live-run');
    const card = screen.getByTestId('run-item-live-run');
    // A live region on the card would re-announce the run id, the project and the
    // timestamp along with the one thing that changed.
    expect(status.closest('[aria-live]')).toBe(status);
    expect(card).not.toHaveAttribute('aria-live');
    expect(card).not.toHaveAttribute('role', 'status');
    // And the phase badge, which is not the status, is not a live region either.
    expect(card.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
