import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  POINTS,
  VERDICTS,
  evaluate,
  loadContext,
  markdownTable,
  repoRoot,
  tally,
  worstOf,
} from './status-ten.mjs';

/**
 * @typedef {import('./status-ten.mjs').Clause} Clause
 * @typedef {import('./status-ten.mjs').Verdict} Verdict
 */

/** The real tree, evaluated once. */
const context = loadContext(repoRoot());
const reports = evaluate(context);

// The two point-6 claims, named once. A test that spells a claim string inline is a test
// that fails the day somebody rewords the clause, and the failure says nothing about the
// probe — which is the same "detector that finds a word" mistake the module's header
// describes, committed by the suite written to catch it.
const METRICS_CLAIM = 'a metrics endpoint exists';
const DIAGNOSTICS_CLAIM = 'a run-diagnostics surface answers why a verdict happened';

/**
 * A context that is the real one with one fact changed, which is how a probe is
 * proven falsifiable without rebuilding a whole repository.
 *
 * @param {Partial<Parameters<typeof evaluate>[0]>} overrides
 */
function withFacts(overrides) {
  return { ...context, ...overrides };
}

test('every point is numbered 1 to 12, in order, and names a command that decides it', () => {
  assert.deepEqual(
    POINTS.map((point) => point.number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    'the roadmap §17 order is the order a reader will look in',
  );
  for (const point of POINTS) {
    assert.notEqual(point.decidedBy.trim(), '', `point ${String(point.number)} names no command`);
    assert.notEqual(point.title.trim(), '', `point ${String(point.number)} has no title`);
    assert.ok(
      Array.isArray(point.probe(context)),
      `point ${String(point.number)} returns no clause list`,
    );
  }
});

test('every clause resolves to one of the three outcomes, and the worst one wins', () => {
  // §5.3, and the whole design: three outcomes, no fourth. A `pass` with nothing
  // behind it is the thing this module is shaped to make hard, and an outcome list
  // that grew a fourth value would be the first step off that path.
  assert.deepEqual([...VERDICTS].sort(), ['fail', 'not_configured', 'pass']);

  for (const report of reports) {
    assert.ok(report.clauses.length > 0, `point ${String(report.number)} checked nothing`);
    for (const clause of report.clauses) {
      assert.ok(
        VERDICTS.includes(clause.verdict),
        `point ${String(report.number)} produced a fourth outcome: ${clause.verdict}`,
      );
      assert.notEqual(
        clause.reason.trim(),
        '',
        `point ${String(report.number)} has a silent clause`,
      );
      assert.notEqual(
        clause.claim.trim(),
        '',
        `point ${String(report.number)} has an unnamed clause`,
      );
    }
    assert.equal(report.verdict, worstOf(report.clauses));
  }

  // The worst-clause rule, on clauses that are only verdicts. `worstOf` reads
  // nothing else, so these are the shapes it has to get right, and they are here
  // rather than inside the loop above because a synthetic clause is easier to read
  // as a list than as a table row.
  /** @param {Verdict} verdict */
  const only = (verdict) => [clauseWith(verdict)];
  assert.equal(worstOf([...only('pass'), ...only('not_configured')]), 'not_configured');
  assert.equal(worstOf([...only('pass'), ...only('fail')]), 'fail');
  assert.equal(worstOf([...only('fail'), ...only('not_configured')]), 'fail');
  assert.equal(worstOf(only('pass')), 'pass');
});

/** @param {Verdict} verdict @returns {Clause} */
function clauseWith(verdict) {
  return { claim: 'a synthetic claim', verdict, reason: 'a synthetic reason' };
}

test('a verdict is decided by the facts, not by the report: each probe is shown to flip on purpose', () => {
  // The reason for this suite. A measurement that has only ever printed one table
  // cannot be distinguished from one that would print that table whatever the tree
  // looked like, so each clause is re-run against a tree where the fact it reads is
  // deliberately *unsatisfied*, and must flip to `fail`. A probe that does not flip is
  // reporting its subject rather than measuring it.
  // Point 6: the instrumented clauses. **Remove** what makes them pass and each must
  // fail — the stronger direction, and the one that survives the tree moving. An earlier
  // version asserted "and the real tree must still report the absence", which is a
  // statement about today rather than about the probe, and it failed on the day the
  // metrics endpoint landed.
  //
  // Each clause is falsified by removing the thing *it* reads, which is why the fixture
  // touches two different files: `/metrics` lives in `health.ts` and the diagnostics
  // surface is the gate route in `runs.routes.ts`.
  const withoutInstrumentation = withFacts({
    text: (relative) => {
      if (relative === 'apps/api/src/routes/health.ts') {
        return context.text(relative).replace("health.get('/metrics'", "health.get('/removed");
      }
      if (relative === 'apps/api/src/routes/execution/runs.routes.ts') {
        // The diagnostics surface is the *gate* route, so removing `/metrics` does not
        // touch it — each clause is falsified by removing the thing it actually reads.
        return context
          .text(relative)
          .replace("app.get('/api/v1/runs/:runId/gate'", "app.get('/removed");
      }
      return context.text(relative);
    },
    has: (relative) =>
      relative === 'apps/api/src/observability/metrics.ts' ? false : context.has(relative),
  });
  const sixWithout = evaluate(withoutInstrumentation).find((report) => report.number === 6);
  assert.equal(
    sixWithout?.clauses.find((clause) => clause.claim === METRICS_CLAIM)?.verdict,
    'fail',
    'removing the route must fail the metrics clause, or the clause is not reading the route',
  );
  assert.equal(
    sixWithout?.clauses.find((clause) => clause.claim === DIAGNOSTICS_CLAIM)?.verdict,
    'fail',
    'removing the gate route must fail the diagnostics clause',
  );

  // And the real tree is instrumented, which is why the two clauses hold today.
  const sixReal = reports.find((report) => report.number === 6);
  for (const claim of [METRICS_CLAIM, DIAGNOSTICS_CLAIM]) {
    assert.equal(
      sixReal?.clauses.find((clause) => clause.claim === claim)?.verdict,
      'pass',
      `the real tree should satisfy: ${claim}`,
    );
  }

  // Point 3: the durable-path spec is absent. Add one naming every stage and both
  // spec clauses must pass.
  const withSpec = withFacts({
    files: (relative) => [...context.files(relative), 'e2e/integration/durable-path.spec.ts'],
    text: (relative) =>
      relative === 'e2e/integration/durable-path.spec.ts'
        ? [
            'migrate',
            'authenticate',
            'enqueue',
            'runner',
            'stream',
            'evidence',
            'cancel',
            'lease',
            'gate',
          ]
            .map((stage) => `// ${stage}`)
            .join('\n')
        : context.text(relative),
  });
  const three = evaluate(withSpec).find((report) => report.number === 3);
  assert.equal(
    three?.clauses.find((clause) => clause.claim === 'a spec walks the durable chain')?.verdict,
    'pass',
  );
  assert.equal(
    three?.clauses.find((clause) => clause.claim === 'the spec names every stage of the chain')
      ?.verdict,
    'pass',
  );

  // Point 3, continued: **the real spec now exists, and it has to say what the fixture
  // said.** The fixture above is a string of `// <stage>` markers the harness reads, so
  // it proves the *probe* works. It says nothing about the spec in the tree, and a spec
  // that exists without every stage marker is exactly the case where point 3 would
  // report a pass on a chain nobody walked: the file is present, the stages are not
  // named, and the reader is invited to trust a walk that was never written down.
  //
  // So the real file is read here and every stage is required of *it*, by the same
  // markers `pointThree` searches for. Read from the tree rather than restated, so this
  // cannot pass while the spec regresses.
  const durableSpec = context.files('e2e').find((file) => file.endsWith('durable-path.spec.ts'));
  assert.ok(
    durableSpec,
    'e2e/product/durable-path.spec.ts is missing; point 3 cannot pass without it',
  );
  const durableSource = context.text(durableSpec).toLowerCase();
  for (const stage of [
    'migrate',
    'authenticate',
    'enqueue',
    'runner',
    'stream',
    'evidence',
    'cancel',
    'lease',
    'gate',
  ]) {
    assert.ok(
      durableSource.includes(stage),
      `the durable-path spec never names the ${stage} stage, so point 3's "every stage" ` +
        'clause would pass on a walk nobody documented',
    );
  }

  // Point 11: `review:pr` is absent. The command is read through the context, so the
  // fixture is one field rather than a rewritten package.json on disk.
  const withReview = withFacts({
    rootScriptCommand: (name) =>
      name === 'review:pr' ? 'node ./scripts/review-pr.mjs' : context.rootScriptCommand(name),
  });
  const eleven = evaluate(withReview).find((report) => report.number === 11);
  assert.equal(
    eleven?.clauses.find((clause) => clause.claim.includes('review:pr'))?.verdict,
    'pass',
  );

  // Point 5: the complexity ceiling is 15 against a target of 10. Lower it to 10 and
  // the clause must pass; the mutation clause must not.
  //
  // The ledger's `Q-1` row is stripped for these two, because a deferral converts a
  // `fail` into a `not_configured` and the property being asserted here is the probe's,
  // not the deferral's. (And that the *real* tree reports `not_configured` for the
  // mutation clause is asserted by the next test, from the row.)
  const noDeferrals = {
    ...context,
    ledgerRows: context.ledgerRows.filter((row) => row.id !== 'Q-1'),
  };
  const tightened = withFacts({
    ledgerRows: noDeferrals.ledgerRows,
    json: (relative) =>
      relative === 'docs/quality/complexity-baseline.json'
        ? { .../** @type {Record<string, unknown>} */ (context.json(relative)), ceiling: 10 }
        : context.json(relative),
  });
  const five = evaluate(tightened).find((report) => report.number === 5);
  assert.equal(
    five?.clauses.find((clause) => clause.claim.includes('complexity ceiling'))?.verdict,
    'pass',
  );
  assert.equal(five?.clauses.find((clause) => clause.claim.includes('mutation'))?.verdict, 'fail');

  // And the real tree does not meet the target, so the flip above was a flip rather
  // than a restatement. Read from the baseline rather than written down, so this
  // survives the ceiling being lowered on the day someone does the refactoring.
  const recorded = /** @type {{ ceiling?: number }} */ (
    context.json('docs/quality/complexity-baseline.json')
  );
  assert.ok(
    (recorded.ceiling ?? 0) > 10,
    `the recorded ceiling is ${String(recorded.ceiling)}; if it is at most 10 the test above is ` +
      'asserting the real state and no longer proves the probe reads anything',
  );
});

test('a debt row converts a fail into a not_configured, and only a complete one does', () => {
  // The mechanism the closing plan's Track 4 depends on: deferring a point must show up
  // on the measurement, must name the row, the owner and a checkable condition — and
  // must not be able to hide a defect.
  //
  // `Q-1` is a real row in the ledger, so the baseline is "the real row, with the status
  // swapped for each case". Deriving the fixtures from a live row rather than from
  // hand-written objects is what keeps this test honest as rows are added and
  // re-banded: the first version asserted `Q-1 is not in the ledger yet`, which is a
  // statement about the moment it was written and failed the day it stopped being true.
  const real = context.ledgerRows.find((candidate) => candidate.id === 'Q-1');
  assert.ok(real, 'Q-1 is the deferral row for point 5 and must be in the ledger');
  const complexityClause = (/** @type {Array<Record<string, unknown>>} */ rows) =>
    evaluate({ ...context, ledgerRows: rows })
      .find((report) => report.number === 5)
      ?.clauses.find((clause) => clause.claim.includes('complexity ceiling'));

  const withoutRow = context.ledgerRows.filter((candidate) => candidate.id !== 'Q-1');
  assert.equal(
    complexityClause(withoutRow)?.verdict,
    'fail',
    'with no row at all, the complexity clause reports the real state',
  );

  // A complete `debt` row defers it, and the reason names the owner and the condition.
  const deferred = complexityClause([
    ...withoutRow,
    { ...real, owner: 'roadmap Track 4', removalCondition: 'the recorded ceiling is at most 10' },
  ]);
  assert.equal(deferred?.verdict, 'not_configured', 'a complete debt row defers the fail');
  assert.match(deferred?.reason ?? '', /owner: roadmap Track 4/);
  assert.match(deferred?.reason ?? '', /Removal condition: the recorded ceiling is at most 10/);

  // The three ways a row can be present and still not defer anything. Each is a way a
  // deferral could become permanent and invisible, which is the thing this mechanism has
  // to prevent.
  assert.equal(
    complexityClause([...withoutRow, { ...real, status: 'open' }])?.verdict,
    'fail',
    'an open row must not defer a fail',
  );
  assert.equal(
    complexityClause([...withoutRow, { ...real, status: 'debt', owner: '', removalCondition: 'x' }])
      ?.verdict,
    'fail',
    'a debt row with no owner is not a deferral',
  );
  assert.equal(
    complexityClause([...withoutRow, { ...real, status: 'debt', owner: 'x', removalCondition: '' }])
      ?.verdict,
    'fail',
    'a debt row with no removal condition is a deferral that cannot end',
  );
  assert.equal(
    complexityClause([
      ...withoutRow,
      { ...real, status: 'debt', owner: '  ', removalCondition: 'y' },
    ])?.verdict,
    'fail',
    'whitespace is not an owner',
  );
});

test('a recorded debt row names the row, the owner and a checkable condition', () => {
  // Read from the real ledger rather than a fixture, because the claim is about the
  // rows this repository actually carries.
  for (const row of context.ledgerRows) {
    if (row.status !== 'debt') continue;
    assert.notEqual(row.owner, undefined, `${String(row.id)} is debt with no owner`);
    assert.notEqual(
      row.removalCondition,
      undefined,
      `${String(row.id)} is debt with no removal condition`,
    );
  }
  // `findings-check.mjs` is the authority on the rule; this only asserts the
  // measurement and the ledger are reading the same document.
  assert.ok(
    context.ledgerRows.length > 100,
    `only ${String(context.ledgerRows.length)} ledger rows read, so the deferral rule is untested`,
  );
});

test('the tally and the table report the same numbers as the clause list', () => {
  const counts = tally(reports);
  assert.equal(
    counts.pass + counts.fail + counts.not_configured,
    reports.length,
    'every point lands in exactly one bucket',
  );
  assert.equal(counts.fail, reports.filter((report) => report.verdict === 'fail').length);

  const table = markdownTable(reports);
  assert.equal(table.length, reports.length + 2, 'a header, a separator and one row per point');
  // Every cell is padded to the column width, because a table emitted without that
  // padding is a `format:check` failure on every run.
  const widths = table[0].split('|').map((cell) => cell.length);
  for (const row of table) {
    assert.deepEqual(
      row.split('|').map((cell) => cell.length),
      widths,
      `unpadded row: ${row}`,
    );
  }
  // And no verdict is ever described in a fourth way. Row N of the table body is at
  // index N, because the header and the separator occupy 0 and 1.
  for (const report of reports) {
    assert.ok(
      table[1 + report.number].includes('`' + report.verdict + '`'),
      `row ${String(report.number)} does not carry its verdict: ${table[1 + report.number]}`,
    );
  }
});

test('the graduation is armed, and an open Blocker is what makes it fail', () => {
  // `--strict` was a switch because arming a gate that reports red forever is not a
  // gate — it blocks every pull request and teaches reviewers to read red as noise.
  // So the arming had to be a deliberate, recorded act, and the record has to be
  // falsifiable: a `const strict = false` here would make `pnpm status:10` a
  // measurement again, silently, and every `fail` row would stop mattering with no
  // diff in any test.
  const reporter = readFileSync(new globalThis.URL('../status-ten.mjs', import.meta.url), 'utf8');
  assert.match(
    reporter,
    /const strict = true;/,
    'status:10 must be armed: the last `fail` row was closed on 2026-10-01, and the gate ' +
      'was to be armed in that commit. Set `const strict = false` only together with a ' +
      'ledger row explaining why a `fail` is tolerable again.',
  );

  // And the second half of the graduation is proven **synthetically** rather than
  // against a count.
  //
  // It used to be `real.fail === 0`. That assertion cannot be right: a test that fails
  // the day a real obligation is discovered is a test that gets deleted or the defect
  // does, and this file's own comment says what the correct behaviour is — *a `fail` row
  // reappearing while `strict` is armed makes `pnpm status:10` exit 1, which is the gate
  // doing its job.* RF-5 exercised exactly that on 2026-10-02, and the count went to 1.
  //
  // The property being defended is that an open Blocker **becomes** a `fail` and is named.
  // Asserting the count asserted the weather; planting the row asserts the instrument, and
  // the instrument has to work whether the tree currently has an open Blocker or not —
  // which is precisely the case a count assertion cannot tell apart from a working gate.
  const planted = evaluate(
    withFacts({
      ledgerRows: [
        { id: 'PLANTED-1', band: 'Blocker', status: 'open', title: 'planted for this test' },
      ],
    }),
  );
  const eleventh = planted.find((report) => report.number === 11);
  assert.equal(
    eleventh?.verdict,
    'fail',
    'point 11 is §17’s eleventh point — zero open Blocker or Critical — so a planted open ' +
      'Blocker must make it fail, or arming `strict` means nothing.',
  );
  const failing = (eleventh?.clauses ?? []).filter((clause) => clause.verdict === 'fail');
  assert.ok(failing.length > 0, 'the planted Blocker produced no failing clause');
  assert.match(
    failing.map((clause) => clause.reason).join(' | '),
    /PLANTED-1 \(Blocker\)/,
    'a `fail` has to name the row that caused it, or the red is not actionable',
  );
});

test('the measurement reads committed files, and executes no gate', () => {
  // §5.3's consequence, asserted rather than assumed. If a probe ever started
  // running a test suite, the generated site page would become a snapshot of a
  // moment rather than a statement about the code, and the staleness gate in
  // `docs:check` would compare two different things.
  const source = readFileSync(new globalThis.URL('./status-ten.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['child_process', 'execSync', 'spawnSync', 'execFile', 'node:http']) {
    assert.equal(
      source.includes(forbidden),
      false,
      `scripts/lib/status-ten.mjs must not reference ${forbidden}: a probe that runs a gate, or reaches ` +
        'the network, makes the committed report a snapshot of a moment',
    );
  }
  // Every run-bearing clause is `not_configured` for the same reason, and the count
  // is stated so a change to it is a visible diff rather than a quiet one. Selected
  // by the shared reason's own wording rather than by the claim, so a structural
  // clause that happens to name a command — point 10's "`pnpm docs:check` runs them",
  // which is about the script's definition — is not mistaken for a run.
  const runs = reports
    .flatMap((report) => report.clauses)
    .filter((clause) => clause.reason.includes('does not execute a gate'));
  for (const clause of runs) {
    assert.equal(
      clause.verdict,
      'not_configured',
      `a clause whose evidence is a run cannot be a pass in a measurement that runs nothing: ${clause.claim}`,
    );
    assert.match(
      clause.reason,
      /`pnpm [^`]+`/,
      'a run clause must name the command that would decide it',
    );
  }
  assert.ok(runs.length >= 8, `only ${String(runs.length)} run-bearing clause(s) found`);
});
