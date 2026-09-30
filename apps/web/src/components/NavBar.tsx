import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Button } from '@automate/ui';
import { useTheme } from '../theme/ThemeProvider.js';

export function NavBar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const { theme, setTheme } = useTheme();

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
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          data-testid="theme-toggle"
          aria-label="Toggle theme"
          onClick={() => {
            const themes = ['light', 'dark', 'system'] as const;
            const current = themes.indexOf(theme as (typeof themes)[number]);
            setTheme(themes[(current + 1) % themes.length]);
          }}
        >
          Theme: {theme}
        </Button>
      </div>
    </nav>
  );
}
