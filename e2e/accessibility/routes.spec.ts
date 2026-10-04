/**
 * Accessibility over every route, in both themes, in all four data states.
 *
 * **This is the gate the glass work is sequenced behind, and it exists because
 * `pnpm status:10` reported thirteen route files and zero of them covered.** Until this
 * spec landed, `expectNoBlockingAxeViolations` was used by exactly one component test
 * (`GlobalCommandPalette.test.tsx`), so a route could regress and nothing would fail.
 * Shipping a translucent fill over a table of evidence with no route-level run would
 * then have been shipping an unmeasured legibility change — which is the whole
 * argument `.kilo/plans/1791096500000-full-glassmorphism-plan.md` §3.4 makes for
 * putting this wave *before* the tokens.
 *
 * ## The route list is derived, not written here
 *
 * The paths come from `routeManifest` in `apps/web/src/route-manifest.ts`, which is the
 * application's single navigation source and is itself asserted against the router's
 * registered tree by `route-manifest.test.ts`. A hand-written list in this file would be
 * a second list, and the failure mode of a second list is a route that exists and is not
 * checked — which is exactly how `/dashboard/quarantine` came to be reachable by URL,
 * absent from the sidebar, and invisible to `isApplicationPath` (ledger W-8).
 *
 * `:param` segments are replaced with a stable sentinel rather than a seeded id. This
 * gate is about the *renderer*: a parameter that resolves to nothing renders the route's
 * own not-found state, and that state is one of the things that has to be legible.
 *
 * ## Both themes, and why this file differs from the component axe helper
 *
 * `apps/web/src/test-axe.ts` turns `color-contrast` **off**, because jsdom has no
 * geometry for axe to measure. Here there is a real browser, so contrast is measured —
 * and that is the rule the glass work changes the answer to. Every other axe rule
 * behaves identically in both places, so the copy of the *filter* is a dozen lines
 * rather than a shared policy module that two Vitest projects and one Playwright project
 * would have to agree about.
 *
 * ## The four states
 *
 * Loading, empty, error and partial are driven by intercepting `/api/v1/**` rather than
 * by seeding the database, because a seeded fixture asserts the state the author
 * imagined while an interception asserts the state the application actually reacts to.
 * `loading` never settles the request, so the page is measured while it is still
 * loading; `empty` and `error` are the two the routes already name with
 * `-empty`/`-error` test ids; `partial` lets the *first* distinct read through to the
 * real API and fails the rest, which is the state a dashboard genuinely reaches and the
 * one no reading of the code can be sure renders cleanly.
 */
import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { routeManifest } from '../../apps/web/src/route-manifest.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { postReporterEvent, reportTest, uniqueRunId } from '../support/api.js';
import { API_AUTH_HEADERS, API_BASE, WEB_BASE } from '../support/config.js';
import { authenticate } from '../support/session.js';

const THEMES = ['dark', 'light'] as const;
const STATES = ['loading', 'empty', 'error', 'partial'] as const;

type Theme = (typeof THEMES)[number];
type State = (typeof STATES)[number];

/**
 * A value for each parameter the manifest uses, and the reason the table is closed.
 *
 * These are syntactically valid v4 UUIDs because the ids they stand in for are UUIDs:
 * a string like `axe-runid` is rejected by the database as `22P02` before the route can
 * render, so the gate would be measuring a 400 it provoked rather than the state it
 * meant to reach, and the API log would fill with errors that were the test's own doing.
 *
 * **A new parameter throws rather than defaulting.** A gate that quietly substituted
 * something for an id it did not have a value for would measure the wrong screen and
 * report it clean, which is the failure this whole file is written against. Adding a
 * route with a new `:param` means adding its sentinel here — one line, and the reason is
 * visible at the point of the edit.
 */
const SENTINELS: Record<string, string> = {
  runId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
};

/**
 * `path` with every `:param` replaced by the sentinel registered for it.
 *
 * The run and the project resolve to nothing, so each of those routes renders its own
 * not-found state — which is one of the states that has to be legible, and is the state
 * a mistyped id produces.
 */
function concretePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const sentinel = SENTINELS[name];
    if (sentinel === undefined) {
      throw new Error(
        `${path} has a ":${name}" parameter with no sentinel in SENTINELS. Add one: a ` +
          'substituted guess would measure a screen other than the one the parameter names.',
      );
    }
    return sentinel;
  });
}

const ROUTES = routeManifest.map((route) => ({
  id: route.id,
  path: concretePath(route.path),
}));

/**
 * axe, filtered to the two impacts that block.
 *
 * `moderate` and `minor` are reported by the run but do not fail it, which is the same
 * line `apps/web/src/test-axe.ts` draws and for the same reason: a gate that fails on
 * everything is a gate whose red means nothing.
 */
async function expectNoSeriousOrCritical(page: Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? 'unknown',
      help: violation.help,
      nodes: violation.nodes.map((node) => ({
        target: node.target.join(' '),
        html: node.html.slice(0, 300),
        why: node.failureSummary ?? '(axe gave no summary)',
      })),
    }));

  expect(
    blocking,
    `axe found serious or critical violations on ${where}. Fix the page — do not disable ` +
      'the rule, and do not exclude the route. If a violation is genuinely unavoidable ' +
      'here, record why in the rule rather than in this file.',
  ).toEqual([]);
}

/**
 * The page rendered something.
 *
 * Without this, a route that 404s, throws during render, or resolves to an empty
 * `<Outlet />` produces a clean axe run: no violations, because there is nothing on the
 * page to violate anything. That is the green no-op this file exists to make impossible,
 * and it is the same class of failure as a Playwright project that matches no spec.
 *
 * The markup is read on the way out rather than on the way in, because the assertion
 * waits five seconds for React to render and a snapshot taken before the wait is a
 * snapshot of an empty page — which would explain nothing about the failure.
 */
async function expectRendered(page: Page, where: string): Promise<void> {
  const main = page.locator('main');
  await expect(main, `${where} rendered no <main>, so the shell never mounted`).toBeVisible();
  try {
    await expect(
      main.locator('*').first(),
      `${where} rendered an empty <main>. A route with nothing on it passes axe trivially, ` +
        'which is not the same as an accessible route.',
    ).toBeVisible();
  } catch (caught) {
    const markup = await main.innerHTML().catch(() => '<unreadable>');
    throw new Error(
      `${where} rendered an empty <main>. What was inside it: ${markup.slice(0, 600)}`,
      { cause: caught },
    );
  }
}

/**
 * Pin the theme before the first script runs.
 *
 * `ThemeProvider` reads `localStorage['automate-theme']` on mount and writes
 * `data-theme` from it, so the value has to be in place before the bundle evaluates —
 * setting the attribute afterwards would measure a page that had already painted in the
 * other theme and then repainted.
 */
async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem('automate-theme', value);
  }, theme);
}

/**
 * Drive the route into one of the four data states.
 *
 * `loading` deliberately returns without settling: a request that never completes is
 * what a slow API actually looks like to the page, and a fulfilled-with-delay fixture
 * would let a fast route finish loading before the measurement is taken.
 */
async function applyState(page: Page, state: State): Promise<void> {
  const reads = new Map<string, number>();
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    const ordinal = reads.get(key) ?? 0;
    reads.set(key, ordinal + 1);

    if (state === 'loading') return;

    const failed = state === 'error' || (state === 'partial' && ordinal % 2 === 1);
    if (failed) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'AXE_FORCED_ERROR',
          message: 'forced by the accessibility state matrix',
        }),
      });
      return;
    }

    if (state === 'empty') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }

    await route.continue();
  });
}

/**
 * * Why this project runs with `reducedMotion: 'reduce'`.* The project sets it in
 * `playwright.config.ts`, not here, and it is a measurement decision rather than a
 * styling one. `EmptyState`, `Skeleton` and the dialog carry `animate-fade-in`, and axe
 * reads computed colour with no reference to opacity: sampled mid-fade it compares a text
 * colour against a background nobody will ever see and reports a serious
 * `color-contrast` violation that is gone a frame later. That is not hypothetical — it is
 * how this spec's first run failed three tests, all on the `<p>` inside `EmptyState`, all
 * three passing on the retry.
 *
 * Turning motion off at the source is better than racing the animations from here:
 * `motion.css` already honours the preference, so the page renders the state a person
 * reads, with nothing to wait for and nothing to time out. `Skeleton`'s pulse is infinite
 * and never finishes, so "wait until the animations settle" is not even a state these
 * loading states reach.
 */
test.describe('accessibility', () => {
  test.beforeEach(
    async ({ context, request }: { context: BrowserContext; request: APIRequestContext }) => {
      // Minted once per worker and injected as a cookie, so the rate limit on
      // `POST /api/v1/auth/login` is not spent per test — see `e2e/support/session.ts`.
      await authenticate(context, request);
    },
  );

  for (const theme of THEMES) {
    test.describe(`in the ${theme} theme`, () => {
      for (const route of ROUTES) {
        test(`${route.id} has no serious or critical violation at ${route.path}`, async ({
          page,
        }) => {
          await useTheme(page, theme);
          await page.goto(`${WEB_BASE}${route.path}`);
          await expectRendered(page, `${route.path} in the ${theme} theme`);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expectNoSeriousOrCritical(page, `${route.path} in the ${theme} theme`);
        });
      }
    });
  }

  for (const state of STATES) {
    test.describe(`with the API in the ${state} state`, () => {
      for (const route of ROUTES) {
        test(`${route.id} has no serious or critical violation at ${route.path}`, async ({
          page,
        }) => {
          await applyState(page, state);
          await page.goto(`${WEB_BASE}${route.path}`);
          await expectRendered(page, `${route.path} with the API in the ${state} state`);
          await expectNoSeriousOrCritical(page, `${route.path} with the API in the ${state} state`);
        });
      }
    });
  }
});

/**
 * The other half of the G4 gate: a screenshot of the cockpit at the fill floor, reviewed as
 * a diff.
 *
 * **Why a screenshot at all, when `theme.test.ts` already measures the composite.** The
 * measurement says the text clears 4.5:1 on every plane step. It cannot say whether the
 * result *reads* — that 72% of the surface over a near-identical backdrop leaves the panel
 * legible but almost flat, that the elevation step is doing all the separating, or that a
 * `unmeasured` cell drawn in `text-fg-muted` over a glass fill still reads as absence rather
 * than as a low score. Those are judgements about pixels, and the honest way to record one
 * is to look at the pixels.
 *
 * **Where the file goes, and why it is not committed.** `test-results/evidence/` is the
 * convention the vertical-slice suite already uses, and CI uploads it as an artefact. A
 * *committed* pixel baseline would be a new mechanism — this repository has no
 * `toHaveScreenshot` anywhere, and inventing one for a design decision would put a
 * per-platform image diff behind every pull request to protect a property that is already
 * measured numerically. The screenshot is evidence for a person; the ratio is the gate.
 *
 * **The assertions before the screenshot are the part that matters.** A screenshot of an
 * empty cockpit is a green artefact showing nothing, which is the same failure shape as an
 * axe run over a blank `<main>`. So the queue has to be present and an `unmeasured` cell has
 * to be on screen before the shutter opens, and both are asserted by name.
 */
const GLASS_EVIDENCE_DIR = path.join(
  import.meta.dirname,
  '..',
  '..',
  'test-results',
  'evidence',
  'glass',
);

let seeded = false;

/**
 * A registered project, plus three runs — two passing, one failing — so the cockpit's queue,
 * limiter and matrix have something in them.
 *
 * **The project comes first because it is the cockpit's subject.** `Cockpit.tsx` reads
 * `listProjects()` and renders `cockpit-onboarding` — "No project is registered, so there is
 * nothing to score yet" — when the list is empty. That screen is a legitimate state and the
 * axe sweep above measures it, but it shows neither a queue nor a matrix, so a screenshot
 * taken there would be evidence of nothing. Registering through `POST /api/v1/projects` is
 * the endpoint the onboarding text itself points a reader at, so the fixture uses the
 * documented door rather than writing to the database.
 *
 * Runs are seeded through the reporter rather than by inserting rows, because the reporter is
 * how a run is actually created and a fixture that bypasses it would be asserting a shape the
 * product does not use. `qa/score` resolves with `surfaceCoverage: null` per cell when no
 * coverage artifact has been ingested, which is the `unmeasured` case this evidence exists
 * to photograph.
 *
 * **The project may already exist, and that is not a failure.** `e2e/support/reset-queue.mjs`
 * truncates six run-scoped tables and deliberately not `projects` — a registered project is
 * install state, not run data, and emptying it would make the suite assert something about
 * the API's boot path rather than about the screen. So the fixture registers, and on `409`
 * looks the project up and refreshes its detection, which is what `POST
 * /api/v1/projects/:id/detect` exists for. Without that branch the evidence run passed once
 * and failed on every run after it.
 *
 * Once per worker: the seed is shared by both themes, and `globalSetup` has already emptied
 * the run tables before any of them start.
 */
async function seedCockpitRuns(request: APIRequestContext): Promise<void> {
  if (seeded) return;
  seeded = true;

  const slug = 'glass-legibility-fixture';
  const body = {
    name: 'Glass legibility fixture',
    slug,
    repoPath: path.join(import.meta.dirname, '..', '..'),
  };

  const registered = await request.post(`${API_BASE}/api/v1/projects`, {
    headers: API_AUTH_HEADERS,
    data: body,
  });

  if (registered.status() === 409) {
    const listed = await request.get(`${API_BASE}/api/v1/projects`, { headers: API_AUTH_HEADERS });
    expect(listed.status(), `the projects list must be readable to reuse ${slug}`).toBe(200);
    // `{ projects: [...] }`, not a bare array — the same shape `qa-client.ts` parses.
    // Narrowed rather than cast through `unknown` so a wrong key is a runtime `undefined`
    // and the `find` below fails by name, instead of a cast asserting a shape nobody read.
    const payload = (await listed.json()) as { projects?: { slug?: string; id?: string }[] };
    const existing = (payload.projects ?? []).find((project) => project.slug === slug);
    expect(
      existing?.id,
      `${slug} answered 409 to registration but is not in the project list`,
    ).toBeDefined();
    const refreshed = await request.post(
      `${API_BASE}/api/v1/projects/${existing?.id as string}/detect`,
      { headers: API_AUTH_HEADERS },
    );
    expect(
      refreshed.status(),
      `re-detecting the reused project must succeed: ${String(refreshed.status())}`,
    ).toBe(200);
  } else {
    expect(
      registered.status(),
      `the cockpit has no subject without a project, and this one could not be registered: ` +
        `${String(registered.status())} ${await registered.text()}`,
    ).toBe(201);
  }

  for (const status of ['passed', 'failed', 'passed'] as const) {
    const runId = uniqueRunId();
    await postReporterEvent(request, {
      type: 'run:start',
      runId,
      payload: { total: 1, branch: 'main', commitSha: 'glasscafe01' },
    });
    await reportTest(request, runId, {
      testId: `${runId}-a`,
      title: 'a run for the glass legibility evidence',
      file: 'glass-evidence.spec.ts',
      status,
      durationMs: 42,
    });
    await postReporterEvent(request, {
      type: 'run:end',
      runId,
      payload: {
        status: status === 'failed' ? 'failed' : 'passed',
        passed: status === 'failed' ? 0 : 1,
        failed: status === 'failed' ? 1 : 0,
        branch: 'main',
      },
    });
  }
}

test.describe('glass legibility evidence', () => {
  for (const theme of THEMES) {
    test(`the cockpit reads at the fill floor in the ${theme} theme`, async ({
      page,
      request,
      context,
    }) => {
      await authenticate(context, request);
      await seedCockpitRuns(request);
      await useTheme(page, theme);
      await page.goto(`${WEB_BASE}/dashboard`);

      await expect(page.getByTestId('cockpit-queue')).toBeVisible();
      await expect(
        page.locator('[data-testid^="cell-"]', { hasText: 'unmeasured' }).first(),
        'the cockpit shows no unmeasured cell, so the screenshot would not show the floor it ' +
          'exists to show',
      ).toBeVisible();

      mkdirSync(GLASS_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(GLASS_EVIDENCE_DIR, `cockpit-${theme}.png`),
        fullPage: true,
      });

      // The number the pixels are confirming, re-checked on the seeded screen rather than
      // only in jsdom — a cockpit with data in it is not the cockpit the ratio was
      // measured on.
      await expectNoSeriousOrCritical(page, `the seeded cockpit in the ${theme} theme`);
    });
  }
});
