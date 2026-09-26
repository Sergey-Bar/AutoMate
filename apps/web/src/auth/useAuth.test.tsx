import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useAuth, resetAuthState } from './useAuth.js';

function AuthProbe() {
  const { isAuthenticated, isChecking } = useAuth();
  if (isChecking) return <span data-testid="state">checking</span>;
  return <span data-testid="state">{isAuthenticated ? 'authenticated' : 'unauthenticated'}</span>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetAuthState();
});

describe('useAuth refresh generation', () => {
  it('ignores a session response that resolves after a reset', async () => {
    // The bug: `refreshPromise` memoised the in-flight request, and its
    // `setStatus` landed *after* `resetAuthState()`, so the next caller's state
    // was overwritten by the previous one. In the product that is a logout that
    // does not take effect until some later request.
    let resolveFirst: ((ok: boolean) => void) | undefined;
    const firstSession = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/session')) {
          const ok = await firstSession;
          return new Response('{}', { status: ok ? 200 : 401 });
        }
        return new Response('[]', { status: 200 });
      }),
    );

    const first = render(<AuthProbe />);
    expect(screen.getByTestId('state')).toHaveTextContent('checking');

    // Reset while the first request is still in flight.
    resetAuthState();
    first.unmount();

    // The stale response resolves now. It must not establish a session.
    resolveFirst?.(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A second mount starts its own refresh, which is unauthenticated.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 401 });
        return new Response('[]', { status: 200 });
      }),
    );
    render(<AuthProbe />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('unauthenticated'));
  });

  it('does not let a superseded request unblock the current one', async () => {
    let resolveStale: ((ok: boolean) => void) | undefined;
    const stale = new Promise<boolean>((resolve) => {
      resolveStale = resolve;
    });
    let calls = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.endsWith('/api/v1/auth/session')) return new Response('[]', { status: 200 });
        calls += 1;
        if (calls === 1) {
          const ok = await stale;
          return new Response('{}', { status: ok ? 200 : 401 });
        }
        return new Response('{}', { status: 200 });
      }),
    );

    const first = render(<AuthProbe />);
    resetAuthState();
    first.unmount();

    render(<AuthProbe />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('authenticated'));
    expect(calls).toBe(2);

    // The superseded request finally lands. It must not change the status and
    // must not clear the memo belonging to the current generation.
    resolveStale?.(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('state')).toHaveTextContent('authenticated');
  });
});
