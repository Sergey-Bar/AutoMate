/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { ErrorBoundary } from './ErrorBoundary.js';

// Mock lucide-react icons for simpler output
vi.mock('lucide-react', () => {
  const React = require('react') as typeof import('react');
  return {
    AlertTriangle: ({ size }: { size?: number }) =>
      React.createElement('span', { 'data-testid': 'alert-triangle', 'data-size': size }),
    RefreshCw: ({ size }: { size?: number }) =>
      React.createElement('span', { 'data-testid': 'refresh-cw', 'data-size': size }),
    Bug: ({ size }: { size?: number }) =>
      React.createElement('span', { 'data-testid': 'bug-icon', 'data-size': size }),
    WifiOff: ({ size }: { size?: number }) =>
      React.createElement('span', { 'data-testid': 'wifi-off', 'data-size': size }),
    Loader2: ({ size, className }: { size?: number; className?: string }) =>
      React.createElement('span', { 'data-testid': 'loader', 'data-size': size, className }),
  };
});

/**
 * Helper: render ErrorBoundary with a forced error state.
 * React 19 SSR (renderToString) re-throws errors instead of catching them via
 * class error boundaries, so we must force the error state directly on the instance.
 */
function renderWithError(error: Error, props: { label?: string; fallback?: (err: Error, reset: () => void) => React.ReactNode } = {}) {
  const boundary = new ErrorBoundary({ children: null, ...props });
  // Force the error state using getDerivedStateFromError
  Object.assign(boundary.state, ErrorBoundary.getDerivedStateFromError(error));
  return renderToString(boundary.render() as React.ReactElement);
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    const html = renderToString(
      <ErrorBoundary>
        <div data-testid="child">Hello</div>
      </ErrorBoundary>,
    );
    expect(html).toContain('Hello');
    expect(html).toContain('data-testid="child"');
  });

  it('renders default error card for generic errors', () => {
    const html = renderWithError(new Error('Something went kaboom'));
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Something went kaboom');
  });

  it('renders network error card for fetch/network errors', () => {
    const html = renderWithError(new Error('Failed to fetch data from server'));
    expect(html).toContain('Connection Lost');
    expect(html).toContain('Unable to reach the server');
  });

  it('renders network error card for "network" keyword', () => {
    const html = renderWithError(new Error('Network error occurred'));
    expect(html).toContain('Connection Lost');
  });

  it('renders not-found error card for 404 errors', () => {
    const html = renderWithError(new Error('Resource not found: 404'));
    expect(html).toContain('not found');
  });

  it('renders custom label in not-found card', () => {
    const html = renderWithError(new Error('not found'), { label: 'Chat' });
    expect(html).toContain('Chat not found');
  });

  it('renders custom label in generic error card', () => {
    const html = renderWithError(new Error('crash!'), { label: 'Dashboard' });
    expect(html).toContain('Dashboard crashed');
  });

  it('renders custom fallback when provided', () => {
    const html = renderWithError(new Error('custom fallback error'), {
      fallback: (err, _reset) =>
        createElement('div', { 'data-testid': 'custom-fallback' }, `Custom: ${err.message}`),
    });
    expect(html).toContain('data-testid="custom-fallback"');
    expect(html).toContain('Custom: custom fallback error');
  });

  it('renders Retry button in network error card', () => {
    const html = renderWithError(new Error('fetch failed to connect'));
    expect(html).toContain('Retry');
  });

  it('renders Try again button in generic error card', () => {
    const html = renderWithError(new Error('some generic crash'));
    expect(html).toContain('Try again');
  });

  it('renders WifiOff icon in network error card', () => {
    const html = renderWithError(new Error('network error'));
    expect(html).toContain('data-testid="wifi-off"');
  });

  it('renders Bug icon in generic error card', () => {
    const html = renderWithError(new Error('component exploded'));
    expect(html).toContain('data-testid="bug-icon"');
  });

  it('shows fallback error message when error has no message', () => {
    const html = renderWithError(new Error(''));
    expect(html).toContain('An unexpected render error occurred.');
  });

  it('componentDidCatch logs the error to console', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boundary = new ErrorBoundary({ children: null });
    const error = new Error('render failure');
    const info = { componentStack: '\n  at SomeComponent' };
    boundary.componentDidCatch(error, info);
    expect(spy).toHaveBeenCalledWith('[ErrorBoundary]', error, info.componentStack);
    spy.mockRestore();
  });

  it('reset() clears the error state', () => {
    const boundary = new ErrorBoundary({ children: null });
    Object.assign(boundary.state, ErrorBoundary.getDerivedStateFromError(new Error('oops')));
    expect(boundary.state.error).not.toBeNull();
    // Call reset directly
    boundary.setState = vi.fn((updater) => {
      if (typeof updater === 'function') {
        Object.assign(boundary.state, updater(boundary.state));
      } else {
        Object.assign(boundary.state, updater);
      }
    });
    boundary.reset();
    expect(boundary.setState).toHaveBeenCalledWith({ error: null });
  });
});

describe('detectErrorVariant (via ErrorBoundary behavior)', () => {
  it('detects "econnrefused" as network error', () => {
    const html = renderWithError(new Error('ECONNREFUSED connection refused'));
    expect(html).toContain('Connection Lost');
  });

  it('detects "load failed" as network error', () => {
    const html = renderWithError(new Error('load failed'));
    expect(html).toContain('Connection Lost');
  });

  it('detects "not found" as not-found error', () => {
    const html = renderWithError(new Error('resource not found'));
    expect(html).toContain('Resource not found');
  });
});
