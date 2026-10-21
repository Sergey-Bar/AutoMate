/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { RepoMap } from './RepoMap';
import { buildRepoMap, type MapInput, type MapSearch } from '../../lib/repo-map';
import { expectNoBlockingAxeViolations } from '../../test-axe';

const INPUT: MapInput = {
  projectName: 'Automate',
  scan: {
    sourceFiles: 10,
    testFiles: 4,
    tools: [
      {
        id: 'test',
        name: 'test',
        label: 'pnpm test',
        kind: 'unit',
        argv: ['pnpm', 'test'],
        workingDirectory: 'apps/web',
        source: 'package.json',
        evidence: 'vitest run',
        runnable: true,
        reason: null,
      },
    ],
    reports: [
      {
        path: 'apps/web/junit.xml',
        kind: 'tests',
        format: 'junit',
        headline: '2 of 40 tests failed',
        metrics: { failed: 2, passed: 38 },
        status: 'bad',
      },
    ],
    detected: [
      { id: 'vitest', name: 'Vitest', capability: 'unit', evidence: 'vitest.config.ts' },
      { id: 'playwright', name: 'Playwright', capability: 'e2e', evidence: 'playwright.config.ts' },
    ],
  },
  score: null,
  readiness: {
    projectId: 'project-1',
    verdict: 'no-go',
    reasons: [{ code: 'gate', level: 'no-go', message: 'The gate failed', evidence: 'run 9' }],
    evaluatedAt: '2026-10-21T00:00:00.000Z',
  },
};

/** The map is controlled; this is the state a route would hold in the URL. */
function Harness({
  initial,
  onChange,
}: {
  initial: MapSearch;
  onChange?: (next: MapSearch) => void;
}): React.ReactElement {
  const [state, setState] = React.useState(initial);
  const map = React.useMemo(() => buildRepoMap(INPUT, state.view), [state.view]);
  return (
    <RepoMap
      map={map}
      state={state}
      onStateChange={(next) => {
        onChange?.(next);
        setState(next);
      }}
    />
  );
}

function renderMap(initial: Partial<MapSearch> = {}, onChange?: (next: MapSearch) => void) {
  const state: MapSearch = { view: 'flow', node: undefined, path: false, ...initial };
  const rootRoute = createRootRoute({
    component: () => <Harness initial={state} onChange={onChange} />,
  });
  const router = createRouter({ routeTree: rootRoute });
  router.update({ history: createMemoryHistory({ initialEntries: ['/dashboard/map'] }) });
  return render(<RouterProvider router={router} />);
}

function node(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-node="${id}"]`);
  if (found === null) throw new Error(`no node ${id}`);
  return found;
}

function edge(id: string): Element {
  const found = document.querySelector(`[data-edge="${id}"]`);
  if (found === null) throw new Error(`no edge ${id}`);
  return found;
}

describe('the repo map', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('explains an unscored map above the canvas', async () => {
    renderMap();
    expect(await screen.findByTestId('map-notice')).toHaveTextContent(
      'No test layer has been scored yet',
    );
  });

  it('draws every column, and names each node’s status in words', async () => {
    renderMap();
    const canvas = await screen.findByTestId('map-canvas');
    for (const column of ['Code', 'Layers', 'Tools', 'Reports', 'Verdict']) {
      expect(within(canvas).getByRole('list', { name: column })).toBeInTheDocument();
    }
    expect(node('reports:tests')).toHaveAccessibleName('Tests, 1 report, failing');
    expect(node('verdict')).toHaveAccessibleName('No-go, release readiness, failing');
    expect(node('layer:unit')).toHaveAccessibleName('Unit, score unread, not measured');
    expect(screen.getByTestId('map-legend')).toHaveTextContent('Failing');
  });

  it('switches between the flow and the packages view', async () => {
    const onChange = vi.fn();
    renderMap({}, onChange);
    fireEvent.click(await screen.findByRole('button', { name: 'Packages' }));
    expect(onChange).toHaveBeenLastCalledWith({ view: 'packages', node: undefined, path: false });
    await waitFor(() => expect(node('pkg:apps/web')).toBeInTheDocument());
  });

  it('traces a node’s lineage on focus and dims everything else', async () => {
    renderMap();
    await screen.findByTestId('map-canvas');
    fireEvent.focus(node('tool:playwright'));
    expect(node('layer:e2e')).toHaveAttribute('data-dimmed', 'false');
    expect(node('tool:vitest')).toHaveAttribute('data-dimmed', 'true');
    expect(edge('layer:e2e->tool:playwright')).toHaveAttribute('data-lit', 'true');
    expect(edge('layer:unit->tool:vitest')).toHaveAttribute('data-lit', 'false');
    fireEvent.blur(node('tool:playwright'));
    expect(node('tool:vitest')).toHaveAttribute('data-dimmed', 'false');
  });

  it('shows the blocking path on request, and keeps it in the state', async () => {
    const onChange = vi.fn();
    renderMap({}, onChange);
    const toggle = await screen.findByRole('button', { name: 'Show blocking path' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(edge('reports:tests->verdict')).toHaveAttribute('data-blocking', 'false');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith({ view: 'flow', node: undefined, path: true });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(edge('reports:tests->verdict')).toHaveAttribute('data-blocking', 'true');
    expect(edge('code->layer:unit')).toHaveAttribute('data-blocking', 'false');
  });

  it('moves between nodes with the arrow keys, down a column and across', async () => {
    renderMap();
    await screen.findByTestId('map-canvas');
    node('layer:unit').focus();
    fireEvent.keyDown(node('layer:unit'), { key: 'ArrowDown' });
    expect(node('layer:integration')).toHaveFocus();
    fireEvent.keyDown(node('layer:integration'), { key: 'ArrowUp' });
    expect(node('layer:unit')).toHaveFocus();
    fireEvent.keyDown(node('layer:unit'), { key: 'ArrowRight' });
    expect(node('tool:vitest')).toHaveFocus();
    fireEvent.keyDown(node('tool:vitest'), { key: 'ArrowLeft' });
    expect(node('layer:unit')).toHaveFocus();
    fireEvent.keyDown(node('layer:unit'), { key: 'ArrowUp' });
    expect(node('layer:unit')).toHaveFocus();
  });

  it('opens a node’s evidence, with a next step, and closes three ways', async () => {
    const onChange = vi.fn();
    renderMap({}, onChange);
    await screen.findByTestId('map-canvas');
    fireEvent.click(node('reports:tests'));
    expect(onChange).toHaveBeenLastCalledWith({ view: 'flow', node: 'reports:tests', path: false });
    const title = await screen.findByRole('heading', { name: 'Tests' });
    expect(title).toHaveFocus();
    const details = screen.getByTestId('map-detail');
    expect(details).toHaveTextContent('2 of 40 tests failed');
    expect(details).toHaveTextContent('apps/web/junit.xml');
    expect(within(details).getByRole('link', { name: 'Open capabilities' })).toHaveAttribute(
      'href',
      '/dashboard/health',
    );

    // 1. The close button.
    fireEvent.click(within(details).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('map-detail')).toBeNull());
    expect(onChange).toHaveBeenLastCalledWith({ view: 'flow', node: undefined, path: false });

    // 2. Escape, which the native dialog turns into a close event.
    fireEvent.click(node('reports:tests'));
    const again = await screen.findByTestId('map-detail');
    const dialog = again.closest('dialog');
    if (dialog === null) throw new Error('the detail is not in a dialog');
    fireEvent(dialog, new Event('cancel'));
    dialog.close();
    await waitFor(() => expect(screen.queryByTestId('map-detail')).toBeNull());

    // 3. The backdrop: a press that starts and ends on the dialog element itself.
    fireEvent.click(node('reports:tests'));
    const third = (await screen.findByTestId('map-detail')).closest('dialog');
    if (third === null) throw new Error('the detail is not in a dialog');
    fireEvent.pointerDown(third);
    fireEvent.click(third);
    await waitFor(() => expect(screen.queryByTestId('map-detail')).toBeNull());
  });

  it('reopens a shared link in the same state', async () => {
    renderMap({ view: 'flow', node: 'verdict', path: true });
    expect(await screen.findByTestId('map-detail')).toHaveTextContent('The gate failed');
    expect(screen.getByRole('button', { name: 'Show blocking path' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('ignores a shared node id that is not on the map', async () => {
    renderMap({ node: 'gone' });
    await screen.findByTestId('map-canvas');
    expect(screen.queryByTestId('map-detail')).toBeNull();
  });

  it('becomes a list per column on a narrow screen, with the same detail', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    renderMap();
    const list = await screen.findByTestId('map-list');
    expect(screen.queryByTestId('map-canvas')).toBeNull();
    expect(within(list).getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    fireEvent.click(node('reports:tests'));
    expect(await screen.findByTestId('map-detail')).toHaveTextContent('2 of 40 tests failed');
  });

  it('animates only opacity, and not at all under reduced motion', async () => {
    renderMap();
    await screen.findByTestId('map-canvas');
    expect(node('code')).toHaveClass('transition-opacity', 'motion-reduce:transition-none');
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = renderMap({ path: true });
    await screen.findByTestId('map-canvas');
    await expectNoBlockingAxeViolations(container);
  });
});
