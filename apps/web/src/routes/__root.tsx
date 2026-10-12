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
      {/*
        The ambient backdrop, and the reason the shell exists at all.

        A glass panel is a **sampling filter**: it is only legible because of what
        is behind it. This layer is what is behind it — two soft token-derived
        glows over the base surface, wide and off-screen so no band crosses a
        readable column of text. Both are tokens at an opacity, not literal hexes:
        `theme-resolution.test.ts` fails a build on a colour that is not a token,
        and a gradient nobody can retheme is a gradient nobody can ship.

        `pointer-events-none` and `aria-hidden` together: the layer is decoration,
        so it must not eat a click and must not appear in a screen reader's tree.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-surface"
      >
        <div className="absolute -top-56 left-1/2 h-[46rem] w-[96rem] max-w-none -translate-x-1/2 rounded-full bg-gradient-to-b from-accent/12 via-accent/5" />
        <div className="absolute -bottom-64 right-[-14rem] h-[38rem] w-[64rem] rounded-full bg-gradient-to-t from-info/10 via-info/4" />
        <div className="absolute bottom-[-18rem] left-[-12rem] h-[34rem] w-[58rem] rounded-full bg-gradient-to-tr from-accent/8" />
      </div>
      <div className="flex min-h-screen flex-col bg-transparent text-fg">
        <NavBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-h-0 min-w-0 flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <GlobalCommandPalette />
    </ThemeProvider>
  );
}
