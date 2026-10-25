/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NavBar, BottomTabBar, SectionTabs } from './NavBar';
import { ThemeProvider } from '../theme/ThemeProvider';
import { expectNoBlockingAxeViolations } from '../test-axe';
import {
  createMemoryHistory,
  RouterProvider,
  createRouter,
  createRootRoute,
} from '@tanstack/react-router';

function makeRouter(initialPath = '/') {
  const rootRoute = createRootRoute({
    component: () => (
      <ThemeProvider>
        <NavBar />
        <SectionTabs />
        <BottomTabBar />
      </ThemeProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute });
  const memoryHistory = createMemoryHistory({ initialEntries: [initialPath] });
  router.update({ history: memoryHistory });
  return router;
}

const SECTION_LABELS = ['Overview', 'Runs', 'Insights', 'Map'];

describe('NavBar', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('toggles theme', async () => {
    render(<RouterProvider router={makeRouter()} />);
    const themeBtn = await screen.findByTestId('theme-toggle');
    fireEvent.click(themeBtn);
    expect(localStorage.getItem('automate-theme')).toBeDefined();
  });

  /*
   * The cycle is `dark → light → system → dark`, which is the declaration order of
   * `THEMES` in `ThemeProvider.tsx`. These cases exercise the real provider and real
   * `localStorage`; `ThemeToggle.test.tsx` covers the arithmetic against a mocked hook.
   */
  it('theme cycles: light → system when starting from light', async () => {
    localStorage.setItem('automate-theme', 'light');
    render(<RouterProvider router={makeRouter()} />);
    fireEvent.click(await screen.findByTestId('theme-toggle'));
    expect(localStorage.getItem('automate-theme')).toBe('system');
  });

  it('theme cycles: dark → light when starting from dark', async () => {
    localStorage.setItem('automate-theme', 'dark');
    render(<RouterProvider router={makeRouter()} />);
    fireEvent.click(await screen.findByTestId('theme-toggle'));
    expect(localStorage.getItem('automate-theme')).toBe('light');
  });

  it('draws the four sections, and nothing else, in the top bar', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bar = await screen.findByTestId('nav-bar');
    const links = within(bar).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(SECTION_LABELS);
  });

  it('renders the product wordmark once, in the corner', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await screen.findByTestId('nav-bar');
    expect(screen.getByTestId('nav-wordmark')).toHaveTextContent('Automate');
    // Exactly once. A second copy is the rename having half happened — which is
    // what the retired-name gate in `scripts/lib/product-name.test.mjs` exists for.
    expect(screen.getAllByText('Automate')).toHaveLength(1);
  });

  it.each([
    ['/dashboard', 'Overview'],
    ['/dashboard/runs/run-1', 'Runs'],
    ['/dashboard/runner', 'Runs'],
    ['/dashboard/analytics', 'Insights'],
    ['/dashboard/flaky/project-1', 'Insights'],
    ['/dashboard/health', 'Map'],
  ])('marks %s as inside the %s section, in both bars', async (path, label) => {
    render(<RouterProvider router={makeRouter(path)} />);
    const bar = await screen.findByTestId('nav-bar');
    const bottom = screen.getByTestId('bottom-tab-bar');
    for (const nav of [bar, bottom]) {
      const current = within(nav)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');
      expect(current.map((link) => link.textContent)).toEqual([label]);
    }
  });

  it('gives the bottom bar four labelled, finger-sized targets', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bottom = await screen.findByTestId('bottom-tab-bar');
    expect(bottom).toHaveAttribute('aria-label', 'Sections');
    const links = within(bottom).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(SECTION_LABELS);
    for (const link of links) expect(link).toHaveClass('min-h-14');
    // Hidden from `lg` up, where the top bar carries the sections.
    expect(bottom).toHaveClass('lg:hidden');
  });

  it('navigates from the bottom bar', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    const bottom = await screen.findByTestId('bottom-tab-bar');
    fireEvent.click(within(bottom).getByRole('link', { name: 'Insights' }));
    await waitFor(() =>
      expect(within(bottom).getByRole('link', { name: 'Insights' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
  });

  it('shows the section tabs for a section with more than one page', async () => {
    render(<RouterProvider router={makeRouter('/dashboard/analytics')} />);
    const tabs = await screen.findByTestId('section-tabs');
    expect(tabs).toHaveAttribute('aria-label', 'Insights pages');
    const links = within(tabs).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Tests', 'Trends', 'Quarantine']);
    expect(within(tabs).getByRole('link', { name: 'Trends' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows the portfolio and project tabs on the overview, and none on a detail page', async () => {
    const { unmount } = render(<RouterProvider router={makeRouter('/dashboard')} />);
    const tabs = await screen.findByTestId('section-tabs');
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Portfolio', 'Project']);
    unmount();
    render(<RouterProvider router={makeRouter('/dashboard/runs/run-1')} />);
    await screen.findByTestId('nav-bar');
    expect(screen.queryByTestId('section-tabs')).toBeNull();
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(<RouterProvider router={makeRouter('/dashboard/runner')} />);
    await screen.findByTestId('section-tabs');
    await expectNoBlockingAxeViolations(container);
  });
});
