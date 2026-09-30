import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  OUTCOMES,
  ROOT,
  checkBranchName,
  checkBudget,
  checkCommitSubjects,
  checkLedger,
  checkTestsPerChange,
  readPolicy,
  worstOf,
} from './merge-gate.mjs';

const policy = readPolicy();

/** @typedef {import('./merge-gate.mjs').Outcome} Outcome */

/**
 * Every check is proven against the shape it exists to catch, and each `not_configured`
 * path is proven to be reachable — because a gate that reports `not_configured` on a
 * state nobody can reach is a gate whose `not_configured` is decorative.
 */
test('every check reports one of the three outcomes, and the worst wins', () => {
  assert.deepEqual([...OUTCOMES].sort(), ['fail', 'not_configured', 'pass']);
  /** @param {Outcome} outcome */
  const with_ = (outcome) => [checked(outcome)];
  assert.equal(worstOf([...with_('pass'), ...with_('not_configured')]), 'not_configured');
  assert.equal(worstOf([...with_('pass'), ...with_('fail')]), 'fail');
  assert.equal(worstOf([...with_('fail'), ...with_('not_configured')]), 'fail');
  assert.equal(worstOf(with_('pass')), 'pass');
});

/**
 * A check carrying only an outcome, for the worst-of rule.
 *
 * @param {Outcome} outcome
 * @returns {import('./merge-gate.mjs').Check}
 */
function checked(outcome) {
  return { id: 'synthetic', what: 'a synthetic check', outcome, problems: [], note: '' };
}

test('the policy is a file, and its grammar is the policy', () => {
  // A budget written into the script is a policy nobody can change without editing the
  // thing that enforces it, and `merge-gate.json` existing is the assertion.
  assert.ok(existsSync(path.join(ROOT, '.github', 'review-rules', 'merge-gate.json')));
  assert.equal(policy.schemaVersion, 1);
  assert.notEqual(policy.branch.pattern, undefined, 'branch.pattern is missing');
  assert.notEqual(policy.branch.types, undefined, 'branch.types is missing');
  assert.ok(policy.budget.maxChangedLinesPerFile > 0);
  assert.ok(policy.budget.maxTotalChangedLines >= policy.budget.maxChangedLinesPerFile);
});

test('a branch name is a grammar, and each of its three failures is named', () => {
  assert.equal(checkBranchName('feat/add-metrics', policy).outcome, 'pass');
  assert.equal(checkBranchName('fix/rate-limit-regression', policy).outcome, 'pass');
  // The long form: `type/scope/description` is accepted because a change can touch more
  // than one area, and a two-segment-only grammar pushes people to put the scope in the
  // description.
  assert.equal(checkBranchName('refactor/api/routes/execution-split', policy).outcome, 'pass');
  assert.equal(
    checkBranchName('main', policy).outcome,
    'pass',
    'a local run on main is not a branch failure',
  );

  const noSlash = checkBranchName('just-a-branch', policy);
  assert.equal(noSlash.outcome, 'fail');
  assert.match(noSlash.problems[0] ?? '', /does not match/);

  const unknownType = checkBranchName('wip/thing', policy);
  assert.equal(unknownType.outcome, 'fail');
  assert.match(unknownType.problems[0] ?? '', /is not one of/);

  const notLowerCase = checkBranchName('Feat/AddMetrics', policy);
  assert.equal(notLowerCase.outcome, 'fail');
});

test('a detached HEAD is not_configured, and says so', () => {
  // The check that matters most. A merge gate that passes on a detached HEAD is a gate
  // that was not run, and a detached HEAD is a real state on a CI checkout.
  const detached = checkBranchName(null, policy);
  assert.equal(detached.outcome, 'not_configured');
  assert.match(detached.note, /detached/);
  assert.deepEqual(detached.problems, [], 'not_configured names a reason, it does not also fail');
});

test('every commit subject must be conventional, and each rejection is specific', () => {
  const good = [
    { sha: 'a1', subject: 'feat(observability): add a metrics endpoint' },
    { sha: 'b2', subject: 'fix: reject an over-long request id' },
    { sha: 'c3', subject: 'refactor!: drop the legacy store interface' },
  ];
  assert.equal(checkCommitSubjects(good, policy).outcome, 'pass');

  const noScope = checkCommitSubjects(good, policy);
  assert.equal(noScope.outcome, 'pass');

  const missingColon = checkCommitSubjects(
    [{ sha: 'a1', subject: 'add the metrics endpoint' }],
    policy,
  );
  assert.equal(missingColon.outcome, 'fail');
  assert.match(missingColon.problems[0] ?? '', /is not/);

  const unknownType = checkCommitSubjects([{ sha: 'a1', subject: 'wip(api): something' }], policy);
  assert.equal(unknownType.outcome, 'fail');
  assert.match(unknownType.problems[0] ?? '', /is not one of/);

  const tooLong = checkCommitSubjects([{ sha: 'a1', subject: `feat: ${'x'.repeat(80)}` }], policy);
  assert.equal(tooLong.outcome, 'fail');
  assert.match(tooLong.problems[0] ?? '', /the budget is/);

  // A merge commit's subject is `Merge branch 'x' into y`, which is not something a
  // person wrote as a description of a change. `commitsSince` filters them with
  // `--no-merges`; if that filter is ever dropped, this is the line that catches it.
  const merge = checkCommitSubjects([{ sha: 'a1', subject: "Merge branch 'x' into y" }], policy);
  assert.equal(merge.outcome, 'fail');
});

test('an empty range and an unreadable range are both not_configured, and both say which', () => {
  const empty = checkCommitSubjects([], policy);
  assert.equal(empty.outcome, 'not_configured');
  assert.match(empty.note, /no commits/);

  const unreadable = checkCommitSubjects(null, policy);
  assert.equal(unreadable.outcome, 'not_configured');
  assert.match(unreadable.note, /git could not produce a log/);
});

test('the budget is per file and in total, and the two failures are different problems', () => {
  const withinBudget = checkBudget(
    [
      { file: 'apps/api/src/a.ts', added: 10, removed: 5 },
      { file: 'apps/api/src/b.ts', added: 200, removed: 100 },
    ],
    policy,
  );
  assert.equal(withinBudget.outcome, 'pass');

  const oneBigFile = checkBudget(
    [{ file: 'apps/api/src/huge.ts', added: 400, removed: 0 }],
    policy,
  );
  assert.equal(oneBigFile.outcome, 'fail');
  assert.equal(oneBigFile.problems.length, 1, 'one big file is one problem, not one per line');
  assert.match(oneBigFile.problems[0] ?? '', /per-file budget/);

  // The defect the per-file ceiling catches is an unreviewable *file*. The total catches
  // a change that is evenly spread, which is a different complaint and needs a different
  // message or a reviewer cannot tell which one they are looking at.
  const manyFiles = checkBudget(
    Array.from({ length: 10 }, (_unused, index) => ({
      file: `apps/api/src/file-${String(index)}.ts`,
      added: 160,
      removed: 0,
    })),
    policy,
  );
  assert.equal(manyFiles.outcome, 'fail');
  assert.match(manyFiles.problems[0] ?? '', /total budget/);

  // A generated file is excluded, and the count is printed rather than silently dropped.
  const withGenerated = checkBudget(
    [
      { file: 'apps/api/src/a.ts', added: 1, removed: 0 },
      { file: 'apps/web/src/x.snap', added: 9_000, removed: 0 },
      { file: 'pnpm-lock.yaml', added: 5_000, removed: 5_000 },
    ],
    policy,
  );
  assert.equal(withGenerated.outcome, 'pass');
  assert.match(withGenerated.note, /2 generated or lock file\(s\) excluded/);

  const unreadable = checkBudget(null, policy);
  assert.equal(unreadable.outcome, 'not_configured');
});

test('a changed source file needs a changed test in the same package, or a written reason', () => {
  /** @param {Record<string, string>} files */
  const read = (files) => (/** @type {string} */ file) => files[file] ?? '';

  const withTest = checkTestsPerChange(
    [
      { file: 'apps/api/src/observability/metrics.ts', added: 10, removed: 0 },
      { file: 'apps/api/src/observability/metrics.test.ts', added: 40, removed: 0 },
    ],
    policy,
    read({}),
  );
  assert.equal(withTest.outcome, 'pass');

  // The package boundary is the point: a `packages/ui` test is not a test for an
  // `apps/api` source file, and treating it as one is how a change ends up with a test
  // that does not exercise it.
  const wrongPackage = checkTestsPerChange(
    [
      { file: 'apps/api/src/observability/metrics.ts', added: 10, removed: 0 },
      { file: 'packages/ui/src/metrics.test.tsx', added: 40, removed: 0 },
    ],
    policy,
    read({}),
  );
  assert.equal(wrongPackage.outcome, 'fail');
  assert.match(wrongPackage.problems[0] ?? '', /apps\/api/);

  const withMarker = checkTestsPerChange(
    [{ file: 'docs/adr/README.md', added: 10, removed: 0 }],
    policy,
    read({}),
  );
  assert.equal(withMarker.outcome, 'pass', 'a change touching no source file needs no test');

  // A marker with a real reason is an exemption; a marker with a word is not.
  const excused = checkTestsPerChange(
    [{ file: 'apps/api/src/routes/health.ts', added: 4, removed: 0 }],
    policy,
    read({
      'apps/api/src/routes/health.ts':
        '// review:no-test the assertion is in health.test.ts, which this branch does not touch\n' +
        'export const x = 1;',
    }),
  );
  assert.equal(excused.outcome, 'pass');

  const weakMarker = checkTestsPerChange(
    [{ file: 'apps/api/src/routes/health.ts', added: 4, removed: 0 }],
    policy,
    read({
      'apps/api/src/routes/health.ts': '// review:no-test later\nexport const x = 1;',
    }),
  );
  assert.equal(
    weakMarker.outcome,
    'fail',
    'a marker with a word instead of a reason is not an exemption',
  );
});

test('a test file is not a source file, or every test change would demand a test', () => {
  const onlyTests = checkTestsPerChange(
    [{ file: 'apps/api/src/observability/metrics.test.ts', added: 40, removed: 0 }],
    policy,
    () => '',
  );
  assert.equal(onlyTests.outcome, 'pass');
});

test('the ledger check blocks on an open Blocker and passes on the same row deferred', () => {
  // §17's eleventh point, and the asymmetry that keeps it honest: a `debt` row has an
  // owner and a removal condition, which is the state §1 permits, so it does not block.
  // An `open` Blocker does, because there is no decision behind it yet.
  const blocker = checkLedger(
    { findings: [{ id: 'RF-5', band: 'Blocker', status: 'open', title: 'x' }] },
    policy,
  );
  assert.equal(blocker.outcome, 'fail');
  assert.match(blocker.problems[0] ?? '', /RF-5 \(Blocker\)/);
  assert.match(blocker.note, /scope decision/);

  const deferred = checkLedger(
    {
      findings: [
        {
          id: 'RF-5',
          band: 'Blocker',
          status: 'debt',
          owner: 'roadmap',
          removalCondition: 'one rehearsal run',
          title: 'x',
        },
      ],
    },
    policy,
  );
  assert.equal(deferred.outcome, 'pass');

  const majorOpen = checkLedger(
    { findings: [{ id: 'O-4b', band: 'Major', status: 'open', title: 'x' }] },
    policy,
  );
  assert.equal(majorOpen.outcome, 'pass', 'only the two blocking bands block, per the plan');

  const unreadable = checkLedger(null, policy);
  assert.equal(unreadable.outcome, 'not_configured');
  assert.match(unreadable.note, /must not report it as clean/);
});

test('the committed ledger is the one the gate reads, and the verdict is derived from it', () => {
  // So the gate and `pnpm status:10` cannot disagree about what is blocking. Both read
  // this file, and this asserts the file is where they read it from.
  //
  // The expectation is *derived from the ledger* rather than written down, because a test
  // that asserts "fail" is a test that fails the day RF-5 is re-banded — which is the
  // day the work landed. The property is that the gate names exactly the rows the
  // ledger calls blocking, and no others.
  const ledger = JSON.parse(
    readFileSync(path.join(ROOT, 'docs', 'quality', 'findings-ledger.json'), 'utf8'),
  );
  const expected = ledger.findings.filter(
    (/** @type {{ band: string, status: string }} */ row) =>
      policy.ledger.blockingBands.includes(row.band) &&
      policy.ledger.blockingStatuses.includes(row.status),
  );
  const real = checkLedger(ledger, policy);

  assert.equal(
    real.outcome,
    expected.length === 0 ? 'pass' : 'fail',
    `${String(expected.length)} open blocking row(s) in the ledger, so the gate must ${
      expected.length === 0 ? 'pass' : 'fail'
    }`,
  );
  for (const row of expected) {
    assert.ok(
      real.problems.some((problem) => problem.startsWith(row.id)),
      `the gate must name ${row.id} specifically; got: ${real.problems.join(' | ')}`,
    );
  }
  assert.equal(real.problems.length, expected.length, 'and must name nothing else');
});
