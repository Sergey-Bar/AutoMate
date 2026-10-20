import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEngine } from '../src/engine.mjs';
import {
  FINDING_DEFAULTS,
  applyDismissals,
  computeFindings,
  observationsByPath,
} from '../src/findings.mjs';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** @param {Array<[string, string, number?]>} tests name, outcome, duration */
const run = (tests, completeness = 'complete') => ({
  kind: 'run',
  completeness,
  tests: tests.map(([name, outcome, duration]) => ({
    name,
    suite: 'suite',
    project: null,
    file: null,
    outcome,
    flakiness: 'none',
    attempts: [{ index: 0, outcome, rawStatus: outcome, durationMs: duration ?? null }],
  })),
});
const coverage = (percent, completeness = 'complete') => ({
  kind: 'coverage',
  completeness,
  totals: { lines: { found: 100, hit: percent, percent } },
});

/**
 * A history: one entry per scan, each saying which report bytes (by sha) sat at each path.
 *
 * @param {Array<{ commit?: string | null, reports: Array<{ path: string, sha: string, result: any, format?: string, modifiedMs?: number }>, projects?: any[] }>} steps
 */
function history(steps) {
  const results = new Map();
  const scans = steps.map((step, index) => {
    for (const report of step.reports) results.set(report.sha, report.result);
    return {
      id: `scan${String(index)}`,
      started_at: new Date(NOW - (steps.length - index) * DAY).toISOString(),
      summary: {
        commit: step.commit ?? null,
        projects: step.projects ?? [],
        reports: step.reports.map((r) => ({
          path: r.path,
          sha256: r.sha,
          format: r.format ?? (r.result.kind === 'coverage' ? 'lcov' : 'junit-xml'),
          outcome: 'ingested',
          modifiedMs: r.modifiedMs ?? NOW - 60_000,
        })),
      },
    };
  });
  return { scans, resultOf: (/** @type {string} */ sha) => results.get(sha) ?? null };
}
const at = (p, sha, result, extra = {}) => ({ path: p, sha, result, ...extra });
const compute = (h, thresholds) => computeFindings({ ...h, now: NOW, thresholds });
const rules = (found) => found.findings.map((f) => f.rule).sort();

test('a new failure needs an earlier report that passed, and says what it knows about the commits', () => {
  const pass = run([
    ['a', 'passed'],
    ['b', 'passed'],
  ]);
  const fail = run([
    ['a', 'failed'],
    ['b', 'passed'],
  ]);
  const different = compute(
    history([
      { commit: 'c1', reports: [at('r.xml', 's1', pass)] },
      { commit: 'c2', reports: [at('r.xml', 's2', fail)] },
    ]),
  );
  assert.deepEqual(rules(different), ['new-failure']);
  const f = different.findings[0];
  assert.equal(f.priority, 'high');
  assert.equal(f.confidence, 'high');
  assert.match(f.comparability, /commits differ/);
  assert.match(f.evidence.join(' '), /s1/);
  assert.match(f.evidence.join(' '), /s2/);

  const same = compute(
    history([
      { commit: 'c1', reports: [at('r.xml', 's1', pass)] },
      { commit: 'c1', reports: [at('r.xml', 's2', fail)] },
    ]),
  ).findings[0];
  assert.equal(same.priority, 'medium', 'the same commit is not a regression candidate');
  assert.match(same.comparability, /not explained by a code change/);

  const unknown = compute(
    history([{ reports: [at('r.xml', 's1', pass)] }, { reports: [at('r.xml', 's2', fail)] }]),
  ).findings[0];
  assert.equal(unknown.confidence, 'medium', 'an unknown commit lowers the confidence');
  assert.match(unknown.comparability, /nothing is said about code changes/);

  const partial = compute(
    history([
      { commit: 'c1', reports: [at('r.xml', 's1', pass)] },
      { commit: 'c2', reports: [at('r.xml', 's2', run([['a', 'failed']], 'partial'))] },
    ]),
  ).findings[0];
  assert.equal(partial.confidence, 'medium', 'a partial report lowers the confidence');
});

test('no new failure from one report, a failure that was already failing, a fix, or an unmatched test', () => {
  const none = (steps) => assert.deepEqual(rules(compute(history(steps))), []);
  none([{ reports: [at('r.xml', 's1', run([['a', 'failed']]))] }]);
  none([
    { reports: [at('r.xml', 's1', run([['a', 'failed']]))] },
    { reports: [at('r.xml', 's2', run([['a', 'failed']]))] },
  ]);
  none([
    { reports: [at('r.xml', 's1', run([['a', 'failed']]))] },
    { reports: [at('r.xml', 's2', run([['a', 'passed']]))] },
  ]);
  none([
    { reports: [at('r.xml', 's1', run([['a', 'passed']]))] },
    { reports: [at('r.xml', 's2', run([['renamed', 'failed']]))] },
  ]);
  none([
    { reports: [at('r.xml', 's1', run([['a', 'passed']]))] },
    { reports: [at('other.xml', 's2', run([['a', 'failed']]))] },
  ]);
});

test('comparison is by report path: the same bytes seen twice are one observation', () => {
  const same = history([
    { reports: [at('r.xml', 's1', run([['a', 'passed']]))] },
    { reports: [at('r.xml', 's1', run([['a', 'passed']]))] },
    { reports: [at('r.xml', 's2', run([['a', 'failed']]))] },
  ]);
  assert.equal(observationsByPath(same.scans).get('r.xml')?.length, 2);
  assert.deepEqual(rules(compute(same)), ['new-failure']);
});

test('a failure in each of the last three reports is repeated; a broken streak or two reports is not', () => {
  const f = (sha) => at('r.xml', sha, run([['a', 'failed']]));
  const p = (sha) => at('r.xml', sha, run([['a', 'passed']]));
  assert.deepEqual(
    rules(compute(history([{ reports: [f('1')] }, { reports: [f('2')] }, { reports: [f('3')] }]))),
    ['repeated-failure'],
  );
  assert.deepEqual(rules(compute(history([{ reports: [f('1')] }, { reports: [f('2')] }]))), []);
  assert.deepEqual(
    rules(
      compute(
        history([
          { reports: [f('1')] },
          { reports: [p('2')] },
          { reports: [f('3')] },
          { reports: [f('4')] },
        ]),
      ),
    ),
    [],
  );
  const found = compute(
    history([
      { reports: [f('1')] },
      { reports: [f('2')] },
      { reports: [f('3')] },
      { reports: [f('4')] },
    ]),
  );
  assert.match(found.findings[0].title, /last 4 reports/);
  assert.equal(found.findings[0].evidence.length, 4);
});

test('flaky needs enough executions of one known commit with both outcomes, and says what that minimum is', () => {
  const mixed = (n, commit) =>
    Array.from({ length: n }, (_, i) => ({
      commit,
      reports: [
        at('r.xml', `${commit}-${String(i)}`, run([['a', i % 2 === 0 ? 'passed' : 'failed']])),
      ],
    }));
  const five = compute(history(mixed(5, 'c1')));
  assert.ok(rules(five).includes('flaky-from-history'));
  const flaky = five.findings.find((x) => x.rule === 'flaky-from-history');
  assert.match(flaky.comparability, /minimum for this label is 5/);
  assert.match(flaky.evidence[0], /3 passed, 2 failed/);
  assert.ok(
    !rules(compute(history(mixed(4, 'c1')))).includes('flaky-from-history'),
    'four is not enough',
  );
  assert.ok(
    !rules(compute(history([...mixed(3, 'c1'), ...mixed(3, 'c2')]))).includes('flaky-from-history'),
    'the commits differ',
  );
  assert.ok(
    !rules(compute(history(mixed(6, null)))).includes('flaky-from-history'),
    'an unknown commit is not one code state',
  );
  const allFail = Array.from({ length: 6 }, (_, i) => ({
    commit: 'c1',
    reports: [at('r.xml', `f${String(i)}`, run([['a', 'failed']]))],
  }));
  assert.ok(
    !rules(compute(history(allFail))).includes('flaky-from-history'),
    'consistent failure is not flakiness',
  );
});

test('a duration change needs a baseline, a ratio and a minimum absolute change', () => {
  const d = (ms) => ({
    reports: [at('r.xml', `d${String(ms)}-${String(Math.random())}`, run([['a', 'passed', ms]]))],
  });
  const steps = (...values) => values.map(d);
  assert.deepEqual(rules(compute(history(steps(100, 110, 105, 2000)))), ['duration-change']);
  const faster = compute(history(steps(3000, 3100, 2900, 600)));
  assert.match(faster.findings[0].title, /less time/);
  assert.deepEqual(
    rules(compute(history(steps(100, 110, 105, 300)))),
    [],
    'under the absolute minimum',
  );
  assert.deepEqual(rules(compute(history(steps(5000, 5100, 5050, 6000)))), [], 'under the ratio');
  assert.deepEqual(rules(compute(history(steps(100, 110, 2000)))), [], 'baseline too short');
  const found = compute(history(steps(100, 110, 105, 2000))).findings[0];
  assert.match(found.evidence.join(' '), /latest: 2000 ms/);
  assert.match(found.comparability, /machine and its load are not known/);
});

test('a coverage drop is reported with what it was held to, and a failure is only ever "observed together"', () => {
  const found = compute(
    history([
      { reports: [at('c.info', 'c1', coverage(80))] },
      { reports: [at('c.info', 'c2', coverage(78.5))] },
    ]),
  );
  assert.deepEqual(rules(found), ['coverage-change']);
  assert.match(found.findings[0].title, /80\.00% to 78\.50%/);
  assert.deepEqual(
    rules(
      compute(
        history([
          { reports: [at('c.info', 'c1', coverage(80))] },
          { reports: [at('c.info', 'c2', coverage(79.5))] },
        ]),
      ),
    ),
    [],
  );
  assert.deepEqual(
    rules(
      compute(
        history([
          { reports: [at('c.info', 'c1', coverage(80))] },
          { reports: [at('c.info', 'c2', coverage(85))] },
        ]),
      ),
    ),
    [],
    'a rise is not a finding',
  );

  const together = compute(
    history([
      {
        commit: 'a',
        reports: [at('c.info', 'c1', coverage(80)), at('r.xml', 'r1', run([['x', 'passed']]))],
      },
      {
        commit: 'b',
        reports: [at('c.info', 'c2', coverage(70)), at('r.xml', 'r2', run([['x', 'failed']]))],
      },
    ]),
  );
  assert.deepEqual(rules(together), ['coverage-change', 'new-failure']);
  const cov = together.findings.find((f) => f.rule === 'coverage-change');
  assert.match(cov.evidence.join(' '), /observed together/);
  assert.match(cov.evidence.join(' '), /neither is claimed to explain the other/);
});

test('no finding ever states a cause', () => {
  const big = compute(
    history([
      {
        commit: 'a',
        reports: [
          at(
            'r.xml',
            '1',
            run([
              ['x', 'passed', 100],
              ['y', 'failed', 100],
            ]),
          ),
          at('c.info', 'c1', coverage(90)),
        ],
      },
      {
        commit: 'b',
        reports: [
          at(
            'r.xml',
            '2',
            run([
              ['x', 'passed', 110],
              ['y', 'failed', 100],
            ]),
          ),
          at('c.info', 'c2', coverage(80)),
        ],
      },
      {
        commit: 'b',
        reports: [
          at(
            'r.xml',
            '3',
            run([
              ['x', 'passed', 105],
              ['y', 'failed', 100],
            ]),
          ),
          at('c.info', 'c2', coverage(80)),
        ],
      },
      {
        commit: 'b',
        reports: [
          at(
            'r.xml',
            '4',
            run([
              ['x', 'failed', 4000],
              ['y', 'failed', 100],
            ]),
          ),
          at('c.info', 'c3', coverage(70)),
        ],
      },
    ]),
  );
  assert.ok(big.findings.length >= 3);
  for (const f of big.findings) {
    for (const field of [
      'rule',
      'title',
      'severity',
      'priority',
      'confidence',
      'comparability',
      'explanation',
      'suggestedAction',
      'verify',
      'falsePositives',
      'fingerprint',
    ]) {
      assert.ok(typeof f[field] === 'string' && f[field].trim() !== '', `${f.rule}: ${field}`);
    }
    assert.ok(
      f.evidence.length > 0 && f.evidence.every((e) => e.trim() !== ''),
      `${f.rule}: evidence`,
    );
    assert.ok(['high', 'medium', 'low'].includes(f.confidence));
    assert.ok(
      !/\bcaused?\b|\bbecause\b|root cause|\bdue to\b|\bresults? from\b/i.test(
        `${f.title} ${f.explanation} ${f.evidence.join(' ')}`,
      ),
      `${f.rule} states a cause`,
    );
  }
});

test('a project with a test tool and no test result report gets an observation, not a verdict; a report removes it', () => {
  const project = {
    relativePath: '.',
    ecosystem: 'node',
    findings: [
      { subject: 'test-tool:vitest', evidence: ['package.json:5 "vitest"'], confidence: 0.95 },
    ],
  };
  const missing = compute(history([{ projects: [project], reports: [] }]));
  assert.deepEqual(rules(missing), ['missing-report']);
  assert.match(missing.findings[0].explanation, /does not show that anything is wrong/);
  assert.match(missing.findings[0].falsePositives, /only in CI/);
  const present = compute(
    history([{ projects: [project], reports: [at('r.xml', 's', run([['a', 'passed']]))] }]),
  );
  assert.deepEqual(rules(present), []);
  const other = { ...project, relativePath: 'pkg' };
  assert.deepEqual(
    rules(
      compute(
        history([{ projects: [other], reports: [at('root.xml', 's', run([['a', 'passed']]))] }]),
      ),
    ),
    ['missing-report'],
    'a report elsewhere does not count',
  );
  const noTool = {
    relativePath: '.',
    findings: [{ subject: 'ci-configuration', evidence: ['x:1'], confidence: 0.9 }],
  };
  assert.deepEqual(rules(compute(history([{ projects: [noTool], reports: [] }]))), []);
});

test('a stale report is judged by file time against the clock, and only past the stated age', () => {
  const old = (days) => at('r.xml', 's', run([['a', 'passed']]), { modifiedMs: NOW - days * DAY });
  assert.deepEqual(rules(compute(history([{ reports: [old(8)] }]))), ['stale-report']);
  assert.deepEqual(rules(compute(history([{ reports: [old(6)] }]))), []);
  assert.deepEqual(rules(compute(history([{ reports: [] }]))), []);
  const found = compute(history([{ reports: [old(30)] }])).findings[0];
  assert.match(found.title, /30 days old/);
  assert.match(found.explanation, /file time can also be wrong/);
});

test('with no scans there is nothing, and the thresholds the findings were held to come back with them', () => {
  const none = computeFindings({ scans: [], resultOf: () => null, now: NOW });
  assert.deepEqual(none.findings, []);
  assert.deepEqual(none.thresholds, FINDING_DEFAULTS);
  const custom = computeFindings({
    scans: [],
    resultOf: () => null,
    now: NOW,
    thresholds: { repeatedFailureMin: 2 },
  });
  assert.equal(custom.thresholds.repeatedFailureMin, 2);
  const two = history([
    { reports: [at('r.xml', '1', run([['a', 'failed']]))] },
    { reports: [at('r.xml', '2', run([['a', 'failed']]))] },
  ]);
  assert.deepEqual(rules(compute(two, { repeatedFailureMin: 2 })), ['repeated-failure']);
});

test('dismissals flag a finding without deleting it, and carry the note', () => {
  const found = compute(
    history([
      { reports: [at('r.xml', '1', run([['a', 'failed']]))] },
      { reports: [at('r.xml', '2', run([['a', 'failed']]))] },
      { reports: [at('r.xml', '3', run([['a', 'failed']]))] },
    ]),
  );
  const flagged = applyDismissals(found.findings, [
    {
      fingerprint: found.findings[0].fingerprint,
      dismissed_at: 'then',
      note: 'known and accepted',
    },
  ]);
  assert.equal(flagged.length, found.findings.length);
  assert.equal(flagged[0].dismissed, true);
  assert.equal(flagged[0].dismissal.note, 'known and accepted');
  assert.equal(flagged[0].dismissal.by, 'the local user');
  assert.equal(applyDismissals(found.findings, [])[0].dismissed, false);
});

// ── Through the engine, with real files and real scans ─────────────────────────────────

const junit = (tests) =>
  `<testsuite name="s" tests="${String(tests.length)}" failures="${String(
    tests.filter(([, ok]) => !ok).length,
  )}">${tests
    .map(
      ([name, ok, time]) =>
        `<testcase classname="s" name="${name}" time="${String((time ?? 100) / 1000)}">${
          ok ? '' : '<failure message="boom"/>'
        }</testcase>`,
    )
    .join('')}</testsuite>`;

async function withHistory(body) {
  const root = mkdtempSync(path.join(tmpdir(), 'automate-fi-repo-'));
  const dataDir = mkdtempSync(path.join(tmpdir(), 'automate-fi-data-'));
  let clock = NOW - 10 * DAY;
  const engine = createEngine({ dataDir, now: () => new Date(clock) });
  /** @param {string} commit @param {Array<[string, boolean, number?]>} tests */
  const scanWith = async (commit, tests) => {
    mkdirSync(path.join(root, '.git'), { recursive: true });
    writeFileSync(path.join(root, '.git', 'HEAD'), `${commit}\n`);
    mkdirSync(path.join(root, 'reports'), { recursive: true });
    const file = path.join(root, 'reports', 'junit.xml');
    writeFileSync(file, junit(tests));
    const stamp = new Date(clock);
    utimesSync(file, stamp, stamp);
    clock += DAY;
    return engine.scan(root);
  };
  try {
    await body({
      engine,
      scanWith,
      root,
      tick: () => (clock += DAY),
      setClock: (/** @type {number} */ ms) => (clock = ms),
    });
  } finally {
    engine.close();
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // a handle can outlive the test on Windows
    }
  }
}

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

test('through the engine: a failure that appears after a commit change is found, and dismissing it hides it until asked', async () => {
  await withHistory(async ({ engine, scanWith, setClock }) => {
    const first = await scanWith(SHA_A, [
      ['one', true],
      ['two', true],
    ]);
    await scanWith(SHA_B, [
      ['one', true],
      ['two', false],
    ]);
    setClock(NOW);
    const view = engine.findings(first.repositoryId);
    assert.equal(view.scans, 2);
    const failure = view.findings.find((f) => f.rule === 'new-failure');
    assert.ok(failure, JSON.stringify(view.findings.map((f) => f.rule)));
    assert.match(failure.title, /two/);
    assert.equal(failure.priority, 'high');
    assert.match(failure.comparability, /commits differ/);

    assert.equal(
      engine.dismissFinding(first.repositoryId, failure.fingerprint, 'known flake in CI'),
      true,
    );
    assert.ok(
      !engine
        .findings(first.repositoryId)
        .findings.some((f) => f.fingerprint === failure.fingerprint),
      'hidden by default',
    );
    assert.equal(engine.findings(first.repositoryId).dismissedCount, 1);
    const withDismissed = engine.findings(first.repositoryId, { includeDismissed: true });
    const kept = withDismissed.findings.find((f) => f.fingerprint === failure.fingerprint);
    assert.equal(kept.dismissed, true);
    assert.equal(kept.dismissal.note, 'known flake in CI');

    assert.equal(
      engine.dismissFinding(first.repositoryId, 'not-a-real-fingerprint', 'x'),
      false,
      'only an existing finding can be dismissed',
    );
    assert.equal(engine.restoreFinding(first.repositoryId, 'not-a-real-fingerprint'), false);
    assert.equal(engine.restoreFinding(first.repositoryId, failure.fingerprint), true);
    assert.ok(
      engine
        .findings(first.repositoryId)
        .findings.some((f) => f.fingerprint === failure.fingerprint),
      'visible again',
    );
    assert.equal(engine.findings('missing'), null);
  });
});

test('through the engine: a dismissal holds across a rescan of the same state and lapses when the state changes', async () => {
  await withHistory(async ({ engine, scanWith, setClock }) => {
    const first = await scanWith(SHA_A, [['one', true]]);
    await scanWith(SHA_B, [['one', false]]);
    setClock(NOW);
    const failure = engine
      .findings(first.repositoryId)
      .findings.find((f) => f.rule === 'new-failure');
    engine.dismissFinding(first.repositoryId, failure.fingerprint, 'accepted');

    await scanWith(SHA_B, [['one', false]]);
    setClock(NOW);
    const again = engine
      .findings(first.repositoryId, { includeDismissed: true })
      .findings.find((f) => f.rule === 'new-failure');
    assert.equal(
      again?.fingerprint,
      failure.fingerprint,
      'the same report seen again is the same finding',
    );
    assert.equal(again?.dismissed, true);

    setClock(NOW + DAY);
    await scanWith(SHA_B, [['one', true]]);
    await scanWith(SHA_B, [
      ['one', false],
      ['extra', true],
    ]);
    setClock(NOW + 4 * DAY);
    const changed = engine
      .findings(first.repositoryId)
      .findings.find((f) => f.rule === 'new-failure');
    assert.ok(changed, 'a new failure after a fix is a new event and is shown');
    assert.notEqual(changed.fingerprint, failure.fingerprint);
  });
});

test('through the engine: the scan records the commit, and the thresholds come back with the findings', async () => {
  await withHistory(async ({ engine, scanWith }) => {
    const first = await scanWith(SHA_A, [['one', true]]);
    assert.equal(engine.store.scansFor(first.repositoryId)[0].summary.commit, SHA_A);
    assert.equal(engine.findings(first.repositoryId).thresholds.flakyMinExecutions, 5);
  });
});
