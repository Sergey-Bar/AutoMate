import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { ThemeToggle } from './ThemeToggle.js';

export function NavBar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  // **No Logout button.** There is no session to end: the install is open, so there is
  // nothing to log out of, and a button that appeared to sign you out of an install you
  // are still signed into would be worse than no button. Removed rather than hidden.
  return (
    <nav
      data-testid="nav-bar"
      className="flex items-center justify-between gap-4 border-b border-border-default bg-surface-muted px-4 py-3"
    >
      <Link
        to="/dashboard"
        className="rounded-md text-sm font-semibold no-underline"
        aria-current={currentPath === '/dashboard' ? 'page' : undefined}
      >
        Release Command Center
      </Link>
      {/*
        `ThemeToggle` used to sit *next to* an inline `<Button variant="ghost">Theme:
        {theme}</Button>` that shared its `data-testid="theme-toggle"` and cycled
        the themes in a different order. Two controls for one setting, one of them
        reachable only from a test, and a `getByTestId` that resolved to whichever
        the caller happened to render.

        Rendering the component removes the second one. The state is announced by
        the control that changes it — `ThemeToggle`'s accessible name says both the
        current theme and where pressing it lands — so the bar does not need a
        second representation of the same fact beside it.
      */}
      <ThemeToggle />
    </nav>
  );
}
