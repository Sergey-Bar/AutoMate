/**
 * The metrics of docs/local/kpi-dictionary.md, as pure functions.
 *
 * Every figure carries its denominator and what was excluded from it. A value that cannot be
 * computed is `null` with a reason, never `0`.
 */
import { OUTCOME_CLASS, OUTCOMES } from './model.mjs';

/**
 * @typedef {{ id: string, sha256: string, result: any,
 *   context?: { modifiedMs?: number } }} AnalysisItem
 */

/**
 * @param {number[]} values
 * @param {number} percentile 0..1
 * @returns {number | null}
 */
export function nearestRank(values, percentile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

/**
 * The runs whose results count, after the reconciliation rules: one artifact once, one
 * execution in two formats once (the primary report), shards all together.
 *
 * @param {AnalysisItem[]} items
 * @param {{ groups: Array<{ kind: string, members: string[], primary: string | null }> }} [reconciliation]
 * @returns {AnalysisItem[]}
 */
export function effectiveRuns(items, reconciliation) {
  const runs = items.filter((item) => item.result.kind === 'run');
  const seen = new Set();
  const distinct = runs.filter((item) => {
    if (seen.has(item.sha256)) return false;
    seen.add(item.sha256);
    return true;
  });
  if (reconciliation === undefined) return distinct;
  const keep = new Set();
  for (const group of reconciliation.groups) {
    const chosen =
      group.kind === 'shards' || group.kind === 'single'
        ? group.members
        : [group.primary ?? group.members[0]];
    for (const id of chosen) keep.add(id);
  }
  return distinct.filter((item) => keep.has(item.id));
}

const missing = (reason) => ({ value: null, missing: reason });

/**
 * @param {AnalysisItem[]} runs effective runs
 */
function attemptsOf(runs) {
  return runs.flatMap((item) =>
    item.result.tests.flatMap((test) =>
      test.attempts.map((attempt) => ({ ...attempt, flakiness: test.flakiness })),
    ),
  );
}

/**
 * The attempt-based rates (K-03, K-04, K-05): numerators over product attempts, with the
 * excluded attempts counted beside them.
 *
 * @param {AnalysisItem[]} runs
 */
function rates(runs) {
  const attempts = attemptsOf(runs);
  const product = attempts.filter((a) => OUTCOME_CLASS[a.outcome] === 'product');
  const unknown = attempts.filter((a) => OUTCOME_CLASS[a.outcome] === 'indeterminate').length;
  const nonProduct = attempts.filter((a) => OUTCOME_CLASS[a.outcome] === 'nonProduct').length;
  const confidence =
    runs.length > 0 && runs.every((r) => r.result.completeness === 'complete') ? 'high' : 'low';
  /** @param {number} numerator */
  const rate = (numerator) =>
    product.length === 0
      ? {
          ...missing('no-product-attempts'),
          numerator: 0,
          denominator: 0,
          unknown,
          nonProduct,
          confidence,
        }
      : {
          value: numerator / product.length,
          numerator,
          denominator: product.length,
          unknown,
          nonProduct,
          confidence,
        };
  return {
    firstPassRate: rate(product.filter((a) => a.outcome === 'passed').length),
    executionFailureRate: rate(product.filter((a) => a.outcome === 'failed').length),
    retryRecoveredRate: rate(product.filter((a) => a.flakiness === 'observed').length),
    durations: product.map((a) => a.durationMs).filter((d) => typeof d === 'number'),
  };
}

/**
 * @param {{ runs: AnalysisItem[], coverage?: AnalysisItem[], rejected?: Array<{ id: string, reason: string }>,
 *   scan?: any, reconciliation?: any, now?: number }} input runs are the effective runs
 */
export function computeKpis(input) {
  const runs = input.runs;
  const coverage = input.coverage ?? [];
  const now = input.now ?? Date.now();
  const noRuns = runs.length === 0;
  const reason = (input.rejected ?? []).length > 0 ? 'all-reports-rejected' : 'no-reports-found';

  const tests = runs.flatMap((r) => r.result.tests);
  const stamps = runs.map((r) => r.context?.modifiedMs).filter((m) => typeof m === 'number');
  const r = rates(runs);
  const durations = r.durations;

  /** @type {Record<string, number>} */
  const byOutcome = {};
  for (const outcome of OUTCOMES) byOutcome[outcome] = 0;
  for (const test of tests) byOutcome[test.outcome] = (byOutcome[test.outcome] ?? 0) + 1;

  /** @type {Record<string, number>} */
  const completeness = {
    complete: 0,
    partial: 0,
    unknown: 0,
    rejected: input.rejected?.length ?? 0,
  };
  for (const item of [...runs, ...coverage]) {
    completeness[item.result.completeness] = (completeness[item.result.completeness] ?? 0) + 1;
  }

  return {
    testsFound: noRuns
      ? { ...missing(reason), runs: 0 }
      : {
          value: tests.length,
          runs: runs.length,
          emptyReports: runs.filter((x) => x.result.tests.length === 0).length,
        },
    testsByOutcome: noRuns ? missing(reason) : { value: byOutcome, total: tests.length },
    firstPassRate: r.firstPassRate,
    executionFailureRate: r.executionFailureRate,
    retryRecoveredRate: r.retryRecoveredRate,
    durationP50:
      durations.length === 0
        ? missing('no-durations')
        : { value: nearestRank(durations, 0.5), attempts: durations.length },
    durationP95:
      durations.length === 0
        ? missing('no-durations')
        : { value: nearestRank(durations, 0.95), attempts: durations.length },
    coverageByType: coverageKpi(coverage),
    freshness: runs.concat(coverage).map((item) => ({
      id: item.id,
      ageMs:
        typeof item.context?.modifiedMs === 'number'
          ? Math.max(0, now - item.context.modifiedMs)
          : null,
    })),
    oldestReportMs: stamps.length === 0 ? null : now - Math.min(...stamps),
    newestReportMs: stamps.length === 0 ? null : now - Math.max(...stamps),
    completeness,
    reportsFound: reportsFound(input.scan, runs, coverage, input.rejected ?? []),
    toolsDetected: toolsDetected(input.scan),
    disagreements: input.reconciliation
      ? {
          value: input.reconciliation.disagreements.length,
          contestedGroups: input.reconciliation.groups.filter((g) => g.status === 'contested')
            .length,
        }
      : { value: null, missing: 'no-grouped-reports' },
  };
}

/** @param {AnalysisItem[]} coverage */
function coverageKpi(coverage) {
  const readable = coverage.filter((item) => item.result.kind === 'coverage');
  if (readable.length === 0) return missing('no-coverage-report');
  /** @type {Record<string, any>} */
  const out = {};
  for (const type of ['lines', 'functions', 'branches']) {
    const reporting = readable.map((item) => item.result.totals[type]).filter((t) => t !== null);
    if (reporting.length === 0) {
      out[type] = missing('not-reported');
      continue;
    }
    const found = reporting.reduce((sum, t) => sum + t.found, 0);
    const hit = reporting.reduce((sum, t) => sum + t.hit, 0);
    out[type] = {
      found,
      hit,
      percent: found === 0 ? null : Math.round((hit / found) * 10_000) / 100,
      reports: reporting.length,
      ofReports: readable.length,
    };
  }
  return { value: out, reports: readable.length };
}

/**
 * K-11. Files found, distinct reports read, rejected, extra copies of reports already counted,
 * and files that were found but could not be read.
 */
function reportsFound(scan, runs, coverage, rejected) {
  const reports = scan?.reports;
  if (reports === undefined) {
    const read = runs.length + coverage.length;
    return {
      found: read + rejected.length,
      read,
      rejected: rejected.length,
      duplicates: 0,
      unread: 0,
    };
  }
  const withDigest = reports.filter((report) => report.sha256);
  const distinct = new Set(withDigest.map((report) => report.sha256)).size;
  return {
    found: reports.length,
    read: distinct - rejected.length,
    rejected: rejected.length,
    duplicates: withDigest.length - distinct,
    unread: reports.length - withDigest.length,
  };
}
function toolsDetected(scan) {
  if (scan === undefined) return { value: null, missing: 'no-scan' };
  const tools = scan.projects.flatMap((project) =>
    project.findings
      .filter((f) => f.subject.startsWith('test-tool:'))
      .map((f) => ({
        project: project.relativePath,
        tool: f.subject.slice('test-tool:'.length),
        confidence: f.confidence,
        evidence: f.evidence,
      })),
  );
  return tools.length === 0 ? { value: [], note: 'nothing recognised' } : { value: tools };
}
