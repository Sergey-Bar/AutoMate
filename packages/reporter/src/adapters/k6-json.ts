import type { CanonicalRunResult } from '@automate/shared-contracts';
import { canonicalRunResult, type CanonicalAttemptInput } from '../canonical-run-result.js';
import type { ProducerAdapter, ProducerContext } from '../adapter.js';
import type { CanonicalStatus } from '../producer-status.js';

/**
 * k6 JSON — a load generator's summary, ingested as a **run result**.
 *
 * ## There is no test in a k6 summary, and pretending otherwise is the trap
 *
 * k6 reports **metrics** and **thresholds**. It has no test identity, no suite and
 * no per-case outcome, so an adapter that invented "tests" out of HTTP requests
 * would be fabricating an identity the producer never stated — and the score keys
 * flake detection and hollow detection on exactly that identity. What this adapter
 * produces instead is:
 *
 *  - one attempt per **check-like metric** — a metric carrying `passes`/`fails`,
 *    which is how k6 says a count of things passed or failed; and
 *  - one attempt per **declared threshold**: k6's own evaluated verdict when the summary
 *    carries one (`--summary-export` writes it on the metric), else evaluated here against
 *    the metric it names.
 *
 * The threshold is k6's real verdict. A load script that reports 200 requests and
 * 200 successes while blowing its latency budget has failed, and the threshold is
 * the only place in the document that says so.
 */

/**
 * `2`: reads the thresholds `k6 run --summary-export` writes on each metric, and counts a
 * Rate's `passes` (not its `fails`) as the failures. Version 1 read neither, so it could not
 * fail a run on a crossed latency bound and failed a clean run on `http_req_failed`.
 */
export const K6_JSON_ADAPTER_VERSION = '2';

interface K6Metric {
  value?: number;
  passes?: number;
  fails?: number;
  rate?: number;
  [key: string]: number | undefined;
}

interface K6Summary {
  metrics?: Record<string, K6Metric>;
  options?: { thresholds?: Record<string, string[] | string> };
}

/**
 * Metrics whose **high** value is the bad one.
 *
 * A named list rather than a rule, because the polarity is not derivable: it is a
 * property of what each metric measures. `http_req_failed` at `value: 0.02` means
 * 2% of requests failed; reading its `fails` count the same way as `checks`'s
 * would report 418 failures on a run that had 2.
 */
const LOWER_IS_BETTER = new Set([
  'http_req_failed',
  'http_req_connecting_failed',
  'dropped_iterations',
]);

function decode(input: Uint8Array): K6Summary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw new Error('k6 summary is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('k6 summary is not an object');
  }
  const document = parsed as K6Summary;
  // A document with neither key is not a k6 summary — it is something else that
  // happens to be JSON, and treating it as one would ingest an empty run.
  if (document.metrics === undefined && document.options?.thresholds === undefined) {
    throw new Error('k6 summary declares neither metrics nor thresholds');
  }
  return document;
}

/**
 * `p(95)<500` → `{aggregate: 'p(95)', comparator: '<', limit: 500}`.
 *
 * The aggregate comes **first** in a k6 threshold (`p(95)<500`, not `<500 p(95)`),
 * so the comparator is found by scanning for it rather than anchoring at the start.
 * Anchoring was the bug here: `<500` sliced to `500` and every threshold reported
 * `unknown`, which is the safe direction but silently useless.
 */
interface SplitThreshold {
  aggregate: string;
  comparator: '<' | '<=' | '>' | '>=';
  limit: number;
}

function splitThreshold(expression: string): SplitThreshold | null {
  const match = /^\s*(.+?)(<=|>=|<|>)\s*([\d.]+)\s*$/u.exec(expression);
  if (!match) return null;
  return {
    aggregate: match[1]?.trim() ?? '',
    comparator: match[2] as SplitThreshold['comparator'],
    limit: Number(match[3]),
  };
}

/** Resolves the aggregate a threshold names: `p(95)`, `rate`, `count`, `avg`. */
function aggregateFor(metric: K6Metric, aggregate: string): number | undefined {
  if (aggregate === 'rate') return metric['rate'] ?? metric['value'];
  return metric[aggregate];
}

function satisfies(
  observed: number,
  comparator: SplitThreshold['comparator'],
  limit: number,
): boolean {
  switch (comparator) {
    case '<':
      return observed < limit;
    case '<=':
      return observed <= limit;
    case '>':
      return observed > limit;
    default:
      return observed >= limit;
  }
}

/**
 * The verdicts k6 itself wrote on a metric: `{ "<expression>": <crossed> }`, where `true` means
 * the bound was breached. `k6 run --summary-export` puts them here, and nowhere in `options`.
 */
function metricThresholds(metric: K6Metric): Record<string, unknown> {
  const raw = (metric as { thresholds?: unknown }).thresholds;
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** k6's evaluated answer for one threshold: `true` is breached. Anything else is unreadable. */
function verdictStatus(crossed: unknown): CanonicalStatus {
  if (crossed === true) return 'failed';
  return crossed === false ? 'passed' : 'unknown';
}

/**
 * One attempt per threshold k6 evaluated. This is the verdict: k6 compared the bound against
 * the aggregate itself, so nothing is re-derived. A value that is not a boolean is `unknown`,
 * never `passed` - a bound nobody can read has not been met.
 */
function nativeThresholdAttempts(
  metrics: Record<string, K6Metric>,
  startedAt: string,
): CanonicalAttemptInput[] {
  const attempts: CanonicalAttemptInput[] = [];
  for (const [name, metric] of Object.entries(metrics)) {
    for (const [expression, crossed] of Object.entries(metricThresholds(metric))) {
      const status = verdictStatus(crossed);
      const title = `k6 threshold ${name}[${expression.trim()}]`;
      attempts.push({
        index: 1,
        testId: `threshold:${name}[${expression.trim()}]`,
        specPath: `k6/threshold/${name}`,
        title,
        status,
        rawStatus: String(crossed),
        startedAt,
        flakiness: 'unknown',
        ...(status === 'failed' ? { error: { message: `${title} - crossed` } } : {}),
      });
    }
  }
  return attempts;
}

/**
 * One attempt per check-like metric.
 *
 * A metric with no `passes`/`fails` is **not** an attempt: it is the evidence a
 * threshold is evaluated against, and turning it into one would make
 * `http_req_duration` look like a test that either passed or failed. A metric that carries
 * thresholds of its own is not one either - its thresholds are its verdict, and failing it on
 * its raw counters as well would overrule a tolerance the script chose (`rate>0.95`).
 */
function metricAttempts(
  metrics: Record<string, K6Metric>,
  startedAt: string,
): CanonicalAttemptInput[] {
  const attempts: CanonicalAttemptInput[] = [];
  for (const [name, metric] of Object.entries(metrics)) {
    if (Object.keys(metricThresholds(metric)).length > 0) continue;
    if (!hasVerdict(name, metric)) continue;
    const breach = describeBreach(name, metric);
    attempts.push({
      index: 1,
      testId: `k6.${name}`,
      specPath: `k6/${name}`,
      title: `k6 metric ${name}`,
      status: breach === null ? 'passed' : 'failed',
      rawStatus: String(metric.value ?? 0),
      startedAt,
      flakiness: 'unknown',
      ...(breach === null ? {} : { error: { message: `${name}: ${breach}` } }),
    });
  }
  return attempts;
}

/**
 * Whether this metric says anything about whether the run was clean.
 *
 * A failure metric with no counters is still a verdict: its value *is* the failure
 * rate. Skipping it for want of `passes`/`fails` would turn a summary with a breached
 * `http_req_failed` into a run that measured nothing — the one thing a
 * security-and-performance row must never be.
 */
function hasVerdict(name: string, metric: K6Metric): boolean {
  if (typeof metric.passes === 'number' || typeof metric.fails === 'number') return true;
  return LOWER_IS_BETTER.has(name) && typeof metric.value === 'number';
}

/**
 * Why the metric breached, or `null` when it did not.
 *
 * The polarity split lives here so the loop above reads as a loop, and `null`
 * rather than a boolean because the *reason* is what a reader needs — a boolean
 * throws it away, and "failed" without a reason is a row nobody acts on.
 */
function describeBreach(name: string, metric: K6Metric): string | null {
  if (LOWER_IS_BETTER.has(name)) {
    // A Rate's `passes` counts its non-zero samples: for these metrics, the failures. Its
    // `fails` counts the samples that were fine, so reading it as failures inverts the verdict.
    if (typeof metric.passes === 'number') {
      return metric.passes > 0
        ? `${metric.passes} of ${metric.passes + (metric.fails ?? 0)} samples failed`
        : null;
    }
    return (metric.value ?? 0) > 0 ? `value ${metric.value ?? 0} is above zero` : null;
  }
  const failures = metric.fails ?? 0;
  return failures > 0 ? `${failures} of ${(metric.passes ?? 0) + failures} failed` : null;
}

/** One attempt per declared threshold. An absent metric is `unknown`, never `passed`. */
function thresholdAttempts(document: K6Summary, startedAt: string): CanonicalAttemptInput[] {
  // `index` is the attempt ordinal **within a test**, not within the run: the
  // contract's `uniqueAttemptIdentity` enforces `1..n` per `testId`, which is why
  // every attempt in this file is numbered 1 despite being different tests.
  const attempts: CanonicalAttemptInput[] = [];
  for (const [expression, raw] of Object.entries(document.options?.thresholds ?? {})) {
    for (const text of Array.isArray(raw) ? raw : [raw]) {
      const attempt = thresholdAttempt(document, expression, text, startedAt);
      if (attempt !== null) attempts.push(attempt);
    }
  }
  return attempts;
}

/**
 * One threshold, or `null` when the expression is not one this adapter can read.
 *
 * Split from the loop so the loop reads as two nested loops and the *decision* —
 * measured, met, unmeasured — reads as one expression with the reasoning beside it.
 * That reasoning is the part worth reading: an absent metric is `unknown`, never
 * `passed`, because k6 did not evaluate the bound and a green run on the dashboard
 * would be a verdict nobody reached.
 */
function thresholdAttempt(
  document: K6Summary,
  expression: string,
  text: string,
  startedAt: string,
): CanonicalAttemptInput | null {
  const split = splitThreshold(text);
  if (split === null) return null;
  const metric = document.metrics?.[expression];
  const observed = metric === undefined ? undefined : aggregateFor(metric, split.aggregate);
  const status: CanonicalStatus =
    observed === undefined
      ? 'unknown'
      : satisfies(observed, split.comparator, split.limit)
        ? 'passed'
        : 'failed';
  const title = `k6 threshold ${expression}[${text.trim()}]`;
  return {
    index: 1,
    testId: `threshold:${expression}[${text.trim()}]`,
    specPath: `k6/threshold/${expression}`,
    title,
    status,
    rawStatus: observed === undefined ? 'unmeasured' : String(observed),
    startedAt,
    flakiness: 'unknown',
    ...(status === 'failed' ? { error: { message: `${title} — observed ${observed}` } } : {}),
  };
}

/**
 * The attempt emitted for a summary that measured nothing.
 *
 * `runStatusFrom([])` returns `skipped` for an empty outcome list, and a run
 * reported as *skipped* reads as a decision somebody made. A k6 summary with no
 * metrics has asserted nothing at all, so the adapter states one `unknown` row
 * rather than handing the ladder an empty list.
 */
function unmeasuredAttempt(startedAt: string): CanonicalAttemptInput[] {
  return [
    {
      index: 1,
      testId: 'k6.summary',
      specPath: 'k6/summary',
      title: 'k6 summary declared no measurable metric or threshold',
      status: 'unknown',
      rawStatus: 'unmeasured',
      startedAt,
      flakiness: 'unknown',
    },
  ];
}

export function parseK6Summary(input: Uint8Array, context: ProducerContext): CanonicalRunResult {
  const document = decode(input);
  const metrics = document.metrics ?? {};
  const fromMetrics = metricAttempts(metrics, context.startedAt);
  const native = nativeThresholdAttempts(metrics, context.startedAt);
  // A threshold k6 evaluated is listed once, from k6's own verdict, even if `options` declares it.
  const evaluated = new Set(native.map((attempt) => attempt.testId));
  const declared = thresholdAttempts(document, context.startedAt).filter(
    (attempt) => !evaluated.has(attempt.testId),
  );
  const attempts = [...fromMetrics, ...native, ...declared];
  const rows = attempts.length > 0 ? attempts : unmeasuredAttempt(context.startedAt);

  return canonicalRunResult(
    {
      outcomes: rows.map((attempt) => attempt.status),
      attempts: rows,
      producer: 'k6',
      verifier: 'packages/reporter k6-json',
      // Every metric is carried through. A performance row whose numbers cannot be
      // charted is a performance row nobody looks at twice.
      provenance: { metrics, thresholds: document.options?.thresholds ?? {} },
    },
    context,
  );
}

export const K6_JSON_ADAPTER: ProducerAdapter = {
  mediaType: 'application/vnd.k6.summary+json',
  parse: (input, context) => parseK6Summary(input, context),
};
