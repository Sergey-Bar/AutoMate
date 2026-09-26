import type { JobState } from '@automate/shared-contracts';

const transitions: Record<JobState, readonly JobState[]> = {
  queued: ['leased', 'cancelled', 'expired'],
  leased: ['running', 'queued', 'expired', 'cancelled'],
  running: ['waiting_approval', 'cancelling', 'succeeded', 'failed', 'cancelled', 'expired'],
  waiting_approval: ['running', 'cancelling', 'failed', 'cancelled'],
  cancelling: ['cancelled', 'failed'],
  succeeded: [],
  failed: [],
  cancelled: [],
  expired: [],
};

/**
 * Whether `from → to` is a legal transition.
 *
 * Total: an unrecognised `from` is not a legal origin, so this returns `false`
 * rather than reading `transitions[from].includes(...)` on `undefined`. That
 * turned a malformed state into a `TypeError` in the middle of a cancellation,
 * which is the worst place for a crash — the caller's intent ("cancel this job")
 * was perfectly reasonable.
 */
export function canTransition(from: JobState, to: JobState): boolean {
  const allowed = transitions[from];
  if (allowed === undefined) return false;
  return allowed.includes(to);
}

export function transition(from: JobState, to: JobState): JobState {
  if (!canTransition(from, to)) throw new Error(`Invalid job transition: ${from} -> ${to}`);
  return to;
}

/** True when no further transition out of `state` is possible. */
export function isTerminal(state: JobState): boolean {
  return (transitions[state] ?? []).length === 0;
}
