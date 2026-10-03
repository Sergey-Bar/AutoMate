/**
 * reporter-event-canonical.ts — a run's event stream, turned into one canonical result.
 *
 * `POST /api/v1/reporter/events` is the streaming door. A stream cannot be a
 * `CanonicalRunResult` until it ends, because the contract's answer to "how did this run
 * go?" is a whole-run claim, and a claim made at `test:begin` about a run with 400 tests
 * left is not a claim. So the events door writes incrementally — it has to, because the
 * dashboard renders a run while it runs and 19 E2E tests assert a live transition — and
 * **this module closes the canonical row when the terminal event arrives.**
 *
 * **The accumulation reads the rows the events already wrote rather than keeping a second
 * copy in memory.** An in-memory accumulator would be a second authority that survives
 * exactly as long as the process does: restart it halfway through a run and the canonical
 * row is never written for that run, with nothing recording that it was skipped. Reading
 * back what was persisted means the canonical result is derived from durable evidence, and
 * a restart changes nothing about the answer.
 *
 * **What that costs, stated plainly.** The canonical result's per-attempt detail is read
 * back from `tests`, which holds one row per *test* — the run's own identity for a
 * retried test is the same row. So a stream's canonical result records each test's final
 * attempt rather than every attempt it took, and `flakiness` has to be recovered from the
 * `runs.flaky` counter rather than from per-attempt evidence. That is a real loss of
 * fidelity, and it is why the upload door remains the better-fed one. It is not a reason to
 * leave the door out of the canonical model: a run whose evidence reaches no KPI at all is
 * worse than one whose attempts are summarised.
 */

import { createHash } from 'node:crypto';
import type { CanonicalRunResult } from '@automate/shared-contracts';
import {
  canonicalRunResult,
  canonicalTestStatusFrom,
  flakinessFrom,
  type CanonicalAttemptInput,
} from '@automate/reporter';
import type { RunRepository, TestRecord, TestStatus } from '../repositories/run-repository.js';

/** The adapter version recorded on results this module produces. */
const ADAPTER_VERSION = '2';

/**
 * `tests.status` → the producer's own name for it.
 *
 * The ladder in `@automate/reporter` maps producer vocabulary to canonical status, and the
 * stream has already been through it once — `TestEndPayloadSchema` accepts `passed`,
 * `failed`, `flaky`, `skipped` and `timedOut`, and `toStoredTestStatus` collapses the two
 * timeout spellings on the way into the column. So the reverse mapping is a spelling
 * change, not a second judgement about what a status means, which is why it is written as
 * a rename rather than as a table of decisions.
 */
const PRODUCER_STATUS_BY_TEST_STATUS: Record<TestStatus, string> = {
  passed: 'passed',
  failed: 'failed',
  flaky: 'flaky',
  skipped: 'skipped',
  timed_out: 'timedOut',
  // "Declared, no outcome observed" — the producer spelling of an unobserved test.
  running: 'running',
  queued: 'queued',
};

/**
 * The canonical result for a run whose events have all been persisted.
 *
 * Returns `undefined` when the run has no test rows. A run with no observable attempt is
 * not a run result — the same refusal the upload adapters make — and inventing an attempt
 * for it would record a test that never ran.
 */
export async function canonicalRunFromUploadEvents(
  repository: RunRepository,
  identity: { workspaceId: string; runId: string },
): Promise<CanonicalRunResult | undefined> {
  const [run, tests] = await Promise.all([
    repository.getRun(identity.runId),
    repository.listTests(identity.runId),
  ]);
  if (run === null || tests.length === 0) return undefined;

  const attempts: CanonicalAttemptInput[] = tests
    // Ordered so the attempt ordinal is deterministic: `listTests` has no guaranteed
    // order, and `CanonicalRunResultSchema` requires 1..n per `testId`, so an unordered
    // list could only be numbered by accident.
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((test) => attemptFor(test, run.startedAt, run.finishedAt));

  const outcomes = attempts.map((attempt) => attempt.status);

  // **The run row's own status is deliberately not read.** It looks like a claim and is not
  // one: `runs.status` is the projection's four-value narrowing of a canonical status, and
  // nine canonical statuses narrow to `interrupted` — so reading it back would copy the
  // projection's opinion into the row that is supposed to be its authority, and a flaky run
  // would come back as `cancelled`. The durable evidence is the test rows.
  //
  // What *is* read is terminal-ness. A run whose row says `running` has produced no verdict
  // at all, so deriving one from the tests that have reported so far is deriving it from a
  // partial view — which is why `running` is the one claim that outranks the rows.
  if (run.status === 'running') outcomes.push('running');

  return canonicalRunResult(
    {
      outcomes,
      attempts,
      producer: 'legacy',
      verifier: 'reporter-events-canonical',
    },
    {
      workspaceId: identity.workspaceId,
      runId: run.id,
      sourceUri: 'reporter/events',
      // A stream has no single document to digest, so the digest is over the run's own
      // identity and the attempts it reported. `DigestSchema` requires a SHA-256 hex
      // string, and a constant would make every streamed run in the installation
      // fingerprint identically — which is the defect `digestRunOutcome` was written to
      // end, reintroduced on the other door.
      sourceDigest: digestOf(run.id, attempts),
      producerVersion: 'events',
      adapterVersion: ADAPTER_VERSION,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? undefined,
      branch: run.branch ?? undefined,
      commitSha: run.commitSha ?? undefined,
    },
  );
}

function attemptFor(
  test: TestRecord,
  startedAt: string,
  finishedAt: string | null,
): CanonicalAttemptInput {
  const rawStatus = PRODUCER_STATUS_BY_TEST_STATUS[test.status];
  return {
    index: 1,
    testId: test.id,
    // The projection already reduced the path on the way in, so this is the value the
    // canonical contract validated, not a second reduction of the same string.
    specPath: test.file === '' ? 'unknown.spec.ts' : test.file,
    title: test.title,
    status: canonicalTestStatusFrom('legacy', rawStatus),
    rawStatus,
    startedAt,
    finishedAt: finishedAt ?? undefined,
    durationMs: test.durationMs ?? undefined,
    error: test.errorMessage === null ? undefined : { message: test.errorMessage },
    evidence: [],
    flakiness: flakinessFrom(rawStatus),
  };
}

function digestOf(runId: string, attempts: readonly CanonicalAttemptInput[]): string {
  const shape = attempts.map((attempt) => [
    attempt.testId,
    attempt.index,
    attempt.status,
    attempt.rawStatus,
  ]);
  return createHash('sha256')
    .update(JSON.stringify([runId, shape]), 'utf8')
    .digest('hex');
}
