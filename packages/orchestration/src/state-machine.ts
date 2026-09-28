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

/**
 * A lease's fencing token: a counter the store increments on every grant.
 *
 * The mechanism is a monotonic counter rather than a timestamp, because a clock is
 * not monotonic across two processes and a fencing token only has to be *newer*.
 */
export type FencingToken = number;

/**
 * What a caller knows about a job, and what it is asking to do to it.
 *
 * The two halves are read from different places and that is the point. `state` and
 * `current` come from the row the store gave back; `held` is what the caller was
 * handed with its lease. A caller that supplied `state` itself would be making a
 * second claim about the state, and the two could disagree — the same trap the
 * quarantine store documents at `drizzle-stores.ts:223-226`.
 */
export interface JobFence {
  /** The job's state as read from the store, never as supplied by the caller. */
  readonly state: JobState;
  /** The newest token the store has issued for this job. */
  readonly current: FencingToken;
  /** The token this caller was given with its lease. */
  readonly held: FencingToken;
}

/** Why a transition was refused. Both are refusals; neither is an error. */
export type TransitionRefusal =
  /** The caller has been superseded: a newer lease was issued after this one. */
  | { readonly reason: 'fenced_out'; readonly held: FencingToken; readonly current: FencingToken }
  /** The transition is not in the table, whatever the caller holds. */
  | { readonly reason: 'illegal'; readonly from: JobState; readonly to: JobState };

/** The outcome of asking the machine to move a job. */
export type TransitionDecision =
  | { readonly allowed: true; readonly state: JobState }
  | ({ readonly allowed: false } & TransitionRefusal);

/**
 * Whether this caller's lease is still the newest one.
 *
 * Equality, not `>=`. A token that is *newer* than the store's current one means the
 * caller has a token the store never issued, which is a defect somewhere upstream and
 * must not be treated as authority.
 */
export function holdsFence(fence: JobFence): boolean {
  return fence.held === fence.current;
}

/**
 * The decision a state transition actually needs, which is not a question about states.
 *
 * `canTransition` answers "is `running → succeeded` a legal edge?", and the answer is
 * yes, always. What a caller needs to know is "may *I* make that edge *now*", and that
 * is two questions: is the edge in the table, and is my lease still the newest one. A
 * worker whose lease expired mid-run and was handed to somebody else still holds a
 * token that is perfectly valid-looking, and the table cannot tell the two callers
 * apart — only the comparison can.
 *
 * Fencing is checked before legality on purpose. An illegal transition is a bug
 * either way, and naming the fence first is what stops a superseded worker from
 * learning anything useful about the job it no longer owns.
 */
export function decideTransition(fence: JobFence, to: JobState): TransitionDecision {
  if (!holdsFence(fence)) {
    return { allowed: false, reason: 'fenced_out', held: fence.held, current: fence.current };
  }
  if (!canTransition(fence.state, to)) {
    return { allowed: false, reason: 'illegal', from: fence.state, to };
  }
  return { allowed: true, state: to };
}

/** The fence an unowned caller holds: the control plane has no lease to be fenced out of. */
export function unownedFence(state: JobState): JobFence {
  return { state, current: 0, held: 0 };
}
