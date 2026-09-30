import React from 'react';
import { Outlet, createRootRoute, redirect } from '@tanstack/react-router';
import { NavBar } from '../components/NavBar.js';
import { Sidebar } from '../components/Sidebar.js';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { GlobalCommandPalette } from '../components/GlobalCommandPalette.js';

export const Route = createRootRoute({
  /**
   * `/` has no page; the command center is what a reader wants.
   *
   * Decided here, in `beforeLoad`, rather than by a rendered `<Navigate>` on a
   * child route declared with `path: '/'`. That declaration made `/` match the
   * child *and* the root, so every navigation re-ran matching, the rendered
   * redirect re-rendered, and matching ran again — until React threw at fifty
   * nested updates. `router.test.tsx` failed on a `waitFor` that reported a
   * timeout, so the loop underneath it was invisible; the same test was observed
   * at 1.5 s and then 15 s on consecutive runs of an unchanged tree.
   *
   * A redirect thrown from `beforeLoad` is a navigation decision rather than a
   * render, so it happens once and cannot re-trigger itself. It also runs before
   * the root component mounts, so `/` never paints a redirect at all.
   */
  beforeLoad: ({ location }) => {
    if (location.pathname === '/') throw redirect({ to: '/dashboard' });
  },
  component: RootComponent,
});

function RootComponent() {
  return (
    <ThemeProvider>
      <div className="flex min-h-screen flex-col bg-surface text-fg">
        <NavBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <GlobalCommandPalette />
    </ThemeProvider>
  );
}
