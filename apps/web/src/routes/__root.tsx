import React from 'react';
import { Outlet, createRootRoute, redirect, useRouterState } from '@tanstack/react-router';
import { BottomTabBar, NavBar, SectionTabs } from '../components/NavBar.js';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { GlobalCommandPalette } from '../components/GlobalCommandPalette.js';
import { SessionGate } from '../components/SessionGate.js';
import { ToastProvider } from '../components/Toasts.js';
import { Shortcuts } from '../components/Shortcuts.js';
import { PreferencesProvider } from '../theme/preferences.js';
import { createHealthClient } from '../lib/health-client.js';

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
    if (location.pathname === '/') throw redirect({ to: '/dashboard/now' });
  },
  component: RootComponent,
});

function RootComponent() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const health = React.useMemo(() => createHealthClient(), []);
  /*
   * **The viewport is the page.** `h-dvh` and `overflow-hidden` on the frame, and each
   * screen is laid out into what is left — `PageFrame` fills it and panels page their
   * lists — so a screen is composed to fit rather than scrolled through. `main` keeps
   * `overflow-y-auto` as a floor rather than a feature: below the `lg` breakpoint the
   * panels stack and reflow is what WCAG 1.4.10 requires, and clipping content that did
   * not fit would hide it rather than show it.
   */
  return (
    <ThemeProvider>
      <PreferencesProvider>
        <ToastProvider>
          <div className="flex h-dvh flex-col overflow-hidden bg-surface-sunken text-fg">
            <NavBar />
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:px-6 sm:py-6">
              {/* Secondary chrome: focus mode hides it (index.css). */}
              <div data-chrome="secondary">
                <SectionTabs />
              </div>
              <div data-page className="flex min-h-0 flex-1 flex-col">
                <SessionGate health={health} bypass={pathname === '/dashboard/pair'}>
                  <Outlet />
                </SessionGate>
              </div>
            </main>
            <div data-chrome="secondary">
              <BottomTabBar />
            </div>
          </div>
          <GlobalCommandPalette />
          <Shortcuts />
        </ToastProvider>
      </PreferencesProvider>
    </ThemeProvider>
  );
}
