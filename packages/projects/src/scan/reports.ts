import type { RepoReport } from '@automate/shared-contracts';
import { readJson } from '../detect/manifest.js';

/**
 * QA reports already on disk, and the numbers each one says.
 *
 * ## Read, never trusted as a run
 *
 * A report on disk is evidence that a tool ran *at some point* and wrote this. It is
 * not a run — nothing here knows which commit it was for — so the numbers are shown as
 * "what the files on disk say" and never fed to the score, which reads only results
 * that arrived through ingestion with their provenance attached.
 *
 * ## Not a second ingestion path
 *
 * Each reader extracts a headline and a handful of totals. A per-test parse is the
 * reporter adapters' job; a second one here would be a parser that drifts from them.
 */

type Reader = (path: string, text: string) => RepoReport | null;

interface Matcher {
  matches: (path: string) => boolean;
  read: Reader;
}

/**
 * Trees whose reports are not about the repository's own code.
 *
 * Fixture trees hold reports written to test a parser. `var/` and `artifacts/` are where a
 * running install — this one included — stores the evidence of runs it executed, which is
 * already in the run history and would otherwise be counted a second time, one file per run.
 * `corpus/` holds sample inputs for an adapter.
 */
const FIXTURE =
  /(^|\/)(fixtures?|__fixtures__|testdata|test-data|samples?|corpus|var|artifacts)\//u;

const KIND_ORDER: Record<RepoReport['kind'], number> = {
  coverage: 0,
  tests: 1,
  lint: 2,
  security: 3,
  performance: 4,
  quality: 5,
};

/** At most this many files are opened, so a tree with ten thousand XML files stays bounded. */
const MAX_REPORTS = 60;

const MATCHERS: readonly Matcher[] = [
  { matches: (path) => path.endsWith('coverage-summary.json'), read: istanbulSummary },
  { matches: (path) => path.endsWith('lcov.info'), read: lcov },
  {
    matches: (path) =>
      path.endsWith('.xml') && /junit|test-results|surefire|test-reports|reports\//iu.test(path),
    read: junit,
  },
  {
    matches: (path) =>
      path.endsWith('.json') && /playwright|test-results\/[^/]*\.json$|results\.json$/u.test(path),
    read: playwrightJson,
  },
  { matches: (path) => /eslint[^/]*\.json$/u.test(path), read: eslintJson },
  { matches: (path) => /\.sarif(\.json)?$/u.test(path), read: sarif },
  { matches: (path) => /gitleaks[^/]*\.json$/u.test(path), read: gitleaks },
  { matches: (path) => /k6[^/]*\.json$/u.test(path), read: k6Summary },
  { matches: (path) => path.endsWith('findings-ledger.json'), read: findingsLedger },
];

export async function scanReports(
  paths: readonly string[],
  read: (path: string) => Promise<string | null>,
): Promise<RepoReport[]> {
  const candidates = paths
    .filter((path) => !FIXTURE.test(path))
    .map((path) => ({ path, matcher: MATCHERS.find((matcher) => matcher.matches(path)) }))
    .filter((entry): entry is { path: string; matcher: Matcher } => entry.matcher !== undefined)
    .slice(0, MAX_REPORTS);
  const reports: RepoReport[] = [];
  for (const { path, matcher } of candidates) {
    const text = await read(path);
    if (text === null) continue;
    const report = matcher.read(path, text);
    if (report !== null) reports.push(report);
  }
  return reports.sort(
    (left, right) =>
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.path.localeCompare(right.path),
  );
}

function percentStatus(value: number): RepoReport['status'] {
  if (value >= 80) return 'good';
  if (value >= 60) return 'warn';
  return 'bad';
}

function numberAt(source: unknown, ...keys: string[]): number | null {
  let current: unknown = source;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : null;
}

export function istanbulSummary(path: string, text: string): RepoReport | null {
  const total = readJson(text)?.['total'];
  const lines = numberAt(total, 'lines', 'pct');
  if (lines === null) return null;
  const metrics: Record<string, number> = { lines };
  for (const key of ['statements', 'branches', 'functions']) {
    const value = numberAt(total, key, 'pct');
    if (value !== null) metrics[key] = value;
  }
  return {
    path,
    kind: 'coverage',
    format: 'istanbul-summary',
    headline: `${lines.toFixed(1)}% of lines covered`,
    metrics,
    status: percentStatus(lines),
  };
}

export function lcov(path: string, text: string): RepoReport | null {
  let found = 0;
  let hit = 0;
  for (const line of text.split(/\r?\n/u)) {
    if (line.startsWith('LF:')) found += Number(line.slice(3)) || 0;
    if (line.startsWith('LH:')) hit += Number(line.slice(3)) || 0;
  }
  if (found === 0) return null;
  const lines = (hit / found) * 100;
  return {
    path,
    kind: 'coverage',
    format: 'lcov',
    headline: `${lines.toFixed(1)}% of ${String(found)} lines covered`,
    metrics: { lines, linesFound: found, linesHit: hit },
    status: percentStatus(lines),
  };
}

function attribute(tag: string, name: string): number {
  const match = new RegExp(`\\s${name}="(\\d+)"`, 'u').exec(tag);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

export function junit(path: string, text: string): RepoReport | null {
  const root = /<testsuites\b[^>]*>/u.exec(text)?.[0];
  const suites = root !== undefined && /\stests="/u.test(root) ? [root] : suiteTags(text);
  if (suites.length === 0) return null;
  const sum = (name: string): number =>
    suites.reduce((total, tag) => total + attribute(tag, name), 0);
  const tests = sum('tests');
  const failed = sum('failures') + sum('errors');
  const skipped = sum('skipped');
  return {
    path,
    kind: 'tests',
    format: 'junit-xml',
    headline: `${String(tests)} tests, ${String(failed)} failing, ${String(skipped)} skipped`,
    metrics: { tests, failed, skipped, passed: Math.max(0, tests - failed - skipped) },
    status: failed > 0 ? 'bad' : tests === 0 ? 'warn' : 'good',
  };
}

function suiteTags(text: string): string[] {
  return [...text.matchAll(/<testsuite\b[^>]*>/gu)].map((match) => match[0]);
}

export function playwrightJson(path: string, text: string): RepoReport | null {
  const parsed = readJson(text);
  const stats = parsed?.['stats'];
  const expected = numberAt(stats, 'expected');
  if (parsed === null || !('suites' in parsed) || expected === null) return null;
  const unexpected = numberAt(stats, 'unexpected') ?? 0;
  const flaky = numberAt(stats, 'flaky') ?? 0;
  const skipped = numberAt(stats, 'skipped') ?? 0;
  return {
    path,
    kind: 'tests',
    format: 'playwright-json',
    headline: `${String(expected)} passed, ${String(unexpected)} failed, ${String(flaky)} flaky`,
    metrics: { passed: expected, failed: unexpected, flaky, skipped },
    status: unexpected > 0 ? 'bad' : flaky > 0 ? 'warn' : 'good',
  };
}

function parseArray(text: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function eslintJson(path: string, text: string): RepoReport | null {
  const files = parseArray(text);
  if (files === null) return null;
  const errors = files.reduce<number>((sum, file) => sum + (numberAt(file, 'errorCount') ?? 0), 0);
  const warnings = files.reduce<number>(
    (sum, file) => sum + (numberAt(file, 'warningCount') ?? 0),
    0,
  );
  return {
    path,
    kind: 'lint',
    format: 'eslint-json',
    headline: `${String(errors)} errors, ${String(warnings)} warnings across ${String(files.length)} files`,
    metrics: { errors, warnings, files: files.length },
    status: errors > 0 ? 'bad' : warnings > 0 ? 'warn' : 'good',
  };
}

export function sarif(path: string, text: string): RepoReport | null {
  const runs = readJson(text)?.['runs'];
  if (!Array.isArray(runs)) return null;
  const results = runs.reduce<number>((sum, run) => {
    const found = (run as { results?: unknown } | null)?.results;
    return sum + (Array.isArray(found) ? found.length : 0);
  }, 0);
  return {
    path,
    kind: 'security',
    format: 'sarif',
    headline: results === 0 ? 'No findings' : `${String(results)} findings`,
    metrics: { findings: results },
    status: results === 0 ? 'good' : 'bad',
  };
}

export function gitleaks(path: string, text: string): RepoReport | null {
  const leaks = parseArray(text);
  if (leaks === null) return null;
  return {
    path,
    kind: 'security',
    format: 'gitleaks-json',
    headline: leaks.length === 0 ? 'No secrets found' : `${String(leaks.length)} possible secrets`,
    metrics: { findings: leaks.length },
    status: leaks.length === 0 ? 'good' : 'bad',
  };
}

export function k6Summary(path: string, text: string): RepoReport | null {
  const metrics = readJson(text)?.['metrics'];
  const p95 =
    numberAt(metrics, 'http_req_duration', 'p(95)') ??
    numberAt(metrics, 'http_req_duration', 'values', 'p(95)');
  if (p95 === null) return null;
  const failedRate =
    numberAt(metrics, 'http_req_failed', 'value') ??
    numberAt(metrics, 'http_req_failed', 'values', 'rate') ??
    0;
  return {
    path,
    kind: 'performance',
    format: 'k6-summary',
    headline: `p95 ${p95.toFixed(0)} ms, ${(failedRate * 100).toFixed(1)}% failed requests`,
    metrics: { p95Ms: p95, failedRate },
    status: failedRate > 0.01 ? 'bad' : 'good',
  };
}

/** A findings ledger: rows with a `status`, counted by it. */
export function findingsLedger(path: string, text: string): RepoReport | null {
  const parsed = readJson(text);
  const rows = parsed?.['findings'] ?? parsed?.['rows'];
  if (!Array.isArray(rows)) return null;
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const status = (row as { status?: unknown } | null)?.status;
    if (typeof status === 'string') counts[status] = (counts[status] ?? 0) + 1;
  }
  const open = counts['open'] ?? 0;
  return {
    path,
    kind: 'quality',
    format: 'findings-ledger',
    headline: `${String(counts['fixed'] ?? 0)} fixed, ${String(open)} open of ${String(rows.length)} findings`,
    metrics: { total: rows.length, ...counts },
    status: open === 0 ? 'good' : 'warn',
  };
}
