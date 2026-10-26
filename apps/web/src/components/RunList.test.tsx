import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RunList } from './RunList.js';
import { makeApi, makePhaseEvent, makeRun } from '../test-utils.js';
import type { RunEventSubscription } from '../lib/api.js';

describe('RunList', () => {
  it('renders loading, empty, and populated states', async () => {
    const loading = render(
      <RunList
        api={makeApi({
          getRuns: vi.fn(() => new Promise<ReturnType<typeof makeRun>[]>(() => undefined)),
        })}
      />,
    );
    expect(screen.getByTestId('runs-loading')).toBeInTheDocument();
    loading.unmount();

    const empty = render(<RunList api={makeApi()} />);
    await waitFor(() => expect(screen.getByTestId('runs-empty')).toBeInTheDocument());
    empty.unmount();

    const runs = [
      makeRun({ id: 'run-1', projectId: 'project-a', phase: 'running' }),
      makeRun({ id: 'run-2', projectId: 'project-b', phase: 'complete', outcome: 'passed' }),
    ];
    render(<RunList api={makeApi({ getRuns: vi.fn().mockResolvedValue(runs) })} />);
    await waitFor(() => expect(screen.getByTestId('run-item-run-1')).toBeInTheDocument());
    expect(screen.getByTestId('run-item-run-2')).toBeInTheDocument();
    expect(screen.getByTestId('run-status-run-2')).toHaveTextContent('passed');
  });

  it('renders API errors', async () => {
    render(
      <RunList
        api={makeApi({ getRuns: vi.fn().mockRejectedValue(new Error('API unavailable')) })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('runs-error')).toHaveTextContent('API unavailable'),
    );
  });

  it('updates canonical phase from a live event', async () => {
    let subscription: RunEventSubscription | undefined;
    const api = makeApi({
      getRuns: vi.fn().mockResolvedValue([makeRun({ id: 'run-1', phase: 'queued' })]),
      subscribeToRunEvents: vi.fn((value) => {
        subscription = value;
        return () => undefined;
      }),
    });
    render(<RunList api={api} />);
    await waitFor(() => expect(screen.getByTestId('run-item-run-1')).toBeInTheDocument());
    await waitFor(() => expect(subscription).toBeDefined());
    subscription?.onEvent(makePhaseEvent({ phase: 'running' }));
    // Wait on the change the event makes. `PENDING` held before the event too, so waiting
    // on it synchronised nothing and the phase was asserted before the update rendered.
    await waitFor(() => expect(screen.getByTestId('run-item-run-1')).toHaveTextContent('running'));
    expect(screen.getByTestId('run-status-run-1')).toHaveTextContent('PENDING');
  });
});
