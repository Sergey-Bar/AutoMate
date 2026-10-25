import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Activity, LayoutGrid, ListChecks, Network, cn } from '@automate/ui';
import { SECTIONS, routeFor, sectionOf, tabsOf, type SectionId } from '../route-manifest.js';
import { ThemeToggle } from './ThemeToggle.js';

/**
 * The chrome: four sections, three surfaces.
 *
 * - `NavBar` — the top bar. The wordmark, the four sections from `lg` up, the theme.
 * - `SectionTabs` — the tab row under it, for a section with more than one page.
 * - `BottomTabBar` — the four sections as a thumb-reach tab bar below `lg`.
 *
 * All three read `SECTIONS` and `sectionOf` from the manifest, so there is one answer to
 * "where am I". The current section is marked with `aria-current="page"` **and** with
 * weight and a rule, never with colour alone.
 *
 * **No Logout button.** The install is open, so there is no session to end.
 */

const SECTION_ICONS: Record<SectionId, typeof LayoutGrid> = {
  overview: LayoutGrid,
  runs: ListChecks,
  insights: Activity,
  map: Network,
};

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

function useCurrentPath(): string {
  return useRouterState({ select: (state) => state.location.pathname });
}

export function NavBar(): React.ReactElement {
  const current = sectionOf(useCurrentPath());
  return (
    <nav
      data-testid="nav-bar"
      aria-label="Primary navigation"
      className="relative flex h-14 shrink-0 items-center gap-x-6 border-b border-border bg-surface px-4 sm:px-6"
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
      <ul className="hidden min-w-0 flex-1 items-center justify-center gap-x-1 lg:flex">
        {SECTIONS.map((section) => {
          const active = section.id === current;
          return (
            <li key={section.id}>
              <Link
                to={section.path}
                activeOptions={{ exact: true }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-md px-4 text-sm transition-colors',
                  FOCUS,
                  active
                    ? 'font-semibold text-fg underline decoration-accent decoration-2 underline-offset-[1.15rem]'
                    : 'font-medium text-fg-muted hover:text-fg',
                )}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
      {/* Below `lg` the sections are in the bottom bar; the top bar names where you are. */}
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-muted lg:hidden">
        {SECTIONS.find((section) => section.id === current)?.label}
      </span>
      <ThemeToggle />
    </nav>
  );
}

/**
 * The section's pages, as an underline row. Shown only when the current page is one of
 * the section's tabs — a run detail or a score deep-dive is reached by a link, and a tab
 * row above it would mark nothing as current.
 */
export function SectionTabs(): React.ReactElement | null {
  const path = useCurrentPath();
  const section = sectionOf(path);
  const page = routeFor(path);
  if (section === null || page === undefined || !('tab' in page)) return null;
  const tabs = tabsOf(section);
  if (tabs.length === 0) return null;
  const label = SECTIONS.find((entry) => entry.id === section)?.label ?? '';
  return (
    <nav
      data-testid="section-tabs"
      data-chrome="secondary"
      aria-label={`${label} pages`}
      className="-mx-4 mb-4 overflow-x-auto border-b border-border px-4 sm:-mx-6 sm:mb-6 sm:px-6"
    >
      <ul className="flex gap-1">
        {tabs.map((tab) => {
          const active = tab.id === page.id;
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                to={tab.path}
                activeOptions={{ exact: true }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm transition-colors',
                  FOCUS,
                  active
                    ? 'border-accent font-semibold text-fg'
                    : 'border-transparent font-medium text-fg-muted hover:text-fg',
                )}
              >
                {tab.tab}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The four sections within thumb reach, below `lg`. A flex child of the shell rather than
 * `position: fixed`, so it never covers the last row of a page, with the safe-area inset
 * added beneath it for a phone with a home indicator.
 */
export function BottomTabBar(): React.ReactElement {
  const current = sectionOf(useCurrentPath());
  return (
    <nav
      data-testid="bottom-tab-bar"
      data-chrome="secondary"
      aria-label="Sections"
      className="shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-4">
        {SECTIONS.map((section) => {
          const Icon = SECTION_ICONS[section.id];
          const active = section.id === current;
          return (
            <li key={section.id}>
              <Link
                to={section.path}
                activeOptions={{ exact: true }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 text-xs transition-colors',
                  FOCUS,
                  active ? 'font-semibold text-fg' : 'font-medium text-fg-muted hover:text-fg',
                )}
              >
                <Icon size={20} strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
