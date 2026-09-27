import { createHash } from 'node:crypto';
import type { CanonicalRunResult } from '@automate/shared-contracts';
import type { ProducerAdapter } from '../adapter.js';
import { canonicalRunResult } from '../canonical-run-result.js';

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
  suites?: PlaywrightSpec[];
}
interface PlaywrightReport {
  suites?: PlaywrightSpec[];
}

function collectSpecs(suites: PlaywrightSpec[] | undefined, output: PlaywrightSpec[] = []) {
  for (const suite of suites ?? []) {
    if (suite.file && suite.title) output.push(suite);
    collectSpecs(suite.suites, output);
  }
  return output;
}

function mapStatus(status: string | undefined): CanonicalRunResult['status'] {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'timedOut':
      return 'timedOut';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'unknown';
  }
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
        uri: `artifact://${runId}/${testIndex}/${attemptIndex}/${attachmentIndex}/${attachment.name}`,
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

export const playwrightJsonAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.playwright+json',
  parse(input, context) {
    const report = JSON.parse(new TextDecoder().decode(input)) as PlaywrightReport;
    const specs = collectSpecs(report.suites);
    // Final outcome per test, for run-level aggregation. A retry history is not
    // a set of independent tests: the last attempt is the outcome, and the
    // earlier ones are the evidence of flakiness.
    const finalOutcomes: CanonicalRunResult['status'][] = [];
    const attempts = specs.flatMap((spec, testIndex) => {
      const tests = spec.tests ?? [];
      return tests.flatMap((test) => {
        const results = test.results?.length ? test.results : [{ status: test.status }];
        const flaky = isFlaky(test);
        const statuses = results.map((attempt) => mapStatus(attempt.status));
        const last = statuses[statuses.length - 1] ?? 'unknown';
        finalOutcomes.push(flaky ? 'flaky' : last);
        return results.map((attempt, attemptIndex) => ({
          index: attemptIndex + 1,
          testId: `${spec.file}:${test.title ?? testIndex}`,
          // `collectSpecs` only pushes a suite that has **both** `file` and `title`,
          // so these are present by construction. They were typed `string | undefined`
          // and handed to `CanonicalRunResultSchema.parse`, which would have rejected
          // the whole result — the throw is real, but it surfaced as an opaque Zod
          // error on a legitimate-looking report rather than at the point where the
          // invariant is established.
          specPath: spec.file as string,
          title: (test.title ?? spec.title) as string,
          suite: spec.title,
          // Each attempt keeps its own status: the retry history is evidence and
          // must not be rewritten. Flakiness is recorded alongside it.
          status: mapStatus(attempt.status),
          rawStatus: attempt.status ?? 'unknown',
          startedAt: attempt.startTime ?? context.startedAt,
          finishedAt: context.finishedAt,
          durationMs: attempt.duration,
          error: attempt.error?.message ? { message: attempt.error.message } : undefined,
          evidence: evidenceFor(attempt.attachments, context.runId, testIndex, attemptIndex),
          flakiness: flaky ? ('observed' as const) : ('unknown' as const),
        }));
      });
    });
    if (attempts.length === 0) throw new Error('Playwright report contains no test attempts');
    // The status comes from `finalOutcomes` — one entry per *test* — not from
    // `attempts`, which holds one entry per retry. A test that failed once and then
    // passed contributes a `failed` attempt and a `flaky` outcome; deriving the run
    // from attempts would report the run failed, and deriving it from the last
    // attempt alone would report it passed.
    return canonicalRunResult(
      {
        outcomes: finalOutcomes,
        attempts,
        evidence: attempts.flatMap((attempt) => attempt.evidence),
        producer: 'playwright',
        verifier: 'playwright-adapter',
      },
      context,
    );
  },
};
