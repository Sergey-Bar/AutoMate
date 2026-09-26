import { describe, expect, it } from 'vitest';
import { junitXmlAdapter } from './adapters/junit-xml.js';

const context = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'artifact://run-1/results.xml',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '1.0.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-09-25T00:00:00.000Z',
};

describe('JUnit adapter', () => {
  it('maps a testcase that declares nothing as unknown, and preserves files without treating classnames as paths', () => {
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite><testcase classname="suite.pkg" file="tests/self-closing.spec.ts" name="self-closing" time="0.1"/><testcase classname="suite.pkg" file="tests/plain.spec.ts" name="plain"></testcase><testcase classname="suite.pkg" name="fails"><failure>boom</failure></testcase></testsuite>',
      ),
      context,
    );
    expect(result.attempts).toHaveLength(3);
    // No `status` attribute and no outcome child means no declared outcome.
    // These used to be recorded as passes.
    expect(result.attempts.map((attempt) => attempt.status)).toEqual([
      'unknown',
      'unknown',
      'failed',
    ]);
    expect(result.status).toBe('failed');
    expect(result.attempts.map((attempt) => attempt.specPath)).toEqual([
      'tests/self-closing.spec.ts',
      'tests/plain.spec.ts',
      'unknown.spec.ts',
    ]);
  });

  it('honours an explicitly declared status', () => {
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite><testcase name="ok" status="passed"/><testcase name="bad" status="failed"/></testsuite>',
      ),
      context,
    );
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(['passed', 'failed']);
    expect(result.status).toBe('failed');
  });

  it('reports a retried test as flaky rather than a clean pass', () => {
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite><testcase name="retried" status="passed"><rerunFailure>attempt 1</rerunFailure></testcase><testcase name="clean" status="passed"/></testsuite>',
      ),
      context,
    );
    expect(result.attempts[0]?.status).toBe('flaky');
    expect(result.attempts[0]?.flakiness).toBe('observed');
    expect(result.attempts[1]?.flakiness).toBe('unknown');
  });

  it('keeps a run with only undeclared testcases out of the passed column', () => {
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode('<testsuite><testcase name="a"/><testcase name="b"/></testsuite>'),
      context,
    );
    expect(result.status).toBe('unknown');
    expect(result.completeness.state).toBe('unknown');
  });

  it('keeps an explicitly unrecognized testcase status non-green', () => {
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite><testcase name="unknown" status="mystery"/></testsuite>',
      ),
      context,
    );
    expect(result.status).toBe('unknown');
    expect(result.attempts[0]?.status).toBe('unknown');
  });

  it('rejects reports without testcases', () => {
    expect(() =>
      junitXmlAdapter.parse(new TextEncoder().encode('<testsuite/>'), context),
    ).toThrow();
  });
});
