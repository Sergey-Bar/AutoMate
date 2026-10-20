import assert from 'node:assert/strict';
import test from 'node:test';
import { computeKpis, effectiveRuns, nearestRank } from '../src/analysis.mjs';
import { ingest } from '../src/ingest.mjs';
import { reconcile } from '../src/reconcile.mjs';
import { bytesFor, loadManifest, optionsFor } from './support.mjs';

const manifest = loadManifest();

/** @param {string[]} ids */
function items(ids) {
  return ids.map((id) => {
    const entry = manifest.find((candidate) => candidate.id === id);
    assert.ok(entry, id);
    const { artifact, result } = ingest(bytesFor(entry), optionsFor(entry));
    return {
      id,
      sha256: artifact.sha256,
      result,
      context: { ...entry.context, modifiedMs: 1_000 },
    };
  });
}

/** @param {string[]} ids */
function kpis(ids, extra = {}) {
  const all = items(ids);
  const reconciliation = reconcile(all);
  return computeKpis({
    runs: effectiveRuns(
      all.filter((item) => item.result.kind === 'run'),
      reconciliation,
    ),
    coverage: all.filter((item) => item.result.kind === 'coverage'),
    rejected: all
      .filter((item) => item.result.kind === 'rejected')
      .map((item) => ({ id: item.id, reason: item.result.rejection })),
    reconciliation,
    now: 61_000,
    ...extra,
  });
}

test('K-01: byte-identical reports are counted once, and a zero-test report is visible', () => {
  assert.equal(kpis(['junit-basic', 'junit-basic-copy']).testsFound.value, 4);
  const zero = kpis(['junit-zero-tests']);
  assert.equal(zero.testsFound.value, 0, 'a readable report with no tests is a real zero');
  assert.equal(zero.testsFound.emptyReports, 1);
});

test('byte-identical artifacts are one run even before any grouping', () => {
  assert.equal(effectiveRuns(items(['junit-basic', 'junit-basic-copy'])).length, 1);
});

test('K-01 to K-07: with nothing readable every figure is missing, not zero', () => {
  const none = kpis(['not-a-report']);
  for (const key of [
    'testsFound',
    'testsByOutcome',
    'firstPassRate',
    'executionFailureRate',
    'retryRecoveredRate',
    'durationP50',
    'durationP95',
    'coverageByType',
  ]) {
    assert.equal(none[key].value, null, key);
    assert.ok(typeof none[key].missing === 'string', `${key} says why`);
  }
  assert.equal(none.testsFound.missing, 'all-reports-rejected');
  assert.equal(kpis([]).testsFound.missing, 'no-reports-found');
});

test('K-02: every outcome is counted and they add up to the tests found', () => {
  const out = kpis(['junit-basic']);
  assert.deepEqual(
    Object.entries(out.testsByOutcome.value).filter(([, n]) => n > 0),
    [
      ['passed', 1],
      ['failed', 1],
      ['errored', 1],
      ['skipped', 1],
    ],
  );
  assert.equal(
    Object.values(out.testsByOutcome.value).reduce((a, b) => a + b, 0),
    out.testsByOutcome.total,
  );
});

test('K-03 and K-04: rates carry their denominator and what was excluded', () => {
  const out = kpis(['junit-basic', 'junit-truncated']);
  // junit-basic: 4 product attempts. junit-truncated: 2 product attempts and 1 unknown.
  assert.equal(out.firstPassRate.denominator, 6);
  assert.equal(out.firstPassRate.numerator, 2);
  assert.equal(out.firstPassRate.unknown, 1);
  assert.equal(out.firstPassRate.value, 2 / 6);
  assert.equal(out.executionFailureRate.numerator, 2);
  assert.equal(out.firstPassRate.confidence, 'low', 'an incomplete report lowers confidence');
  assert.equal(kpis(['junit-basic']).firstPassRate.confidence, 'high');
});

test('K-05: only retry evidence the report itself records is counted', () => {
  const out = kpis(['playwright-retries']);
  assert.equal(out.retryRecoveredRate.numerator, 2);
  assert.equal(out.retryRecoveredRate.denominator, 6);
  assert.equal(kpis(['junit-basic']).retryRecoveredRate.numerator, 0);
});

test('K-06 and K-07: attempts with no valid duration are left out and counted', () => {
  const out = kpis(['junit-time-garbage']);
  assert.equal(out.durationP50.value, 1500);
  assert.equal(out.durationP50.attempts, 1);
  assert.equal(nearestRank([], 0.5), null);
  assert.equal(nearestRank([1, 2, 3, 4], 0.5), 2);
  assert.equal(nearestRank([1, 2, 3, 4], 0.95), 4);
});

test('K-08: coverage per type, and a type no file reports is missing, not 0%', () => {
  const real = kpis(['node-lcov']).coverageByType.value;
  assert.deepEqual(
    [real.lines.percent, real.functions.percent, real.branches.percent],
    [87.76, 77.78, 100],
  );
  const basic = kpis(['lcov-basic']).coverageByType.value;
  assert.equal(basic.branches.value, null);
  assert.equal(basic.branches.missing, 'not-reported');
  assert.equal(kpis(['lcov-empty-file']).coverageByType.value.lines.percent, null);
});

test('K-09: every report shows its age, and a report with no file time shows none', () => {
  const out = kpis(['junit-basic']);
  assert.deepEqual(out.freshness, [{ id: 'junit-basic', ageMs: 60_000 }]);
  assert.equal(out.newestReportMs, 60_000);
  const noTime = computeKpis({
    runs: [{ id: 'x', sha256: 'x', result: items(['junit-basic'])[0].result }],
    now: 5,
  });
  assert.equal(noTime.freshness[0].ageMs, null);
});

test('K-10 and K-11: completeness is counted and rejected reports are not hidden', () => {
  const out = kpis(['junit-basic', 'junit-truncated', 'junit-wrong-root']);
  assert.deepEqual(out.completeness, { complete: 1, partial: 0, unknown: 1, rejected: 1 });
  assert.deepEqual(out.reportsFound, { found: 3, read: 2, rejected: 1, duplicates: 0, unread: 0 });
});

test('K-12: tools come from the scan with their evidence, and an empty scan says so', () => {
  const scan = {
    reports: [],
    projects: [
      {
        relativePath: '.',
        findings: [{ subject: 'test-tool:jest', confidence: 0.9, evidence: ['package.json:3'] }],
      },
    ],
  };
  assert.deepEqual(computeKpis({ runs: [], scan }).toolsDetected.value, [
    { project: '.', tool: 'jest', confidence: 0.9, evidence: ['package.json:3'] },
  ]);
  assert.equal(
    computeKpis({ runs: [], scan: { reports: [], projects: [] } }).toolsDetected.note,
    'nothing recognised',
  );
  assert.equal(computeKpis({ runs: [] }).toolsDetected.missing, 'no-scan');
});

test('K-13: a contradiction is counted and a clean pair is not', () => {
  assert.equal(kpis(['contradict-junit', 'contradict-playwright']).disagreements.value, 1);
  assert.equal(kpis(['pair-junit', 'pair-playwright']).disagreements.value, 0);
});

test('the same execution in two formats is counted once, and shards are added', () => {
  assert.equal(kpis(['pair-junit', 'pair-playwright']).testsFound.value, 3);
  assert.equal(kpis(['junit-shard-1', 'junit-shard-2']).testsFound.value, 4);
});
