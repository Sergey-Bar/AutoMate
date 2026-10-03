import type { CanonicalRunResult } from '@automate/shared-contracts';

/**
 * Everything a producer has to say about *where* a result came from, as distinct from
 * what the result says.
 *
 * Attribution is not optional. A release gate that cannot name the adapter version which
 * produced a verdict cannot answer "did this get worse, or did we change how we read the
 * report" — and that question is unanswerable *after the fact*, which is the only time
 * anybody asks it.
 */
export interface ProducerContext {
  workspaceId: string;
  runId: string;
  projectId?: string;
  sourceUri: string;
  sourceDigest: string;
  producerVersion: string;
  adapterVersion: string;
  startedAt: string;
  finishedAt?: string;
  /**
   * The cohort, when the producer knows it.
   *
   * Declared on the context rather than read from the document because a JUnit file
   * carries no branch — the *job* knows, and the job is what the context is. Absent is an
   * honest answer for a report uploaded by hand.
   */
  branch?: string;
  commitSha?: string;
  environment?: string;
  /**
   * What the *job* says about the run, when it says anything.
   *
   * A producer document never states its own run status — a JUnit file has no run in it, and
   * a Playwright report has no verdict — but the job wrapping one does, and its
   * `status=running` is how a streaming uploader says "this is a partial report". It rides
   * here rather than in the document because that is where the information lives.
   *
   * It is a **claim**, and it goes onto the same ladder as the tests' own outcomes rather
   * than over them. Only one claim outranks them, and that is `running`: a run that has not
   * finished has no verdict to derive, so deriving one from the tests that have reported so
   * far is deriving it from a partial view.
   */
  declaredRunStatus?: string;
}

export interface ProducerAdapter {
  readonly mediaType: string;
  parse(input: Uint8Array, context: ProducerContext): CanonicalRunResult;
}
