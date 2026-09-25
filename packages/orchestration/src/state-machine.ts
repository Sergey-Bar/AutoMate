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

export function canTransition(from: JobState, to: JobState): boolean {
  return transitions[from].includes(to);
}

export function transition(from: JobState, to: JobState): JobState {
  if (!canTransition(from, to)) throw new Error(`Invalid job transition: ${from} -> ${to}`);
  return to;
}

export function isTerminal(state: JobState): boolean {
  return transitions[state].length === 0;
}
