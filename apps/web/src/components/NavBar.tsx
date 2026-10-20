import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { GLASS_SURFACE_CLASSES, Menu, X, cn } from '@automate/ui';
import { visibleRoutes } from '../route-manifest.js';
import { ThemeToggle } from './ThemeToggle.js';

/**
 * The only chrome: one bar, the product's name, every destination, the theme.
 *
 * ## One row at every width
 *
 * From `lg` up the seven destinations sit inline. Below it they move behind a menu button,
 * so the bar stays one row tall on a phone — a second row of links is 50px every page has
 * to give up, and the rule is that a page fits without scrolling. The bar names the page
 * you are on beside the button, so the menu hides the other destinations and never the
 * current one.
 *
 * ## The current page is marked for assistive technology, not only by colour
 *
 * `aria-current="page"` on the active link, and the visual marker is a weight and an
 * underline as well as a colour, so a reader who cannot see the hue still sees which.
 *
 * **No Logout button.** The install is open, so there is no session to end.
 */
const LINK_BASE =
  'inline-flex min-h-11 items-center rounded-md px-3 text-sm no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

export function NavBar() {
  const currentPath = useRouterState({ select: (state) => state.location.pathname });
  const isActive = (path: string) =>
    path === '/dashboard' ? currentPath === path : currentPath.startsWith(path);
  const [open, setOpen] = React.useState(false);
  const menuId = React.useId();
  const current = visibleRoutes.find((route) => isActive(route.path));

  // A navigation closes the menu; so does Escape, from anywhere on the page.
  React.useEffect(() => setOpen(false), [currentPath]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const links = (inMenu: boolean) =>
    visibleRoutes.map((route) => (
      <li key={route.id} className={inMenu ? undefined : 'shrink-0'}>
        <Link
          to={route.path}
          // TanStack writes `aria-current` itself on any child path, so `/dashboard` would
          // claim to be current on every screen. Exact matching for the root only.
          activeOptions={{ exact: route.path === '/dashboard' }}
          aria-current={isActive(route.path) ? 'page' : undefined}
          className={cn(
            LINK_BASE,
            inMenu && 'w-full',
            isActive(route.path)
              ? 'font-semibold text-fg underline decoration-accent decoration-2 underline-offset-8'
              : 'text-fg-muted hover:text-fg',
          )}
        >
          {route.label}
        </Link>
      </li>
    ));

  return (
    <nav
      data-testid="nav-bar"
      aria-label="Primary navigation"
      className={`relative flex shrink-0 items-center gap-x-4 border-b border-border-default px-4 sm:px-6 lg:gap-x-6 ${GLASS_SURFACE_CLASSES}`}
    >
      {/*
        The product's name, and the only place it appears in the chrome. `aria-hidden`
        because the page's `h1` already names the screen.
      */}
      <span
        data-testid="nav-wordmark"
        aria-hidden="true"
        className="shrink-0 text-sm font-semibold uppercase tracking-widest"
      >
        Automate
      </span>
      <ul className="hidden min-w-0 flex-1 items-center gap-x-1 lg:flex">{links(false)}</ul>
      <div className="flex min-w-0 flex-1 items-center gap-1 lg:hidden">
        <button
          type="button"
          data-testid="nav-menu-toggle"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          <span className="truncate">{current?.label ?? 'Menu'}</span>
          <span className="sr-only">{open ? ', close the menu' : ', open the menu'}</span>
        </button>
      </div>
      <ThemeToggle />
      {open ? (
        <ul
          id={menuId}
          data-testid="nav-menu"
          className="absolute inset-x-0 top-full z-overlay flex flex-col gap-0.5 border-b border-border bg-surface-raised p-2 shadow-elevation-2 lg:hidden"
        >
          {links(true)}
        </ul>
      ) : null}
    </nav>
  );
}
