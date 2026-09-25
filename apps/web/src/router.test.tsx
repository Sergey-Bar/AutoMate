/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { router } from './router';
import { resetAuthState } from './auth/useAuth.js';

// Mock window.scrollTo
window.scrollTo = vi.fn();

describe('Unified Web Skeleton', () => {
  beforeEach(() => {
    resetAuthState();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    resetAuthState();
  });

  it('renders the NavBar, Sidebar, and correct labels', async () => {
    const memoryHistory = createMemoryHistory({
      initialEntries: ['/'],
    });

    router.update({ history: memoryHistory });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      // Verify NavBar links exist
      expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0);
    });

    expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  const routes = [
    { path: '/dashboard', testId: 'dashboard-page', text: 'Dashboard' },
    { path: '/login', testId: 'login-page', text: 'Login' },
  ];

  for (const r of routes) {
    it(`renders the ${r.path} route without crashing`, async () => {
      const memoryHistory = createMemoryHistory({
        initialEntries: [r.path],
      });
      router.update({ history: memoryHistory });

      const { unmount } = render(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
        if (r.testId) {
          expect(screen.getByTestId(r.testId)).toBeInTheDocument();
        } else {
          // Check that the text of the component appears at least once.
          // We can use queryAllByText because NavBar also has these labels.
          const elements = screen.queryAllByText(r.text);
          expect(elements.length).toBeGreaterThan(0);
        }
      });

      unmount();
    });
  }
});
