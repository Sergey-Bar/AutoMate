import type { RunOutcome, RunPhase } from './types.js';
import type { LeaseReapResult } from './types.js';

/**
 * What one expired lease resolves to, and where it lands.
 *
 * ## Pure, shared, and the reason both stores can agree
 *
 * A lease that expires is the moment a job either goes back in the queue or
 * stops, and the two stores — Drizzle and in-memory — each had to decide it. Two
 * implementations of the same table is how they drift: one store requeues a
 * cancelled job, and the bug is invisible until an operator sees a cancelled run
 * execute twice.
 *
 * So the table lives here, once, and both stores apply it. The parity suite in
 * `store-parity.test.ts` is what pins the *behaviour*; this module is why there
 * is only one behaviour to pin.
 *
 * ## The three outcomes, and the one that is not "failed"
 *
 * - **cancelled** — the job was asked to stop, so it does not run again and its
 *   run is terminal as a cancellation, not as a runner loss. An operator's
 *   decision has to survive the lease.
 * - **requeued** — the job is available again, with its attempt advanced. A
 *   transient runner death is the ordinary case, and three attempts is the
 *   ordinary ceiling.
 * - **failed** — three attempts gone, so the run is `runner_lost`: the work
 *   stopped because its runner did, and a reader must be able to tell that
 *   apart from a suite that failed.
 */
export function reapOutcome(
  cancelRequested: boolean,
  attempt: number,
  maxAttempts = 3,
): {
  canRequeue: boolean;
  attempt: number;
  jobState: 'cancelled' | 'queued' | 'failed';
  phase: RunPhase;
  outcome: RunOutcome | null;
  status: 'running' | 'interrupted';
  result: Pick<LeaseReapResult, 'requeued' | 'phase' | 'status'>;
} {
  const canRequeue = !cancelRequested && attempt < maxAttempts;
  const phase: RunPhase = cancelRequested ? 'cancelled' : canRequeue ? 'queued' : 'runner_lost';
  const status = canRequeue ? 'running' : 'interrupted';
  const jobState: 'cancelled' | 'queued' | 'failed' = cancelRequested
    ? 'cancelled'
    : canRequeue
      ? 'queued'
      : 'failed';
  return {
    canRequeue,
    attempt: canRequeue ? attempt + 1 : attempt,
    jobState,
    phase,
    outcome: cancelRequested ? 'cancelled' : canRequeue ? null : 'runner_lost',
    status,
    result: {
      requeued: canRequeue,
      phase,
      status: cancelRequested ? 'cancelled' : canRequeue ? 'queued' : 'failed',
    },
  };
}
