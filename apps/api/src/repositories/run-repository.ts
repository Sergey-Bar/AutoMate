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

import { PERSISTED_RUN_STATUS_VALUES, RUN_STATUS_VALUES } from '@automate/shared-contracts';

/**
 * The run statuses this repository persists.
 *
 * Derived from the contract rather than restated, because the list existed here
 * in one variant and in `shared-contracts` in another — the contract accepted
 * `queued` while the `runs_status_check` constraint rejected it.
 *
 * The **write** side is the persisted subset, because that is what the column
 * accepts. The read side is the wider `RunStatus`, so a row written by something
 * else can still be represented. Splitting them is what stops a `queued` from
 * reaching the insert and failing as a 500 at runtime.
 */
export type RunStatus = (typeof RUN_STATUS_VALUES)[number];

/** What `runs.status` will actually store. */
export type PersistedRunStatus = (typeof PERSISTED_RUN_STATUS_VALUES)[number];

/**
 * Narrows a read status to one the column will store.
 *
 * A row read back from the database should never carry `queued` — the column
 * forbids it — so a value that does is a real inconsistency between the
 * contract and the store. It is reported rather than coerced: silently mapping it
 * to something plausible is how a wrong status becomes a green run.
 */
export function toPersistedStatus(status: RunStatus): PersistedRunStatus {
  if ((PERSISTED_RUN_STATUS_VALUES as readonly string[]).includes(status)) {
    return status as PersistedRunStatus;
  }
  throw new Error(
    `Run status "${status}" is not one the runs.status column stores ` +
      `(${PERSISTED_RUN_STATUS_VALUES.join(', ')}). A read row is inconsistent with the schema.`,
  );
}

export interface RunRecord {
  id: string;
  startedAt: string; // ISO-8601
  finishedAt: string | null;
  /** The persisted subset: this is written straight to `runs.status`. */
  status: PersistedRunStatus;
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
  /** The persisted subset: this becomes a `runs.status` write. */
  status?: PersistedRunStatus;
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
export interface RunAnalyticsSummary {
  totalRuns: number;
  /** Percentage, 0–100, over completed runs only. */
  passRate: number;
  /** Mean of the runs that recorded a duration; null when none did. */
  avgDurationMs: number | null;
}

/**
 * The dashboard's three numbers, from the runs.
 *
 * Exported so the in-memory repository and the SQL one cannot disagree about
 * what they mean: the pass rate is over **completed** runs only, so a run still
 * executing is not silently counted as a failure, and the average is over runs
 * that recorded a duration and is `null` when none did — not zero, which would
 * read as "instant".
 *
 * The SQL implementation must produce these same numbers; `analytics-parity.test.ts`
 * holds the two to each other against a real database.
 */
export function aggregateRuns(runs: Iterable<RunRecord>): RunAnalyticsSummary {
  let totalRuns = 0;
  let completed = 0;
  let passed = 0;
  let durationTotal = 0;
  let durationCount = 0;
  for (const run of runs) {
    totalRuns += 1;
    if (run.status === 'passed' || run.status === 'failed') {
      completed += 1;
      if (run.status === 'passed') passed += 1;
    }
    if (run.durationMs !== null && run.durationMs !== undefined) {
      durationTotal += run.durationMs;
      durationCount += 1;
    }
  }
  return {
    totalRuns,
    passRate: completed === 0 ? 0 : Math.round((passed / completed) * 100),
    avgDurationMs: durationCount === 0 ? null : Math.round(durationTotal / durationCount),
  };
}

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
   * The dashboard's three numbers, aggregated.
   *
   * A method rather than three, because the alternative was `listRuns()` on the
   * dashboard's first request — which loads **every run in the installation** into
   * memory to compute a count, a percentage and an average. The cost grew with
   * how long the install had been running, and it grew on the page an operator
   * opens first after an incident.
   *
   * `passRate` is over completed runs only (`passed` and `failed`), so a run still
   * executing is not counted as a failure. `avgDurationMs` is over runs with a
   * recorded duration, and is null when none has one — not zero, which would read
   * as "instant".
   */
  getAnalyticsSummary(): Promise<RunAnalyticsSummary>;

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
