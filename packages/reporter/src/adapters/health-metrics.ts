import {
  HEALTH_METRIC_FORMATS,
  type DimensionMetric,
  type HealthMetricFormat,
} from '@automate/shared-contracts';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';
import { type Json, record, finite } from './json-fields.js';
import { parseCoverage, type CoverageFormat } from './coverage.js';
import { parseK6Summary } from './k6-json.js';

/**
 * Tool reports that are numbers rather than findings, each mapped onto 0–100.
 *
 * Every mapping is the tool's own number on a stated scale — never a re-analysis. The
 * `summary` repeats the tool's figure so a reader can check it against the report.
 *
 * | Format              | Tool's number                         | 0–100                     |
 * | ------------------- | ------------------------------------- | ------------------------- |
 * | `jscpd`             | `statistics.total.percentage`         | `100 − 4 × percentage`    |
 * | `scorecard`         | aggregate `score` (0–10)              | `× 10`                    |
 * | `lighthouse`        | each `categories.*.score` (0–1)       | `× 100`, one metric each  |
 * | `k6`                | thresholds and checks k6 evaluated    | share that passed         |
 * | `istanbul-summary`  | `total.lines.pct`                     | as is                     |
 * | a coverage format   | covered / total lines                 | `× 100`                   |
 */
/**
 * The formats whose whole report is numbers, taken from the contract so the upload door and
 * this module cannot disagree. SARIF and the evidence formats (an SBOM, a mutation run, an axe
 * run, …) carry findings or inventory and are read by their own adapters, never forced
 * through this one.
 */
export type MetricFormat = HealthMetricFormat;
export const METRIC_FORMATS: readonly MetricFormat[] = HEALTH_METRIC_FORMATS;

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function json(input: Uint8Array, what: string): Json {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw new HealthReportError('malformed', `${what} report is not valid JSON`);
  }
  const document = record(parsed);
  if (document === null)
    throw new HealthReportError('malformed', `${what} report is not an object`);
  return document;
}

function jscpd(input: Uint8Array): DimensionMetric[] {
  const total = record(record(json(input, 'jscpd')['statistics'])?.['total']);
  const percentage = finite(total?.['percentage']);
  if (percentage === null) {
    throw new HealthReportError('malformed', 'jscpd report has no statistics.total.percentage');
  }
  return [
    {
      dimension: 'code-quality',
      metric: 'duplication',
      tool: { name: 'jscpd', version: null },
      score: clamp(100 - 4 * percentage),
      summary: `${percentage.toFixed(1)}% of lines duplicated`,
    },
  ];
}

function scorecard(input: Uint8Array): DimensionMetric[] {
  const document = json(input, 'Scorecard');
  const score = finite(document['score']);
  if (score === null || score < 0)
    throw new HealthReportError('malformed', 'Scorecard report has no aggregate score');
  const checks = Array.isArray(document['checks']) ? document['checks'].length : 0;
  const version = record(document['scorecard'])?.['version'];
  return [
    {
      dimension: 'supply-chain',
      metric: 'scorecard',
      tool: { name: 'scorecard', version: typeof version === 'string' ? version : null },
      score: clamp(score * 10),
      summary: `OpenSSF Scorecard ${score.toFixed(1)} / 10 over ${String(checks)} checks`,
    },
  ];
}

function lighthouse(input: Uint8Array): DimensionMetric[] {
  const document = json(input, 'Lighthouse');
  const categories = record(document['categories']);
  const version =
    typeof document['lighthouseVersion'] === 'string' ? document['lighthouseVersion'] : null;
  const metrics = Object.entries(categories ?? {}).flatMap(([id, raw]) => {
    const category = record(raw);
    const score = finite(category?.['score']);
    if (score === null) return [];
    const title = typeof category?.['title'] === 'string' ? category['title'] : id;
    return [
      {
        dimension: 'runtime' as const,
        metric: `lighthouse ${id}`,
        tool: { name: 'lighthouse', version },
        score: clamp(score * 100),
        summary: `Lighthouse ${title} ${String(Math.round(score * 100))}`,
      },
    ];
  });
  if (metrics.length === 0)
    throw new HealthReportError('malformed', 'Lighthouse report has no scored category');
  return metrics;
}

function k6(input: Uint8Array): DimensionMetric[] {
  let result;
  try {
    result = parseK6Summary(input, {
      workspaceId: 'health',
      runId: 'health',
      sourceUri: 'k6-summary.json',
      sourceDigest: '0'.repeat(64),
      producerVersion: 'unknown',
      adapterVersion: 'health',
      startedAt: new Date(0).toISOString(),
    });
  } catch (error) {
    throw new HealthReportError(
      'malformed',
      error instanceof Error ? error.message : 'k6 summary unreadable',
    );
  }
  const decided = result.attempts.filter(
    (attempt) => attempt.status === 'passed' || attempt.status === 'failed',
  );
  if (decided.length === 0)
    throw new HealthReportError('malformed', 'k6 summary has no evaluated threshold or check');
  const passed = decided.filter((attempt) => attempt.status === 'passed').length;
  return [
    {
      dimension: 'runtime',
      metric: 'load thresholds',
      tool: { name: 'k6', version: null },
      score: (passed / decided.length) * 100,
      summary: `${String(passed)} of ${String(decided.length)} k6 thresholds and checks passed`,
    },
  ];
}

function coverageMetric(score: number, tool: string): DimensionMetric[] {
  return [
    {
      dimension: 'coverage',
      metric: 'line coverage',
      tool: { name: tool, version: null },
      score: clamp(score),
      summary: `${score.toFixed(1)}% of lines covered`,
    },
  ];
}

function istanbulSummary(input: Uint8Array): DimensionMetric[] {
  const pct = finite(record(record(json(input, 'Coverage summary')['total'])?.['lines'])?.['pct']);
  if (pct === null)
    throw new HealthReportError('malformed', 'coverage summary has no total.lines.pct');
  return coverageMetric(pct, 'istanbul');
}

function coverage(format: CoverageFormat, input: Uint8Array): DimensionMetric[] {
  let fraction: number | null;
  try {
    fraction = parseCoverage(format, input).coveredFraction;
  } catch (error) {
    throw new HealthReportError(
      'malformed',
      error instanceof Error ? error.message : `${format} unreadable`,
    );
  }
  // An empty report is an absent measurement: refusing it keeps Coverage "not measured".
  if (fraction === null)
    throw new HealthReportError('malformed', `${format} report measured no lines`);
  return coverageMetric(fraction * 100, format);
}

export function parseHealthMetrics(format: MetricFormat, input: Uint8Array): DimensionMetric[] {
  if (input.byteLength > MAX_HEALTH_REPORT_BYTES) {
    throw new HealthReportError(
      'too_large',
      `${format} report is larger than ${String(MAX_HEALTH_REPORT_BYTES)} bytes`,
    );
  }
  switch (format) {
    case 'jscpd':
      return jscpd(input);
    case 'scorecard':
      return scorecard(input);
    case 'lighthouse':
      return lighthouse(input);
    case 'k6':
      return k6(input);
    case 'istanbul-summary':
      return istanbulSummary(input);
    case 'lcov':
    case 'cobertura':
    case 'jacoco-xml':
    case 'go-coverprofile':
      return coverage(format, input);
  }
}
