/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { RunnerPage, inGroup, toolForRun } from './runner';
import { makeApi, makeQa, makeRun, makeScan, makeTool } from '../../test-utils';
import type { QaClient } from '../../lib/qa-client';
import type { ApiClient } from '../../lib/api';

/**
 * The runner page.
 *
 * The claim that matters is the one the page cannot make by itself: **only a tool the
 * server scanned can be started, and only after the operator has seen its argv.** The
 * assertions are about what the confirmation shows and what the click sends.
 */
function renderRunner(qa: QaClient, api: ApiClient = makeApi()) {
  const rootRoute = createRootRoute({ component: () => <RunnerPage qa={qa} api={api} /> });
  const router = createRouter({ routeTree: rootRoute });
  router.update({ history: createMemoryHistory({ initialEntries: ['/dashboard/runner'] }) });
  return render(<RouterProvider router={router} />);
}

describe('the runner', () => {
  it('lists the scanned tools, with the ones that never exit disabled and explained', async () => {
    renderRunner(makeQa());
    await waitFor(() => expect(screen.getByTestId('tool-script:.:test')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Launch' })).toBeInTheDocument();
    expect(screen.getByText('3 runnable of 4 tools declared in Automate')).toBeInTheDocument();
    expect(screen.getByTestId('run-script:.:dev')).toBeDisabled();
    expect(screen.getByTestId('tool-script:.:dev')).toHaveTextContent('long-running server');
    expect(screen.getByTestId('tool-script:apps/web:test:e2e')).toHaveTextContent('apps/web');
  });

  it('filters by group and by text, and counts each group', async () => {
    renderRunner(makeQa());
    await waitFor(() => expect(screen.getByTestId('group-tests')).toHaveTextContent('Tests2'));
    fireEvent.click(screen.getByTestId('group-quality'));
    expect(screen.getByTestId('group-quality')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('tool-script:.:lint')).toBeInTheDocument();
    expect(screen.queryByTestId('tool-script:.:test')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('group-all'));
    fireEvent.change(screen.getByTestId('runner-filter'), { target: { value: 'apps/web' } });
    expect(within(screen.getByTestId('runner-tools')).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.change(screen.getByTestId('runner-filter'), {
      target: { value: 'nothing-like-this' },
    });
    expect(screen.getByText('No tool matches.')).toBeInTheDocument();
  });

  it('shows the argv token by token before it runs, and sends only the tool id', async () => {
    const qa = makeQa();
    const getRuns = vi.fn(async () => []);
    renderRunner(qa, makeApi({ getRuns }));
    await waitFor(() => expect(screen.getByTestId('run-script:.:lint')).toBeEnabled());
    fireEvent.click(screen.getByTestId('run-script:.:lint'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Run lint?' })).toBeInTheDocument();
    const tokens = within(within(dialog).getByRole('list', { name: 'Command' })).getAllByRole(
      'listitem',
    );
    expect(tokens.map((token) => token.textContent)).toEqual(['pnpm', 'run', 'lint']);
    expect(dialog).toHaveTextContent('eslint .');
    expect(dialog).toHaveTextContent('the repository root');

    fireEvent.click(within(dialog).getByTestId('confirm-run-submit'));
    await waitFor(() => expect(qa.startRun).toHaveBeenCalledOnce());
    const [projectId, toolId, key] = vi.mocked(qa.startRun).mock.calls[0] ?? [];
    expect([projectId, toolId]).toEqual(['project-1', 'script:.:lint']);
    expect(key).toMatch(/[0-9a-f-]{36}/u);
    await waitFor(() =>
      expect(screen.getByTestId('runner-started')).toHaveTextContent('Queued pnpm run lint.'),
    );
    expect(screen.getByRole('link', { name: 'Open the run' })).toHaveAttribute(
      'href',
      '/dashboard/runs/run-new',
    );
    // The activity panel is refreshed so the new run appears without a reload.
    await waitFor(() => expect(getRuns.mock.calls.length).toBeGreaterThan(1));
  });

  it('keeps the dialog open with the server’s own sentence when a start is refused', async () => {
    const qa = makeQa({
      startRun: vi.fn(async () => {
        throw Object.assign(new Error('API answered 400'), { detail: 'cannot be run as a job' });
      }),
    });
    renderRunner(qa);
    await waitFor(() => expect(screen.getByTestId('run-script:apps/web:test:e2e')).toBeEnabled());
    fireEvent.click(screen.getByTestId('run-script:apps/web:test:e2e'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('in apps/web');
    fireEvent.click(within(dialog).getByTestId('confirm-run-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('confirm-run-error')).toHaveTextContent('cannot be run as a job'),
    );
    expect(screen.queryByTestId('runner-started')).not.toBeInTheDocument();
  });

  it('reports a plain error, and closes on cancel', async () => {
    const qa = makeQa({
      startRun: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    renderRunner(qa);
    await waitFor(() => expect(screen.getByTestId('run-script:.:test')).toBeEnabled());
    fireEvent.click(screen.getByTestId('run-script:.:test'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByTestId('confirm-run-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('confirm-run-error')).toHaveTextContent('network down'),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Run test?' })).not.toBeInTheDocument(),
    );
  });

  it('rescans on demand, skipping the server cache', async () => {
    const qa = makeQa();
    renderRunner(qa);
    await waitFor(() => expect(qa.getScan).toHaveBeenCalledWith('project-1', false));
    fireEvent.click(screen.getByTestId('runner-rescan'));
    await waitFor(() => expect(qa.getScan).toHaveBeenLastCalledWith('project-1', true));
  });

  it('shows the latest runs live, with their status as a live region', async () => {
    const runs = [
      makeRun({ id: 'r1', suite: 'pnpm run lint', phase: 'running' }),
      makeRun({ id: 'r2', phase: 'complete', outcome: 'passed' }),
      makeRun({ id: 'r3', phase: 'complete', outcome: 'failed' }),
      makeRun({ id: 'r4', phase: 'cancelled', outcome: 'cancelled' }),
    ];
    renderRunner(makeQa(), makeApi({ getRuns: vi.fn(async () => runs) }));
    await waitFor(() =>
      expect(screen.getByTestId('activity-r1')).toHaveTextContent('pnpm run lint'),
    );
    expect(screen.getByTestId('activity-r2')).toHaveTextContent('r2');
    expect(within(screen.getByTestId('activity-r3')).getByRole('status')).toHaveTextContent(
      'failed',
    );
    expect(within(screen.getByTestId('activity-r4')).getByRole('status')).toHaveTextContent(
      'cancelled',
    );
  });

  it('says so when the repository cannot be scanned', async () => {
    renderRunner(
      makeQa({
        getScan: vi.fn(async () => {
          throw new Error('no path');
        }),
      }),
    );
    await waitFor(() => expect(screen.getByTestId('runner-error')).toHaveTextContent('no path'));
  });

  it('shows the loading state while the scan is in flight', async () => {
    renderRunner(makeQa({ getScan: vi.fn(() => new Promise<never>(() => undefined)) }));
    await waitFor(() => expect(screen.getByTestId('runner-loading')).toBeInTheDocument());
  });

  it('pages a long list instead of scrolling it', async () => {
    const tools = Array.from({ length: 12 }, (_, index) =>
      makeTool({
        id: `script:.:t${String(index)}`,
        name: `t${String(index)}`,
        label: `pnpm run t${String(index)}`,
      }),
    );
    renderRunner(makeQa({ getScan: vi.fn(async () => makeScan({ tools })) }));
    await waitFor(() => expect(screen.getByText('1–7 of 12')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Next tool page' }));
    expect(screen.getByText('8–12 of 12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next tool page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous tool page' }));
    expect(screen.getByText('1–7 of 12')).toBeInTheDocument();
  });

  it('groups every kind somewhere', () => {
    expect(inGroup(makeTool({ kind: 'sast' }), 'security')).toBe(true);
    expect(inGroup(makeTool({ kind: 'sast' }), 'tests')).toBe(false);
    expect(inGroup(makeTool({ kind: 'other' }), 'all')).toBe(true);
  });
});

describe('the runner, as a daily tool', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('pins a tool to the top, keeps it across a reload, and gives it its own group', async () => {
    const first = renderRunner(makeQa());
    await waitFor(() => expect(screen.getByTestId('pin-script:.:lint')).toBeInTheDocument());
    expect(screen.queryByTestId('group-pinned')).not.toBeInTheDocument();
    const order = () =>
      within(screen.getByTestId('runner-tools'))
        .getAllByRole('listitem')
        .map((item) => item.dataset['testid']);
    expect(order()[0]).toBe('tool-script:.:test');

    fireEvent.click(screen.getByTestId('pin-script:.:lint'));
    expect(screen.getByTestId('pin-script:.:lint')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('pin-script:.:lint')).toHaveAccessibleName('Unpin lint');
    expect(order()[0]).toBe('tool-script:.:lint');
    expect(JSON.parse(localStorage.getItem('automate-pinned-tools') ?? '[]')).toEqual([
      'script:.:lint',
    ]);
    fireEvent.click(screen.getByTestId('group-pinned'));
    expect(order()).toEqual(['tool-script:.:lint']);
    first.unmount();

    renderRunner(makeQa());
    await waitFor(() => expect(screen.getByTestId('group-pinned')).toHaveTextContent('Pinned1'));
    fireEvent.click(screen.getByTestId('group-pinned'));
    fireEvent.click(screen.getByTestId('pin-script:.:lint'));
    expect(screen.getByText('Nothing pinned yet.')).toBeInTheDocument();
  });

  it('reads a corrupt pin store as no pins rather than failing the page', async () => {
    localStorage.setItem('automate-pinned-tools', '{not json');
    renderRunner(makeQa());
    await waitFor(() => expect(screen.getByTestId('tool-script:.:lint')).toBeInTheDocument());
    expect(screen.queryByTestId('group-pinned')).not.toBeInTheDocument();
    localStorage.setItem('automate-pinned-tools', '{"a":1}');
    renderRunner(makeQa());
    await waitFor(() => expect(screen.getAllByTestId('tool-script:.:lint')).toHaveLength(2));
    expect(screen.queryByTestId('group-pinned')).not.toBeInTheDocument();
  });

  it('copies the command line of a tool', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderRunner(makeQa());
    await waitFor(() => expect(screen.getByTestId('tool-script:.:lint')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Copy pnpm run lint' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copied pnpm run lint' })).toBeInTheDocument(),
    );
    expect(writeText).toHaveBeenCalledWith('pnpm run lint');
  });

  it('says nothing was copied when the clipboard refuses', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied');
    });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderRunner(makeQa());
    await waitFor(() => expect(screen.getByTestId('tool-script:.:lint')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Copy pnpm run lint' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Copy pnpm run lint' })).toBeInTheDocument();
  });

  it('runs a finished run again through the same confirmation, by the id the server stored', async () => {
    const runs = [
      makeRun({ id: 'run-9', suite: 'lint', configuration: { commandId: 'script:.:lint' } }),
      makeRun({ id: 'run-8', suite: 'gone', configuration: { commandId: 'script:.:missing' } }),
    ];
    renderRunner(makeQa(), makeApi({ getRuns: vi.fn(async () => runs) }));
    await waitFor(() => expect(screen.getByTestId('again-run-9')).toBeInTheDocument());
    // A run whose tool the scan no longer has cannot be run again from here.
    expect(screen.queryByTestId('again-run-8')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run pnpm run lint again' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Run lint?' })).toBeInTheDocument();
  });

  it('finds the tool a run executed only when the scan still lists it as runnable', () => {
    const tools = makeScan().tools;
    expect(toolForRun(makeRun({ configuration: { commandId: 'script:.:lint' } }), tools)?.id).toBe(
      'script:.:lint',
    );
    expect(toolForRun(makeRun({ configuration: { commandId: 'script:.:dev' } }), tools)).toBe(
      undefined,
    );
    expect(toolForRun(makeRun({ configuration: { commandId: 7 } }), tools)).toBe(undefined);
    expect(toolForRun(makeRun({ configuration: {} }), tools)).toBe(undefined);
  });

  it('on a narrow screen, trades the groups panel for a select and the columns for tabs', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    renderRunner(makeQa());
    const select = await screen.findByTestId('runner-group-select');
    expect(screen.queryByTestId('group-all')).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'quality' } });
    expect(
      within(screen.getByTestId('runner-tools'))
        .getAllByRole('listitem')
        .map((item) => item.dataset['testid']),
    ).toEqual(['tool-script:.:lint']);
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByTestId('runner-activity')).toBeInTheDocument();
    expect(screen.queryByTestId('runner-tools')).not.toBeInTheDocument();
  });
});
