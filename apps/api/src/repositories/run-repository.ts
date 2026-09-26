/**
 * run-repository.ts — Persistence seam for reporter run/test data
 *
 * Types are aligned with packages/db/src/schema/dashboard.ts (runs, tests tables)
 * but kept local to apps/api for the T14 vertical slice.  A real Postgres-backed
 * implementation would satisfy this same interface.
 */

// ---------------------------------------------------------------------------
// Domain types (aligned with @automate/db schema)
// ---------------------------------------------------------------------------

export type RunStatus = 'running' | 'passed' | 'failed' | 'interrupted';

export interface RunRecord {
  id: string;
  startedAt: string; // ISO-8601
  finishedAt: string | null;
  status: RunStatus;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs: number | null;
  branch: string | null;
  commitSha: string | null;
  triggeredBy: string;
}

/**
 * The status of a stored test.
 *
 * `timed_out`, not `timedOut`: the column holds the snake_case spelling, and
 * migration 0007 removed the camelCase duplicate. A test record cast straight
 * from the row was carrying both, so a `timedOut` row presented as a type the
 * database never stores — and any consumer comparing it against a real value
 * found no match.
 */
export type TestStatus =
  | 'running'
  | 'passed'
  | 'failed'
  | 'flaky'
  | 'skipped'
  | 'timed_out'
  | 'queued';

export interface TestRecord {
  id: string;
  runId: string;
  title: string;
  file: string;
  status: TestStatus;
  durationMs: number | null;
}

/**
 * Patch applied to an existing run row.
 *
 * Numeric delta fields (passedDelta, failedDelta, …) are *added* to the
 * current counter rather than replacing it — this enables safe concurrent
 * increments without a read-modify-write race.
 */
export interface RunPatch {
  status?: RunStatus;
  finishedAt?: string | null;
  durationMs?: number | null;
  /** Increment passed counter by this amount */
  passedDelta?: number;
  /** Increment failed counter by this amount */
  failedDelta?: number;
  /** Increment flaky counter by this amount */
  flakyDelta?: number;
  /** Increment skipped counter by this amount */
  skippedDelta?: number;
}

// ---------------------------------------------------------------------------
// Repository interface (the persistence seam)
// ---------------------------------------------------------------------------

/**
 * RunRepository defines the persistence contract for reporter run/test events.
 *
 * Duplicate-handling rule (deterministic):
 *   - upsertRun: same runId → overwrite the row with new values (idempotent).
 *   - upsertTest: same (testId, runId) composite key → overwrite.
 *   - patchRun: if run does not exist, the patch is a no-op (graceful).
 *   - patchTest: if test does not exist, the patch is a no-op.
 */
export interface RunRepository {
  /**
   * Insert or overwrite a run row.
   * If a run with the same `id` already exists it is replaced entirely.
   */
  upsertRun(run: RunRecord): Promise<void>;

  /**
   * Apply a patch to an existing run row.
   * Delta counter fields accumulate (add to current value).
   * No-op if run does not exist.
   */
  patchRun(id: string, patch: RunPatch): Promise<void>;

  /** Retrieve a run by id.  Returns null when not found. */
  getRun(id: string): Promise<RunRecord | null>;

  /**
   * Retrieve all run rows in insertion order.
   * Returns an empty array when no runs exist.
   */
  listRuns(): Promise<RunRecord[]>;

  /**
   * Insert or overwrite a test row.
   * Composite key is (id, runId).
   */
  upsertTest(test: TestRecord): Promise<void>;

  /**
   * Apply a status/duration patch to a test row.
   * No-op if test does not exist.
   */
  patchTest(
    testId: string,
    runId: string,
    patch: Partial<Pick<TestRecord, 'status' | 'durationMs'>>,
  ): Promise<void>;

  /** Retrieve a test by (testId, runId). Returns null when not found. */
  getTest(testId: string, runId: string): Promise<TestRecord | null>;

  /**
   * Retrieve all test rows for a given run.
   * Returns an empty array when no tests exist for the run.
   */
  listTests(runId: string): Promise<TestRecord[]>;
}
