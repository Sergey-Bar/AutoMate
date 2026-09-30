/**
 * `/metrics` — the Prometheus text exposition format, with no dependency.
 *
 * **Why not `prom-client`.** The format is `# HELP` / `# TYPE` / samples, and the
 * whole of it needed here is a dozen lines. What `prom-client` adds is a transitive
 * dependency tree, a **global default registry** — mutable process-wide state, which is
 * the one thing this codebase has spent two waves removing, and which a test suite
 * that imports two registries has to be careful with — and its own conventions to work
 * around. A self-hosted, single-node install whose metrics are process state and two
 * in-memory counters does not need a registry framework; it needs the text.
 *
 * **What this endpoint deliberately does not expose.** The register row
 * `ops.metrics-endpoint` is the authority, and it says the same thing:
 *
 *   - **no run, test, suite, artifact or tenant data.** Those are the customer's
 *     quality data, and a metrics scrape is a different audience from an authenticated
 *     API read. A metric label is a dimension an operator groups by, not a place to put
 *     a test name.
 *   - **no database query.** A scrape is an unauthenticated GET, so every query it makes
 *     is a query anybody can make repeatedly, and the answer would be a count of the
 *     customer's rows. Everything below is either process state or an in-memory counter,
 *     so a scrape costs a memory read and cannot be a way to load the store.
 *   - **no per-URL labels on the request counter.** `GET /api/v1/runs/:id` is one series,
 *     not one per run. A path parameter in a label is unbounded cardinality, and an
 *     unbounded-cardinality metric is a memory leak with a scrape on top.
 *
 * **The counter is monotonic and lives in this process.** It resets when the API
 * restarts, which is what `rate()` is for. A persistent counter would need a table and
 * an extra write on the request path, to answer a question `rate()` already answers.
 */

/** The content type the exposition format requires, with the charset stated. */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** The three metric types this module emits. */
export type MetricType = 'counter' | 'gauge';

/** One series: a name, a type, one line of help, its labels, and its value. */
export interface Series {
  /** `automate_` prefix, suffixed `_total` for a counter */
  name: string;
  type: MetricType;
  /** one line; the exposition format has nowhere else to put it */
  help: string;
  labels: Record<string, string>;
  value: number;
}

/**
 * The request counters, in process memory.
 *
 * Keyed by status class rather than by status code: 404 and 401 are both "the client
 * asked for something that is not there", and 500 and 503 are both "this instance
 * failed", and an operator's question is which of the two. Six classes, so a scrape
 * body is a fixed size and cannot be grown by a client choosing unusual status codes.
 */
export const STATUS_CLASSES = ['1xx', '2xx', '3xx', '4xx', '5xx'] as const;

/** @type {Map<string, number>} */
const requestCounts = new Map<string, number>(
  STATUS_CLASSES.map((statusClass) => [statusClass, 0]),
);

/**
 * Record one completed request.
 *
 * Called from the request-context middleware, so the count is a count of requests that
 * reached the app rather than a count somebody remembered to record. A scrape counts as
 * one request, which is correct: it is one.
 *
 * A status outside the five classes is dropped rather than coerced. A client cannot
 * choose the status — the handler does — so an unexpected value is a bug in a handler,
 * and counting it under a fabricated class would hide the bug behind a plausible
 * number rather than surface it.
 *
 * @param status the response status
 */
export function recordRequest(status: number): void {
  const statusClass = `${String(Math.floor(status / 100))}xx`;
  if (!requestCounts.has(statusClass)) return;
  requestCounts.set(statusClass, (requestCounts.get(statusClass) ?? 0) + 1);
}

/** The current counters, for a test and for the exposition body. */
export function requestCounterSamples(): Series[] {
  return STATUS_CLASSES.map((statusClass) => ({
    name: 'automate_http_requests_total',
    type: /** @type {const} */ 'counter',
    help: 'HTTP requests answered by this process, by response status class.',
    labels: { class: statusClass },
    value: requestCounts.get(statusClass) ?? 0,
  }));
}

/** Everything the exposition body can contain, at the moment it is rendered. */
export function collect(): Series[] {
  const memory = process.memoryUsage();
  return [
    {
      name: 'process_resident_memory_bytes',
      type: 'gauge',
      help: 'Resident set size of the API process.',
      labels: {},
      value: memory.rss,
    },
    {
      name: 'process_heap_size_used_bytes',
      type: 'gauge',
      help: 'Heap bytes in use by the API process.',
      labels: {},
      value: memory.heapUsed,
    },
    {
      name: 'process_uptime_seconds',
      type: 'gauge',
      help: 'Seconds since the API process started.',
      labels: {},
      value: Math.round(process.uptime()),
    },
    ...requestCounterSamples(),
  ];
}

/**
 * Render the series in the Prometheus text exposition format, version 0.0.4.
 *
 * `HELP` and `TYPE` are emitted once per metric name, before its first sample, and a
 * metric with no samples is omitted entirely — an absent series is how a scraper
 * represents "no data", and emitting a `# HELP` with nothing under it is a parse
 * warning in every downstream tool.
 *
 * @param series the samples to render
 * @returns the response body
 */
export function renderExposition(series: Series[]): string {
  /** @type {string[]} */
  const lines = [];
  /** @type {Set<string>} */
  const described = new Set();

  for (const sample of series) {
    if (!described.has(sample.name)) {
      described.add(sample.name);
      lines.push(`# HELP ${sample.name} ${sample.help}`);
      lines.push(`# TYPE ${sample.name} ${sample.type}`);
    }
    lines.push(`${sample.name}${renderLabels(sample.labels)} ${sample.value}`);
  }
  // A trailing newline, because the format's line-based parsers expect one and a body
  // without it is a different body from every other. An empty registry is `''` rather
  // than `'\n'`: a body with a blank line in it is not a body with no metrics in it.
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/**
 * `{a="1",b="2"}`, or `''` for a metric with no labels.
 *
 * Values are escaped for backslash, double quote and newline, per the format. An
 * unescaped newline in a label value would end the sample and the remainder of the
 * value would be read as the next line — which is how a value that came from a request
 * becomes a metric the scraper trusts.
 *
 * @param labels the series' labels
 */
function renderLabels(labels: Record<string, string>): string {
  const pairs = Object.entries(labels);
  if (pairs.length === 0) return '';
  const body = pairs.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(',');
  return `{${body}}`;
}

/** @param {string} value @returns {string} */
function escapeLabelValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}
