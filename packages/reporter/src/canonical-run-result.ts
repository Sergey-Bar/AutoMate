/**
 * canonical-run-result.ts — the one serialiser and the one status ladder.
 *
 * `playwright-json.ts` and `junit-xml.ts` each hand-built a complete
 * `CanonicalRunResultSchema.parse({ … })` envelope. Nine of the fields were
 * identical boilerplate copied from `ProducerContext` — `contractVersion`,
 * `identity`, `startedAt`, `finishedAt`, `provenance`, `retention`, `proof`,
 * `completeness`, `raw` — so there were two places to change every time the
 * contract added a field, and a new adapter would be written by copying whichever
 * one was open.
 *
 * The status ladder was worse, because the two copies did not agree.
 *
 * Playwright:  `failed → unknown → skipped → flaky → passed`
 * JUnit:       `failed → unknown → skipped → passed`          ← no `flaky` rung
 *
 * And JUnit's own `statusFrom` **can return `flaky`** — `<rerunFailure>` is the
 * documented JUnit way of saying a test failed once and passed on a retry, and the
 * adapter reads it. So a JUnit report whose only interesting property was a flaky
 * test was serialised with `status: 'passed'`, while the same tests from a
 * Playwright report were serialised with `status: 'flaky'`. The identical outcome
 * had two answers depending on which producer wrote the file, and a release gate
 * reading the run status would see a green run where there was a retry.
 *
 * So the ladder is now one function, and the serialiser is one function. JUnit no
 * longer has a rung to forget, because there is no ladder to edit.
 */

import { CanonicalRunResultSchema, type CanonicalRunResult } from '@automate/shared-contracts';
import type { ProducerContext } from './adapter.js';

export type CanonicalStatus = CanonicalRunResult['status'];
export type CanonicalAttempt = NonNullable<CanonicalRunResult['attempts']>[number];

/**
 * The run's status, from the outcome of each test.
 *
 * Ordered most-severe first, and the order is the argument: a run containing both a
 * failure and an unknown is `failed`, because "some tests are known broken" is a
 * stronger statement than "some tests are unobserved", and reporting the unknown
 * would hide the failure behind a softer label.
 *
 * `skipped` requires *every* test to be skipped — a run with one skipped test and
 * the rest passed is a run with a pass, not a skipped run.
 *
 * `flaky` sits above `passed` and below `skipped`: a test that needed a retry
 * reached a verdict, but the verdict is not trustworthy, and calling that `passed` is
 * how a lucky run is reported as a green one.
 */
export function runStatusFrom(outcomes: readonly CanonicalStatus[]): CanonicalStatus {
  if (outcomes.some((status) => status === 'failed' || status === 'timedOut')) return 'failed';
  if (outcomes.some((status) => status === 'unknown')) return 'unknown';
  if (outcomes.some((status) => status === 'cancelled')) return 'cancelled';
  if (outcomes.every((status) => status === 'skipped')) return 'skipped';
  if (outcomes.some((status) => status === 'flaky')) return 'flaky';
  return 'passed';
}

/** One attempt, assembled with the fields every adapter fills identically. */
export interface CanonicalAttemptInput {
  index: number;
  testId: string;
  specPath: string;
  title: string;
  status: CanonicalStatus;
  rawStatus: string;
  startedAt: string;
  /**
   * Optional, matching `AttemptSchema.finishedAt` in the contract.
   *
   * `ProducerContext.finishedAt` is optional too, and the adapters passed it straight
   * through — so a report ingested without a declared finish time produced an attempt
   * with none, and that is the correct reading: the producer did not say when the
   * attempt ended. Inventing one from `startedAt` would make a still-running test
   * look like it had a duration, and a duration is what the dashboard charts.
   */
  finishedAt?: string;
  suite?: string;
  durationMs?: number;
  error?: { message: string };
  evidence?: CanonicalAttempt['evidence'];
  flakiness: 'unknown' | 'observed';
}

export interface CanonicalRunResultInput {
  /** The outcome of each *test*, not of each attempt. */
  outcomes: readonly CanonicalStatus[];
  attempts: readonly CanonicalAttemptInput[];
  /** Adapter-specific additions to `provenance`, such as Playwright's `project`. */
  provenance?: Record<string, unknown>;
  /** The whole result's evidence, when it is not simply every attempt's. */
  evidence?: CanonicalRunResult['evidence'];
  /** The producer writing the result, e.g. `'playwright'` or `'junit'`. */
  producer: string;
  /** A human-readable name for this adapter, recorded in `proof.verifier`. */
  verifier: string;
}

/**
 * Builds the canonical result, and validates it.
 *
 * `completeness.state` is derived from the same `unknown` signal the status ladder
 * uses, rather than passed in: a run with an unobserved test and a completeness claim
 * of `complete` would be two fields contradicting each other, and the second one is
 * what a consumer reads to decide whether the evidence is enough to trust the status.
 *
 * `proof.state` is always `unverified`. An adapter that has parsed a report has
 * verified that the report parses; it has not verified that the report describes
 * the run it claims to. A future producer that *can* verify passes its own state
 * through `proof` rather than this function hardcoding the safe answer.
 */
export function canonicalRunResult(
  input: CanonicalRunResultInput,
  context: ProducerContext,
): CanonicalRunResult {
  const hasUnknown = input.outcomes.some((status) => status === 'unknown');
  const attempts: CanonicalAttempt[] = input.attempts.map((attempt) => ({
    index: attempt.index,
    testId: attempt.testId,
    specPath: attempt.specPath,
    title: attempt.title,
    suite: attempt.suite,
    status: attempt.status,
    rawStatus: attempt.rawStatus,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    durationMs: attempt.durationMs,
    error: attempt.error,
    evidence: attempt.evidence ?? [],
    flakiness: attempt.flakiness,
  }));

  return CanonicalRunResultSchema.parse({
    contractVersion: '2',
    identity: {
      runId: context.runId,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
    },
    status: runStatusFrom(input.outcomes),
    startedAt: context.startedAt,
    // Absent when the producer declared none. Not derived from the last attempt:
    // `context.finishedAt` is a statement about the run, and borrowing the last
    // attempt's end time would state something the producer never said.
    finishedAt: context.finishedAt,
    attempts,
    evidence: input.evidence ?? attempts.flatMap((attempt) => attempt.evidence ?? []),
    provenance: {
      producer: input.producer,
      producerVersion: context.producerVersion,
      adapterVersion: context.adapterVersion,
      sourceDigest: context.sourceDigest,
      sourceUri: context.sourceUri,
      project: context.projectId,
      ...input.provenance,
    },
    retention: { class: 'standard' },
    proof: {
      state: 'unverified',
      digest: context.sourceDigest,
      verifier: input.verifier,
    },
    completeness: {
      state: hasUnknown ? 'unknown' : 'complete',
      missingShards: [],
      duplicateShards: [],
    },
    raw: {},
  });
}
