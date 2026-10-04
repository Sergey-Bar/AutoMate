import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { GLASS_SURFACE_CLASSES } from '@automate/ui';
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
      className={`flex items-center justify-between gap-4 border-b border-border-default px-4 py-3 ${GLASS_SURFACE_CLASSES}`}
    >
      <Link
        to="/dashboard"
        className="inline-flex min-h-11 items-center rounded-md text-sm font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        aria-current={currentPath === '/dashboard' ? 'page' : undefined}
      >
        Cockpit
      </Link>
      <div className="flex items-center gap-3">
        {/*
          The product's name, in the corner, and the **only** place it appears in the
          chrome.

          The left link is a navigation target and is named after the screen it opens.
          It used to read `Release Command Center` — a product name sitting in a
          navigation slot, which put two brands twenty pixels apart as soon as the
          wordmark arrived. One brand, one destination.

          `aria-hidden` because it is a brand, not information: the page's `h1` already
          names the product, so a screen reader announcing it twice from the same header
          would be reading the document structure aloud rather than telling the reader
          anything.
        */}
        <span
          data-testid="nav-wordmark"
          aria-hidden="true"
          className="text-sm font-semibold tracking-tight text-fg-muted"
        >
          Automate
        </span>
        {/*
          `ThemeToggle` used to sit *next to* an inline `<Button variant="ghost">Theme:
          {theme}</Button>` that shared its `data-testid="theme-toggle"` and cycled
          the themes in a different order. Two controls for one setting, one of them
          reachable only from a test, and a `getByTestId` that resolved to whichever
          the caller happened to render.

          Rendering the component removes the second one. The state is announced by the
          control that changes it — `ThemeToggle`'s accessible name says both the
          current theme and where pressing it lands — so the bar does not need a
          second representation of the same fact beside it.
        */}
        <ThemeToggle />
      </div>
    </nav>
  );
}
