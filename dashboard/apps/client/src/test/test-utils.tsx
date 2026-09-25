/**
 * Shared test utilities for client component/hook tests.
 *
 * Provides:
 * - renderWithProviders: wraps components in QueryClientProvider with testing defaults
 * - createTestQueryClient: creates a QueryClient with retries disabled
 * - Convenient re-exports from @testing-library/react
 */
import React, { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Create a QueryClient configured for tests:
 * - No retries (fail fast)
 * - No cache time (isolate between tests)
 * - No refetch on mount
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

interface WrapperProps {
  children: ReactNode;
}

/**
 * Render a component wrapped in all required providers for testing.
 * Each call gets a fresh QueryClient.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: WrapperProps) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    queryClient,
  };
}

// Re-export everything from testing-library for convenience
export { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
