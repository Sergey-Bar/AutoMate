import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { GLASS_SURFACE_CLASSES } from '@automate/ui';

export function NavBar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <nav
      data-testid="nav-bar"
      className={`flex items-center justify-between gap-4 border-b border-border-default px-4 py-3 ${GLASS_SURFACE_CLASSES}`}
    >
      <Link
        to="/dashboard"
        className="inline-flex min-h-11 items-center rounded-md text-sm font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        aria-current={currentPath === '/dashboard' ? 'page' : undefined}
      >
        Automate
      </Link>
      <span
        data-testid="nav-wordmark"
        aria-hidden="true"
        className="text-sm font-semibold tracking-tight text-fg-muted"
      >
        MAIN
      </span>
    </nav>
  );
}
