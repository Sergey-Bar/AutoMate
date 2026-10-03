import { describe, expect, it } from 'vitest';
import { CanonicalRunResultSchema } from '@automate/shared-contracts';
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
  it('reads a complete testcase that declares nothing as a pass, and preserves files without treating classnames as paths', () => {
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite><testcase classname="suite.pkg" file="tests/self-closing.spec.ts" name="self-closing" time="0.1"/><testcase classname="suite.pkg" file="tests/plain.spec.ts" name="plain"></testcase><testcase classname="suite.pkg" name="fails"><failure>boom</failure></testcase></testsuite>',
      ),
      context,
    );
    expect(result.attempts).toHaveLength(3);
    // **This expectation was `'unknown'`, `'unknown'`, `'failed'` and that was
    // wrong.** Every JUnit dialect — Surefire, Gradle, Jest, pytest, RSpec,
    // PHPUnit — writes a passing test with no `status` attribute and no outcome
    // child, because that is what the schema means. Resolving that to `unknown`
    // made every Maven, Gradle, Jest, pytest and RSpec run ingest as a run of
    // unobserved tests, so the score read such a project as having no tests at
    // all. `new-adapter-parity.test.ts`'s six dialect fixtures are what made it
    // visible; this file's single self-closing testcase could not, because one
    // self-closing element looks like the malformed case it was written for.
    //
    // The guard that was protecting something real is kept, on the input that
    // actually warrants it: a *truncated* testcase, whose unseen remainder is
    // where a `<failure>` would be. `statusFrom` now takes `truncated` and returns
    // `unknown` for it.
    expect(result.attempts.map((attempt) => attempt.status)).toEqual([
      'passed',
      'passed',
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

  it('reports a run of complete attribute-less testcases as passed, because that is what JUnit means', () => {
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode('<testsuite><testcase name="a"/><testcase name="b"/></testsuite>'),
      context,
    );
    // The old expectation was `unknown`, on the reasoning that an attribute-less
    // testcase "declares nothing". It does declare something — it declares that the
    // test ran and did not fail, which is how every dialect in the format writes a
    // pass. `keeps a *truncated* testcase out of the passed column` below is the
    // same property applied to the input that actually warrants it.
    expect(result.status).toBe('passed');
    expect(result.completeness.state).toBe('complete');
  });

  it('keeps a *truncated* document out of the passed column, because its remainder is unread', () => {
    // The document stops mid-element, so the `<failure>` that would have been in
    // the part we did not see is exactly what is missing. This is the case the
    // old `unknown` default was written for.
    //
    // Note *where* the doubt lands: the SAX parser never opens a tag it never sees
    // closed, so the cut-off `<testcase>` produces no attempt and there is no row
    // to mark. The adapter therefore states the doubt at the **run** level, and
    // the ladder orders it below a real failure — a report that is both truncated
    // and failing is still `failed`.
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode('<testsuite><testcase name="a"/><testcase name="cut off"'),
      context,
    );
    // Only the complete testcase became an attempt. Nothing is fabricated for the
    // element we never finished opening.
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts?.[0]?.status).toBe('passed');
    expect(result.status).toBe('unknown');
    expect(result.completeness.state).toBe('unknown');
  });

  it('still reports a truncated document that also failed as failed', () => {
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite><testcase name="boom"><failure>x</failure></testcase><testcase name="cut off"',
      ),
      context,
    );
    expect(result.status).toBe('failed');
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

  it('numbers a retried test 1..n, which is what a JUnit report with a retry actually contains', () => {
    // The test above uses three *distinct* names, and that is why the defect went
    // unnoticed: with distinct names, "always 1" is correct.
    //
    // A retry is several `<testcase>` elements with the same `classname` and `name`
    // — which is what JUnit XML exists to express, and what every CI reporter emits
    // for a flaky test. `CanonicalRunResultSchema` requires each `testId`'s indexes to
    // be exactly 1..n with no repeat, so `[1, 1]` for one test was rejected by
    // `safeParse` at the API boundary: every retried JUnit run in every project
    // failed to ingest, with an error about a duplicate attempt index.
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite>' +
          '<testcase classname="checkout" name="adds to cart" status="failed"/>' +
          '<testcase classname="checkout" name="adds to cart" status="passed"/>' +
          '<testcase classname="checkout" name="refunds" status="passed"/>' +
          '</testsuite>',
      ),
      context,
    );

    // One attempt ordinal per *test*, not per element in the document.
    const byTest = new Map<string, number[]>();
    for (const attempt of result.attempts) {
      byTest.set(attempt.testId, [...(byTest.get(attempt.testId) ?? []), attempt.index]);
    }
    expect(byTest.get('checkout:adds to cart')).toEqual([1, 2]);
    // A test that ran once is still attempt 1, and unaffected by a neighbour's retry.
    expect(byTest.get('checkout:refunds')).toEqual([1]);
  });

  it('produces a result the canonical contract accepts, retries and all', () => {
    // The end of the chain the previous test's failure reached: the ingestion
    // boundary parses with `safeParse`, so an adapter that produces a sequence the
    // contract rejects rejects the whole report.
    const result = junitXmlAdapter.parse(
      new TextEncoder().encode(
        '<testsuite>' +
          '<testcase classname="checkout" name="adds to cart" status="failed"/>' +
          '<testcase classname="checkout" name="adds to cart" status="passed"/>' +
          '</testsuite>',
      ),
      context,
    );

    const parsed = CanonicalRunResultSchema.safeParse(result);
    expect(
      parsed.success,
      parsed.success
        ? ''
        : `the adapter produced a result the contract rejects: ${JSON.stringify(parsed.error.issues)}`,
    ).toBe(true);
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

describe('a JUnit report that is not valid XML', () => {
  // `saxes` is a strict parser and a JUnit report in the wild is frequently not strictly
  // valid: an unescaped `&` in a `<system-out>` block, a `>` in a failure message, a body
  // cut off when CI killed the job. The hand-rolled scanner this replaced tolerated all of
  // it, so recovering is not optional — refusing is a regression dressed as a hardening, and
  // nobody notices until a customer's daily run stops appearing.
  //
  // What makes it honest is the mark: a report the parser could not finish is one whose
  // completeness is not established, and `proofCeiling` says so.
  const truncated = (body: string) =>
    junitXmlAdapter.parse(new TextEncoder().encode(body), context);

  it('keeps the testcase that was open when the document stopped', () => {
    const result = truncated('<testsuite><testcase name="a" status="passed">');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.title).toBe('a');
    expect(result.completeness.state).toBe('unknown');
    expect(CanonicalRunResultSchema.safeParse(result).success).toBe(true);
  });

  it('keeps everything before an undefined entity in a system-out block', () => {
    // `&lol;` is not a defined XML entity. It is also exactly what a CI log full of shell
    // output contains, and rejecting the report over it would lose every test in it.
    const result = truncated(
      '<testsuite><testcase name="a" status="passed"/><system-out>&lol;</system-out></testsuite>',
    );
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.title).toBe('a');
    expect(result.completeness.state, 'the document did not parse to its end').toBe('unknown');
  });

  it('refuses a document that yields no testcase at all, because that is not a run', () => {
    expect(() => truncated('<testsuite></testsuite>')).toThrow(/no test cases/u);
    expect(() => truncated('not xml at all')).toThrow();
    expect(() => truncated('')).toThrow(/no test cases/u);
  });

  it('reads a well-formed document as complete', () => {
    const result = truncated(
      '<testsuite><testcase name="a" status="passed"/><testcase name="b" status="passed"/></testsuite>',
    );
    expect(result.completeness.state).toBe('complete');
    expect(result.status).toBe('passed');
  });
});
