/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Sidebar } from './Sidebar';
import { createMemoryHistory, RouterProvider, createRouter, createRootRoute } from '@tanstack/react-router';

const rootRoute = createRootRoute({
  component: () => (
    <Sidebar />
  ),
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
});
