import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configure } from '@testing-library/dom';
import { MemoryRouter } from './router.js';

/**
 * A render assertion with a 15s budget, on a machine also running 160 test files.
 *
 * This test timed out intermittently under load. The assertion is a render that
 * normally takes single-digit milliseconds, so a failure meant the event loop
 * was busy, not that the route was wrong â€” and a red test here is a lie about
 * the product. The assertion is unchanged; only the time it is allowed to take.
 *
 * The budget has to be set on the *test*, not only on `waitFor`: Vitest's own
 * per-test timeout is 5s and fires first, so a generous `asyncUtilTimeout` on
 * its own just guarantees the test times out at 5s with a clearer message about
 * the wrong thing.
 */
const RENDER_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 30_000;
configure({ asyncUtilTimeout: RENDER_TIMEOUT_MS });
window.scrollTo = () => undefined;

function mockAuthenticatedApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 200 });
      if (url.endsWith('/api/v1/runs')) return new Response('[]', { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    }),
  );
}

beforeAll(() => {
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the root route owns the redirect to the command center', () => {
  // This is the shape that made the render above cost 15 seconds instead of 1.5.
  //
  // The redirect was a rendered `<Navigate>` on a child route declared with
  // `path: '/'`. That makes `/` match the child *and* the root, so every
  // navigation re-ran matching, and the rendered redirect re-rendered, and
  // matching ran again. React bounds the cycle at fifty updates and then throws —
  // so the test failed on a `waitFor` timeout that said nothing about a loop.
  //
  // Asserted on the source rather than on a render count, because a render-count
  // assertion only fails when the machine is slow enough to hit the bound, which
  // is the same invisibility that hid this in the first place. What must be true
  // is the *mechanism*: the redirect is a navigation decision, not a component.
  it('redirects in beforeLoad, so no render can re-trigger it', () => {
    const root = readFileSync(path.join(import.meta.dirname, 'routes', '__root.tsx'), 'utf8');
    expect(root).toMatch(/beforeLoad/);
    expect(root).toMatch(/redirect\(/);

    // And the child route that carried the rendered redirect is gone. Its
    // `path: '/'` is what made `/` match twice, and this app's file-based route
    // generation rejects a child of the root with *no* path — it is generated as
    // a second `__root__` and the tree throws at import. So deleting the file is
    // the only form the fix takes here.
    let indexRoute = true;
    try {
      readFileSync(path.join(import.meta.dirname, 'routes', 'index.tsx'), 'utf8');
    } catch {
      indexRoute = false;
    }
    expect(indexRoute, 'routes/index.tsx carried the rendered redirect and is now redundant').toBe(
      false,
    );
  });
});

describe('router', { timeout: TEST_TIMEOUT_MS }, () => {
  it('activates the dashboard route and renders the release command center', async () => {
    mockAuthenticatedApi();
    render(<MemoryRouter initialEntries={['/dashboard']} />);
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Release Command Center' })).toBeInTheDocument();
  });

  it('redirects the root route to the command center instead of a placeholder home', async () => {
    mockAuthenticatedApi();
    render(<MemoryRouter initialEntries={['/']} />);
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
    expect(screen.getByRole('heading', { name: 'Release Command Center' })).toBeInTheDocument();
  });

  it('settles in one navigation rather than looping toward the update bound', async () => {
    // The behaviour the mechanism guarantees, stated as behaviour so the two are
    // not only the source assertion. React throws "Maximum update depth
    // exceeded" at fifty nested updates; a routed redirect settles long before
    // that, and a rendered one does not.
    mockAuthenticatedApi();
    const { container } = render(<MemoryRouter initialEntries={['/']} />);
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
    // One command center, not a stack of them: a loop that re-rendered the
    // redirect would leave more than one node behind.
    expect(container.querySelectorAll('[data-testid="dashboard-page"]')).toHaveLength(1);
  });

  it('navigates from the command center to the runs list in one click', async () => {
    mockAuthenticatedApi();
    render(<MemoryRouter initialEntries={['/dashboard']} />);
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument());

    // Asserted on what rendered, not on `window.location`: `MemoryRouter` builds a
    // memory history, so the browser location is `/` for the whole test and an
    // assertion against it can never pass. That is a test bug, not a product one,
    // and it was caught by the test failing on an unchanged assertion rather than
    // by the routing.
    const runs = screen.getAllByRole('link', { name: /runs/i })[0];
    expect(runs).toBeDefined();
    fireEvent.click(runs as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
  });
});
