/**
 * canonical-projection.test.ts — the recompute gate.
 *
 * **This is the gate that makes `runs` and `tests` a projection rather than a second
 * authority.** It takes the canonical row the repository actually stored, recomputes the
 * projection from it with `projectCanonicalRun`, and compares the result against what the
 * repository actually holds — every field, every row, both directions. Any drift between
 * the authority and its view is named.
 *
 * It has to be able to fail, which is why the last test perturbs a stored row on purpose.
 * A gate whose assertion cannot fail is not a gate: it is a line of test code that reports
 * the same thing every run, and a reader cannot tell it apart from one that is working.
 *
 * The corpus is the one the adapters can produce — JUnit and Playwright documents through
 * the real route, plus the flat upload payload — so a change to an adapter that alters a
 * status cannot quietly change the projection without this noticing.
 */

import { describe, expect, it } from 'vitest';
import { projectCanonicalRun, projectionDivergence } from './canonical-projection.js';
import { reporterHarness } from '../test-support/reporter-harness.js';
import type { TestRecord } from '../repositories/run-repository.js';

interface CorpusCase {
  name: string;
  fields: Record<string, string>;
  file: { name: string; type: string; body: string };
}

const CORPUS: CorpusCase[] = [
  {
    name: 'a clean JUnit run',
    fields: { runId: 'gate-junit-clean', artifactType: 'junit' },
    file: {
      name: 'junit.xml',
      type: 'application/xml',
      body:
        '<testsuite name="s">' +
        '<testcase name="a" classname="p" file="a.spec.ts" time="0.1" status="passed"/>' +
        '<testcase name="b" classname="p" file="b.spec.ts" time="0.2" status="passed"/>' +
        '</testsuite>',
    },
  },
  {
    name: 'a JUnit run with a failure, a skip and an undeclared test',
    fields: { runId: 'gate-junit-mixed', artifactType: 'junit' },
    file: {
      name: 'junit.xml',
      type: 'application/xml',
      body:
        '<testsuite name="s">' +
        '<testcase name="a" classname="p" file="a.spec.ts" time="0.1"><failure>boom</failure></testcase>' +
        '<testcase name="b" classname="p" file="b.spec.ts"><skipped/></testcase>' +
        '<testcase name="c" classname="p" file="c.spec.ts"/>' +
        '</testsuite>',
    },
  },
  {
    name: 'a retried JUnit test',
    fields: { runId: 'gate-junit-flaky', artifactType: 'junit' },
    file: {
      name: 'junit.xml',
      type: 'application/xml',
      body:
        '<testsuite name="s">' +
        '<testcase name="a" classname="p" file="a.spec.ts" status="passed"><rerunFailure>x</rerunFailure></testcase>' +
        '<testcase name="b" classname="p" file="b.spec.ts" status="passed"/>' +
        '</testsuite>',
    },
  },
  {
    name: 'a truncated JUnit document',
    fields: { runId: 'gate-junit-truncated', artifactType: 'junit' },
    file: {
      name: 'junit.xml',
      type: 'application/xml',
      // No closing tag: the report was cut off when CI killed the job.
      body: '<testsuite name="s"><testcase name="a" classname="p" file="a.spec.ts" status="passed">',
    },
  },
  {
    name: 'a Playwright run with a timed-out test and an interrupted one',
    fields: { runId: 'gate-pw-mixed', artifactType: 'playwright-json' },
    file: {
      name: 'pw.json',
      type: 'application/json',
      body: JSON.stringify({
        suites: [
          {
            title: 's',
            file: 's.spec.ts',
            specs: [
              { title: 'timed out', tests: [{ results: [{ status: 'timedOut', duration: 1 }] }] },
              {
                title: 'interrupted',
                tests: [{ results: [{ status: 'interrupted', duration: 1 }] }],
              },
              { title: 'never ran', tests: [{ results: [] }] },
            ],
          },
        ],
      }),
    },
  },
  {
    name: 'a Playwright run with a retry',
    fields: { runId: 'gate-pw-retry', artifactType: 'playwright-json' },
    file: {
      name: 'pw.json',
      type: 'application/json',
      body: JSON.stringify({
        suites: [
          {
            title: 's',
            file: 's.spec.ts',
            specs: [
              {
                title: 'eventually passes',
                tests: [
                  {
                    results: [
                      { status: 'failed', duration: 2 },
                      { status: 'passed', duration: 1 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    },
  },
];

/** Post one corpus case through the real upload door. */
async function ingest(runCase: CorpusCase) {
  const harness = reporterHarness(undefined);
  const form = new FormData();
  for (const [key, value] of Object.entries(runCase.fields)) form.set(key, value);
  form.set('file', new File([runCase.file.body], runCase.file.name, { type: runCase.file.type }));
  const response = await harness.app.request('/api/v1/reporter/upload', {
    method: 'POST',
    body: form,
  });
  expect(response.status, `${runCase.name}: ${await response.text()}`).toBe(202);
  const stored = await harness.store.get(runCase.fields['runId'] as string);
  expect(stored, `${runCase.name}: the canonical row is the authority`).toBeDefined();
  const run = await harness.runs.getRun(runCase.fields['runId'] as string);
  const tests = new Map<string, TestRecord>(
    (await harness.runs.listTests(runCase.fields['runId'] as string)).map((test) => [
      test.id,
      test,
    ]),
  );
  return { harness, stored: stored!, run, tests };
}

describe('the projection recomputes from the canonical row, field by field', () => {
  for (const runCase of CORPUS) {
    it(`agrees with what was stored for ${runCase.name}`, async () => {
      const { stored, run, tests } = await ingest(runCase);
      const expected = projectCanonicalRun(stored);
      expect(projectionDivergence(expected, { run, tests })).toEqual([]);
    });
  }

  it('agrees for the flat upload payload too, which is the other door', async () => {
    const harness = reporterHarness(undefined);
    const response = await harness.app.request('/api/v1/reporter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'gate-legacy-upload',
        status: 'passed',
        branch: 'main',
        commitSha: 'a'.repeat(40),
        tests: [
          { id: 't-1', title: 'ok', file: 'a.spec.ts', status: 'passed', durationMs: 5 },
          { id: 't-2', title: 'flaky', file: 'a.spec.ts', status: 'flaky', durationMs: 6 },
        ],
      }),
    });
    expect(response.status).toBe(202);

    const stored = await harness.store.get('gate-legacy-upload');
    const run = await harness.runs.getRun('gate-legacy-upload');
    const tests = new Map(
      (await harness.runs.listTests('gate-legacy-upload')).map((test) => [test.id, test]),
    );
    expect(projectionDivergence(projectCanonicalRun(stored!), { run, tests })).toEqual([]);
    // The cohort travels into the projection, because it is on the authority. It used to
    // be writeable only by a door that bypassed the authority, which is why a per-branch
    // comparison was answerable only from the derived table.
    expect(run?.branch).toBe('main');
    expect(run?.commitSha).toBe('a'.repeat(40));
  });
});

describe('the gate can fail', () => {
  it('names every field a hand-edited row disagrees with', async () => {
    const runCase = CORPUS[1];
    if (runCase === undefined) throw new Error('the corpus is empty');
    const { stored, run, tests } = await ingest(runCase);

    // Simulate the failure mode the gate exists for: something wrote to `runs`/`tests`
    // behind the projection's back, or the projection function changed and the stored rows
    // were not rewritten.
    const drifted = { ...run!, status: 'passed' as const, passed: 99, flaky: 3 };
    const storedTest = [...tests.values()][0];
    expect(storedTest).toBeDefined();
    const driftedTests = new Map(tests);
    driftedTests.set(storedTest!.id, { ...storedTest!, status: 'passed' });

    const differences = projectionDivergence(projectCanonicalRun(stored), {
      run: drifted,
      tests: driftedTests,
    });
    expect(differences).toContainEqual(expect.stringContaining('runs.status'));
    expect(differences).toContainEqual(expect.stringContaining('runs.passed'));
    expect(differences).toContainEqual(expect.stringContaining('runs.flaky'));
    expect(differences).toContainEqual(expect.stringContaining(`tests[${storedTest!.id}].status`));
  });

  it('names a test row with no attempt behind it, and a missing run', async () => {
    const runCase = CORPUS[0];
    if (runCase === undefined) throw new Error('the corpus is empty');
    const { stored, run, tests } = await ingest(runCase);
    const expected = projectCanonicalRun(stored);

    // An orphaned row: something wrote a test the canonical row knows nothing about, which
    // is a row whose status has no authority at all.
    const withOrphan = new Map(tests);
    withOrphan.set('tests/ghost.spec.ts:never ran', {
      id: 'tests/ghost.spec.ts:never ran',
      runId: stored.identity.runId,
      title: 'never ran',
      file: 'tests/ghost.spec.ts',
      status: 'passed',
      durationMs: null,
      errorCode: null,
      errorMessage: null,
    });
    expect(
      projectionDivergence(expected, { run, tests: withOrphan }).some((difference) =>
        difference.includes('no attempt for it in the canonical row'),
      ),
    ).toBe(true);

    // And a missing run, which is what a deleted projection row looks like.
    expect(projectionDivergence(expected, { run: null, tests })).toContainEqual(
      `runs: no row for ${expected.run.id}, which the canonical row projects to`,
    );
  });
});
