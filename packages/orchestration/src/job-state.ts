/**
 * The contract state machine and the database column are **not** the same
 * vocabulary, and should not be.
 *
 * The contract describes the product's nine-state machine. The database stores
 * six. Only four names overlap, and the state machine transitions to `running`,
 * `succeeded`, `waiting_approval` and `expired` — none of which
 * `execution_jobs_state_check` permits. Nothing mapped between them, so
 * persisting a legitimate state-machine result threw a raw constraint violation
 * that surfaced as a 500.
 *
 * The fix is an explicit mapping rather than a merge: the state machine needs
 * the fidelity, the column does not, and collapsing them would either lose
 * meaning or force a migration for states the store never needs to distinguish.
 *
 * `job-state.test.ts` reads the real CHECK out of the migration and proves every
 * value this mapping can produce satisfies it, so the two cannot drift.
 */
import type { JobState } from '@automate/shared-contracts';

/**
 * The states the `execution_jobs.state` column accepts. This mirrors
 * `EXECUTION_JOB_STATES` in `packages/db/src/schema/execution.ts` and
 * `execution_jobs_state_check` in migration 0003.
 *
 * Declared here rather than imported because `packages/db` is a leaf — it
 * depends on `drizzle-orm` and `pg` and nothing else, which is what lets every
 * other package depend on it. The mirroring is verified by a test that reads the
 * constraint from the migration, so the duplication cannot go stale.
 */
export const STORED_JOB_STATES = [
  'queued',
  'leased',
  'completed',
  'failed',
  'cancelled',
  'requeued',
] as const;

export type StoredJobState = (typeof STORED_JOB_STATES)[number];

/**
 * Contract state → stored state.
 *
 * Lossy on purpose, and each lossy case is a decision rather than an accident:
 *
 * - `running` → `leased`. The column has no separate "running" state; a leased
 *   job that has begun executing is still `leased` as far as the store is
 *   concerned, and `completed_at` distinguishes the two.
 * - `succeeded` → `completed`. The column's positive terminal state.
 * - `expired` → `failed`. A lease that timed out is a failure to complete, and
 *   the store already records `runner_lost` separately for the lease-reaper
 *   case; collapsing expiry to `failed` keeps that distinction where it matters.
 * - `waiting_approval` and `cancelling` → their nearest durable states. A job
 *   awaiting approval is still `leased` (someone holds it), and one being
 *   cancelled is still `leased` until the cancellation lands. Neither is a
 *   terminal state, and neither may be reported as one.
 */
const TO_STORED: Record<JobState, StoredJobState> = {
  queued: 'queued',
  leased: 'leased',
  running: 'leased',
  waiting_approval: 'leased',
  cancelling: 'leased',
  succeeded: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  expired: 'failed',
};

/**
 * Stored state → the contract state to report.
 *
 * `completed` maps back to `succeeded` because that is the contract's name for
 * it. The mapping is not invertible — `running` and `leased` are the same stored
 * value — and callers that need the distinction must consult the job's timestamps
 * rather than this table.
 */
const FROM_STORED: Record<StoredJobState, JobState> = {
  queued: 'queued',
  leased: 'leased',
  completed: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
  // `requeued` is a store-level retry, which the contract models as going back
  // to `queued` and claiming again.
  requeued: 'queued',
};

/** Maps a contract state to the value the column accepts. */
export function toStoredJobState(state: JobState): StoredJobState {
  return TO_STORED[state];
}

/** Maps a stored value back to the contract state to report. */
export function fromStoredJobState(state: StoredJobState): JobState {
  return FROM_STORED[state];
}

/** Every stored state the mapping can produce, for the drift test to check. */
export function allMappedStoredStates(): StoredJobState[] {
  return Object.values(TO_STORED);
}
