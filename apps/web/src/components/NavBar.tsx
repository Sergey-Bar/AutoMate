import React from 'react';
import { Link, useRouterState, useNavigate } from '@tanstack/react-router';
import { Button } from '@automate/ui';
import { useAuth } from '../auth/useAuth.js';
import { useTheme } from '../theme/ThemeProvider.js';

export function NavBar() {
  const routerState = useRouterState();
  const navigate = useNavigate();
  const currentPath = routerState.location.pathname;
  const { logout, isAuthenticated } = useAuth();
  const { theme, setTheme } = useTheme();

  const handleLogout = async () => {
    await logout();
    void navigate({ to: '/login' });
  };

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
        {isAuthenticated ? (
          <Button variant="outline" data-testid="logout-button" onClick={() => void handleLogout()}>
            Logout
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
