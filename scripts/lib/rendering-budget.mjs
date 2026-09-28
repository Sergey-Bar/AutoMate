/**
 * The rendering budget's rules, as a pure function.
 *
 * `performance/rendering-budget.json` is a **ratchet baseline**, and this module is
 * the comparison. It is split out from the Playwright spec for the same reason
 * `findings-ledger.mjs` and `coverage-floor-ratchet.mjs` are split out from their
 * CLIs: the browser half needs a browser and a database, so it cannot be run on every
 * change, and the policy half is the part that decides whether a regression is a
 * regression. Keeping them apart means the policy is covered by `node --test` on
 * every `pnpm verify`, and a browser is only needed to produce a number to feed it.
 *
 * Why this exists at all, in the repository's own terms: the design language in the
 * v2 plan puts `backdrop-filter: blur(20px) saturate(180%)` on the app chrome, and
 * `backdrop-filter` repaints the backdrop on every frame. Without a committed ceiling
 * the effect ships on instinct, and a scroll-heavy dashboard with stacked translucent
 * layers is a known source of jank. This is the instrument that makes it measurable
 * instead of decorative — and the plan's own ordering constraint is that the budget
 * lands *before* the effect, not after.
 *
 * The one rule this module exists to enforce, and cannot be got around: **a ceiling
 * that was never measured is not a ceiling.** `performance/thresholds.json` carries
 * `recorded: false` with three nulls and is, by the ledger's own RF-9 row, a gate
 * that protects nothing. Repeating that shape here would be the same defect wearing a
 * new filename, so an unmeasured baseline is a **finding**, not a pass. The baseline
 * is written deliberately and by hand — the same contract as `complexity:baseline` and
 * `coverage:baseline`, and `never-in-ci` in `gate-tooling.json` for the same reason:
 * a gate that can rewrite its own threshold in the same commit is a gate that agrees
 * with the tree instead of the code.
 */

/**
 * The four metrics, and how each is judged.
 *
 * All four are ceilings — a higher reading is worse — so there is one direction and
 * no per-metric branching. `unit` is carried because the failure message has to name
 * it: "CLS 0.31 over 0.1" is a reportable regression and "CLS 0.31" alone is a number
 * in a log.
 */
export const METRICS = [
  { key: 'lcpMs', label: 'LCP', unit: 'ms', why: 'largest contentful paint' },
  { key: 'inpMs', label: 'INP', unit: 'ms', why: 'interaction to next paint' },
  { key: 'cls', label: 'CLS', unit: '', why: 'cumulative layout shift' },
  { key: 'longTasks', label: 'long tasks', unit: '', why: 'tasks over 50ms of main-thread work' },
];

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A finite number, as a predicate rather than a boolean.
 *
 * The predicate is the whole point: without it every call site keeps an `unknown`, and
 * the arithmetic below has to be asserted past — which is how a rendering reading
 * silently becomes a number nobody checked. `Number.isFinite` also rejects `NaN` and
 * `Infinity`, both of which reach a reading when a `PerformanceEntry` has no usable
 * timestamp.
 *
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Every way the measurement can fail to be a measurement, as findings.
 *
 * A metric the browser never reported is not a zero. `PerformanceObserver` does not
 * fire for `largest-contentful-paint` on a page that paints no large element, and
 * `event` entries only exist once something is interacted with — so a spec that
 * treats an absent reading as `0` reports a perfect score for a route it never
 * actually observed. That is the one class of bug this gate is most able to hide in
 * itself, so it is checked first and separately.
 *
 * @param {string} route
 * @param {unknown} reading
 * @returns {string[]}
 */
export function measurementProblems(route, reading) {
  if (!isRecord(reading)) {
    return [`${route}: no measurement was recorded for this route.`];
  }
  return METRICS.filter((metric) => !isFiniteNumber(reading[metric.key])).map(
    (metric) =>
      `${route}: ${metric.label} was not measured. A metric the browser never ` +
      `reported is not a zero — it is an unobserved route, and scoring it as zero ` +
      `is how a rendering budget passes without having watched anything render.`,
  );
}

/**
 * One metric over its ceiling, or `null` when it is within budget.
 *
 * @param {string} route
 * @param {{ key: string, label: string, unit: string, why: string }} metric
 * @param {unknown} observed
 * @param {unknown} ceiling
 * @returns {string | null}
 */
function overBudget(route, metric, observed, ceiling) {
  if (!isFiniteNumber(observed) || !isFiniteNumber(ceiling)) return null;
  if (observed <= ceiling) return null;
  const unit = metric.unit === '' ? '' : metric.unit;
  return (
    `${route}: ${metric.label} ${String(round(observed))}${unit} over its ceiling of ` +
    `${String(round(ceiling))}${unit} (${metric.why}). A rendering budget that does ` +
    'not fail on this is not a budget.'
  );
}

/**
 * Two decimal places.
 *
 * LCP and INP are milliseconds read from a `PerformanceObserver` timestamp with
 * sub-millisecond precision, and CLS is a small unitless ratio. Printing all of it
 * makes the failure message harder to read without making it more accurate, and a
 * budget is a ceiling, not a measurement instrument.
 *
 * @param {number} value
 * @returns {number}
 */
function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * One route's findings: unmeasured metrics first, then ceilings that were exceeded.
 *
 * Both documents are narrowed once at the top rather than at every use, so the loop
 * below is comparing two numbers rather than asserting its way to them.
 *
 * @param {string} route
 * @param {unknown} reading
 * @param {unknown} budget
 * @returns {string[]}
 */
function routeProblems(route, reading, budget) {
  const problems = measurementProblems(route, reading);
  if (!isRecord(budget)) {
    return [
      ...problems,
      `${route}: no ceiling is recorded for this route. Add it to ` +
        'performance/rendering-budget.json deliberately.',
    ];
  }
  const observed = isRecord(reading) ? reading : {};
  for (const metric of METRICS) {
    const value = observed[metric.key];
    const ceiling = budget[metric.key];
    if (isFiniteNumber(value) && !isFiniteNumber(ceiling)) {
      problems.push(
        `${route}: ${metric.label} has no recorded ceiling, so the measurement of ` +
          `${String(round(value))} cannot fail anything. An unrecorded ceiling is not ` +
          'a ceiling.',
      );
      continue;
    }
    const finding = overBudget(route, metric, value, ceiling);
    if (finding !== null) problems.push(finding);
  }
  return problems;
}

/**
 * Audits one measurement against one baseline, in both directions.
 *
 * Both directions, because each omission is a silent escape:
 *
 *  - a **measured** route with no baseline entry has nothing to fail against, so
 *    adding a route would quietly escape the budget;
 *  - a **baseline** route with no measurement has had its budget deleted, so
 *    removing a route would quietly drop its ceiling.
 *
 * That symmetry is the same one `coverage-exclusions.test.mjs` asserts, and for the
 * same reason: a one-directional check is a check that can be defeated by editing one
 * of the two documents.
 *
 * @param {unknown} baseline parsed `performance/rendering-budget.json`
 * @param {unknown} measurement `{ routes: { [route]: { lcpMs, inpMs, cls, longTasks } } }`
 * @returns {{ findings: string[], routes: number }}
 */
export function auditRenderingBudget(baseline, measurement) {
  if (!isRecord(baseline)) {
    return { findings: ['the rendering budget is not a JSON object'], routes: 0 };
  }
  if (baseline['recorded'] !== true) {
    return {
      findings: [
        'performance/rendering-budget.json has no recorded measurement, so this gate ' +
          'has measured nothing. A budget that was never observed is an intention, ' +
          'not a ceiling — the same defect as performance/thresholds.json before it ' +
          'was populated. Record a real run on reference hardware and set recorded: true.',
      ],
      routes: 0,
    };
  }
  const budgets = isRecord(baseline['routes']) ? baseline['routes'] : {};
  const observed =
    isRecord(measurement) && isRecord(measurement['routes']) ? measurement['routes'] : {};
  const routes = new Set([...Object.keys(budgets), ...Object.keys(observed)]);

  // The empty case is a finding rather than a pass, and it is the one this gate is
  // most able to reach on its own: a baseline with `recorded: true` and no `routes`,
  // measured by a spec that reported no routes, produces an empty union — and an empty
  // union has nothing to exceed, so every rule above passes vacuously. That is a
  // rendering budget that watched nothing and reported success, which is the one
  // outcome the whole design refuses. `recorded: true` with an empty `routes` map is
  // almost certainly someone clearing the file rather than a measurement.
  if (routes.size === 0) {
    return {
      findings: [
        'performance/rendering-budget.json records no routes and the measurement ' +
          'reported none, so there is nothing to compare and everything passes. A ' +
          'rendering budget with no routes is not a budget. The four primary routes ' +
          'are /login, /dashboard/runs, /dashboard/runs/:runId and ' +
          '/dashboard/quarantine.',
      ],
      routes: 0,
    };
  }

  /** @type {string[]} */
  const findings = [];
  for (const route of [...routes].sort()) {
    if (!(route in observed)) {
      findings.push(
        `${route}: recorded in performance/rendering-budget.json but not measured. ` +
          'Dropping a route drops its ceiling, which is a lowering with no diff to it.',
      );
      continue;
    }
    findings.push(...routeProblems(route, observed[route], budgets[route]));
  }
  return { findings, routes: routes.size };
}
