/**
 * The rendering budget: LCP, INP, CLS and long tasks on the four primary flows.
 *
 * This is the gate that makes the design language's glassmorphism safe to ship rather
 * than merely intended. `backdrop-filter: blur(20px) saturate(180%)` — the signature
 * effect in the v2 plan — repaints the backdrop on every frame, and stacked
 * translucent layers on a scroll-heavy dashboard are a known source of jank. The plan's
 * ordering constraint is explicit that this budget lands *before* the effect, because
 * the alternative is shipping a repaint-heavy surface on instinct and hearing about it
 * from a user.
 *
 * **No new dependency.** Every reading comes from `PerformanceObserver`, which is the
 * platform. `web-vitals` wraps the same API and would add a package to a repository
 * that has already decided two new dependencies is the ceiling (D18).
 *
 * The policy half lives in `scripts/lib/rendering-budget.mjs` and is covered by
 * `node --test` on every `pnpm verify`. This file is deliberately thin: it produces
 * numbers and hands them over. That split is why the comparison can be reviewed
 * without a browser, and why a mistake in it is a unit-test failure rather than a
 * flaky measurement.
 *
 * `pnpm render:baseline` writes the measurements into
 * `performance/rendering-budget.json` with `recorded: true`. That is a deliberate,
 * human-run act — the same contract as `complexity:baseline` and `coverage:baseline`,
 * and `never-in-ci` in `gate-tooling.json` for the same reason. A gate that rewrites
 * its own ceiling in the same commit is a gate that agrees with the tree.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { phaseFor } from '../../scripts/lib/render-gate-phase.mjs';
import { auditRenderingBudget, measurementProblems } from '../../scripts/lib/rendering-budget.mjs';
import { postReporterEvent, uniqueRunId } from '../support/api.js';
import { WEB_BASE } from '../support/config.js';
import { authenticate, signInAndVisit } from '../support/session.js';

/**
 * The four primary flows the plan names, and the four routes the budget file carries.
 *
 * `/dashboard/runs/:runId` is a pattern rather than a path because the budget key is
 * the pattern: a budget keyed by run id would need a new entry per run and would
 * measure nothing. `pattern: 'run'` is how this test knows to substitute a real one.
 */
const PRIMARY_ROUTES = [
  { key: '/login', pattern: null },
  { key: '/dashboard/runs', pattern: null },
  { key: '/dashboard/runs/:runId', pattern: 'run' },
  { key: '/dashboard/quarantine', pattern: null },
] as const;

const BUDGET_FILE = 'performance/rendering-budget.json';

/** What the page-side observers accumulate. Mirrors `METRICS` in the policy module. */
interface RenderMetrics {
  lcpMs: number;
  inpMs: number;
  cls: number;
  longTasks: number;
}

declare global {
  interface Window {
    /**
     * The running totals, installed before the first navigation.
     *
     * Declared rather than reached for with a cast, because an untyped global is
     * exactly the seam where a rendering reading silently becomes a number nobody
     * checked. The name is prefixed so it cannot collide with the application's own.
     */
    __automateRenderBudget?: RenderMetrics;
  }
}

/**
 * `PerformanceObserver` emits `PerformanceEntry`, and the two properties this gate
 * needs — `value` and `hadRecentInput` on a layout shift — are not on it in the DOM
 * lib. Narrowed with a predicate rather than a cast, so a future entry type that does
 * carry them is picked up by the compiler rather than by a comment.
 */
function isLayoutShift(
  entry: PerformanceEntry,
): entry is PerformanceEntry & { value: number; hadRecentInput: boolean } {
  return 'value' in entry && 'hadRecentInput' in entry;
}

/**
 * Install the four observers before the first paint.
 *
 * `buffered: true` on each, so a reading is not lost to the observer being installed
 * after the entry was dispatched — the usual reason a first-paint measurement comes
 * back as nothing.
 */
async function installObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const totals: RenderMetrics = { lcpMs: 0, inpMs: 0, cls: 0, longTasks: 0 };
    window.__automateRenderBudget = totals;

    // A route that paints no large element emits no LCP entry at all. The reading
    // stays 0 and `measurementProblems` reports it as unmeasured rather than as a
    // perfect score — see the note there, because that is the failure this gate is
    // most able to hide in itself.
    new PerformanceObserver((list) => {
      for (let index = 0; index < list.getEntries().length; index += 1) {
        const entry = list.getEntries()[index];
        if (entry) totals.lcpMs = Math.max(totals.lcpMs, entry.startTime);
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    new PerformanceObserver((list) => {
      for (let index = 0; index < list.getEntries().length; index += 1) {
        const entry = list.getEntries()[index];
        if (!entry || !isLayoutShift(entry)) continue;
        // A shift the user caused is not instability; counting it is how a budget ends
        // up measuring how fast somebody types.
        if (entry.hadRecentInput) continue;
        totals.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });

    new PerformanceObserver((list) => {
      totals.longTasks += list.getEntries().length;
    }).observe({ type: 'longtask', buffered: true });

    // `durationThreshold: 16` records the interactions a person would actually feel
    // slow rather than every pointer move. INP is the *worst* interaction on the
    // route, not an average: a page is only as responsive as its slowest moment.
    //
    // `durationThreshold` is real but absent from the DOM lib's `PerformanceObserverInit`,
    // so the object is built as a typed variable first — excess-property checking only
    // applies to a fresh literal, which is a way of asking the compiler rather than
    // casting past it.
    const eventInit: PerformanceObserverInit & { durationThreshold?: number } = {
      type: 'event',
      buffered: true,
      durationThreshold: 16,
    };
    new PerformanceObserver((list) => {
      for (let index = 0; index < list.getEntries().length; index += 1) {
        const entry = list.getEntries()[index];
        if (entry) totals.inpMs = Math.max(totals.inpMs, entry.duration);
      }
    }).observe(eventInit);
  });
}

/**
 * Read the accumulated totals.
 *
 * Throws rather than inventing a value. A missing accumulator means no navigation
 * happened, which is a broken spec and not a fast route — and the difference between
 * those two is the difference between a budget that measures and one that agrees.
 */
async function readMetrics(page: Page): Promise<RenderMetrics> {
  const totals = await page.evaluate(() => window.__automateRenderBudget);
  if (totals === undefined) {
    throw new Error(
      'The render observers were installed by addInitScript, so a missing accumulator ' +
        'means no navigation happened. That is a broken spec, not a fast route.',
    );
  }
  return totals;
}

/**
 * Settle the page after its data lands.
 *
 * Fixed rather than conditional, because a budget that waits for a selector which may
 * not exist measures whichever route happened to be fast to assert.
 */
const SETTLE_MS = 750;

/**
 * Put the four readings where a reviewer will actually see them.
 *
 * A measurement that only exists in a test log is the same thing as no measurement, and
 * in the measurement phase the *number* is the deliverable — there is no verdict to
 * read off a red or green tick. Written to the job summary so it lands on the pull
 * request, and to the console so a local run shows it too.
 *
 * The caption states which phase produced it, because a table of LCP numbers under a
 * green tick is exactly the artifact a reader mistakes for a passing budget.
 */
function reportMeasurements(routes: Record<string, RenderMetrics>, compared: boolean): void {
  const caption = compared
    ? 'Compared against the recorded ceilings.'
    : '**No ceiling is recorded, so nothing was compared. These are measurements, not a verdict.**';
  const rows = Object.entries(routes)
    .map(
      ([route, m]) =>
        `| \`${route}\` | ${String(Math.round(m.lcpMs))} ms | ${String(Math.round(m.inpMs))} ms | ${m.cls.toFixed(3)} | ${String(m.longTasks)} |`,
    )
    .join('\n');
  const body = [
    '### Rendering budget',
    '',
    caption,
    '',
    '| Route | LCP | INP | CLS | Long tasks |',
    '| --- | --- | --- | --- | --- |',
    rows,
  ].join('\n');

  console.info(`\n${body}\n`);
  // Absent in a local run, which is why the console write above is not optional.
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (typeof summary === 'string' && summary !== '') {
    appendFileSync(summary, `${body}\n\n`, 'utf8');
  }
}

test.describe('rendering budget', () => {
  test('the four primary routes render within their committed budget', async ({
    page,
    request,
  }) => {
    const budgetPath = path.join(import.meta.dirname, '..', '..', BUDGET_FILE);
    const baseline = JSON.parse(readFileSync(budgetPath, 'utf8')) as Record<string, unknown>;

    const browser = page.context().browser();
    expect(browser, 'the budget needs a real browser, not a persistent context').not.toBeNull();
    if (browser === null) throw new Error('unreachable: asserted above');

    // A run detail page needs a run to exist, so one is created through the reporter
    // first. Seeding it here rather than relying on another spec's leftovers is what
    // keeps this gate runnable on its own.
    const runId = uniqueRunId();
    await postReporterEvent(request, {
      type: 'run:start',
      runId,
      payload: { total: 1, branch: 'main', commitSha: 'budge7cafe01' },
    });
    await postReporterEvent(request, {
      type: 'test:end',
      runId,
      payload: {
        testId: `${runId}-a`,
        title: 'passing test',
        file: 'a.spec.ts',
        status: 'passed',
        durationMs: 20,
      },
    });
    await postReporterEvent(request, {
      type: 'run:end',
      runId,
      payload: { status: 'passed', passed: 1, failed: 0, branch: 'main' },
    });

    /** @type {Record<string, RenderMetrics>} */
    const routes: Record<string, RenderMetrics> = {};

    for (const route of PRIMARY_ROUTES) {
      const context = await browser.newContext();
      const target = await context.newPage();
      try {
        await installObservers(target);

        if (route.key === '/login') {
          await target.goto(`${WEB_BASE}/login`);
          await expect(target.getByTestId('auth-loading')).toBeHidden();
        } else {
          await authenticate(context, request);
          const routePath =
            route.pattern === 'run' ? `/dashboard/runs/${runId}` : (route.key as string);
          await signInAndVisit(target, routePath);
          // One interaction, so the route has an `event` entry and INP is a
          // measurement rather than an absence. Quarantine filters on input, so typing
          // there is the interaction the plan's INP reading is actually about.
          if (route.key === '/dashboard/quarantine') {
            const filter = target.locator('input[type="search"], input[type="text"]').first();
            if ((await filter.count()) > 0) await filter.fill('a');
          } else {
            await target.mouse.move(10, 10);
            await target.mouse.click(10, 10);
          }
        }

        await target.waitForLoadState('networkidle');
        await target.waitForTimeout(SETTLE_MS);
        routes[route.key] = await readMetrics(target);
      } finally {
        await context.close();
      }
    }

    // Three modes, and which one runs is a property of the committed budget rather
    // than of a flag. `phaseFor` is the single definition of that property — the same
    // function `gate-tooling.test.mjs` uses to decide what tier the job may have — so
    // the spec and the manifest cannot disagree about which phase the repository is in.
    const isWriteMode = process.env['AUTOMATE_RENDER_BASELINE'] === '1';
    const isMeasured = phaseFor(baseline) === 'threshold';

    if (isWriteMode) {
      const recordedOn = new Date().toISOString().slice(0, 10);
      writeFileSync(
        budgetPath,
        `${JSON.stringify(
          {
            ...baseline,
            recorded: true,
            recordedOn,
            reason: `Recorded by \`pnpm render:baseline\` on ${recordedOn}.`,
            routes: Object.fromEntries(
              PRIMARY_ROUTES.map((route) => {
                const previous =
                  ((baseline['routes'] as Record<string, Record<string, unknown>> | undefined) ??
                    {})[route.key] ?? {};
                return [route.key, { ...previous, ...routes[route.key] }];
              }),
            ),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      console.info(`Rendering budget written: ${String(Object.keys(routes).length)} route(s)`);
      return;
    }

    const measurement = { routes };
    reportMeasurements(routes, isMeasured);

    if (!isMeasured) {
      // **Measurement phase.** There is no ceiling yet, so there is nothing to compare
      // against and pretending otherwise would be the RF-9 defect: committing numbers
      // that mean nothing so a gate can be green. This measures and reports.
      //
      // What it does still enforce is that the measurement is *complete* — a missing
      // metric means the observers did not fire, which is a broken instrument, not a
      // fast route, and is worth failing on in any phase. Only the ceilings are skipped.
      const incomplete = Object.entries(routes).flatMap(([route, metrics]) =>
        measurementProblems(route, metrics),
      );
      expect(
        incomplete,
        'the measurement itself is incomplete, so the numbers below are not usable: ' +
          'a metric PerformanceObserver never reported is not a zero.',
      ).toEqual([]);
      console.info(
        'No rendering ceiling is recorded, so nothing was compared. These are ' +
          'measurements, not a verdict. Populate the baseline with `pnpm ' +
          'render:baseline` on reference hardware — see PERF-1 in the findings ledger.',
      );
      return;
    }

    // **Threshold phase.** A real run has been recorded, so the comparison is a gate
    // and a regression is a failure. `auditRenderingBudget` is the whole rule, and it
    // is unit-tested; this file only supplies numbers.
    const { findings, routes: audited } = auditRenderingBudget(baseline, measurement);
    expect(
      findings,
      findings.length > 0
        ? `Rendering budget failed across ${String(audited)} route(s). A budget that does ` +
            'not fail on this is not a budget.'
        : '',
    ).toEqual([]);
  });
});
