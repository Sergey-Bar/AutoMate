/**
 * legacy-upload.ts — the flat upload payload, parsed onto the canonical model.
 *
 * `POST /api/v1/reporter/upload` accepts two body shapes, and this is the one that is not
 * a producer's own report. A caller posting JSON is speaking Automate's upload wire
 * format — `{ runId, tests[], status?, branch?, commitSha?, … }` — rather than handing us
 * a Playwright or JUnit document, and the route used to parse it into `runs`/`tests` rows
 * with its own status mapping. That made it the second ingestion system: the same test,
 * reported through this door and through a JUnit upload, landed in two different tables
 * and could be given two different statuses.
 *
 * So the wire schema lives here now, next to the parser that uses it, and the result is a
 * `CanonicalRunResult` like every other door's. The route reads bytes, picks an adapter,
 * and stops.
 *
 * **It is an adapter and not a special case, because that is what makes it testable
 * against the same corpus as the others.** The wire format is `legacy` in
 * `ProvenanceSchema` already, which is the strongest evidence that it was always meant
 * to be one.
 */

import { ReporterUploadSchema, type ReporterUploadPayload } from '@automate/shared-contracts';
import type { CanonicalRunResult } from '@automate/shared-contracts';
import type { ProducerAdapter, ProducerContext } from '../adapter.js';
import { canonicalRunResult } from '../canonical-run-result.js';
import {
  canonicalRunStatusFrom,
  canonicalTestStatusFrom,
  flakinessFrom,
} from '../producer-status.js';
import { safeRelativePath } from '../safe-path.js';

export type { ReporterUploadPayload };

/**
 * Decode an upload body, or refuse it by name.
 *
 * A named `Error` rather than a raw `SyntaxError`, matching every other adapter refusal:
 * a caller that cannot distinguish "your JSON is malformed" from "your adapter threw"
 * cannot report either to the person who has to fix it.
 */
export function parseReporterUploadPayload(text: string): ReporterUploadPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new Error('Reporter upload is not valid JSON', { cause });
  }
  const parsed = ReporterUploadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Reporter upload does not match the upload contract: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
    );
  }
  return parsed.data;
}

/**
 * The upload adapter.
 *
 * `parse` takes bytes because `ProducerAdapter` does, and because the route should not
 * need to know whether a body arrived as multipart or as JSON to hand over the same
 * thing.
 */
export const legacyUploadAdapter: ProducerAdapter = {
  mediaType: 'application/json',
  parse(input: Uint8Array, context: ProducerContext): CanonicalRunResult {
    const payload = parseReporterUploadPayload(new TextDecoder().decode(input));

    // No rows at all is not a run result. `CanonicalRunResultSchema` requires at least one
    // attempt, and it is right to: a report with no observable attempt has observed
    // nothing, and synthesising an attempt for it would invent a test that never ran. The
    // refusal names the cause, because "your report was empty" is actionable and a
    // non-green run row is not.
    if (payload.tests.length === 0) {
      throw new Error('Reporter upload declares no test rows, so it is not a run result');
    }

    const startedAt = payload.startedAt ?? context.startedAt;
    const finishedAt = payload.finishedAt ?? context.finishedAt;

    // The ordinal is per `testId`, not a running counter across the body, so a row that
    // re-reports an existing test becomes its second attempt rather than claiming ordinal 7.
    // `CanonicalRunResultSchema` requires 1..n per `testId`, and a running counter fails the
    // whole upload for a re-reported test.
    const ordinals = new Map<string, number>();
    const retried = new Set<string>();
    const attempts = payload.tests.map((test) => {
      const testId = test.id ?? test.testId ?? '';
      const index = (ordinals.get(testId) ?? 0) + 1;
      if (index > 1) retried.add(testId);
      ordinals.set(testId, index);
      const specPath = test.file === '' ? 'unknown.spec.ts' : safeRelativePath(test.file);
      return {
        index,
        testId,
        specPath,
        title: test.title,
        status: canonicalTestStatusFrom('legacy', test.status),
        rawStatus: test.status,
        startedAt,
        finishedAt,
        durationMs: test.durationMs ?? undefined,
        error: test.error?.message ? { message: test.error.message } : undefined,
        evidence: [],
        flakiness:
          flakinessFrom(test.status) === 'observed' || retried.has(testId)
            ? ('observed' as const)
            : ('unknown' as const),
      };
    });

    // What the run's status is derived from: **one outcome per test**, the last one it
    // reported — plus any claim the producer made about the run that the rows cannot
    // overrule.
    //
    // Collapsing retries is not tidiness, it is the ladder. `runStatusFrom` says a retry
    // history is not a set of independent tests, and the JUnit adapter already reads a
    // repeated `<testcase>` as one test with several attempts. A producer that reports the
    // same `testId` twice here has done the same thing, so a failed-then-passed upload is a
    // flaky test — not a run with a failure and a pass in it.
    const finalByTestId = new Map<string, (typeof attempts)[number]>();
    for (const attempt of attempts) finalByTestId.set(attempt.testId, attempt);
    const outcomes = [...finalByTestId.values()].map((attempt) => {
      // A retried test that ended green is `flaky`, not `passed`. The verdict exists and is
      // not one a release should be read from — which is exactly what `flakiness: 'observed'`
      // on the attempt records, and reading the run as green while the attempt says
      // "observed" is how a lucky run becomes a green one.
      if (
        retried.has(attempt.testId) &&
        (attempt.status === 'passed' || attempt.status === 'skipped')
      ) {
        return 'flaky' as const;
      }
      return attempt.status;
    });

    // A declared status is honoured as a *claim*, and a claim cannot outrank the rows it
    // describes. The body's own `status` wins over the form field's when both are present:
    // this wire format *is* the payload, so what it says about itself is more specific
    // than what the multipart envelope around it says.
    if (payload.status !== undefined) {
      outcomes.push(canonicalRunStatusFrom(payload.status));
    }

    // The declared summary is a claim about the rows too, and it used to be read as
    // `summary?.failed ?? derived.failed` — a preference for the client. A body carrying
    // one failing row and `summary: { total: 99, passed: 99, failed: 0 }` derived
    // `passed`, because the declared `failed: 0` suppressed the row-derived `1`, so a
    // client could turn a failing suite green by attaching a summary that disagreed with
    // its own rows. A summary that declares more failures than the rows show is
    // therefore taken at its word; a summary that declares *fewer* is already covered,
    // because the rows themselves are already in the list.
    if ((payload.summary?.failed ?? 0) > 0) outcomes.push('failed');

    return canonicalRunResult(
      {
        outcomes,
        attempts,
        producer: 'legacy',
        verifier: 'legacy-upload-adapter',
      },
      {
        ...context,
        // **The body's own `runId`, not the context's.** A JUnit document carries no run
        // id — the caller supplies it — but this wire format *is* the payload, and it names
        // its own run. Reading the context instead meant a caller posting
        // `{ runId: 'upload-run-001' }` with no multipart fields got a run whose identity
        // was derived from its bytes, so the id it asked for and the id it got differed.
        runId: payload.runId,
        startedAt,
        finishedAt,
        branch: payload.branch ?? context.branch,
        commitSha: payload.commitSha ?? context.commitSha,
        environment: payload.environment ?? context.environment,
      },
    );
  },
};
