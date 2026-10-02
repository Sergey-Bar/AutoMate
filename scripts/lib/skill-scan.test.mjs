/**
 * skill-scan.test.mjs — the policy half of `scripts/skill-scan.mjs`.
 *
 * Every test here has a control arm: the arm that passes when the behaviour is
 * correct, and one that must fail when it is not. A test whose control arm
 * cannot be made to fail is a test that asserts nothing, and this repository has
 * had three fully-green suites that were checking the wrong thing.
 *
 * The subject is a supply-chain gate on instructions the agent obeys, so the
 * failure mode that matters most is the quiet one: a scan that did not run
 * reporting as a pass.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';

import {
  probeScanner,
  verdictFor,
  classifyFindings,
  completenessFor,
  knownFingerprints,
  VENDORED,
} from '../skill-scan.mjs';
import {
  HOST_SCANNERS_ENV,
  HOST_SCANNERS_UNAVAILABLE,
  isHostDegradationOptedIn,
} from './host-scanners.mjs';

/** A probe that reports the binary present. */
const present = () => ({ status: 0, stderr: '' });
/** A probe that reports the binary absent, which is ENOUT on every platform. */
const absent = () => ({ status: 1, stderr: 'not found' });
/** A probe that throws, standing in for a broken Python toolchain. */
const throwing = () => {
  throw new Error('spawn skillspector ENOENT');
};

test('a scanner that runs is available', () => {
  assert.equal(probeScanner(present).available, true);
});

test('a scanner that is missing is unavailable and says so', () => {
  const outcome = probeScanner(absent);
  assert.equal(outcome.available, false);
  assert.match(outcome.reason, /not installed|not on PATH/);
});

test('a probe that throws is unavailable, and the throw does not escape', () => {
  // Without the try/catch this assertion never runs — the error propagates out of
  // `probeScanner` and the test fails with a stack trace instead of a verdict.
  const outcome = probeScanner(throwing);
  assert.equal(outcome.available, false);
  assert.match(outcome.reason, /could not be invoked/);
});

test('every unavailable outcome carries a reason', () => {
  // The reason is what `notConfiguredMessage` prints, and it is the difference
  // between "install the scanner" and "your install is broken".
  for (const probe of [absent, throwing]) {
    const outcome = probeScanner(probe);
    assert.equal(outcome.available, false);
    assert.ok(outcome.reason.length > 0, 'an unavailable scan must name its reason');
  }
});

test('SAVE and CAUTION pass', () => {
  assert.equal(verdictFor({ risk_assessment: { recommendation: 'SAFE', score: 4 } }).ok, true);
  assert.equal(verdictFor({ risk_assessment: { recommendation: 'CAUTION', score: 30 } }).ok, true);
});

test('DO_NOT_INSTALL is reported as adverse, whatever the score says', () => {
  // `ok: false` here means "report this as adverse", **not** "fail the gate". The real
  // scan returns `DO_NOT_INSTALL` on a tree of baselined false positives, so the exit
  // status is decided by `classifyFindings` — unbaselined findings — and `main` prints
  // the reason a zero exit can sit next to `DO_NOT_INSTALL` rather than leaving a
  // reader to infer it. This test pins the reporting; the `classifyFindings` tests
  // below pin the blocking.
  assert.equal(
    verdictFor({ risk_assessment: { recommendation: 'DO_NOT_INSTALL', score: 55 } }).ok,
    false,
  );
  assert.equal(
    verdictFor({ risk_assessment: { recommendation: 'DO_NOT_INSTALL', score: 0 } }).ok,
    false,
  );
});

test('a report with no verdict is adverse rather than absent', () => {
  // The control arm is the point. A parseable report that carries no assessment is
  // the `P-18` shape: a claim whose content is gone still reading as a result. If
  // this returned `ok: true`, every one of these four cases would be a silent pass.
  assert.equal(verdictFor({}).ok, false);
  assert.equal(verdictFor({ risk_assessment: {} }).ok, false);
  assert.equal(verdictFor({ risk_assessment: { score: 0 } }).ok, false);
  assert.equal(verdictFor({ risk_assessment: null }).ok, false);
});

test('non-object reports fail rather than throwing', () => {
  for (const report of [null, undefined, 'SAFE', 0, []]) {
    assert.equal(verdictFor(report).ok, false);
  }
});

test('a failing verdict names the score, so a reader can see how far off it was', () => {
  const outcome = verdictFor({ risk_assessment: { recommendation: 'DO_NOT_INSTALL', score: 78 } });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /78/);
});

test('only the exact opt-in string degrades the gate', () => {
  // Asserted against the policy module rather than re-derived, because a
  // hand-copied rule is exactly the second authority this repository keeps
  // recording as a defect. `true` and `1` deliberately do not opt in: if they
  // did, a workflow carrying a boolean default would silently turn a
  // supply-chain gate into a no-op.
  assert.equal(HOST_SCANNERS_UNAVAILABLE, 'unavailable');
  assert.equal(isHostDegradationOptedIn({ [HOST_SCANNERS_ENV]: HOST_SCANNERS_UNAVAILABLE }), true);

  for (const value of [
    'true',
    '1',
    'yes',
    'on',
    'Unavailable',
    'UNAVAILABLE',
    'unavailable ',
    '',
  ]) {
    assert.equal(
      isHostDegradationOptedIn({ [HOST_SCANNERS_ENV]: value }),
      false,
      `${HOST_SCANNERS_ENV}=${JSON.stringify(value)} must not opt in`,
    );
  }
});

test('an absent opt-in variable does not degrade the gate', () => {
  assert.equal(isHostDegradationOptedIn({}), false);
});

test('the vendored list is non-empty and frozen', () => {
  // A gate over an empty list is a gate over nothing, and `Object.freeze` stops a
  // later edit from silently narrowing what is scanned.
  assert.ok(VENDORED.length > 0, 'the vendored skill list must not be empty');
  assert.ok(Object.isFrozen(VENDORED), 'the vendored skill list must be frozen');
});

// ── The baseline ──────────────────────────────────────────────────────────────
//
// The real scan of `.kilo/skills` on 2026-10-02 returned `DO_NOT_INSTALL` with a
// risk score of 56, on the strength of six pattern matches against markdown prose:
// a React README sentence, a `dangerouslySetInnerHTML` inside a code fence, and
// unpinned `npx` in command examples. A gate that fails on those six is
// permanently red, and a permanently red gate is what this repository records as
// the reason SEM-2 is `pr-reporting` — the remedy for a noisy scanner is not to
// stop running it, but to record each finding with a reason and let the count
// stay visible.
//
// The alternative — leaving it red — is the failure `P-18` names: a claim nobody
// checked, dressed as a gate. So each of these tests carries a control arm.

/** A report shaped like the one skillspector 2.12.0 actually emits. */
/**
 * `unknown`, not `unknown[]`: one caller below passes `null` and a bare string on
 * purpose, because the property being asserted is that a malformed report is empty
 * rather than a crash. A narrower annotation would make that test unwriteable.
 *
 * @param {unknown} issues
 * @returns {Record<string, unknown>}
 */
const reportWith = (issues) => ({
  risk_assessment: { score: 56, severity: 'HIGH', recommendation: 'DO_NOT_INSTALL' },
  issues,
});

/**
 * @param {string} fingerprint
 * @param {string} id
 * @param {string} severity
 * @returns {Record<string, unknown>}
 */
const finding = (fingerprint, id, severity) => ({
  id,
  finding_id: `finding-${Math.random().toString(16).slice(2)}`,
  match_fingerprint: fingerprint,
  severity,
  finding: 'matched text',
  location: { file: 'some/SKILL.md', start_line: 10 },
});

test('a baselined fingerprint is not reported as new', () => {
  const outcome = classifyFindings(reportWith([finding('aaa', 'MP3', 'HIGH')]), new Set(['aaa']));
  assert.equal(outcome.newFindings.length, 0);
  assert.equal(outcome.stale.length, 0);
  assert.equal(outcome.total, 1);
});

test('a fingerprint the baseline does not carry is new', () => {
  const outcome = classifyFindings(
    reportWith([finding('bbb', 'TT3', 'CRITICAL')]),
    new Set(['aaa']),
  );
  assert.equal(outcome.newFindings.length, 1);
  assert.equal(outcome.newFindings[0].id, 'TT3');
  assert.equal(outcome.newFindings[0].severity, 'CRITICAL');
  assert.equal(outcome.newFindings[0].location, 'some/SKILL.md:10');
});

test('an empty baseline makes every finding new, which is the fail-closed direction', () => {
  // The control arm for "the suppression list went missing". If this returned no
  // findings, deleting the baseline would silently turn the gate into a pass —
  // the one failure mode a baseline mechanism must not have.
  const outcome = classifyFindings(reportWith([finding('aaa', 'MP3', 'HIGH')]), new Set());
  assert.equal(outcome.newFindings.length, 1);
});

test('a baseline entry the scanner no longer reports is stale, not silently dropped', () => {
  const outcome = classifyFindings(reportWith([]), new Set(['gone', 'also-gone']));
  assert.deepEqual(outcome.stale.sort(), ['also-gone', 'gone']);
  assert.equal(outcome.newFindings.length, 0);
});

test('a report with no issues array is empty, not a crash', () => {
  for (const report of [{}, { issues: null }, reportWith(null), null, 'nonsense']) {
    const outcome = classifyFindings(report, new Set(['aaa']));
    assert.equal(outcome.newFindings.length, 0);
    assert.equal(outcome.total, 0);
  }
});

test('a report without a fingerprint is new even when the baseline is full', () => {
  // An unmatchable finding must not be suppressed by an unrelated baseline entry.
  const orphan = finding('', 'MP3', 'HIGH');
  const outcome = classifyFindings(reportWith([orphan]), new Set(['aaa', 'bbb']));
  assert.equal(outcome.newFindings.length, 1);
});

// ── Completeness ──────────────────────────────────────────────────────────────

test('an incomplete scan is reported as incomplete', () => {
  // The real scan returned `is_complete: false` at 97.7% with three files
  // partially inspected. A gate that printed a clean summary there would be
  // asserting a coverage it does not have — the RF-9 shape in a new place.
  const outcome = completenessFor({
    analysis_completeness: {
      is_complete: false,
      coverage_percent: 97.7,
      scanned_components: 126,
      total_components: 129,
      analyzer_statuses: [{ analyzer_id: 'static_patterns_tool_misuse', status: 'degraded' }],
    },
  });
  assert.equal(outcome.complete, false);
  assert.match(outcome.coverage, /97\.7% \(126\/129\)/);
  assert.deepEqual(outcome.degraded, ['static_patterns_tool_misuse']);
});

test('a failed analyzer is named alongside a degraded one', () => {
  const outcome = completenessFor({
    analysis_completeness: {
      is_complete: false,
      analyzer_statuses: [
        { analyzer_id: 'a', status: 'degraded' },
        { analyzer_id: 'b', status: 'failed' },
        { analyzer_id: 'c', status: 'completed' },
        { analyzer_id: 'd', status: 'not_applicable' },
      ],
    },
  });
  assert.deepEqual(
    outcome.degraded,
    ['a', 'b'],
    'only degraded and failed analyzers are a finding',
  );
});

test('a report with no completeness block is not complete, and does not throw', () => {
  for (const report of [{}, null, 'nonsense', { analysis_completeness: null }]) {
    const outcome = completenessFor(report);
    assert.equal(outcome.complete, false);
    assert.equal(outcome.coverage, 'unknown');
    assert.deepEqual(outcome.degraded, []);
  }
});

// ── The committed baseline ────────────────────────────────────────────────────

test('the committed baseline is readable and every row states a reason', () => {
  // A baseline row with no reason is exactly what `checkKnownFindings` does for
  // the semgrep baseline: it is dropped so the finding fails the scan instead of
  // being suppressed by silence.
  const known = knownFingerprints();
  assert.ok(
    known.size > 0,
    'the committed baseline must carry fingerprints, or the gate has no baseline at all',
  );
  for (const fingerprint of known) {
    assert.match(fingerprint, /^[0-9a-f]{64}$/, `fingerprint must be a sha256: ${fingerprint}`);
  }
});

test('the committed baseline is a duplicate-free fingerprint list', () => {
  const baselinePath = path.join(
    path.resolve(import.meta.dirname, '..', '..'),
    'docs',
    'quality',
    'skill-findings-baseline.json',
  );
  const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const findings = /** @type {Array<Record<string, unknown>>} */ (parsed.findings);
  const fingerprints = findings.map((row) => row.matchFingerprint);
  assert.equal(
    new Set(fingerprints).size,
    fingerprints.length,
    'a repeated fingerprint means two rows claim the same finding and one reason will be read for both',
  );
  for (const row of findings) {
    assert.ok(
      typeof row.reason === 'string' && row.reason.trim().length > 20,
      `${row.id} needs a reason a reader can disagree with, not a label`,
    );
    assert.ok(typeof row.severity === 'string', `${row.id} needs its severity recorded`);
  }
});
