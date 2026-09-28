import { describe, expect, it } from 'vitest';
import { junitXmlAdapter, MAX_MESSAGE_CHARS } from './adapters/junit-xml.js';

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
    // The **run** is flaky too, and this is the assertion that was missing. The
    // attempt was already recorded as flaky — the adapter read `<rerunFailure>`
    // correctly — but the run status came from a ladder with no `flaky` rung, so the
    // run was serialised `passed`. A release gate reads the run status: a green run
    // that contains a flaky test, decided by which producer wrote the file.
    expect(result.status).toBe('flaky');
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

  it('numbers each testcase’s attempt 1, not a running ordinal across the document', () => {
    // A JUnit `<testcase>` is one test with one attempt. `playwright-json.ts` puts
    // `attemptIndex + 1` here — the attempt's ordinal within one test — and
    // `RunExplorer.tsx:36` renders it as "attempt N". A running ordinal across the
    // document made the second testcase in a report claim its only attempt was
    // attempt 2, so a consumer keying on `(testId, index)` had no consistent identity
    // across the two producers.
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite><testcase name="first" status="passed"/><testcase name="second" status="passed"/><testcase name="third" status="passed"/></testsuite>',
      ),
      context,
    );
    expect(result.attempts.map((attempt) => attempt.index)).toEqual([1, 1, 1]);
  });

  it('rejects reports without testcases', () => {
    expect(() =>
      junitXmlAdapter.parse(new TextEncoder().encode('<testsuite/>'), context),
    ).toThrow();
  });

  it('bounds an enormous failure body at consumption and marks the truncation', () => {
    const huge = 'e'.repeat(200_000);
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        `<testsuite><testcase name="chatty"><failure>${huge}</failure></testcase></testsuite>`,
      ),
      context,
    );
    const attempt = result.attempts[0];
    expect(attempt?.error?.message).toHaveLength(MAX_MESSAGE_CHARS);
    // Truncation has to be *visible*. A sentinel appended to the message would make
    // the string falsely claim to be the producer's own text; `error.code` is
    // already permitted by the contract and a consumer can branch on it.
    expect(attempt?.error?.code).toBe('MESSAGE_TRUNCATED');
  });

  it('leaves a normal-length message with no code, so a fix that truncates everything cannot pass', () => {
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite><testcase name="quiet"><failure>expected 1 to equal 2</failure></testcase></testsuite>',
      ),
      context,
    );
    expect(result.attempts[0]?.error?.message).toBe('expected 1 to equal 2');
    expect(result.attempts[0]?.error?.code).toBeUndefined();
  });

  it('does not leak the truncation flag into the next testcase', () => {
    const huge = 'e'.repeat(200_000);
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        `<testsuite><testcase name="chatty"><failure>${huge}</failure></testcase>` +
          '<testcase name="quiet"><failure>short reason</failure></testcase></testsuite>',
      ),
      context,
    );
    expect(result.attempts[0]?.error?.code).toBe('MESSAGE_TRUNCATED');
    // The reset lives in the `opentag` handler alongside `currentText` and
    // `currentChildren`, not in the `closetag` branch. Resetting it on close would
    // leave the flag set for whichever testcase the parser had not yet opened.
    expect(result.attempts[1]?.error?.message).toBe('short reason');
    expect(result.attempts[1]?.error?.code).toBeUndefined();
  });

  it('caps a CDATA body the same way a text body is capped', () => {
    const huge = 'e'.repeat(200_000);
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        `<testsuite><testcase name="cdata"><failure><![CDATA[${huge}]]></failure></testcase></testsuite>`,
      ),
      context,
    );
    // The cap is enforced in the `text` and `cdata` handlers together. Covering
    // only `text` would leave the CDATA path able to regrow the unbounded string.
    expect(result.attempts[0]?.error?.message).toHaveLength(MAX_MESSAGE_CHARS);
    expect(result.attempts[0]?.error?.code).toBe('MESSAGE_TRUNCATED');
  });

  it('stops accumulating once the cap is reached, so later text cannot regrow the message', () => {
    const huge = 'e'.repeat(200_000);
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        `<testsuite><testcase name="chatty"><failure>${huge}</failure><system-out>${huge}</system-out></testcase></testsuite>`,
      ),
      context,
    );
    // Two events after the ceiling was reached. The second one has to be dropped
    // outright rather than appended, which is what keeps the bound a bound.
    expect(result.attempts[0]?.error?.message).toHaveLength(MAX_MESSAGE_CHARS);
    expect(result.attempts[0]?.error?.code).toBe('MESSAGE_TRUNCATED');
  });
});
