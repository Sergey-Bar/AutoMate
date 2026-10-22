import { describe, expect, it } from 'vitest';
import type { JobState } from '@automate/shared-contracts';
import { canTransition, isTerminal, transition } from './state-machine.js';

/**
 * The whole transition table, written out a second time on purpose.
 *
 * Found by mutation testing: twenty of the table's string literals could be replaced by
 * `''` and its terminal rows by a non-empty array, and every existing case still passed,
 * because they spot-checked five edges of a 9 x 9 relation. This states every edge, so a
 * state that silently stops being reachable (or becomes reachable) fails here by name.
 * It is a deliberate duplicate of the table: the point is that changing the machine
 * means changing two places and reading both.
 */
const EXPECTED: Record<JobState, readonly JobState[]> = {
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
const STATES = Object.keys(EXPECTED) as JobState[];

describe('the job transition table, edge by edge', () => {
  it.each(STATES)('%s allows exactly its listed successors', (from) => {
    for (const to of STATES) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(EXPECTED[from].includes(to));
    }
  });

  it.each(STATES)('%s is terminal exactly when it has no successor', (state) => {
    expect(isTerminal(state)).toBe(EXPECTED[state].length === 0);
  });

  it('names both states in the refusal, so a log line says which edge was illegal', () => {
    expect(() => transition('succeeded', 'failed')).toThrow(
      'Invalid job transition: succeeded -> failed',
    );
  });

  it('returns the destination for a legal edge and not the origin', () => {
    expect(transition('queued', 'leased')).toBe('leased');
  });

  it('treats an unrecognised state as having no way out, without throwing a TypeError', () => {
    expect(canTransition('nonsense' as JobState, 'queued')).toBe(false);
    expect(isTerminal('nonsense' as JobState)).toBe(true);
  });
});
