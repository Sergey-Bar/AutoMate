/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import {
  createMemoryHistory,
  RouterProvider,
  createRouter,
  createRootRoute,
} from '@tanstack/react-router';

const rootRoute = createRootRoute({
  component: () => <Sidebar />,
});
const router = createRouter({ routeTree: rootRoute });

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('toggles and persists state', async () => {
    const memoryHistory = createMemoryHistory({ initialEntries: ['/'] });
    router.update({ history: memoryHistory });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-toggle')).toBeInTheDocument();
    });

    const toggleBtn = screen.getByTestId('sidebar-toggle');

    // Initial state is expanded
    expect(localStorage.getItem('automate-sidebar-collapsed')).toBe('false');

    fireEvent.click(toggleBtn);
    expect(localStorage.getItem('automate-sidebar-collapsed')).toBe('true');
  });

  /**
   * The collapse control's two states, both named.
   *
   * The collapsed state used to be a bare `›`. It had no accessible name — the
   * `aria-label` said "Expand navigation" while the visible glyph said nothing, so a
   * screen-reader user heard the action and a sighted user saw a character with no
   * relationship to what it does. The word "Collapse" was on the expanded state and
   * nothing was on the other one.
   *
   * Asserted on the text rather than on the icon because the icon is the thing most
   * likely to change shape again, and "the collapsed state is still labelled" is the
   * property that matters.
   */
  it('names the collapse control in both states', async () => {
    const memoryHistory = createMemoryHistory({ initialEntries: ['/'] });
    router.update({ history: memoryHistory });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-toggle')).toBeInTheDocument();
    });

    // Expanded: the visible label states the action, and the name agrees with it.
    const expanded = screen.getByTestId('sidebar-toggle');
    expect(expanded).toHaveTextContent('Collapse');
    expect(expanded).toHaveAccessibleName('Collapse navigation');

    fireEvent.click(expanded);
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-toggle')).toHaveAccessibleName('Expand navigation');
    });
    // Collapsed: still named. The glyph beside it is decorative and carries nothing.
    expect(screen.getByTestId('sidebar-toggle')).not.toHaveTextContent('Collapse');
  });
});
