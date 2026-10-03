import { createHash } from 'node:crypto';
import type { CanonicalRunResult } from '@automate/shared-contracts';
import type { ProducerAdapter } from '../adapter.js';
import { canonicalRunResult } from '../canonical-run-result.js';
import { canonicalTestStatusFrom, outcomesWithDeclaredRunStatus } from '../producer-status.js';

type CanonicalStatus = CanonicalRunResult['status'];

interface PlaywrightAttachment {
  name?: string;
  contentType?: string;
  body?: string;
}
interface PlaywrightAttempt {
  status?: string;
  duration?: number;
  error?: { message?: string };
  attachments?: PlaywrightAttachment[];
  startTime?: string;
}
interface PlaywrightTest {
  title?: string;
  path?: string[];
  projectName?: string;
  results?: PlaywrightAttempt[];
  status?: string;
}
interface PlaywrightSpec {
  title?: string;
  file?: string;
  tests?: PlaywrightTest[];
  /** Real Playwright reports nest their specs here; `tests` on a suite is the shorthand. */
  specs?: (PlaywrightSpec | null)[];
  suites?: (PlaywrightSpec | null)[];
}
interface PlaywrightReport {
  suites?: (PlaywrightSpec | null)[];
}

/** One spec, with the suite it was found under — a spec carries no file of its own. */
interface CollectedSpec {
  spec: PlaywrightSpec;
  file: string;
  suiteTitle: string;
}

/**
 * Every spec in the report, paired with the suite that owns it.
 *
 * **A Playwright JSON report nests `specs[]` under `suites[]`; the tests live on the spec
 * and the file lives on the suite.** This collector read `suite.tests`, which no real
 * report has, so every spec it found had zero attempts and the adapter refused the document
 * with "Playwright report contains no test attempts" — for a report Playwright had written
 * itself. The upload door had its own walker, that walker handled `specs[]`, and the two
 * disagreed; unifying the doors meant the canonical adapter had to learn the shape the
 * product actually receives, which is the whole point of retiring the duplicate.
 *
 * Both spellings are accepted because both occur: `suites[].specs[]` is what Playwright
 * emits and `suites[].tests[]` is what a hand-rolled wrapper produces, and neither is a
 * mistake by its author.
 */
function collectSpecs(
  suites: (PlaywrightSpec | null)[] | undefined,
  output: CollectedSpec[] = [],
  inheritedFile = '',
  inheritedTitle = '',
): CollectedSpec[] {
  for (const suite of suites ?? []) {
    // **A `null` entry is real and common.** Playwright emits one for a project whose
    // worker died before it reported, and the upload door's walker skipped them. Reading
    // `suite.file` on `null` throws, so a report containing a crashed project was rejected
    // wholesale — losing the tests that *did* run because one that did not was listed.
    if (suite === null || suite === undefined) continue;
    const file = suite.file ?? inheritedFile;
    const title = suite.title ?? inheritedTitle;
    // A node with `tests` *is* a spec, in either spelling. A node with `specs` is a suite
    // and is not pushed itself: it carries no attempts, and pushing it would shift every
    // ordinal after it and give a suite an evidence URI that names no test.
    if (suite.tests !== undefined && file && title) {
      output.push({ spec: suite, file, suiteTitle: title });
    }
    collectSpecs(suite.specs, output, file, title);
    collectSpecs(suite.suites, output, file, title);
  }
  return output;
}

/**
 * Playwright's own test status, read through the one shared ladder.
 *
 * The switch this replaced had no `interrupted` rung, so Playwright's `interrupted` —
 * emitted when the *harness* stopped the run — fell through to `unknown`, which is a
 * different misreport from the one the blueprint found in the upload door but has the
 * same cause: a status this adapter did not have a row for. The ladder has one, and it is
 * `cancelled`, because cancelling a run yields no outcome at all and `policy.ts` already
 * classifies `cancelled` as non-product for that reason.
 */
function mapStatus(status: string | undefined): CanonicalStatus {
  return canonicalTestStatusFrom('playwright', status ?? 'unknown');
}

function evidenceFor(
  attachments: PlaywrightAttachment[] | undefined,
  runId: string,
  testIndex: number,
  attemptIndex: number,
) {
  return (attachments ?? []).flatMap((attachment, attachmentIndex) => {
    if (!attachment.body || !attachment.name) return [];
    const bytes = Buffer.from(attachment.body, 'base64');
    return [
      {
        // The name is the only segment an outside party can choose, and it is
        // interpolated rather than escaped, so a name containing `?` or `#` changed
        // the URI that got *recorded*: `report?x=1` parses as a path segment `report`
        // with a query, and `dir/file` adds a segment. The evidence URI is what a
        // reader follows, so a crafted name makes it resolve to the wrong artifact or
        // to nothing, silently. The name arrives inside a Playwright report uploaded
        // by a build — a pull request controls it.
        //
        // The other segments are not encoded because they are ours: a run id we
        // generate and three indices. Encoding them would be noise, and pretending
        // otherwise would be a claim that is not currently true.
        uri: `artifact://${runId}/${testIndex}/${attemptIndex}/${attachmentIndex}/${encodeURIComponent(attachment.name)}`,
        mediaType: attachment.contentType ?? 'application/octet-stream',
        byteSize: bytes.byteLength,
        digest: createHash('sha256').update(bytes).digest('hex'),
      },
    ];
  });
}

/**
 * Whether a test needed more than one attempt to reach its reported outcome.
 *
 * Playwright's `results` array *is* the retry history, so this is real evidence
 * rather than a guess. Hardcoding `flakiness: 'unknown'` threw away the one
 * signal that separates a trustworthy green run from a lucky one.
 */
function isFlaky(test: PlaywrightTest): boolean {
  const results = test.results ?? [];
  if (results.length < 2) return false;
  const statuses = results.map((attempt) => mapStatus(attempt.status));
  // Flaky means the outcome *changed* between attempts. Two failures are just a
  // broken test, and must not be softened into "flaky".
  return statuses.some((status) => status !== statuses[0]);
}

/**
 * Decode an uploaded Playwright report, or refuse it by name.
 *
 * The refusal is deliberately *not* a `SyntaxError`: the adapter's other refusals are
 * plain `Error`s carrying a message a caller can act on, and a raw parser exception
 * is the one shape a caller cannot distinguish from its own bugs.
 *
 * @param text the decoded upload
 * @returns the report as the adapter reads it
 * @throws {Error} `Playwright report is not valid JSON` when the body cannot be parsed
 */
function parsePlaywrightReport(text: string): PlaywrightReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error('Playwright report is not valid JSON', { cause });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Playwright report is not a JSON object');
  }
  return parsed as PlaywrightReport;
}

export const playwrightJsonAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.playwright+json',
  parse(input, context) {
    // Ledger F-7. This parse had no guard, and `parse` declares no error channel, so
    // a malformed upload escaped as a raw `SyntaxError` — indistinguishable from this
    // adapter's own deliberate refusals further down, which are plain `Error`s the
    // caller can recognise. The API's equivalent parse is equally unguarded *inside*,
    // but the route wraps it in a `try` and renders a classified ingestion error, so
    // the same boundary was giving two different answers depending on which parser
    // ran. Turning it into a named refusal costs nothing and makes the two agree.
    const report = parsePlaywrightReport(new TextDecoder().decode(input));
    const specs = collectSpecs(report.suites);
    // Final outcome per test, for run-level aggregation. A retry history is not
    // a set of independent tests: the last attempt is the outcome, and the
    // earlier ones are the evidence of flakiness.
    const finalOutcomes: CanonicalRunResult['status'][] = [];
    // A single ordinal per **test in the whole report**, not per spec and not per
    // attempt. It has to span the report: a per-spec index still collides, because
    // spec 0's first test and spec 1's first test would both be ordinal 0.
    //
    // `testIndex` used to be the spec's position in `specs`, threaded unchanged into
    // both `testId`'s fallback and `evidenceFor`. Two tests inside one spec therefore
    // produced byte-identical evidence URIs for the same attachment name — and two
    // `trace.zip`, which Playwright emits for *every* test, is the normal case rather
    // than an unlucky one. Nothing downstream de-duplicates by URI, so both entries
    // survived carrying the same `uri` and different digests (ledger F-5).
    const testCases = specs.flatMap(({ spec, file, suiteTitle }) =>
      // A `null` test entry is the same crashed-project case as a `null` suite: the worker
      // died before it reported anything, and reading `test.results` on `null` would reject
      // the whole report over the one project that never ran.
      (spec.tests ?? [])
        .filter((test): test is PlaywrightTest => test !== null)
        .map((test) => ({ test, file, suiteTitle, spec })),
    );
    const attempts = testCases.flatMap(({ test, file, suiteTitle, spec }, ordinal) => {
      const results = test.results?.length ? test.results : [{ status: test.status }];
      const flaky = isFlaky(test);
      const statuses = results.map((attempt) => mapStatus(attempt.status));
      const last = statuses[statuses.length - 1] ?? 'unknown';
      finalOutcomes.push(flaky ? 'flaky' : last);
      return results.map((attempt, attemptIndex) => ({
        index: attemptIndex + 1,
        testId: `${file}:${test.title ?? ordinal}`,
        // The file is the *suite's*, and `collectSpecs` only pushes a pair when both the
        // file and the title were found on the node or an ancestor. So these are present
        // by construction. They were typed `string | undefined` and handed to
        // `CanonicalRunResultSchema.parse`, which would have rejected the whole result —
        // the throw is real, but it surfaced as an opaque Zod error on a
        // legitimate-looking report rather than at the point where the invariant is
        // established.
        specPath: file,
        title: test.title ?? spec.title ?? suiteTitle,
        suite: suiteTitle,
        // Each attempt keeps its own status: the retry history is evidence and
        // must not be rewritten. Flakiness is recorded alongside it.
        status: mapStatus(attempt.status),
        rawStatus: attempt.status ?? 'unknown',
        startedAt: attempt.startTime ?? context.startedAt,
        finishedAt: context.finishedAt,
        durationMs: attempt.duration,
        error: attempt.error?.message ? { message: attempt.error.message } : undefined,
        evidence: evidenceFor(attempt.attachments, context.runId, ordinal, attemptIndex),
        flakiness: flaky ? ('observed' as const) : ('unknown' as const),
      }));
    });
    if (attempts.length === 0) throw new Error('Playwright report contains no test attempts');
    // The status comes from `finalOutcomes` — one entry per *test* — not from
    // `attempts`, which holds one entry per retry. A test that failed once and then
    // passed contributes a `failed` attempt and a `flaky` outcome; deriving the run
    // from attempts would report the run failed, and deriving it from the last
    // attempt alone would report it passed.
    return canonicalRunResult(
      {
        outcomes: outcomesWithDeclaredRunStatus(finalOutcomes, context.declaredRunStatus),
        attempts,
        evidence: attempts.flatMap((attempt) => attempt.evidence),
        producer: 'playwright',
        verifier: 'playwright-adapter',
      },
      context,
    );
  },
};
