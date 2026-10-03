import { SaxesParser } from 'saxes';
import type { CanonicalRunResult } from '@automate/shared-contracts';
import type { ProducerAdapter } from '../adapter.js';
import { canonicalRunResult, type CanonicalStatus } from '../canonical-run-result.js';
import { canonicalTestStatusFrom, outcomesWithDeclaredRunStatus } from '../producer-status.js';

interface TestCase {
  name: string;
  classname?: string;
  file?: string;
  time?: number;
  // Typed as the canonical union, not `string`. It was `string`, so every consumer of
  // `testCase.status` had to be re-widened by hand — and the run-status ladder below
  // was reading a `string[]` and comparing it against literals, which is the shape
  // where a status the contract does not declare slips through unnoticed.
  status: CanonicalStatus;
  flakiness: 'unknown' | 'observed';
  declaredStatus?: string;
  message?: string;
  /** Set when the cap discarded part of the body, surfaced as `error.code`. */
  truncated?: boolean;
}

/**
 * JUnit test-case elements that carry outcome evidence.
 *
 * `flakyFailure` and `rerunFailure` are the JUnit way of saying "this test
 * failed on an earlier attempt and passed on a later one", so their presence is
 * the only honest source for `flakiness: 'observed'`.
 */
const OUTCOME_CHILDREN = new Set([
  'failure',
  'error',
  'skipped',
  'flakyfailure',
  'rerunfailure',
  'rerunerror',
]);

/**
 * Maps JUnit evidence to a canonical status.
 *
 * ## A complete, attribute-less `<testcase>` is a **pass**
 *
 * Every JUnit dialect writes a passing test with no `status` attribute and no
 * outcome child — Surefire, Gradle, Jest, pytest, RSpec and PHPUnit all do, and it
 * is the shape the schema itself specifies. Resolving that to `unknown` — which
 * this function did — meant that **every** Maven, Gradle, Jest, pytest and RSpec
 * run ingested as a run of unobserved tests: the score would compute `presence 0`
 * for every cell of every such project and read the repository as having no tests
 * at all. The plan's R4 asks for one adapter and a dialect fixture per producer,
 * and that fixture set is what made this visible.
 *
 * ## A **truncated** one is still `unknown`
 *
 * The original reason for returning `unknown` was sound and is preserved: a
 * `<testcase>` whose closing tag never arrived ran, but the rest of its body was
 * never seen, so it is not a pass — a `<failure>` after the cut would be exactly
 * the evidence we are missing. Truncation and "complete" are therefore different
 * inputs rather than the same one, and the distinction is the whole fix.
 */
function statusFrom(
  declaredStatus: string | undefined,
  children: ReadonlySet<string>,
  truncated: boolean,
): CanonicalRunResult['status'] {
  if (children.has('failure') || children.has('error') || children.has('rerunerror'))
    return 'failed';
  if (children.has('skipped')) return 'skipped';
  // Retry evidence outranks a declared status: a `<testcase status="passed">`
  // that also carries a `rerunFailure` is a flaky pass, not a clean one.
  if (children.has('flakyfailure') || children.has('rerunfailure')) return 'flaky';
  if (declaredStatus !== undefined) {
    // The declared attribute goes through the same ladder as every other producer's
    // vocabulary, so a JUnit `status="passed"` and a Playwright `"passed"` cannot mean two
    // different things. The previous copy of this switch was a fourth mapping of the same
    // names, and it was the only one that had no row for `timedOut`'s snake_case spelling.
    return canonicalTestStatusFrom('junit', declaredStatus);
  }
  // No attribute and no outcome child. Complete means passed, because that is what
  // the format means; truncated means we did not see the whole body, and the part
  // we did not see is where a failure would be.
  return truncated ? 'unknown' : 'passed';
}

/**
 * Ceiling on the failure text kept per `<testcase>`.
 *
 * `currentText` grew with `+=` on every `text`/`cdata` event and nothing bounded
 * it, so one enormous `<failure>` body — a repeated stack trace, a test that
 * dumps a whole response — was materialised in full before any consumer saw it.
 * The cap is applied as the text is consumed, because slicing at the end would
 * leave the unbounded string already allocated and throw the saving away.
 */
export const MAX_MESSAGE_CHARS = 8_192;

/** Marked on `AttemptSchema.error.code` when the cap discarded producer text. */
const TRUNCATED_CODE = 'MESSAGE_TRUNCATED';

/**
 * How one `<testcase>` ended.
 *
 * **Two different meanings, deliberately not one flag.** `textTruncated` is the
 * message-length cap firing, which is an *intact* element whose failure text was
 * clipped — the outcome is still known. `incomplete` is the closing tag never
 * arriving, which is an element we saw the start of and not the end, and is the
 * only one of the two that makes the status unknown. Collapsing them is what let
 * the old blanket `unknown` default survive: the flag named `truncated` was the
 * cap, and the path that needed the unknown was the one that never set it.
 */
interface TestCaseEnding {
  /** The failure text exceeded `MAX_MESSAGE_CHARS` and was clipped. */
  textTruncated: boolean;
  /** The document ended before `</testcase>` arrived. */
  incomplete: boolean;
}

/**
 * Resolve and record one `<testcase>`.
 *
 * One function because there are two ways a testcase can end — its `</testcase>` arrives,
 * or the document stops — and the second path used to be a second copy of this logic. A
 * testcase whose closing tag never arrived still ran; it just cannot be sure of the rest.
 */
function finish(
  testCases: TestCase[],
  children: ReadonlySet<string>,
  text: string,
  ending: TestCaseEnding,
  testCase: TestCase,
): void {
  testCase.status = statusFrom(testCase.declaredStatus, children, ending.incomplete);
  // `flakyFailure` / `rerunFailure` are the only JUnit evidence that a
  // test needed more than one attempt, so flakiness stays `unknown`
  // without them.
  testCase.flakiness =
    testCase.status === 'flaky' || children.has('flakyfailure') || children.has('rerunfailure')
      ? 'observed'
      : 'unknown';
  testCase.message = text.trim() || undefined;
  testCase.truncated = ending.textTruncated || ending.incomplete;
  testCases.push(testCase);
}

export const junitXmlAdapter: ProducerAdapter = {
  mediaType: 'application/xml',
  parse(input, context) {
    const parser = new SaxesParser({ xmlns: false });
    const testCases: TestCase[] = [];
    let current: TestCase | undefined;
    let currentText = '';
    let truncated = false;
    /** The document could not be parsed to its end. See the `error` handler. */
    let malformed = false;
    const currentChildren = new Set<string>();
    /**
     * Recover from XML errors instead of rethrowing them.
     *
     * `saxes` is a strict parser and a JUnit report in the wild is frequently not strictly
     * valid: an unescaped `&` in a `<system-out>` block, a `>` in a failure message, a body
     * cut off when CI killed the job. The hand-rolled scanner this replaced tolerated all
     * of it, so switching to a real parser without recovery rejects reports that used to
     * ingest — a regression dressed as a hardening, and one nobody notices until a
     * customer's daily run stops appearing.
     *
     * **Recovering is only honest because the result is marked.** `malformed` forces
     * `completeness.state: 'unknown'`, so a report the parser could not finish is one whose
     * completeness is not established and `proofCeiling` says so. What is *not* done is
     * pretending the document parsed: a document that yields no `<testcase>` is still
     * refused below, because "we could not read it" and "there was nothing in it" are
     * different answers and only the second one is a run result.
     */
    parser.on('error', () => {
      malformed = true;
    });
    parser.on('opentag', (tag) => {
      if (tag.name === 'testcase') {
        const attributes = tag.attributes as Record<string, string>;
        current = {
          name: attributes.name ?? 'unnamed test',
          classname: attributes.classname,
          file: attributes.file,
          time: attributes.time ? Number(attributes.time) * 1000 : undefined,
          status: 'unknown',
          flakiness: 'unknown',
          declaredStatus: attributes.status,
        };
        currentText = '';
        truncated = false;
        currentChildren.clear();
      } else if (OUTCOME_CHILDREN.has(tag.name.toLowerCase())) {
        currentChildren.add(tag.name.toLowerCase());
      }
    });
    // Growth happens at `+=`, so the cap belongs here and not on the serialised
    // attempt. Once the ceiling is reached the remaining text is dropped rather
    // than accumulated, and `truncated` records that it was.
    const append = (text: string): void => {
      if (truncated) return;
      if (currentText.length + text.length > MAX_MESSAGE_CHARS) {
        currentText += text.slice(0, MAX_MESSAGE_CHARS - currentText.length);
        truncated = true;
        return;
      }
      currentText += text;
    };
    parser.on('text', (text) => {
      append(text);
    });
    parser.on('cdata', (text) => {
      append(text);
    });
    parser.on('closetag', (tag) => {
      if (tag.name === 'testcase' && current) {
        finish(
          testCases,
          currentChildren,
          currentText,
          {
            textTruncated: truncated,
            incomplete: false,
          },
          current,
        );
        current = undefined;
        currentText = '';
        currentChildren.clear();
      }
    });
    try {
      parser.write(new TextDecoder().decode(input)).close();
    } catch {
      // The `error` handler above covers every recoverable error; anything thrown here
      // stopped the parse outright. What survived is flushed below.
      malformed = true;
    }
    // **A `<testcase>` still open when the document ends did run.** The only path that
    // leaves `current` set is a document that stopped mid-element, which is also why it
    // makes the result malformed — a report cut short cannot have said what its last test
    // did. Flushing it here rather than in each error path is what keeps "the document
    // ended" and "the parse threw" from becoming two copies of the same rule.
    if (current) {
      finish(
        testCases,
        currentChildren,
        currentText,
        {
          textTruncated: truncated,
          // The path that reaches here is the one where `current` was still open at
          // the end of the document, so the closing tag never arrived.
          incomplete: true,
        },
        current,
      );
      current = undefined;
      malformed = true;
    }
    if (testCases.length === 0) throw new Error('JUnit report contains no test cases');
    // The attempt ordinal is *within one test*, so it is counted per `testId` and
    // not across the document.
    //
    // It was a running ordinal, which made the second testcase in a report claim its
    // only attempt was attempt 2; and it was then "always 1", which fixed that case
    // and broke the one that matters more: **a retry is several `<testcase>` elements
    // with the same `classname` and `name`**, which is what JUnit XML exists to
    // express and what every CI reporter emits for a flaky test. Always-1 produced
    // `[1, 1]` for one `testId`, and `CanonicalRunResultSchema` requires exactly
    // 1..n with no repeat — so every retried JUnit report in every project was
    // rejected at the ingestion boundary with an error about a duplicate attempt
    // index, and nothing about the error named the adapter.
    //
    // The existing test used three *distinct* names, so it passed against both wrong
    // versions. It is a real limitation of the shape, not of the test: a suite with
    // no retries cannot tell "always 1" from "per test".
    const attemptOrdinal = new Map<string, number>();
    const attempts = testCases.map((testCase) => {
      const testId = `${testCase.classname ?? 'suite'}:${testCase.name}`;
      const index = (attemptOrdinal.get(testId) ?? 0) + 1;
      attemptOrdinal.set(testId, index);
      return {
        index,
        testId,
        // Deliberately **not** `classname`. A fully-qualified class name is not a path, and
        // `specPath` is validated as one and grouped by as one: a report with no `file`
        // attribute put every test under a single suite called after its package, which
        // reads as a location and is not one. `unknown.spec.ts` is honest in a way
        // `suite.pkg` is not, and it is what this adapter has always done.
        specPath: testCase.file ?? 'unknown.spec.ts',
        title: testCase.name,
        suite: testCase.classname,
        status: testCase.status,
        rawStatus: testCase.status,
        startedAt: context.startedAt,
        finishedAt: context.finishedAt,
        durationMs: Number.isFinite(testCase.time) ? testCase.time : undefined,
        error: testCase.message
          ? { message: testCase.message, ...(testCase.truncated ? { code: TRUNCATED_CODE } : {}) }
          : undefined,
        evidence: [],
        flakiness: testCase.flakiness,
      };
    });
    // One attempt per `<testcase>`, so the per-test outcome and the per-attempt
    // outcome are the same list. Passed explicitly rather than left to the serialiser
    // to infer, so a future change that gives JUnit several attempts per testcase
    // cannot quietly start deriving the run status from attempts instead of tests.
    //
    // This list is where the JUnit/Playwright disagreement showed up: `statusFrom`
    // returns `flaky` for a `<rerunFailure>`, and this adapter's own ladder had no
    // `flaky` rung, so a report whose only interesting property was a retry was
    // serialised as `status: 'passed'` — a green run with a flaky test in it, which
    // is the one thing a release gate reads.
    //
    // **A malformed document cannot report `passed`.** `completeness.state` already
    // says `unknown`, and the run status said `passed` anyway — two fields
    // contradicting each other, and the second is the one a release gate reads. The
    // SAX parser never opens a tag it never sees closed, so the cut-off
    // `<testcase>` produces no attempt at all and there is nothing in
    // `testCases` to carry the doubt; it has to be added here.
    //
    // The claim goes in as a *run* status through the same ladder as everything
    // else, so it cannot outrank a real failure: a report that is both truncated
    // and failing is still `failed`.
    return canonicalRunResult(
      {
        outcomes: outcomesWithDeclaredRunStatus(
          testCases.map((testCase) => testCase.status),
          malformed ? 'unknown' : context.declaredRunStatus,
        ),
        attempts,
        producer: 'junit',
        verifier: 'junit-adapter',
        truncated: malformed,
      },
      context,
    );
  },
};
