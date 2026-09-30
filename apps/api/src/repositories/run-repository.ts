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
import { deriveRunState } from '../execution/phase-outcome.js';
import type { RunOutcome, RunPhase } from '../execution/types.js';

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

/**
 * The workspace a single-tenant install writes and reads under.
 *
 * One export, because this value appeared in four places and the places that mattered
 * disagreed: `GET /api/v1/runs` resolved `'default-workspace'` and the reporter ingest
 * path wrote NULL, so a run created by a reporter was persisted and then invisible to
 * the listing that is supposed to show it. A constant that exists once cannot drift
 * from itself; the fix for that class of defect is not to be careful but to have
 * nothing to be careful about.
 *
 * `WORKSPACE_ID` in the configuration overrides it. Tenancy beyond this is W7 and is
 * out of scope for v1.0.0 (ADR-006).
 */
export const DEFAULT_WORKSPACE_ID = 'default-workspace';

/**
 * The lifecycle phase a reported status implies, and the state derived from it.
 *
 * **The two columns describe one run, and only one of them was being written.** The
 * reporter set `status` and left `phase` at its column default, so a run a producer had
 * reported as `passed` sat at `phase: 'queued'` for ever. Both fields were individually
 * valid and the pair was wrong, which is why nothing failed: the row was inserted, the
 * CHECK passed, and the dashboard — which renders `phase` — showed a reported run as
 * queued until the end of time. Ten of the nineteen E2E tests were asserting a terminal
 * phase and could not get one.
 *
 * `interrupted` maps to `partial` rather than `cancelled` deliberately. An interrupted
 * producer reported some evidence and then stopped; it was cancelled by nobody, and
 * `cancelled` is a claim about an actor that does not exist here. `partial` says exactly
 * what is true — evidence without a terminal verdict — and `deriveRunState` then yields
 * the honest `unknown` outcome rather than a failure nobody observed.
 *
 * The pair is derived, never assembled by a caller: the database enforces
 * `runs_phase_outcome_check`, and a caller that wrote both fields could produce a
 * combination the CHECK rejects as a 500 for a request that was merely malformed.
 *
 * @param status the reported status
 * @returns the phase, and the coherent state derived from it
 */
export function phaseForReportedStatus(status: RunStatus): {
  phase: RunPhase;
  outcome: RunOutcome;
  status: PersistedRunStatus;
} {
  const phase: RunPhase =
    status === 'running' || status === 'queued'
      ? 'running'
      : status === 'interrupted'
        ? 'partial'
        : 'complete';
  // `deriveRunState` returns the wider `RunStatus`; `toPersistedStatus` narrows it to
  // what the column accepts, and reports rather than coerces a value the column would
  // reject. The two are applied in that order so the narrowing has the last word.
  const derived = deriveRunState(phase, status);
  return {
    phase: derived.phase,
    outcome: derived.outcome,
    status: toPersistedStatus(derived.status),
  };
}

export interface RunRecord {
  id: string;
  /**
   * The workspace this run belongs to, and **required**.
   *
   * It was absent, and the reporter ingest path wrote every run with a NULL workspace
   * while `GET /api/v1/runs` filtered on the caller's workspace. A run created by a
   * reporter was therefore persisted, visible in the database, and invisible to the
   * dashboard that lists it — which is the whole reporter → API → browser path the
   * vertical slice claims to prove, and the reason eleven of the E2E tests could not
   * pass. Nothing failed loudly: the insert succeeded, and the read said there was
   * nothing there.
   *
   * Required rather than optional so the compiler names every site that has to decide
   * which workspace it is writing to. An optional field would let the next omission
   * write NULL again and the defect would return with no signal.
   */
  workspaceId: string;
  /**
   * The lifecycle phase, and **required**.
   *
   * The reporter wrote `status` and left `phase` at its column default of `queued`, so a
   * run a producer had reported as `passed` sat at `phase: 'queued'` forever. The two
   * columns describe the same run, the dashboard renders `phase`, and nothing failed: the
   * row was correct on both fields separately and wrong together. `deriveRunState` owns
   * the pair — the database enforces `runs_phase_outcome_check` — so a caller supplies a
   * phase and lets the vocabulary derive the outcome, rather than writing both and
   * hoping.
   */
  phase: import('../execution/types.js').RunPhase;
  /** Derived from `phase`; never written independently. */
  outcome: import('../execution/types.js').RunOutcome;
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
  /**
   * The lifecycle phase, and the outcome that goes with it.
   *
   * `run:end` patched `status` and nothing else, so a run that finished kept the
   * `phase: 'queued'` it was inserted with. The dashboard renders `phase`, so a
   * completed run was shown as queued for ever — and ten E2E tests asserting a terminal
   * phase could not get one. Both fields are written together because
   * `runs_phase_outcome_check` requires the pair to agree: a terminal phase with a null
   * outcome is rejected as a 500 for a request that was merely malformed.
   */
  phase?: RunPhase;
  outcome?: RunOutcome;
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
   * Retrieve run rows in insertion order, optionally capped.
   *
   * `limit` exists because `GET /api/v1/runs` merges this into a page it has
   * already bounded, and reading the whole table to truncate it afterwards holds
   * every row in Node — the cost the page's cap existed to avoid (ledger Q-50).
   * Omitting it means "all", which is what the other callers want and what they
   * got before.
   */
  listRuns(options?: { limit?: number }): Promise<RunRecord[]>;

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

  /**
   * Retrieve test rows for many runs at once, grouped by `runId`.
   *
   * Exists because the dashboard aggregations used to loop over runs and call
   * {@link listTests} once each — one query for the runs and then N for the tests,
   * so a dashboard with a thousand runs cost a thousand round trips to answer
   * "what tests exist" (ledger Q-47). One call is one round trip regardless of how
   * many runs are asked about.
   *
   * Returns a `Map` rather than a flat array because both callers need the
   * grouping: the suites route attributes each test to the run it came from, and a
   * flat array would make that a second pass over the data the query already
   * grouped. An empty `runIds` issues no query at all.
   */
  listTestsForRuns(runIds: readonly string[]): Promise<Map<string, TestRecord[]>>;
}
