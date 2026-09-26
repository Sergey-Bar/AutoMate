import assert from 'node:assert/strict';
import test from 'node:test';
import {
  duplicationVerdict,
  EMPTY_TOTAL,
  notConfiguredVerdict,
  readTotals,
} from './duplication-gate.mjs';

const measured = { ...EMPTY_TOTAL, sources: 400, lines: 40000, percentage: 1.61 };

test('an empty analysis is a failure, not a zero-percent pass', () => {
  // The defect this module exists for. jscpd exits 0 in this state and prints
  // "Found 0 clones", so an exit-status check alone reports a pass over no code.
  const verdict = duplicationVerdict({
    totals: { ...EMPTY_TOTAL },
    threshold: 3,
    exitStatus: 0,
    stderr: '',
  });
  assert.equal(verdict.outcome, 'fail');
  assert.match(verdict.message, /analysed 0 files/);
  assert.match(verdict.message, /not of this repository/);
});

test('a measured tree within budget passes, and says how much it measured', () => {
  const verdict = duplicationVerdict({ totals: measured, threshold: 3, exitStatus: 0, stderr: '' });
  assert.equal(verdict.outcome, 'pass');
  assert.match(verdict.message, /1\.61% of 40000 lines across 400 files/);
});

test('a measured tree over budget fails, naming the clones and the lines', () => {
  const verdict = duplicationVerdict({
    totals: { ...measured, percentage: 7.5, clones: 4, duplicatedLines: 3000 },
    threshold: 3,
    exitStatus: 1,
    stderr: '',
  });
  assert.equal(verdict.outcome, 'fail');
  assert.match(verdict.message, /7\.50% exceeds the 3% budget/);
  assert.match(verdict.message, /4 clone\(s\) over 3000 of 40000 lines/);
});

test('the threshold is a ceiling, so exactly at the limit passes', () => {
  const atLimit = duplicationVerdict({
    totals: { ...measured, percentage: 3 },
    threshold: 3,
    exitStatus: 0,
    stderr: '',
  });
  assert.equal(atLimit.outcome, 'pass');
  const overLimit = duplicationVerdict({
    totals: { ...measured, percentage: 3.01 },
    threshold: 3,
    exitStatus: 0,
    stderr: '',
  });
  assert.equal(overLimit.outcome, 'fail');
});

test('a non-zero exit with an in-budget number is a failure, not a pass', () => {
  // jscpd can exit non-zero because the scan itself failed. Reporting `pass` from
  // the percentage alone would turn a broken scan into a green gate.
  const verdict = duplicationVerdict({
    totals: { ...measured, percentage: 0.1 },
    threshold: 3,
    exitStatus: 2,
    stderr: 'boom',
  });
  assert.equal(verdict.outcome, 'fail');
  assert.match(verdict.message, /exited 2/);
  assert.match(verdict.message, /scan itself failed/);
});

test('a missing scanner is not_configured with a reason, and is not a pass', () => {
  const verdict = notConfiguredVerdict('jscpd');
  assert.equal(verdict.outcome, 'not_configured');
  assert.match(verdict.message, /jscpd is not installed/);
  assert.match(verdict.message, /This is not a pass/);
});

test('totals are read defensively, so a truncated report cannot read as a pass', () => {
  for (const report of [
    null,
    undefined,
    42,
    'x',
    {},
    { statistics: null },
    { statistics: {} },
    { statistics: { total: 'no' } },
  ]) {
    assert.deepEqual(readTotals(report), EMPTY_TOTAL);
    // Every unusable shape yields no sources, and no sources cannot pass.
    assert.equal(
      duplicationVerdict({ totals: readTotals(report), threshold: 3, exitStatus: 0, stderr: '' })
        .outcome,
      'fail',
    );
  }
  const partial = readTotals({ statistics: { total: { sources: 7, percentage: 'lots' } } });
  assert.equal(partial.sources, 7);
  assert.equal(partial.percentage, 0, 'a non-numeric percentage reads as 0, not NaN');
  // Seven files really were measured, so this is a measurement of a small tree
  // rather than of nothing, and it may pass.
  assert.equal(
    duplicationVerdict({ totals: partial, threshold: 3, exitStatus: 0, stderr: '' }).outcome,
    'pass',
  );
});

test('totals survive a report with extra or non-finite numbers', () => {
  const totals = readTotals({
    statistics: {
      total: { sources: 10, percentage: Number.NaN, clones: Number.POSITIVE_INFINITY, lines: 100 },
    },
  });
  assert.equal(totals.percentage, 0);
  assert.equal(totals.clones, 0);
  assert.equal(totals.lines, 100);
});
