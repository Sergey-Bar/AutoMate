/**
 * Shared test utilities for Automate web component and hook tests.
 *
 * Provides:
 * - renderWithProviders: wraps components in required providers
 * - Convenient re-exports from @testing-library/react
 */
import React, { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';

interface WrapperProps {
  children: ReactNode;
}

/**
 * Render a component wrapped in all required providers for testing.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  function Wrapper({ children }: WrapperProps) {
    return React.createElement(React.Fragment, null, children);
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
  };
}

// Re-export everything from testing-library for convenience
export { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
