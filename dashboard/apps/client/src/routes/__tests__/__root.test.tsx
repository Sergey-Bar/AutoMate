import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, waitFor, screen } from '@/test/test-utils';
import { Route } from '../__root';

const mocks = vi.hoisted(() => {
  const checkAuthStatus = vi.fn();
  const getState = vi.fn(() => ({ checkAuthStatus }));
  return {
    checkAuthStatus,
    getState,
  };
});

vi.mock('@tanstack/react-router', () => ({
  createRootRouteWithContext: () => (options: Record<string, unknown>) => options,
}));

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: () => <div data-testid="app-shell">App Shell</div>,
}));

vi.mock('@/components/shared/NotFoundPage', () => ({
  NotFoundPage: () => <div>Not Found</div>,
}));

vi.mock('@/components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/store/authStore', () => {
  const useAuthStore = ((selector: (state: { checkAuthStatus: () => Promise<void> }) => unknown) =>
    selector({ checkAuthStatus: mocks.checkAuthStatus })) as unknown as {
    getState: () => { checkAuthStatus: () => Promise<void> };
  };

  useAuthStore.getState = mocks.getState;
  return { useAuthStore };
});

describe('__root route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAuthStatus.mockResolvedValue(undefined);
  });

  it('calls checkAuthStatus from store.getState once on mount', async () => {
    const RootComponent = Route.component as React.ComponentType;
    renderWithProviders(<RootComponent />);

    await waitFor(() => {
      expect(mocks.getState).toHaveBeenCalledTimes(1);
      expect(mocks.checkAuthStatus).toHaveBeenCalledTimes(1);
    });
  });

  it('renders AppShell', () => {
    const RootComponent = Route.component as React.ComponentType;
    renderWithProviders(<RootComponent />);

    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });
});
