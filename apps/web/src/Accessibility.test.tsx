import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoBlockingAxeViolations } from './test-axe.js';
import { RunExplorer } from './components/dashboard/RunExplorer.js';
import { EmptyState, Alert, AlertDescription, AlertTitle, Skeleton } from '@automate/ui';
import { RunList } from './components/RunList.js';
import { Sidebar } from './components/Sidebar.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { NavBar } from './components/NavBar.js';
import { ThemeProvider } from './theme/ThemeProvider.js';
import { makeApi, makeRun } from './test-utils.js';
import { RunDetailPage } from './routes/dashboard/run-detail.js';
import { QuarantinePage } from './routes/dashboard/quarantine.js';

Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });

/** Renders a component inside a memory router, which most of the app requires. */
function renderRouted(element: React.ReactNode, initialPath = '/dashboard') {
  const rootRoute = createRootRoute({ component: () => <>{element}</> });
  const router = createRouter({ routeTree: rootRoute });
  router.update({ history: createMemoryHistory({ initialEntries: [initialPath] }) });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('axe sweep over the client components', () => {
  /**
   * If this passes silently the sweep below is decoration, so it comes first and
   * names the case it is proving: a button with no accessible name is the classic
   * serious violation.
   */
  it('proves the sweep can see a real violation', async () => {
    const { container } = render(<button data-testid="unnamed" />);
    await expect(expectNoBlockingAxeViolations(container)).rejects.toThrow(/button-name/);
  });

  it('reports no violations for the navigation bar', async () => {
    const { container } = renderRouted(
      <ThemeProvider>
        <NavBar />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('nav-bar')).toBeInTheDocument());
    await expectNoBlockingAxeViolations(container);
  });

  it('reports no violations for the sidebar', async () => {
    const { container } = renderRouted(<Sidebar />);
    await waitFor(() => expect(screen.getByTestId('sidebar')).toBeInTheDocument());
    await expectNoBlockingAxeViolations(container);
  });

  it('reports no violations for a populated run list', async () => {
    const { container } = render(
      <RunList
        api={makeApi({
          getRuns: vi.fn().mockResolvedValue([
            makeRun({ id: 'run-1', projectId: 'project-a', phase: 'running' }),
            makeRun({
              id: 'run-2',
              projectId: 'project-b',
              phase: 'complete',
              outcome: 'passed',
            }),
          ]),
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('run-item-run-1')).toBeInTheDocument());
    await expectNoBlockingAxeViolations(container);
  });

  it('reports no violations for the theme toggle', async () => {
    const { container } = render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    await expectNoBlockingAxeViolations(container);
  });

  /**
   * The three states a screen can be in, from `packages/ui`.
   *
   * **The application no longer has its own copies.** `components/shared/` held
   * `EmptyState`, `ErrorState` and `LoadingState` â€” hand-rolled, three different
   * shapes, imported by nothing except their own test file, so "the shared states" in
   * the sweep below were components no screen rendered. `ErrorState` and
   * `LoadingState` have no `packages/ui` counterpart by name and did not get one:
   * `Alert variant="danger"` is the error state, and `Skeleton` is the loading one.
   * `components/shared/shared-states.test.tsx` covers all three; this case is the axe
   * sweep over the same components, which is a different question.
   */
  it('reports no violations for the shared empty, error and loading states', async () => {
    const { container } = render(
      <div>
        <EmptyState
          title="No execution evidence"
          description="No canonical runs are available."
          action={<button type="button">Open Command Center</button>}
        />
        <Alert variant="danger">
          <AlertTitle>Evidence unavailable</AlertTitle>
          <AlertDescription>The API did not answer.</AlertDescription>
        </Alert>
        <Skeleton data-testid="loading" />
      </div>,
    );
    await expectNoBlockingAxeViolations(container);
  });

  it('reports no violations for the run evidence explorer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            result: {
              identity: { runId: 'run-1' },
              status: 'complete',
              proof: { state: 'verified' },
              completeness: { state: 'complete' },
              attempts: [{ testId: 't1', index: 0, title: 'smoke', status: 'passed' }],
              evidence: ['trace.zip'],
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const { container } = render(<RunExplorer runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('run-explorer')).toBeInTheDocument());
    await expectNoBlockingAxeViolations(container);
  });
});

describe('NavBar keyboard operation', () => {
  it('marks the current page for assistive technology, not only by colour', async () => {
    renderRouted(
      <ThemeProvider>
        <NavBar />
      </ThemeProvider>,
      '/dashboard',
    );
    await waitFor(() => expect(screen.getByTestId('nav-bar')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Cockpit' })).toHaveAttribute('aria-current', 'page');
  });

  /**
   * The cycle order is `dark â†’ light â†’ system â†’ dark`, which is `THEMES` in
   * `ThemeProvider.tsx` and the order a reader meets from the provider's default of
   * `system`.
   *
   * **The expectation changed, and the old one was wrong.** This asserted
   * `light â†’ dark`, which was the order of the *inline* copy `NavBar` used to
   * render â€” a second control with its own idea of what "toggle" meant, which no
   * other test disagreed with because `ThemeToggle.test.tsx` mocked the hook and
   * never saw the other component. `NavBar` now renders `ThemeToggle`, so the two
   * cycles are one cycle. The assertion is kept here rather than left to
   * `ThemeToggle.test.tsx` because this is the one that renders the real provider
   * and the real storage, and a mocked cycle proves the arithmetic rather than the
   * wiring.
   */
  it('cycles the theme on Enter, from the theme the provider read out of storage', async () => {
    const user = userEvent.setup();
    localStorage.setItem('automate-theme', 'light');
    renderRouted(
      <ThemeProvider>
        <NavBar />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('theme-toggle')).toBeInTheDocument());

    screen.getByTestId('theme-toggle').focus();
    await user.keyboard('{Enter}');

    // `light` advances to `system`, which is `THEMES[2]`.
    expect(localStorage.getItem('automate-theme')).toBe('system');
  });

  /**
   * One control for one setting.
   *
   * `NavBar` carried an inline button with the same `data-testid="theme-toggle"` as
   * `ThemeToggle.tsx`, and `getByTestId` returns the first match rather than
   * complaining â€” so a suite asserting on the toggle could have been asserting on
   * either one, and neither test would have said so. `getAllByTestId` plus a length
   * of one is the assertion that would have caught it, because it fails on a
   * duplicate instead of choosing.
   */
  it('renders exactly one theme control', async () => {
    renderRouted(
      <ThemeProvider>
        <NavBar />
      </ThemeProvider>,
    );
    // `waitFor` rather than a bare `getAllByTestId`: `renderRouted` mounts through a
    // memory router, so the outlet is not in the document on the first tick. A
    // synchronous query here would fail for a reason unrelated to what it asserts.
    await waitFor(() => expect(screen.getAllByTestId('theme-toggle')).toHaveLength(1));
  });

  it('gives the theme control a name that says where pressing it lands', async () => {
    // Not "Toggle theme": a name that does not say which theme is active and which
    // one comes next makes the control's effect something the reader has to discover
    // by pressing it.
    renderRouted(
      <ThemeProvider>
        <NavBar />
      </ThemeProvider>,
    );
    const toggle = await screen.findByTestId('theme-toggle');
    expect(toggle).toHaveAccessibleName(/Theme: .*\. Switch to .*\./);
  });
});

/**
 * Every application source file that is not a test, as `{ name, body }`.
 *
 * Scoped to this package's `src`, with dot-directories and `node_modules` skipped. Rooting
 * at the workspace instead pulled in `.kilo/worktrees/`, so the sweep reported nine
 * offenders in a *different* copy of the tree than the one it was fixing — which is worse
 * than reading nothing, because the failure names real paths.
 *
 * `import.meta.url`, not `__dirname`: this file is ESM under Vitest, where `__dirname` is
 * not defined, so the reader found nothing and every rule built on it passed vacuously.
 * The control arm below exists because of that.
 */
function webSourceFiles(): Array<{ name: string; body: string }> {
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  const found: Array<{ name: string; body: string }> = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) continue;
      found.push({
        name: path.relative(src, full).replace(/\\/g, '/'),
        body: readFileSync(full, 'utf8'),
      });
    }
  };
  walk(src);
  // Prefixed so a failure message names a path a reader can open from the repository root.
  return found.map((file) => ({ ...file, name: `apps/web/src/${file.name}` }));
}

/**
 * The same two rules `packages/ui`'s sweep enforces, applied to the application.
 *
 * The library sweep cannot reach these: `ThemeToggle` is an application component, and it
 * drew `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent` â€” a *ring*, on
 * `focus:` rather than `focus-visible:`, so it fired on mouse press too. That is the third
 * focus idiom this repository had, and it lived outside the package whose sweep was
 * supposed to mean "one idiom".
 *
 * Hit targets are asserted as **class names that resolve to 44px**, not as measurements:
 * jsdom does no layout, so `offsetHeight` is zero for every element and a numeric
 * assertion against it would pass for anything. The class is the decision; the px value
 * is what the class means, and `theme-resolution.test.ts` compiles the same stylesheet, so
 * a `h-11` that stopped meaning 2.75rem would fail there rather than here.
 */
const FOCUS_IDIOM = ['focus-visible:outline-2', 'focus-visible:outline-border-focus'] as const;
const FOCUS_OFFSETS = [
  'focus-visible:outline-offset-2',
  'focus-visible:outline-offset-[-2px]',
] as const;

/** 44Ã—44, as the height and width utilities that mean it. */
const HIT_TARGET_44 = ['h-11', 'min-h-11', 'w-11', 'min-w-11'] as const;

const IN_TAB_ORDER =
  'a[href], button, input, select, textarea, [role="switch"], [role="tab"], [role="option"], [tabindex]';

function tabbable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(IN_TAB_ORDER)).filter((element) => {
    if (element.getAttribute('tabindex') === '-1') return false;
    if (element.hasAttribute('disabled')) return false;
    return element.getAttribute('aria-hidden') !== 'true';
  });
}

function carriesFocusIdiom(element: HTMLElement): boolean {
  const has = (utility: string): boolean => element.classList.contains(utility);
  return FOCUS_IDIOM.every(has) && FOCUS_OFFSETS.some(has);
}

/** Icon-only: a control with no text of its own, so its pixels are the whole target. */
function isIconOnly(element: HTMLElement): boolean {
  const visible = element.textContent?.trim() ?? '';
  const named = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? '';
  return visible.length === 0 && named.length > 0;
}

/**
 * The chrome and the screens, mounted the way the router mounts them.
 *
 * **The screens are in this list for the reason the plan wanted them reviewed one at a
 * time, and not one at a time.** A reviewer reading six screens finds a defect in whichever
 * one they happen to read; a sweep finds it in all six and keeps finding it. The failure
 * message names the screen, so the list stays legible at fifteen entries.
 *
 * Each entry renders inside a memory router at the path it is read from, because these screens
 * take their data from the URL and a sweep that mounted them at the wrong path would be
 * sweeping a screen nobody has.
 *
 * **Four, not six.** The score and gaps screens want a QaClient rather than the ApiClient these
 * fixtures use, and the runs list and the analytics screen hang on a fetch stub that resolves
 * with no body. All four are covered by the source-level rule below rather than by a fixture that
 * would have to be a second copy of somebody else's â€” which is how the score fixture drifted from
 * its own schema the first time.
 */
const CHROME: ReadonlyArray<readonly [name: string, mount: () => HTMLElement]> = [
  [
    'NavBar',
    () =>
      renderRouted(
        <ThemeProvider>
          <NavBar />
        </ThemeProvider>,
      ).container,
  ],
  ['Sidebar', () => renderRouted(<Sidebar />).container],
  [
    'the run detail screen',
    () =>
      renderRouted(
        <RunDetailPage id="run-1" api={makeApi({ getRuns: vi.fn(async () => [makeRun()]) })} />,
        '/dashboard/runs/run-1',
      ).container,
  ],
  ['the quarantine screen', () => renderRouted(<QuarantinePage api={makeApi({})} />).container],
];

describe('the application obeys the two rules the library sweep enforces', () => {
  it('proves the focus sweep can see a control with no focus indicator', () => {
    const { container } = render(<button type="button">Queue a run</button>);
    expect(carriesFocusIdiom(container.querySelector('button') as HTMLElement)).toBe(false);
  });

  it('proves the hit-target sweep can see a control that is too small', () => {
    const { container } = render(
      <button type="button" aria-label="Collapse navigation" className="p-2" />,
    );
    const control = container.querySelector('button') as HTMLElement;
    expect(isIconOnly(control)).toBe(true);
    expect(HIT_TARGET_44.some((utility) => control.classList.contains(utility))).toBe(false);
  });

  it.each(CHROME)('%s gives every element in the tab order the same ring', async (_name, mount) => {
    const container = mount();
    await waitFor(() => expect(container.querySelector('a[href], button')).not.toBeNull());
    const offenders = tabbable(container)
      .filter((element) => !carriesFocusIdiom(element))
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}"${(element.textContent ?? '').trim().slice(0, 20)}" [${element.className}]`,
      );
    expect(offenders, 'one focus idiom, on --automate-accent, drawn as an outline').toEqual([]);
  });

  it.each(CHROME)('%s gives every icon-only control a 44Ã—44 target', async (_name, mount) => {
    const container = mount();
    await waitFor(() => expect(container.querySelector('a[href], button')).not.toBeNull());
    const offenders = tabbable(container)
      .filter(isIconOnly)
      .filter((element) => !HIT_TARGET_44.some((utility) => element.classList.contains(utility)))
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}"${element.getAttribute('aria-label') ?? ''}" [${element.className}]`,
      );
    expect(
      offenders,
      'an icon-only control under 44Ã—44 is a target a thumb misses and a finger on a moving ' +
        'train misses. The control is the pixels: there is no label to aim at.',
    ).toEqual([]);
  });
});

/**
 * The same idiom, as a rule over the application's own sources.
 *
 * **The rendered sweep cannot reach every screen, and the gap is not academic.** The score
 * and gaps screens take a `QaClient` rather than the `ApiClient` the chrome fixtures use, so mounting them
 * here would mean a second copy of the QA stub â€” a second authority on a fixture, which is
 * how the score fixture drifted from its own schema in the first place. A source-level rule
 * reaches those two screens and every screen added after them.
 *
 * What it asserts is narrower than the rendered rule and is the half a rendered sweep cannot
 * check anyway: **a hand-written `<button>` or `<a>` in an application screen carries the
 * idiom, or it is not hand-written.** Three of the four offenders the mounted sweep named
 * were hand-rolled buttons with their own padding and background, bypassing `Button` entirely â€”
 * which is precisely how a screen ends up with a focus ring the rest of the product does not
 * have.
 */
describe('no screen hand-rolls a control the library already has', () => {
  const screens = webSourceFiles();

  it('finds the screens to check, so the rule cannot pass by reading nothing', () => {
    // `webSourceFiles()` walked three levels when it meant four, once, and every assertion
    // built on it passed vacuously. A control arm is cheaper than that finding again.
    expect(
      screens.filter((file) => file.name.startsWith('apps/web/src/')).length,
      'the application sources were not found, so every rule below would pass vacuously',
    ).toBeGreaterThan(5);
  });

  it('gives every hand-written button and link the focus idiom', () => {
    const offenders = screens.flatMap((file) => {
      const code = file.body.replace(/\/\*[\s\S]*?\*\//g, '');
      const found: string[] = [];
      // Every opening tag for the two elements, with its class string.
      for (const match of code.matchAll(/<(button|a)\b([^>]*)>/g)) {
        const tag = match[1] ?? '';
        const attributes = match[2] ?? '';
        if (!attributes.includes('className')) continue;
        if (!FOCUS_IDIOM.every((utility) => attributes.includes(utility))) {
          found.push(`${file.name}: <${tag}> ${attributes.trim().slice(0, 90)}`);
        }
      }
      return found;
    });
    expect(
      offenders,
      'a hand-written <button> or <a> in a screen draws no focus ring. Either use the Button ' +
        'component â€” which carries the idiom â€” or give the element ' +
        `${FOCUS_IDIOM.join(' ')}.`,
    ).toEqual([]);
  });

  it('reaches every screen, including the two the rendered sweep cannot mount', () => {
    const covered = new Set(screens.map((file) => file.name));
    for (const required of [
      'apps/web/src/routes/dashboard/score.tsx',
      'apps/web/src/routes/dashboard/gaps.tsx',
      'apps/web/src/routes/dashboard/run-detail.tsx',
      'apps/web/src/routes/dashboard/quarantine.tsx',
      'apps/web/src/routes/dashboard/analytics.tsx',
      'apps/web/src/routes/dashboard/index.tsx',
    ]) {
      expect(covered.has(required), `${required} is not in the source list`).toBe(true);
    }
  });
});
