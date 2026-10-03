import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  auditLedger,
  auditWaveGates,
  landedWaves,
  readLedger,
  readWaveGates,
  repoRoot,
} from './findings-ledger.mjs';

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
  assert.ok(hasFinding(findings, /`sweep` finding/));
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

// This pair is the whole of the generalization. The rule used to consult a
// thirteen-id `Set`, and these two cases are what it could not see: a `sweep` row
// that arrived after the list was written, and one whose id was never on it. Both
// could be closed with no human having read them, which is the exact condition
// D13 exists to prevent. The first case fails against the old rule; the second
// pins that `confirmed` is the only thing that opens the gate.
test('an unconfirmed sweep row cannot be closed, whatever its id', () => {
  for (const id of ['X-9', 'Q-99', 'not-in-any-list']) {
    const { findings } = auditLedger(
      ledgerWith({
        id,
        status: 'fixed',
        provenance: 'sweep',
        evidence: [{ path: 'package.json', asserts: 'x' }],
      }),
      { root },
    );
    assert.ok(
      hasFinding(findings, /`sweep` finding/),
      `${id} closed unconfirmed: an id absent from a hard-coded set used to mean exempt`,
    );
  }
});

test('a hand-confirmed sweep row closes whatever its id', () => {
  const { findings } = auditLedger(
    ledgerWith({
      id: 'X-9',
      status: 'fixed',
      provenance: 'sweep',
      confirmed: true,
      evidence: [{ path: 'package.json', asserts: 'x' }],
    }),
    { root },
  );
  assert.deepEqual(findings, []);
});

test('the confirmation rule does not apply to a hand-provenance row', () => {
  const { findings } = auditLedger(
    ledgerWith({
      status: 'fixed',
      provenance: 'hand',
      evidence: [{ path: 'package.json', asserts: 'x' }],
    }),
    { root },
  );
  assert.deepEqual(findings, []);
});

test('an unreadable confirmation flag does not count as confirmation', () => {
  // `confirmed` is a claim about a human having read the row, so only the literal
  // `true` opens the gate. Anything else — a date, a string, `false` — must not, or
  // the field becomes a checkbox rather than a record.
  for (const confirmed of ['2026-09-27', 1, 'true', false, null]) {
    const { findings } = auditLedger(
      ledgerWith({
        status: 'fixed',
        provenance: 'sweep',
        confirmed,
        evidence: [{ path: 'package.json', asserts: 'x' }],
      }),
      { root },
    );
    assert.ok(
      hasFinding(findings, /`sweep` finding/),
      `confirmed: ${String(confirmed)} opened the gate`,
    );
  }
});

test('a refuted row with no pointer is a finding', () => {
  // Without `refutedBy`, "false positive" is indistinguishable from a row nobody
  // wanted to fix — and unlike `open`, a refutation is read as a result.
  const { findings } = auditLedger(ledgerWith({ status: 'false-positive' }), { root });
  assert.ok(hasFinding(findings, /must say what refutes it/));
  assert.ok(hasFinding(findings, /`refutedBy`/));
});

test('a refuted row that names what refuted it passes', () => {
  const { findings } = auditLedger(
    ledgerWith({
      status: 'false-positive',
      refutedBy: 'apps/api/src/routes/features.ts:12 returns the real registry',
    }),
    { root },
  );
  assert.deepEqual(findings, []);
});

test('a refuted row needs no wave, evidence or confirmation', () => {
  // The refutation *is* the evidence. Requiring a test path would mean inventing a
  // test for a defect that does not exist, which is the mistake W-A exists to stop.
  const { findings } = auditLedger(
    ledgerWith({ band: 'Blocker', status: 'false-positive', refutedBy: 'x.ts:1 is a comment' }),
    { root },
  );
  assert.deepEqual(findings, []);
});

test('an unconfirmed sweep row can be refuted instead of fixed', () => {
  // The honest exit for a sweep row that turns out to be wrong. Before the
  // `false-positive` disposition existed, the only moves were to close it
  // unconfirmed or to delete it and turn the ratchet red.
  const { findings } = auditLedger(
    ledgerWith({ status: 'false-positive', provenance: 'sweep', refutedBy: 'never happened' }),
    { root },
  );
  assert.deepEqual(findings, []);
});

test('open to false-positive is progress', () => {
  const { findings } = auditLedger(ledgerWith({ status: 'false-positive', refutedBy: 'x.ts:1' }), {
    root,
    previous: { 'X-1': 'open' },
  });
  assert.deepEqual(findings, []);
});

test('fixed to false-positive is progress, because the fix met no defect', () => {
  const { findings } = auditLedger(ledgerWith({ status: 'false-positive', refutedBy: 'x.ts:1' }), {
    root,
    previous: { 'X-1': 'fixed' },
  });
  assert.deepEqual(findings, []);
});

test('debt to false-positive is progress', () => {
  const { findings } = auditLedger(ledgerWith({ status: 'false-positive', refutedBy: 'x.ts:1' }), {
    root,
    previous: { 'X-1': 'debt' },
  });
  assert.deepEqual(findings, []);
});

test('a refutation is terminal: un-refuting a refuted row is a regression', () => {
  // The asymmetry is the point. A refutation somebody has not read is not a
  // refutation, so the only way out of this status is to delete the row — which the
  // ratchet also refuses. It is a one-way door on purpose.
  const { findings } = auditLedger(ledgerWith({ status: 'open' }), {
    root,
    previous: { 'X-1': 'false-positive' },
  });
  assert.ok(hasFinding(findings, /status moved from `false-positive` to `open`/));
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

// ── The wave gates ───────────────────────────────────────────────────────────

/**
 * A wave gate whose migration is a file that really exists, so `waveHasLanded` has
 * something to stat.
 *
 * The real tree is the fixture on purpose. A wave-gate rule whose only test used a
 * fictional path would pass whether or not the reader worked, because "the migration
 * is not on disk" and "the wave has not landed" are indistinguishable from here —
 * which is the mistake this file is named for.
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {{ schemaVersion: number, waves: Record<string, unknown> }}
 */
function gatesWith(overrides = {}) {
  return {
    schemaVersion: 1,
    waves: {
      W7: {
        gate: 'one rehearsal run',
        gatingRows: ['RF-5'],
        migrations: ['packages/db/drizzle/0015_schedule_workspace_scope.sql'],
        ...overrides,
      },
    },
  };
}

test("a wave that landed before its gate did is the merge gate's finding, not this one", () => {
  // The shape audit is about the two documents, so it says nothing about whether a
  // wave's work has landed. That question is `checkWaveBlocks` in `merge-gate.mjs`,
  // and asserting the split here is what stops the rule drifting back — a wave-gate
  // rule in `findings:check` makes `pnpm verify` red on a defect only the rehearsal
  // can clear, which is the `test:render` shape this repository already refuses.
  assert.deepEqual(
    auditWaveGates(
      gatesWith(),
      { findings: [{ id: 'RF-5', status: 'open', blocksWave: 'W7' }] },
      { root },
    ),
    [],
  );
});

test('a wave whose migrations are all absent is not landed, and the shape audit still names the missing file', () => {
  // Two findings, not one and not zero. "Not landed" and "listed a file that is not
  // there" are separate defects, and collapsing them would let a renamed migration
  // read as a wave nobody started.
  const findings = auditWaveGates(
    gatesWith({ migrations: ['packages/db/drizzle/9999_never_written.sql'] }),
    { findings: [{ id: 'RF-5', status: 'open' }] },
    { root },
  );
  assert.deepEqual(findings, [
    'docs/quality/wave-gates.json: wave `W7` lists `packages/db/drizzle/9999_never_written.sql`, which does not exist. A migration or landing artefact that was renamed or deleted leaves the gate describing a wave that was never here.',
  ]);
});

test('a migration listed for a wave must exist, or the gate describes a wave that was never here', () => {
  const findings = auditWaveGates(
    gatesWith({
      migrations: ['packages/db/drizzle/0015_schedule_workspace_scope.sql', 'gone.sql'],
    }),
    { findings: [{ id: 'RF-5', status: 'fixed' }] },
    { root },
  );
  assert.ok(hasFinding(findings, /lists `gone\.sql`, which does not exist/));
});

test('a wave gating on a row that is not in the ledger is a finding', () => {
  assert.ok(
    hasFinding(
      auditWaveGates(gatesWith({ gatingRows: ['X-99'] }), { findings: [] }, { root }),
      /gated on `X-99`, which is not a ledger row/,
    ),
    'a gate on a row that does not exist is a gate that cannot fail',
  );
});

test('a wave naming no gating row is a finding, rather than a wave with no entry condition', () => {
  assert.ok(
    hasFinding(
      auditWaveGates(gatesWith({ gatingRows: [] }), { findings: [] }, { root }),
      /names no `gatingRows`/,
    ),
  );
});

test('a wave naming no migrations can never fire, which is a finding', () => {
  assert.ok(
    hasFinding(
      auditWaveGates(gatesWith({ migrations: [] }), { findings: [] }, { root }),
      /names neither `migrations` nor `landedBy`/,
    ),
  );
});

test('a wave that changes no schema names `landedBy`, and that is enough to fire', () => {
  // Wave 0 unified the two ingestion systems and added no table. Before `landedBy` existed
  // there was no way to say so: naming a migration would mean inventing one or claiming the
  // RF-5 rehearsal had happened, and leaving `migrations` out made the wave a gate that
  // could never fire — which is the state this file exists to end, reached by the other
  // door.
  //
  // The fixture path is a real file in the real tree, for the reason `gatesWith` documents.
  const gates = gatesWith({
    migrations: undefined,
    landedBy: ['apps/api/src/services/canonical-projection.ts'],
  });
  assert.deepEqual(
    auditWaveGates(gates, { findings: [{ id: 'RF-5', status: 'open' }] }, { root }),
    [],
  );
  assert.deepEqual(landedWaves(gates, { root }), ['W7']);
});

test('a `landedBy` path that is not on disk is a finding, and the wave has not landed', () => {
  const gates = gatesWith({ migrations: undefined, landedBy: ['apps/api/src/services/gone.ts'] });
  assert.ok(
    hasFinding(
      auditWaveGates(gates, { findings: [] }, { root }),
      /lists `apps\/api\/src\/services\/gone\.ts`, which does not exist/,
    ),
  );
  assert.deepEqual(landedWaves(gates, { root }), []);
});

test('both landing fields are read as one list, so neither can hide behind the other', () => {
  // A wave that lists a migration *and* a landing artefact lands on whichever exists. If
  // either field were read alone, deleting one artefact would leave the wave reading as
  // landed on the strength of the other — a gate that reports clear because a file moved.
  const both = gatesWith({ landedBy: ['apps/api/src/services/canonical-projection.ts'] });
  const onlyMigration = gatesWith();
  assert.deepEqual(landedWaves(both, { root }), ['W7']);
  assert.deepEqual(landedWaves(onlyMigration, { root }), ['W7']);
  const neitherOnDisk = gatesWith({
    migrations: ['packages/db/drizzle/9999_never_written.sql'],
    landedBy: ['apps/api/src/services/gone.ts'],
  });
  assert.deepEqual(landedWaves(neitherOnDisk, { root }), []);
  const missing = auditWaveGates(
    // The gating row is present, so the only findings are the two absent artefacts.
    gatesWith({
      migrations: ['packages/db/drizzle/9999_never_written.sql'],
      landedBy: ['apps/api/src/services/gone.ts'],
    }),
    { findings: [{ id: 'RF-5', status: 'open' }] },
    { root },
  );
  assert.equal(missing.length, 2, 'both absent paths are named, not just the first');
  assert.ok(missing[0].includes('packages/db/drizzle/9999_never_written.sql'));
  assert.ok(missing[1].includes('apps/api/src/services/gone.ts'));
});

test('`blocksWave` must name a wave the manifest declares', () => {
  // The inverse of the rule above, and the one that keeps the field honest: a row
  // claiming to block a wave nothing tracks is asserting a block over nothing, which
  // is the shape of the defect `blocksWave` was added to fix.
  assert.ok(
    hasFinding(
      auditWaveGates(
        gatesWith(),
        { findings: [{ id: 'C-6', status: 'debt', blocksWave: 'W9' }] },
        { root },
      ),
      /`blocksWave` is `W9`, which .* does not declare/,
    ),
  );
});

test('the wave gates themselves are readable, and an unreadable one is not a pass', () => {
  assert.ok(existsSync(path.join(root, 'docs', 'quality', 'wave-gates.json')));
  assert.ok(
    hasFinding(
      auditWaveGates(null, { findings: [] }, { root }),
      /could not be read, so no wave gate could be checked/,
    ),
    'a gate that cannot read its policy must not report the policy as satisfied',
  );
});

test('the committed wave gates name only migrations that exist and rows that are in the ledger', () => {
  // The structural half of the real manifest, so the file cannot rot into describing
  // waves this repository does not have. The *state* half — whether W7's gate is met —
  // is a finding today and is expected to be one; asserting it either way would make
  // this test fail on the day the rehearsal runs.
  const findings = auditWaveGates(
    readWaveGates(),
    readLedger('docs/quality/findings-ledger.json'),
    {
      root,
    },
  );
  assert.deepEqual(
    findings.filter((finding) =>
      /does not exist|is not a ledger row|names no |does not declare|could not be read/.test(
        finding,
      ),
    ),
    [],
    'docs/quality/wave-gates.json is structurally wrong against the tree',
  );
});
