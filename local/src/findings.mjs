/**
 * Cross-tool findings (Phase 4), deterministic and evidence-based.
 *
 * A finding is a statement the stored reports support, with the evidence and the conditions
 * under which it was made. It is never a diagnosis: a correlation is worded as "observed
 * together", and a comparison is made only between reports that are comparable, which here
 * means the same report path, read at different scans, with the commit relation stated.
 *
 * The thresholds are proposals, not measurements. They are in one object, returned with the
 * findings, so a reader can see what a finding was held to.
 */
import { createHash } from 'node:crypto';

export const FINDING_DEFAULTS = {
  repeatedFailureMin: 3,
  flakyMinExecutions: 5,
  durationBaselineMin: 3,
  durationRatio: 2,
  durationMinDeltaMs: 500,
  staleDays: 7,
  coverageDropPoints: 1,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RESULT_FORMATS = new Set(['junit-xml', 'playwright-json']);

/** @param {string} text */
const fingerprint = (text) => createHash('sha256').update(text).digest('hex').slice(0, 20);

/** @param {any} test */
const keyOf = (test) =>
  [test.project ?? '', test.file ?? '', test.suite ?? '', test.name].join('\u0001');
/** @param {any} test */
const labelOf = (test) => [test.suite, test.name].filter(Boolean).join(' › ') || '(unnamed test)';

/** @param {any} test */
const durationOf = (test) => {
  const values = test.attempts
    .map((/** @type {any} */ a) => a.durationMs)
    .filter((/** @type {unknown} */ d) => typeof d === 'number');
  return values.length === 0
    ? null
    : values.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0);
};

/** @param {number[]} values */
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/**
 * @typedef {{ sha256: string, path: string, format: string | null, modifiedMs: number,
 *   scanId: string, observedAt: string, commit: string | null }} Observation
 */

/**
 * The reports of a repository as chronological observations per path. Consecutive scans that
 * saw the same bytes at a path are one observation.
 *
 * @param {Array<{ id: string, started_at: string, summary: any }>} scans oldest first
 * @returns {Map<string, Observation[]>}
 */
export function observationsByPath(scans) {
  /** @type {Map<string, Observation[]>} */
  const byPath = new Map();
  for (const scan of scans) {
    for (const report of scan.summary.reports ?? []) {
      if (typeof report.sha256 !== 'string') continue;
      const list = byPath.get(report.path) ?? [];
      if (list.at(-1)?.sha256 === report.sha256) continue;
      list.push({
        sha256: report.sha256,
        path: report.path,
        format: report.format ?? null,
        modifiedMs: report.modifiedMs,
        scanId: scan.id,
        observedAt: scan.started_at,
        commit: scan.summary.commit ?? null,
      });
      byPath.set(report.path, list);
    }
  }
  return byPath;
}

/**
 * @param {Observation | undefined} a
 * @param {Observation | undefined} b
 * @returns {'same-commit' | 'different-commit' | 'unknown'}
 */
function commitRelation(a, b) {
  if (a?.commit == null || b?.commit == null) return 'unknown';
  return a.commit === b.commit ? 'same-commit' : 'different-commit';
}

/** @param {string} relation */
const relationText = (relation) =>
  relation === 'same-commit'
    ? 'The commit is the same in both scans, so a change here is not explained by a code change.'
    : relation === 'different-commit'
      ? 'The commits differ between the two scans.'
      : 'The commit of one or both scans is not known, so nothing is said about code changes.';

/**
 * @param {{ scans: Array<{ id: string, started_at: string, summary: any }>,
 *   resultOf: (sha256: string) => any | null, now: number, thresholds?: Partial<typeof FINDING_DEFAULTS> }} input
 */
export function computeFindings(input) {
  const t = { ...FINDING_DEFAULTS, ...input.thresholds };
  /** @type {any[]} */
  const findings = [];
  const latestScan = input.scans.at(-1);
  if (latestScan === undefined) return { findings, thresholds: t, comparable: 'none' };
  const byPath = observationsByPath(input.scans);

  /**
   * @param {Omit<any, 'id' | 'fingerprint' | 'dismissed' | 'dismissal'> & { basis: string }} f
   */
  const add = (f) => {
    const { basis, ...rest } = f;
    const fp = fingerprint(`${rest.rule}|${basis}`);
    findings.push({ id: fp, fingerprint: fp, dismissed: false, dismissal: null, ...rest });
  };

  /** Test-result observations only, with their parsed results. */
  const runsAt = (/** @type {string} */ pathKey) =>
    (byPath.get(pathKey) ?? [])
      .map((o) => ({ o, result: input.resultOf(o.sha256) }))
      .filter((x) => x.result?.kind === 'run');

  for (const pathKey of byPath.keys()) {
    const runs = runsAt(pathKey);
    if (runs.length < 1) continue;
    const latest = runs.at(-1);
    if (latest === undefined) continue;
    const latestComplete = latest.result.completeness === 'complete';

    const previous = runs.at(-2);
    if (previous !== undefined) {
      const before = new Map(previous.result.tests.map((/** @type {any} */ x) => [keyOf(x), x]));
      const relation = commitRelation(previous.o, latest.o);
      const confident =
        latestComplete && previous.result.completeness === 'complete' && relation !== 'unknown';
      for (const test of latest.result.tests) {
        const earlier = before.get(keyOf(test));
        if (earlier === undefined) continue;
        if (test.outcome === 'failed' && earlier.outcome === 'passed') {
          add({
            rule: 'new-failure',
            basis: `${pathKey}|${keyOf(test)}|${latest.o.sha256}`,
            title: `${labelOf(test)} failed in the latest report and passed in the one before`,
            severity: 'medium',
            priority: relation === 'different-commit' ? 'high' : 'medium',
            confidence: confident ? 'high' : 'medium',
            comparability: `Same report path (${pathKey}), two scans. ${relationText(relation)}`,
            evidence: [
              `earlier report ${previous.o.sha256.slice(0, 12)} (${previous.o.observedAt}): passed`,
              `latest report ${latest.o.sha256.slice(0, 12)} (${latest.o.observedAt}): failed`,
            ],
            explanation:
              'This test passed in the earlier report and failed in the latest. That is an observation of two reports, not a diagnosis.',
            suggestedAction:
              'Open the latest report for the failure message and compare it with the earlier report.',
            verify:
              'Run the tests again and scan: the finding goes away when the latest report shows the test passing.',
            falsePositives:
              'A test that is flaky, or whose name or file changed, can look new. Dismiss it with a note if so.',
          });
        }
        const d = durationOf(test);
        if (d !== null) {
          const baseline = runs
            .slice(0, -1)
            .map((r) => r.result.tests.find((/** @type {any} */ x) => keyOf(x) === keyOf(test)))
            .filter(Boolean)
            .map((/** @type {any} */ x) => durationOf(x))
            .filter((/** @type {number | null} */ x) => x !== null);
          if (baseline.length >= t.durationBaselineMin) {
            const base = median(/** @type {number[]} */ (baseline));
            const delta = d - base;
            const ratio = base > 0 ? d / base : Number.POSITIVE_INFINITY;
            if (
              Math.abs(delta) >= t.durationMinDeltaMs &&
              (ratio >= t.durationRatio || ratio <= 1 / t.durationRatio)
            ) {
              add({
                rule: 'duration-change',
                basis: `${pathKey}|${keyOf(test)}|${latest.o.sha256}`,
                title: `${labelOf(test)} took ${delta > 0 ? 'longer' : 'less time'} than usual`,
                severity: 'low',
                priority: 'low',
                confidence: latestComplete ? 'medium' : 'low',
                comparability: `Same report path (${pathKey}); the baseline is the median of ${String(
                  baseline.length,
                )} earlier reports. The machine and its load are not known.`,
                evidence: [
                  `latest: ${String(Math.round(d))} ms`,
                  `median of ${String(baseline.length)} earlier reports: ${String(
                    Math.round(base),
                  )} ms`,
                ],
                explanation: `The duration changed by ${String(
                  Math.round(delta),
                )} ms against the median. Durations vary with the machine and its load, which this tool does not measure.`,
                suggestedAction:
                  'Check whether the test or the code it exercises changed, and whether the machine was busy.',
                verify:
                  'Run the tests again; the finding goes away when the duration is back within the stated range.',
                falsePositives: `Only a change of at least ${String(
                  t.durationMinDeltaMs,
                )} ms and a factor of ${String(
                  t.durationRatio,
                )} is reported. Dismiss it with a note if the change is expected.`,
              });
            }
          }
        }
      }
    }

    // Repeated failure: failing in each of the last N observations.
    for (const test of latest.result.tests) {
      if (test.outcome !== 'failed') continue;
      let streak = 0;
      for (let i = runs.length - 1; i >= 0; i -= 1) {
        const there = runs[i]?.result.tests.find(
          (/** @type {any} */ x) => keyOf(x) === keyOf(test),
        );
        if (there?.outcome === 'failed') streak += 1;
        else break;
      }
      if (streak >= t.repeatedFailureMin) {
        add({
          rule: 'repeated-failure',
          basis: `${pathKey}|${keyOf(test)}`,
          title: `${labelOf(test)} has failed in each of the last ${String(streak)} reports`,
          severity: 'medium',
          priority: 'medium',
          confidence: latestComplete ? 'high' : 'medium',
          comparability: `Same report path (${pathKey}), ${String(
            streak,
          )} consecutive scans that saw a different report.`,
          evidence: runs
            .slice(-streak)
            .map((r) => `report ${r.o.sha256.slice(0, 12)} (${r.o.observedAt}): failed`),
          explanation: `A failure that is present in ${String(
            streak,
          )} reports in a row is not a one-off. This says nothing about why.`,
          suggestedAction:
            'Treat it as a real failure to look at, or dismiss it with a note if it is known and accepted.',
          verify: 'It goes away once the latest report shows the test passing.',
          falsePositives: `Reported only from ${String(
            t.repeatedFailureMin,
          )} reports in a row. A test that is expected to fail can be dismissed with a note.`,
        });
      }
    }

    // Flakiness from history: passing and failing on one known commit, enough times.
    /** @type {Map<string, Array<{ outcome: string }>>} */
    const perTest = new Map();
    for (const r of runs) {
      if (r.o.commit == null) continue;
      for (const test of r.result.tests) {
        if (test.outcome !== 'passed' && test.outcome !== 'failed') continue;
        const key = `${r.o.commit}\u0002${keyOf(test)}`;
        const list = perTest.get(key) ?? [];
        list.push({ outcome: test.outcome });
        perTest.set(key, list);
      }
    }
    for (const [key, list] of perTest) {
      const hasBoth =
        list.some((x) => x.outcome === 'passed') && list.some((x) => x.outcome === 'failed');
      if (list.length < t.flakyMinExecutions || !hasBoth) continue;
      const [commit = '', testKey = ''] = key.split('\u0002');
      const test = latest.result.tests.find((/** @type {any} */ x) => keyOf(x) === testKey);
      if (test === undefined) continue;
      add({
        rule: 'flaky-from-history',
        basis: `${pathKey}|${testKey}|${commit}`,
        title: `${labelOf(test)} both passed and failed on the same commit`,
        severity: 'medium',
        priority: 'medium',
        confidence: 'medium',
        comparability: `Same report path (${pathKey}); ${String(
          list.length,
        )} executions of one commit (${commit.slice(
          0,
          12,
        )}). The minimum for this label is ${String(t.flakyMinExecutions)}.`,
        evidence: [
          `${String(list.filter((x) => x.outcome === 'passed').length)} passed, ${String(
            list.filter((x) => x.outcome === 'failed').length,
          )} failed, on commit ${commit.slice(0, 12)}`,
        ],
        explanation:
          'The same code produced both outcomes, which is what "flaky" means here. What triggers it (timing, order, environment) is not known.',
        suggestedAction:
          'Look at what varies between runs: ordering, shared state, timing, the environment.',
        verify: `It goes away only when there are no longer both outcomes among ${String(
          t.flakyMinExecutions,
        )} or more executions of one commit.`,
        falsePositives:
          'A change in the environment between runs can look like flakiness. Dismiss it with a note if the reason is known.',
      });
    }
  }

  // Coverage change between the two latest observations of a coverage report.
  for (const [pathKey, list] of byPath) {
    const coverage = list
      .map((o) => ({ o, result: input.resultOf(o.sha256) }))
      .filter((x) => x.result?.kind === 'coverage');
    const latest = coverage.at(-1);
    const previous = coverage.at(-2);
    const now = latest?.result.totals?.lines?.percent;
    const then = previous?.result.totals?.lines?.percent;
    if (
      latest === undefined ||
      previous === undefined ||
      typeof now !== 'number' ||
      typeof then !== 'number'
    )
      continue;
    if (then - now >= t.coverageDropPoints) {
      const together = findings.filter((f) => f.rule === 'new-failure').map((f) => f.id);
      add({
        rule: 'coverage-change',
        basis: `${pathKey}|${latest.o.sha256}`,
        title: `Reported line coverage fell from ${then.toFixed(2)}% to ${now.toFixed(2)}%`,
        severity: 'low',
        priority: 'low',
        confidence:
          latest.result.completeness === 'complete' && previous.result.completeness === 'complete'
            ? 'medium'
            : 'low',
        comparability: `Same report path (${pathKey}), two scans. ${relationText(
          commitRelation(previous.o, latest.o),
        )} What the files cover can change between runs.`,
        evidence: [
          `earlier ${then.toFixed(2)}% (${previous.o.observedAt})`,
          `latest ${now.toFixed(2)}% (${latest.o.observedAt})`,
          ...(together.length > 0
            ? [
                `observed together with ${String(
                  together.length,
                )} new test failure finding(s); neither is claimed to explain the other`,
              ]
            : []),
        ],
        explanation:
          'The coverage tool reported a lower figure. Coverage figures move for many reasons, including which files were included.',
        suggestedAction: 'Compare the two coverage reports for the files whose coverage changed.',
        verify:
          'It goes away when a later coverage report is not lower than the earlier one by the stated amount.',
        falsePositives: `Only a drop of ${String(
          t.coverageDropPoints,
        )} percentage point or more is reported. Dismiss it with a note if the change is expected.`,
      });
    }
  }

  // Missing and stale reports, from the latest scan.
  const summary = latestScan.summary;
  for (const project of summary.projects ?? []) {
    const tool = project.findings.find((/** @type {any} */ f) =>
      f.subject.startsWith('test-tool:'),
    );
    if (tool === undefined) continue;
    const prefix = project.relativePath === '.' ? '' : `${project.relativePath}/`;
    const results = (summary.reports ?? []).filter(
      (/** @type {any} */ r) =>
        r.path.startsWith(prefix) && RESULT_FORMATS.has(r.format) && typeof r.sha256 === 'string',
    );
    if (results.length === 0) {
      add({
        rule: 'missing-report',
        basis: `${project.relativePath}|${tool.subject}`,
        title: `${tool.subject.slice('test-tool:'.length)} is used in ${
          project.relativePath
        }, but the scan found no test result report there`,
        severity: 'low',
        priority: 'medium',
        confidence: tool.confidence >= 0.9 ? 'medium' : 'low',
        comparability: 'One scan.',
        evidence: [
          ...tool.evidence,
          `the scan read ${String(
            summary.reports?.length ?? 0,
          )} report file(s) in the repository and none is a JUnit XML or Playwright JSON test result under ${
            project.relativePath
          }`,
        ],
        explanation:
          'Either the tests have not been run here, or their reports are written somewhere this scan did not look. It does not show that anything is wrong.',
        suggestedAction:
          'Run the tests with the runner and say where the report is written, or scan the folder the reports go to.',
        verify: 'It goes away when a scan finds a test result report for this project.',
        falsePositives:
          'A project that runs its tests elsewhere (for example only in CI) will always show this. Dismiss it with a note.',
      });
    }
  }
  const stamps = (summary.reports ?? []).filter(
    (/** @type {any} */ r) => typeof r.modifiedMs === 'number' && RESULT_FORMATS.has(r.format),
  );
  if (stamps.length > 0) {
    const newest = stamps.reduce((/** @type {any} */ a, /** @type {any} */ b) =>
      b.modifiedMs > a.modifiedMs ? b : a,
    );
    const ageDays = (input.now - newest.modifiedMs) / DAY_MS;
    if (ageDays >= t.staleDays) {
      add({
        rule: 'stale-report',
        basis: `${newest.path}|${String(newest.sha256)}`,
        title: `The newest test report is ${String(Math.floor(ageDays))} days old`,
        severity: 'low',
        priority: 'low',
        confidence: 'high',
        comparability:
          'One scan, judged against the clock of this computer and the file time of the report.',
        evidence: [`${newest.path}, file time ${new Date(newest.modifiedMs).toISOString()}`],
        explanation:
          'The figures describe an old run. A file time can also be wrong if the file was copied or restored.',
        suggestedAction:
          'Run the tests again if you want the figures to describe the current code.',
        verify: `It goes away when the newest test report is less than ${String(
          t.staleDays,
        )} days old.`,
        falsePositives:
          'A repository that is not under active development will show this. Dismiss it with a note.',
      });
    }
  }
  return { findings, thresholds: t, comparable: byPath.size === 0 ? 'none' : 'same-path' };
}

/**
 * Marks findings the user dismissed. A dismissed finding stays in the list, flagged, so it can
 * be shown on request; it is never deleted.
 *
 * @param {any[]} findings
 * @param {Array<{ fingerprint: string, dismissed_at: string, note: string | null }>} dismissals
 */
export function applyDismissals(findings, dismissals) {
  const byFingerprint = new Map(dismissals.map((d) => [d.fingerprint, d]));
  return findings.map((f) => {
    const d = byFingerprint.get(f.fingerprint);
    return d === undefined
      ? f
      : {
          ...f,
          dismissed: true,
          dismissal: { at: d.dismissed_at, note: d.note, by: 'the local user' },
        };
  });
}
