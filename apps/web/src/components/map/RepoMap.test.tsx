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

  it('says why the blocking path is empty instead of a pressed toggle drawing nothing', async () => {
    const quiet = buildRepoMap(
      { ...INPUT, scan: { ...INPUT.scan, reports: [] }, score: { cells: [] } },
      'flow',
    );
    const rootRoute = createRootRoute({
      component: () => (
        <RepoMap
          map={quiet}
          state={{ view: 'flow', node: undefined, path: true }}
          onStateChange={() => undefined}
        />
      ),
    });
    const router = createRouter({ routeTree: rootRoute });
    router.update({ history: createMemoryHistory({ initialEntries: ['/dashboard/map'] }) });
    render(<RouterProvider router={router} />);
    expect(await screen.findByTestId('map-path-note')).toHaveTextContent(
      'Nothing on this view explains the No-go',
    );
  });

  it('draws every column, and names each node’s status in words', async () => {
    renderMap();
    const canvas = await screen.findByTestId('map-canvas');
    for (const column of ['Code', 'Layers', 'Tools', 'Reports', 'Verdict']) {
      expect(within(canvas).getByRole('list', { name: column })).toBeInTheDocument();
    }
    expect(node('reports:tests')).toHaveAccessibleName(/^Tests\s*,\s*1 report\s*,\s*failing$/);
    expect(node('verdict')).toHaveAccessibleName(/^No-go\s*,\s*release readiness\s*,\s*failing$/);
    expect(node('layer:unit')).toHaveAccessibleName(/^Unit\s*,\s*score unread\s*,\s*not measured$/);
    expect(screen.getByTestId('map-legend')).toHaveTextContent('Failing');
  });

  it('takes each node’s name from what it shows, so the visible words are in the name', async () => {
    // WCAG 2.5.3, Label in Name. An `aria-label` replaces the content as the name, and
    // axe 4.14's `label-content-name-mismatch` failed every node: the visible text runs
    // the label and the detail together, which the punctuated `aria-label` did not
    // contain. A name computed from the content contains the visible text by
    // construction, and the status word rides along as screen-reader-only text.
    renderMap();
    await screen.findByTestId('map-canvas');
    for (const id of ['reports:tests', 'verdict', 'layer:unit']) {
      expect(node(id)).not.toHaveAttribute('aria-label');
    }
    expect(node('reports:tests')).toHaveAccessibleName(/^Tests\s*,\s*1 report\s*,\s*failing$/);
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

  it('highlights a trace under the pointer, ignores keys that are not arrows, and stops at the last column', async () => {
    renderMap();
    await screen.findByTestId('map-canvas');
    // Pointer: entering a node traces it and dims the rest; leaving restores everything.
    fireEvent.mouseEnter(node('layer:e2e'));
    expect(node('layer:e2e')).toHaveAttribute('data-dimmed', 'false');
    expect(node('tool:vitest')).toHaveAttribute('data-dimmed', 'true');
    fireEvent.mouseLeave(node('layer:e2e'));
    expect(node('tool:vitest')).toHaveAttribute('data-dimmed', 'false');
    // A key that is not an arrow is not handled, so the browser keeps its default for it.
    node('layer:unit').focus();
    expect(fireEvent.keyDown(node('layer:unit'), { key: 'a' })).toBe(true);
    expect(node('layer:unit')).toHaveFocus();
    // An arrow with nowhere to go (right of the last column) leaves focus where it is.
    node('verdict').focus();
    fireEvent.keyDown(node('verdict'), { key: 'ArrowRight' });
    expect(node('verdict')).toHaveFocus();
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

  it('returns focus to the node when a shared-link detail closes', async () => {
    renderMap({ node: 'verdict' });
    const details = await screen.findByTestId('map-detail');
    fireEvent.click(within(details).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(node('verdict')).toHaveFocus());
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
