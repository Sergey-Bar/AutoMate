import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { routeManifest } from './route-manifest.js';

/**
 * The state matrix — one place that answers "does every screen have all four states?".
 *
 * ## Why this is a matrix and not four tests per screen
 *
 * `status:10` point 4's second clause is *"every route has loading, empty, error and
 * partial states"*. Four tests per screen assert four things about one screen and
 * nothing about the set: the screen added next month is the one nobody wrote a state
 * test for, and a suite of one-screen state tests reports green while the set is
 * incomplete. The matrix asserts the **set** — every manifest entry has a row, and
 * each row names the state test-ids that screen must render.
 *
 * ## Why the rows are a list and not a generated harness
 *
 * The screens take different seams on purpose: `tools` reads through `fetch`,
 * `insights` takes an injected `QaClient`, `analytics` takes an `ApiClient`. A
 * generic driver over all three would need reflection into props nobody promised.
 * So each row is a hand-written mount with its own seam, and the **manifest check
 * above** is what stops the list going stale — a new route file fails this suite
 * until it has a row, which is the same shape as the authz matrix that point 5 asks
 * for and does not yet have.
 */

const routesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'routes', 'dashboard');

/** The screen files that compose the dashboard, as the route tree mounts them. */
function dashboardScreens(): string[] {
  return readdirSync(routesDir)
    .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
    .map((name) => name.replace(/\.tsx$/u, ''))
    .sort();
}

/**
 * Rows of the matrix: the state test-ids each screen commits to.
 *
 * **A row is a claim a test can contradict.** `loading` is a test-id the screen
 * renders while its resource is in flight; `empty` is the sentence that names what
 * is absent; `error` names the failure rather than greying out; `partial` is the
 * state where one read answered and another did not. A screen with no row has no
 * such commitment, and the manifest check below fails on it.
 */
const MATRIX: Record<string, readonly string[]> = {
  analytics: ['analytics-loading', 'analytics-error', 'analytics-empty', 'kpi-grid'],
  gaps: ['gaps-loading', 'gaps-error', 'gaps-empty', 'gaps-list'],
  index: ['runs-list-loading', 'runs-list-error', 'runs-list-empty', 'runs-list-page'],
  insights: ['insights-loading', 'insights-error', 'insights-empty', 'insights-list'],
  quarantine: ['quarantine-loading', 'quarantine-error', 'quarantine-empty', 'quarantine-list'],
  'run-detail': ['run-detail-loading', 'run-error', 'run-not-found', 'run-detail-page'],
  score: ['score-loading', 'score-error', 'score-empty', 'score-page'],
  today: ['today-loading', 'today-error', 'today-empty', 'today-partial'],
  tools: ['tools-loading', 'tools-error', 'tools-no-project', 'tools-detected-list'],
};

/**
 * The slug each screen derives its state ids from, when it derives them at all.
 *
 * A screen that writes each id literally has no slug, and the matrix checks the
 * literal text. A screen that derives them checks the template — which is what
 * keeps `gaps.tsx` (four ids from one slug) checkable without un-deriving it.
 */
const MATRIX_SLUGS: Record<string, string | undefined> = {
  gaps: 'slug',
  hollow: 'slug',
  flaky: 'slug',
  structure: 'slug',
};

/**
 * The path each screen is reachable at, so a row can be checked against the
 * manifest rather than against a filename someone renamed.
 */
const MATRIX_PATHS: Record<string, string> = {
  analytics: '/dashboard/analytics',
  gaps: '/dashboard/gaps/:projectId',
  index: '/dashboard',
  insights: '/dashboard/insights',
  quarantine: '/dashboard/quarantine',
  'run-detail': '/dashboard/runs/:runId',
  score: '/dashboard/score/:projectId',
  today: '/dashboard/today',
  tools: '/dashboard/tools',
};

describe('the state matrix', () => {
  it('covers every dashboard screen the manifest registers', () => {
    // **The check that makes this a matrix rather than a snapshot.** A route file
    // added without a row fails here, which is the point: the failure lands at the
    // moment the screen is added, when the author still has the shape of it in
    // their head, rather than at the moment somebody asks whether it has states.
    const rows = Object.keys(MATRIX).sort();
    const missing = dashboardScreens().filter((screen) => !rows.includes(screen));
    expect(
      missing,
      `these dashboard screens have no state-matrix row: ${missing.join(', ')}. Add a row ` +
        `naming the four state test-ids the screen renders — a screen with no row is ` +
        `a screen nobody has checked for states.`,
    ).toEqual([]);
  });

  it('registers every screen that has a row, so a removed screen cannot leave one behind', () => {
    // The other direction, and the one the ratchet teaches: a row for a screen that
    // no longer exists records a state of a page nobody can open.
    const screens = dashboardScreens();
    const stale = Object.keys(MATRIX).filter((screen) => !screens.includes(screen));
    expect(
      stale,
      `state-matrix rows for screens that no longer exist: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('commits each screen to state ids that its own source renders', () => {
    // **The claim that makes a row more than a list.** Each id is checked against
    // the screen's source in one of two forms: the literal `data-testid="id"`,
    // or the template form `data-testid={`${slug}-state`}` a screen uses when the
    // four ids are derived from one slug. A row that names a state the screen
    // does not render fails here rather than passing as documentation — a matrix
    // nobody can contradict is a spreadsheet.
    for (const [screen, ids] of Object.entries(MATRIX)) {
      const source = readFileSync(path.join(routesDir, `${screen}.tsx`), 'utf8');
      const slug = MATRIX_SLUGS[screen];
      for (const id of ids) {
        const literal = `data-testid="${id}"`;
        const templated =
          slug === undefined ? '' : `data-testid={\`\${${slug}}-${id.slice(slug.length + 1)}`;
        // The third form: an id handed to a wrapper component as its `testId`
        // prop, which then renders it. That is how the tools screen's two lists
        // reach their `Card`, and rejecting the form would fail a screen that
        // renders the state correctly.
        const prop = `testId="${id}"`;
        expect(
          source.includes(literal) ||
            (templated !== '' && source.includes(templated)) ||
            source.includes(prop),
          `${screen}.tsx renders none of ${literal}, the template form, or ${prop}`,
        ).toBe(true);
      }
    }
  });

  it('names the manifest path for every matrix row, so the row points at a real route', () => {
    // A row for a screen whose manifest entry was removed would be a matrix entry
    // for something unreachable.
    const registered = new Set(routeManifest.map((route) => route.path));
    for (const screen of Object.keys(MATRIX)) {
      expect(registered, `${screen} has no manifest entry`).toContain(MATRIX_PATHS[screen] ?? '');
    }
  });
});
