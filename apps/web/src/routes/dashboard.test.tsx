import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('renders the active dashboard as the release command center', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 200 });
        if (url.endsWith('/api/v1/runs')) return new Response('[]', { status: 200 });
        return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
      }),
    );
    render(<MemoryRouter initialEntries={['/dashboard']} />);
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Release Command Center' })).toBeInTheDocument();
    expect(screen.getByTestId('launch-run-form')).toBeInTheDocument();
    expect(screen.getByTestId('release-readiness')).toHaveTextContent('UNKNOWN');
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
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
    render(<MemoryRouter initialEntries={['/dashboard']} />);
    await waitFor(() => expect(screen.getByTestId('release-readiness')).toHaveTextContent('READY'));
    expect(screen.getByTestId('release-readiness')).toHaveTextContent('browserPASSED');
    expect(screen.getByTestId('release-readiness')).toHaveTextContent('apiNOT_CONFIGURED');
    expect(screen.getByRole('link', { name: /recent-run/iu })).toHaveAttribute(
      'href',
      '/dashboard/runs/recent-run',
    );
  });

  it('shows the command center error state without placeholder success', async () => {
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
    render(<MemoryRouter initialEntries={['/dashboard']} />);
    await waitFor(() =>
      expect(screen.getByTestId('command-center-error')).toHaveTextContent('run store unavailable'),
    );
    expect(screen.queryByText(/all systems operational/iu)).not.toBeInTheDocument();
  });

  it('reuses the launch idempotency key after a failed submission', async () => {
    const createRun = vi.fn().mockRejectedValue(new Error('temporary failure'));
    render(<LaunchRunForm api={makeApi({ createRun })} onCreated={vi.fn()} />);
    fillLaunchForm();
    fireEvent.click(screen.getByTestId('launch-run-submit'));
    await waitFor(() => expect(createRun).toHaveBeenCalledOnce());
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
