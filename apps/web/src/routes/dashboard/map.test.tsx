/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { MapPage } from './map';
import { makeQa, makeScan } from '../../test-utils';
import type { QaClient } from '../../lib/qa-client';
import type { MapSearch } from '../../lib/repo-map';

function renderPage(qa: QaClient, state: Partial<MapSearch> = {}) {
  const onStateChange = vi.fn();
  const rootRoute = createRootRoute({
    component: () => (
      <MapPage
        qa={qa}
        state={{ view: 'flow', node: undefined, path: false, ...state }}
        onStateChange={onStateChange}
      />
    ),
  });
  const router = createRouter({ routeTree: rootRoute });
  router.update({ history: createMemoryHistory({ initialEntries: ['/dashboard/map'] }) });
  render(<RouterProvider router={router} />);
  return onStateChange;
}

describe('the map page', () => {
  it('draws the repository from the scan, the score and the readiness card', async () => {
    const qa = makeQa({
      getScan: vi.fn(async () => makeScan()),
      getScore: vi.fn(async () => {
        throw new Error('no score yet');
      }),
    });
    renderPage(qa);
    await waitFor(() => expect(screen.getByTestId('map-canvas')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Map' })).toBeInTheDocument();
    expect(qa.getScan).toHaveBeenCalledWith('project-1');
    expect(qa.getReadiness).toHaveBeenCalledWith('project-1', 7);
    // The score failed, so the layers say they were not measured rather than passing.
    expect(screen.getByTestId('map-partial')).toHaveTextContent('score: no score yet');
    expect(document.querySelector('[data-node="layer:unit"]')).toHaveAttribute(
      'data-status',
      'unknown',
    );
    // makeReadiness is a caution.
    expect(document.querySelector('[data-node="verdict"]')).toHaveAttribute('data-status', 'warn');
  });

  it('draws the packages view when the link asks for it', async () => {
    renderPage(makeQa({ getScan: vi.fn(async () => makeScan()) }), { view: 'packages' });
    await waitFor(() => expect(document.querySelector('[data-node="repo"]')).not.toBeNull());
    expect(
      screen.getByRole('group', { name: 'Repository map, packages view' }),
    ).toBeInTheDocument();
  });

  it('names a failed scan as a failure, because there is no map without one', async () => {
    renderPage(
      makeQa({
        getScan: vi.fn(async () => {
          throw new Error('scan exploded');
        }),
      }),
    );
    expect(await screen.findByTestId('map-error')).toHaveTextContent('scan exploded');
  });

  it('says it is reading while the scan is in flight', async () => {
    renderPage(makeQa({ getScan: vi.fn(() => new Promise<never>(() => undefined)) }));
    expect(await screen.findByTestId('map-loading')).toHaveTextContent('Mapping Automate');
  });
});
