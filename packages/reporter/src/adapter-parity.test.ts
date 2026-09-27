import { describe, expect, it } from 'vitest';
import { junitXmlAdapter } from './adapters/junit-xml.js';
import { playwrightJsonAdapter } from './adapters/playwright-json.js';
import { runStatusFrom, canonicalRunResult } from './canonical-run-result.js';
import type { ProducerContext } from './adapter.js';

/**
 * The two producer adapters must answer the same question the same way.
 *
 * They each hand-built a `CanonicalRunResultSchema.parse({ … })` envelope — nine
 * identical boilerplate fields — and each derived the run status from its own copy of
 * a ladder. The ladders were not the same ladder:
 *
 *     Playwright:  failed → unknown → skipped → flaky → passed
 *     JUnit:       failed → unknown → skipped → passed          ← no `flaky` rung
 *
 * And JUnit's own `statusFrom` returns `flaky` for a `<rerunFailure>`, which is the
 * documented JUnit way of saying a test failed once and passed on a retry. So a
 * JUnit report whose only interesting property was a retry was serialised with
 * `status: 'passed'` while the identical outcome from a Playwright report was
 * serialised `flaky`. A release gate reading the run status saw a green run that
 * contained a flaky test — and which producer wrote the file decided whether it saw it.
 *
 * The serialiser and the ladder are now one function each (`canonical-run-result.ts`).
 * These tests are the property that motivated that, and they are written as *pairs*:
 * the same outcome asserted through both adapters, so a future divergence is a test
 * failure rather than a surprise in a customer's release gate.
 */

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  projectId: 'project-1',
  sourceUri: 'artifact://run-1/report',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '1.0.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-09-25T00:00:00.000Z',
  finishedAt: '2026-09-25T00:00:10.000Z',
};

/** A JUnit report with one clean test and one that needed a retry. */
const junitFlaky = new TextEncoder().encode(
  '<testsuite>' +
    '<testcase classname="suite" file="tests/a.spec.ts" name="retried" status="passed"><rerunFailure>attempt 1</rerunFailure></testcase>' +
    '<testcase classname="suite" file="tests/b.spec.ts" name="clean" status="passed"/>' +
    '</testsuite>',
);

/** The same two tests, as a Playwright report: one with a two-attempt history. */
const playwrightFlaky = new TextEncoder().encode(
  JSON.stringify({
    suites: [
      {
        title: 'suite',
        file: 'tests/a.spec.ts',
        tests: [
          {
            title: 'retried',
            status: 'passed',
            results: [
              { status: 'failed', duration: 10 },
              { status: 'passed', duration: 12 },
            ],
          },
        ],
      },
      {
        title: 'suite',
        file: 'tests/b.spec.ts',
        tests: [{ title: 'clean', status: 'passed', results: [{ status: 'passed', duration: 8 }] }],
      },
    ],
  }),
);

describe('the two producer adapters agree on the run status', () => {
  it('reports a retried test as a flaky run, from either producer', () => {
    const fromJunit = junitXmlAdapter.parse(junitFlaky, context);
    const fromPlaywright = playwrightJsonAdapter.parse(playwrightFlaky, context);

    // This is the assertion that was impossible to make before: `fromJunit.status` was
    // `'passed'` and `fromPlaywright.status` was `'flaky'`, for the same outcome.
    expect(fromJunit.status).toBe('flaky');
    expect(fromPlaywright.status).toBe('flaky');
    expect(fromJunit.status).toBe(fromPlaywright.status);
  });

  it('agrees on every rung of the ladder, not only on flaky', () => {
    // One outcome per producer per rung, so a divergence in any single rung shows up
    // as a disagreement rather than being hidden by the other cases.
    const cases: Array<{ outcome: string; expected: string }> = [
      { outcome: 'passed', expected: 'passed' },
      { outcome: 'failed', expected: 'failed' },
      { outcome: 'skipped', expected: 'skipped' },
      { outcome: 'timedOut', expected: 'failed' },
      { outcome: 'unknown', expected: 'unknown' },
      { outcome: 'unexpected', expected: 'unknown' },
    ];
    for (const { outcome, expected } of cases) {
      const junit = junitXmlAdapter.parse(
        new TextEncoder().encode(
          `<testsuite><testcase classname="s" file="tests/a.spec.ts" name="a" status="${outcome}"/></testsuite>`,
        ),
        context,
      );
      const playwright = playwrightJsonAdapter.parse(
        new TextEncoder().encode(
          JSON.stringify({
            suites: [
              {
                title: 's',
                file: 'tests/a.spec.ts',
                tests: [{ title: 'a', status: outcome, results: [{ status: outcome }] }],
              },
            ],
          }),
        ),
        context,
      );
      expect(junit.status, `junit for ${outcome}`).toBe(expected);
      expect(playwright.status, `playwright for ${outcome}`).toBe(expected);
    }
  });

  it('agrees that a run mixing a failure with an unknown is failed, not unknown', () => {
    // Ordering is the argument: "some tests are known broken" is a stronger statement
    // than "some tests are unobserved", and reporting the unknown hides the failure.
    const junit = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite><testcase classname="s" file="tests/a.spec.ts" name="a" status="unknown"/><testcase classname="s" file="tests/b.spec.ts" name="b" status="failed"/></testsuite>',
      ),
      context,
    );
    expect(junit.status).toBe('failed');
    expect(runStatusFrom(['unknown', 'failed'])).toBe('failed');
  });

  it('agrees that a run with one skipped test among passes is a passing run', () => {
    const junit = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite><testcase classname="s" file="tests/a.spec.ts" name="a" status="passed"/><testcase classname="s" file="tests/b.spec.ts" name="b" status="skipped"/></testsuite>',
      ),
      context,
    );
    expect(junit.status).toBe('passed');
    expect(runStatusFrom(['passed', 'skipped'])).toBe('passed');
  });
});

describe('the shared serialiser fills the envelope the same way for both', () => {
  it('carries the context into identity and provenance, and never overstates proof', () => {
    const result = junitXmlAdapter.parse(junitFlaky, context);
    expect(result.identity).toEqual({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
    });
    expect(result.provenance).toMatchObject({
      producer: 'junit',
      producerVersion: '1.0.0',
      adapterVersion: '1.0.0',
      sourceDigest: 'f'.repeat(64),
    });
    // An adapter that has parsed a report has verified that the report parses. It has
    // not verified that the report describes the run it claims to, so this is never
    // anything but `unverified` here.
    expect(result.proof.state).toBe('unverified');
    // And completeness follows the same `unknown` signal the status does, so the two
    // fields cannot contradict each other.
    expect(result.completeness.state).toBe('complete');
    expect(result.status).toBe('flaky');
  });

  it('omits a finish time the producer did not declare, rather than inventing one', () => {
    // The adapters passed `context.finishedAt` straight through and the contract makes
    // it optional, so a report ingested without one produces a result without one.
    // Deriving it from the last attempt would state something the producer never said,
    // and a duration is what the dashboard charts.
    const withoutFinish = canonicalRunResult(
      {
        outcomes: ['passed'],
        attempts: [
          {
            index: 1,
            testId: 't',
            specPath: 'tests/a.spec.ts',
            title: 'a',
            status: 'passed',
            rawStatus: 'passed',
            startedAt: '2026-09-25T00:00:00.000Z',
            flakiness: 'unknown',
          },
        ],
        producer: 'generic',
        verifier: 'test',
      },
      { ...context, finishedAt: undefined },
    );
    expect(withoutFinish.finishedAt).toBeUndefined();
    expect(withoutFinish.attempts[0]?.finishedAt).toBeUndefined();
  });
});
