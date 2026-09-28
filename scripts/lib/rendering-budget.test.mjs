import assert from 'node:assert/strict';
import test from 'node:test';
import { METRICS, auditRenderingBudget, measurementProblems } from './rendering-budget.mjs';

/**
 * The point of this file is the same as `findings-ledger.test.mjs`: every rule is
 * provable, and a gate that cannot be shown to fail is a gate that measures nothing.
 *
 * This one has a specific way of failing on its own, which is why the unmeasured cases
 * get the most attention. A rendering budget is measured by a browser through
 * `PerformanceObserver`, and `PerformanceObserver` stays silent for a metric that
 * never happened — so the easiest way to build a permanently green rendering budget
 * is to treat an absent reading as zero. Every case below that plants a missing or
 * unrecorded number is that bug, and each one asserts the audit reports it.
 */

/** @param {string[]} findings @param {RegExp} pattern */
function hasFinding(findings, pattern) {
  return findings.some((finding) => pattern.test(finding));
}

/**
 * A baseline with every ceiling recorded.
 *
 * The second parameter this took was named `reading`, which shadowed the factory
 * below and made every call site a temporal-dead-zone ReferenceError — a mistake
 * worth avoiding here precisely because it reads as a broken gate rather than a
 * broken helper.
 *
 * @param {Record<string, Record<string, number>>} [routes]
 */
function budgetWith(routes = { '/login': reading() }) {
  return { recorded: true, routes };
}

/** @returns {Record<string, number>} */
function reading(overrides = {}) {
  return { lcpMs: 1_200, inpMs: 80, cls: 0.02, longTasks: 1, ...overrides };
}

/** @param {string} route @param {Record<string, number>} [observed] */
function measurementOf(route, observed = reading()) {
  return { routes: { [route]: observed } };
}

test('a baseline that was never measured is a finding, not a pass', () => {
  // The RF-9 shape, deliberately refused. `performance/thresholds.json` ships exactly
  // this and protects nothing; a rendering budget that did the same would be the same
  // defect under a new filename.
  const { findings } = auditRenderingBudget(
    { recorded: false, routes: { '/login': reading() } },
    measurementOf('/login'),
  );
  assert.ok(hasFinding(findings, /no recorded measurement/));
  assert.ok(
    hasFinding(findings, /an intention, not a ceiling/),
    'the message has to say why, or this reads as a missing file rather than an unmeasured gate',
  );
});

test('a budget file that is not an object is a finding rather than a throw', () => {
  const { findings } = auditRenderingBudget([], measurementOf('/login'));
  assert.ok(hasFinding(findings, /not a JSON object/));
});

test('a measurement within every ceiling produces no findings', () => {
  const { findings, routes } = auditRenderingBudget(budgetWith(), measurementOf('/login'));
  assert.deepEqual(findings, []);
  assert.equal(routes, 1);
});

test('an LCP over its ceiling is a finding, naming both numbers', () => {
  const { findings } = auditRenderingBudget(
    budgetWith({ '/login': reading() }),
    measurementOf('/login', reading({ lcpMs: 2_500 })),
  );
  assert.ok(hasFinding(findings, /LCP 2500ms over its ceiling of 1200ms/));
});

test('an INP over its ceiling is a finding', () => {
  const { findings } = auditRenderingBudget(
    budgetWith({ '/login': reading() }),
    measurementOf('/login', reading({ inpMs: 400 })),
  );
  assert.ok(hasFinding(findings, /INP 400ms over its ceiling of 80ms/));
});

test('a CLS over its ceiling is a finding, and carries no unit', () => {
  const { findings } = auditRenderingBudget(
    budgetWith({ '/login': reading() }),
    measurementOf('/login', reading({ cls: 0.31 })),
  );
  // CLS is a ratio, so "0.31ms" would be a unit error rather than a small formatting
  // slip — it would read as a different measurement.
  assert.ok(hasFinding(findings, /CLS 0\.31 over its ceiling of 0\.02/));
  assert.ok(!hasFinding(findings, /CLS 0\.31ms/));
});

test('a long-task count over its ceiling is a finding', () => {
  const { findings } = auditRenderingBudget(
    budgetWith({ '/login': reading() }),
    measurementOf('/login', reading({ longTasks: 9 })),
  );
  assert.ok(hasFinding(findings, /long tasks 9 over its ceiling of 1/));
});

test('a measurement exactly on the ceiling passes, because a ceiling is inclusive', () => {
  const { findings } = auditRenderingBudget(
    budgetWith({ '/login': reading() }),
    measurementOf('/login', reading({ lcpMs: 1_200, inpMs: 80, cls: 0.02, longTasks: 1 })),
  );
  assert.deepEqual(findings, []);
});

test('a metric the browser never reported is a finding, not a zero', () => {
  // The failure mode this gate is most able to hide in itself. `PerformanceObserver`
  // does not emit `largest-contentful-paint` for a page that paints no large element,
  // and `event` entries only exist after an interaction — so scoring an absent
  // reading as 0 reports a perfect result for a route nobody watched render.
  const { findings } = auditRenderingBudget(
    budgetWith({ '/login': reading() }),
    measurementOf('/login', { lcpMs: 1_200, inpMs: 80, cls: 0.02 }),
  );
  assert.ok(hasFinding(findings, /long tasks was not measured/));
  assert.ok(hasFinding(findings, /is not a zero/));
});

test('every unmeasured metric is reported by name, not just the first', () => {
  const { findings } = auditRenderingBudget(
    budgetWith({ '/login': reading() }),
    measurementOf('/login', {}),
  );
  for (const metric of METRICS) {
    assert.ok(
      hasFinding(findings, new RegExp(`${metric.label} was not measured`)),
      `${metric.label} went unreported`,
    );
  }
});

test('a non-numeric reading is a finding rather than a comparison that quietly passes', () => {
  // `NaN` is what a missing `PerformanceEntry.startTime` becomes, and `NaN <= 1200`
  // is false — so an unguarded comparison reports NaN as a *regression* for the wrong
  // reason, or, worse, is written as `!(observed > ceiling)` and passes silently.
  for (const bad of [Number.NaN, null, undefined, 'fast', Number.POSITIVE_INFINITY]) {
    const { findings } = auditRenderingBudget(
      budgetWith({ '/login': reading() }),
      measurementOf('/login', reading({ lcpMs: bad })),
    );
    assert.ok(
      hasFinding(findings, /LCP was not measured/),
      `lcpMs: ${String(bad)} was accepted as a measurement`,
    );
  }
});

test('a route with no measurement at all is a finding', () => {
  // Built as a literal rather than through `measurementOf(route, undefined)`: an
  // explicit `undefined` triggers that helper's default parameter, so the call would
  // have passed a complete reading and asserted nothing. A test that passes for the
  // wrong reason is the one failure mode that does not announce itself.
  const { findings } = auditRenderingBudget(budgetWith({ '/login': reading() }), {
    routes: { '/login': undefined },
  });
  assert.ok(hasFinding(findings, /no measurement was recorded/));
});

test('a baseline and measurement that are both empty is a finding, not a vacuous pass', () => {
  // The one case this gate can reach on its own. An empty union of routes has nothing
  // to exceed, so every rule above passes vacuously — a rendering budget that watched
  // nothing and reported success. This is the whole reason `routes.size === 0` is
  // checked before the loop rather than left to fall out of it.
  const { findings } = auditRenderingBudget({ recorded: true, routes: {} }, { routes: {} });
  assert.ok(hasFinding(findings, /records no routes and the measurement reported none/));
  assert.ok(
    hasFinding(findings, /\/dashboard\/quarantine/),
    'the finding has to name the routes it expected, or a reader has to go and look',
  );
});

test('measurementProblems is exported so a spec can assert before it reports', () => {
  // A measurement that is incomplete should be caught where it is produced, not only
  // in the comparison — which is why this is exported rather than kept private.
  assert.deepEqual(measurementProblems('/login', reading()), []);
  assert.ok(hasFinding(measurementProblems('/login', {}), /was not measured/));
});

test('a metric with no recorded ceiling is a finding, even when the measurement is fine', () => {
  // A `null` ceiling in the baseline is the same "unvalidated estimate" RF-9 records.
  // The measurement passes, so nothing else would report this route at all.
  const { findings } = auditRenderingBudget(
    { recorded: true, routes: { '/login': reading({ lcpMs: null }) } },
    measurementOf('/login', reading({ lcpMs: 900 })),
  );
  assert.ok(hasFinding(findings, /LCP has no recorded ceiling/));
  assert.ok(hasFinding(findings, /An unrecorded ceiling is not a ceiling/));
});

test('a measured route with no baseline entry is a finding', () => {
  // Otherwise adding a route silently escapes the budget: nothing to fail against.
  const { findings } = auditRenderingBudget(
    budgetWith({ '/login': reading() }),
    measurementOf('/dashboard/quarantine'),
  );
  assert.ok(hasFinding(findings, /\/dashboard\/quarantine: no ceiling is recorded/));
});

test('a baseline route that was not measured is a finding', () => {
  // The other direction, and the one that matters for a ratchet: deleting a route
  // from the measurement would otherwise delete its ceiling with no diff to a floor.
  const { findings } = auditRenderingBudget(
    budgetWith({ '/login': reading(), '/dashboard/runs': reading() }),
    measurementOf('/login'),
  );
  assert.ok(hasFinding(findings, /\/dashboard\/runs: recorded .* but not measured/));
  assert.ok(hasFinding(findings, /Dropping a route drops its ceiling/));
});

test('several routes are audited independently, and a bad one does not mask a good one', () => {
  const { findings, routes } = auditRenderingBudget(
    budgetWith({ '/login': reading(), '/dashboard/runs': reading() }),
    {
      routes: {
        '/login': reading({ lcpMs: 900 }),
        '/dashboard/runs': reading({ lcpMs: 3_000 }),
      },
    },
  );
  assert.equal(routes, 2);
  assert.ok(hasFinding(findings, /\/dashboard\/runs: LCP 3000ms over/));
  assert.ok(!hasFinding(findings, /\/login: LCP/));
});

test('the four primary routes are each independently budgeted', () => {
  // Pinned because the plan names these four as the primary flows. A budget file
  // that quietly covered three of them would still be green.
  const primary = ['/login', '/dashboard/runs', '/dashboard/runs/:runId', '/dashboard/quarantine'];
  /** @type {Record<string, Record<string, number>>} */
  const routes = {};
  for (const route of primary) routes[route] = reading();
  const { findings, routes: count } = auditRenderingBudget({ recorded: true, routes }, { routes });
  assert.deepEqual(findings, []);
  assert.equal(count, primary.length);
});

test('the failure message names the metric and the reason, not just the number', () => {
  const { findings } = auditRenderingBudget(
    budgetWith({ '/login': reading() }),
    measurementOf('/login', reading({ longTasks: 4 })),
  );
  const finding = findings.find((entry) => entry.includes('long tasks')) ?? '';
  assert.match(finding, /tasks over 50ms of main-thread work/);
  assert.match(finding, /not a budget/);
});
