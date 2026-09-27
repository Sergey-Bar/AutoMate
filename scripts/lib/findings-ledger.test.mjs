import assert from 'node:assert/strict';
import test from 'node:test';
import { auditLedger, repoRoot, readLedger } from './findings-ledger.mjs';

const root = repoRoot();

/**
 * The point of this file is that every rule is provable.
 *
 * A gate that cannot be shown to fail is a gate that measures nothing, which is
 * the defect class this repository keeps finding in its own gates. So each case
 * below plants the exact condition a rule exists to catch and asserts that the
 * audit reports it — and the last case runs the audit against the committed
 * ledger, so the real document is checked by the same code.
 */

/**
 * One row, with the given fields overridden.
 *
 * Typed as a record rather than a `Partial` of a literal, because the rules being
 * tested are exactly the ones that reach for fields this helper's callers vary —
 * `wave`, `owner`, `evidence`, `summary`, `confirmed`. A `Partial` of a fixed shape
 * would reject half the cases before the audit ever saw them.
 *
 * @param {Record<string, unknown>} [overrides]
 */
function ledgerWith(overrides = {}) {
  return {
    findings: [
      {
        id: 'X-1',
        title: 'A finding',
        band: 'Major',
        provenance: 'hand',
        status: 'open',
        summary: 'What it is.',
        ...overrides,
      },
    ],
  };
}

/** @param {string[]} findings @param {RegExp} pattern */
function hasFinding(findings, pattern) {
  return findings.some((finding) => pattern.test(finding));
}

test('an empty ledger is a finding rather than a pass', () => {
  const { findings } = auditLedger({ findings: [] }, { root });
  assert.ok(
    hasFinding(findings, /no findings, so the gate measured nothing/),
    'a ledger with no rows passes a check that has measured nothing',
  );
});

test('a missing findings array is a finding', () => {
  const { findings } = auditLedger({ schemaVersion: 1 }, { root });
  assert.ok(hasFinding(findings, /no `findings` array/));
});

test('a row with no id cannot be closed', () => {
  const { findings } = auditLedger({ findings: [{ title: 'x' }] }, { root });
  assert.ok(hasFinding(findings, /no `id`/));
});

test('a duplicate id is a finding', () => {
  const { findings } = auditLedger(
    { findings: [ledgerWith().findings[0], ledgerWith().findings[0]] },
    { root },
  );
  assert.ok(hasFinding(findings, /duplicate id/));
});

test('a row that does not say what it is cannot be closed', () => {
  const { findings } = auditLedger(ledgerWith({ summary: '   ' }), { root });
  assert.ok(hasFinding(findings, /`summary` is empty/));
});

test('an unknown band is a finding', () => {
  const { findings } = auditLedger(ledgerWith({ band: 'Disaster' }), { root });
  assert.ok(hasFinding(findings, /band must be one of/));
});

test('an unknown status is a finding, and stops the row being judged further', () => {
  const { findings } = auditLedger(ledgerWith({ status: 'probably' }), { root });
  assert.ok(hasFinding(findings, /status must be one of/));
  // A status the audit cannot read must not be silently treated as `open`.
  assert.ok(
    !hasFinding(findings, /names no wave/),
    'an unreadable status must not be interpreted as an unowned open Blocker',
  );
});

test('an open Blocker with no wave is a finding', () => {
  const { findings } = auditLedger(ledgerWith({ band: 'Blocker', status: 'open' }), { root });
  assert.ok(hasFinding(findings, /an open Blocker names no wave/));
});

test('an open Critical with no wave is a finding', () => {
  const { findings } = auditLedger(ledgerWith({ band: 'Critical', status: 'open' }), { root });
  assert.ok(hasFinding(findings, /an open Critical names no wave/));
});

test('an open Major with no wave is allowed', () => {
  const { findings } = auditLedger(ledgerWith({ band: 'Major', status: 'open' }), { root });
  assert.deepEqual(findings, []);
});

test('an owned open Blocker is a finding-free row', () => {
  const { findings } = auditLedger(ledgerWith({ band: 'Blocker', status: 'open', wave: 'W1.1' }), {
    root,
  });
  assert.deepEqual(findings, []);
});

test('a Blocker recorded as debt is a finding, because the policy forbids it', () => {
  const { findings } = auditLedger(
    ledgerWith({ band: 'Blocker', status: 'debt', owner: 'a', removalCondition: 'b' }),
    { root },
  );
  assert.ok(hasFinding(findings, /a Blocker is recorded as debt/));
});

test('a debt row with no owner is a finding', () => {
  const { findings } = auditLedger(
    ledgerWith({ band: 'Minor', status: 'debt', removalCondition: 'when the retry lands' }),
    { root },
  );
  assert.ok(hasFinding(findings, /`owner` is empty/));
});

test('a debt row with no removal condition is a finding', () => {
  const { findings } = auditLedger(
    ledgerWith({ band: 'Minor', status: 'debt', owner: 'a person' }),
    { root },
  );
  assert.ok(hasFinding(findings, /`removalCondition` is empty/));
});

test('a fully specified debt row passes', () => {
  const { findings } = auditLedger(
    ledgerWith({
      band: 'Minor',
      status: 'debt',
      owner: 'a person',
      removalCondition: 'removed when the spool directory gains an ownership check',
    }),
    { root },
  );
  assert.deepEqual(findings, []);
});

test('a fixed row with no evidence is a finding', () => {
  const { findings } = auditLedger(ledgerWith({ status: 'fixed' }), { root });
  assert.ok(hasFinding(findings, /closed with no evidence/));
});

test('a fixed row whose evidence path no longer exists is a finding', () => {
  const { findings } = auditLedger(
    ledgerWith({
      status: 'fixed',
      evidence: [{ path: 'does/not/exist.ts', asserts: 'something' }],
    }),
    { root },
  );
  assert.ok(hasFinding(findings, /does not exist/));
  assert.ok(
    hasFinding(findings, /A closed finding whose proof was deleted is open again/),
    'the message has to say why, because deleting a test is otherwise a silent fix',
  );
});

test('an evidence entry missing its assertion is a finding', () => {
  const { findings } = auditLedger(
    ledgerWith({ status: 'fixed', evidence: [{ path: 'package.json' }] }),
    { root },
  );
  assert.ok(hasFinding(findings, /needs both `path` and `asserts`/));
});

test('a real evidence path passes', () => {
  const { findings } = auditLedger(
    ledgerWith({
      status: 'fixed',
      evidence: [{ path: 'package.json', asserts: 'the scripts block' }],
    }),
    { root },
  );
  assert.deepEqual(findings, []);
});

test('a destructive-migration row cannot be closed while it is still a sweep', () => {
  // Plan §8.1: the load-bearing `sweep` rows must be spot-confirmed before
  // anything irreversible acts on them. This is that rule, executable.
  const { findings } = auditLedger(
    ledgerWith({
      id: 'P-20',
      status: 'fixed',
      provenance: 'sweep',
      evidence: [{ path: 'package.json', asserts: 'the workspace' }],
    }),
    { root },
  );
  assert.ok(hasFinding(findings, /still marked `sweep`/));
});

test('the same row closes once it is hand-confirmed', () => {
  const { findings } = auditLedger(
    ledgerWith({
      id: 'P-20',
      status: 'fixed',
      provenance: 'sweep',
      confirmed: true,
      evidence: [{ path: 'package.json', asserts: 'the workspace' }],
    }),
    { root },
  );
  assert.deepEqual(findings, []);
});

test('the confirmation rule does not apply to a row the plan does not list', () => {
  const { findings } = auditLedger(
    ledgerWith({
      status: 'fixed',
      provenance: 'sweep',
      evidence: [{ path: 'package.json', asserts: 'x' }],
    }),
    { root },
  );
  assert.deepEqual(findings, []);
});

test('a status moving from open to fixed is progress', () => {
  const { findings } = auditLedger(
    ledgerWith({ status: 'fixed', evidence: [{ path: 'package.json', asserts: 'x' }] }),
    {
      root,
      previous: { 'X-1': 'open' },
    },
  );
  assert.deepEqual(findings, []);
});

test('a status moving from open to debt is progress', () => {
  const { findings } = auditLedger(
    ledgerWith({ status: 'debt', owner: 'a', removalCondition: 'b' }),
    { root, previous: { 'X-1': 'open' } },
  );
  assert.deepEqual(findings, []);
});

test('a status moving from fixed back to open is a regression', () => {
  const { findings } = auditLedger(
    ledgerWith({ status: 'open', evidence: [{ path: 'package.json', asserts: 'x' }] }),
    { root, previous: { 'X-1': 'fixed' } },
  );
  assert.ok(hasFinding(findings, /status moved from `fixed` to `open`/));
});

test('a status moving from fixed to debt is progress, not a regression', () => {
  const { findings } = auditLedger(
    ledgerWith({ status: 'debt', owner: 'a', removalCondition: 'b' }),
    {
      root,
      previous: { 'X-1': 'fixed' },
    },
  );
  assert.deepEqual(findings, []);
});

test('a row that is not in the recorded statuses is a finding, not a silent addition', () => {
  const { findings } = auditLedger(ledgerWith(), { root, previous: {} });
  assert.ok(hasFinding(findings, /not in docs\/quality\/findings-status.json/));
});

test('a deleted row is a regression rather than a closure', () => {
  const { findings } = auditLedger(
    { findings: [ledgerWith()] },
    {
      root,
      previous: { 'X-1': 'open', 'X-2': 'fixed' },
    },
  );
  assert.ok(
    hasFinding(findings, /X-2: recorded in findings-status.json but no longer in the ledger/),
  );
});

test('the committed ledger has no recorded statuses, which is the state before the first baseline', () => {
  // Guarding the guard: if this passes with a `previous` the real run never has,
  // a broken `previous` read would be invisible.
  const { findings } = auditLedger(readLedger('docs/quality/findings-ledger.json'), { root });
  assert.ok(
    !hasFinding(findings, /not in docs\/quality\/findings-status.json/),
    'the committed ledger must be judged on its own content before a baseline exists',
  );
});

test('the committed ledger satisfies every structural rule', () => {
  const { findings, rows, byBand } = auditLedger(readLedger('docs/quality/findings-ledger.json'), {
    root,
  });
  assert.deepEqual(
    findings,
    [],
    'docs/quality/findings-ledger.json has findings against its own rules',
  );
  assert.ok(rows > 0, 'the committed ledger is not empty');
  assert.ok(byBand.Blocker > 0, 'a ledger with no Blocker rows is not this repository');
});
