import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { GLASS_SURFACE_CLASSES, cn } from '@automate/ui';
import { visibleRoutes } from '../route-manifest.js';
import { ThemeToggle } from './ThemeToggle.js';

/**
 * The only chrome: one bar, the product's name, every destination, the theme.
 *
 * ## Why the sidebar went
 *
 * A sidebar costs a fixed 224px column on every screen, and the redesign's rule is that a
 * screen fits the viewport without scrolling. Seven destinations fit in one row of text,
 * so the column was paying for nothing but a collapse button. The bar is the one glass
 * surface on a page; every panel beneath it is opaque, so the stack depth is one.
 *
 * ## The current page is marked for assistive technology, not only by colour
 *
 * `aria-current="page"` on the active link, and the visual marker is a weight and an
 * underline as well as a colour, so a reader who cannot see the hue still sees which.
 *
 * **No Logout button.** The install is open, so there is no session to end, and a button
 * that appeared to sign you out of an install you are still signed into would be worse than
 * no button.
 */
export function NavBar() {
  const currentPath = useRouterState({ select: (state) => state.location.pathname });
  const isActive = (path: string) =>
    path === '/dashboard' ? currentPath === path : currentPath.startsWith(path);

  return (
    <nav
      data-testid="nav-bar"
      aria-label="Primary navigation"
      className={`flex shrink-0 items-center gap-6 border-b border-border-default px-4 sm:px-6 ${GLASS_SURFACE_CLASSES}`}
    >
      {/*
        The product's name, and the only place it appears in the chrome. `aria-hidden`
        because it is a brand rather than information: the page's `h1` already names the
        screen, and a screen reader announcing the brand from every header is reading the
        layout aloud rather than telling the reader anything.
      */}
      <span
        data-testid="nav-wordmark"
        aria-hidden="true"
        className="shrink-0 text-sm font-semibold uppercase tracking-widest"
      >
        Automate
      </span>
      <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {visibleRoutes.map((route) => (
          <li key={route.id} className="shrink-0">
            <Link
              to={route.path}
              aria-current={isActive(route.path) ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-md px-3 text-sm no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                isActive(route.path)
                  ? 'font-semibold text-fg underline decoration-accent decoration-2 underline-offset-8'
                  : 'text-fg-muted hover:text-fg',
              )}
            >
              {route.label}
            </Link>
          </li>
        ))}
      </ul>
      <ThemeToggle />
    </nav>
  );
}
