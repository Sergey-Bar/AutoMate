import { describe, expect, it } from 'vitest';
import type { RunPhase } from '@automate/shared-contracts';
import {
  COMPLETE_OUTCOMES,
  deriveRunState,
  isRequestablePhase,
  isTerminalPhase,
  PHASE_OUTCOME,
  RUN_PHASES,
  TERMINAL_PHASES,
} from './phase-outcome.js';

/**
 * Found by mutation testing: the existing suite asserted the database invariant over the
 * phase vocabulary, but never pinned the individual fields (`terminal`, the `status` split
 * between `passed` and `failed`, the fall-back to `unknown`), so each could be flipped.
 */
const NON_TERMINAL = RUN_PHASES.filter((phase) => !TERMINAL_PHASES.includes(phase));

describe('isTerminalPhase', () => {
  it.each(TERMINAL_PHASES)('%s is terminal', (phase) => {
    expect(isTerminalPhase(phase)).toBe(true);
  });

  it.each(NON_TERMINAL)('%s is not terminal', (phase) => {
    expect(isTerminalPhase(phase)).toBe(false);
  });

  it('is false for null, undefined and a phase that does not exist', () => {
    expect(isTerminalPhase(null)).toBe(false);
    expect(isTerminalPhase(undefined)).toBe(false);
    expect(isTerminalPhase('not_a_phase' as RunPhase)).toBe(false);
  });
});

describe('isRequestablePhase', () => {
  it.each(RUN_PHASES)('accepts %s', (phase) => {
    expect(isRequestablePhase(phase)).toBe(true);
  });

  it('rejects anything that is not a known phase string', () => {
    for (const value of [undefined, null, 42, {}, [], 'gate_evaluation_x', '']) {
      expect(isRequestablePhase(value), String(value)).toBe(false);
    }
  });
});

describe('deriveRunState', () => {
  it.each(NON_TERMINAL)(
    '%s is running, outcome-less, and not terminal, whatever is claimed',
    (phase) => {
      expect(deriveRunState(phase, 'passed')).toEqual({
        phase,
        outcome: null,
        status: 'running',
        terminal: false,
      });
    },
  );

  it.each(TERMINAL_PHASES.filter((phase) => phase !== 'complete'))(
    '%s is terminal, interrupted, and implies its own outcome over any claim',
    (phase) => {
      expect(deriveRunState(phase, 'passed')).toEqual({
        phase,
        outcome: PHASE_OUTCOME[phase],
        status: 'interrupted',
        terminal: true,
      });
    },
  );

  it.each(COMPLETE_OUTCOMES)('a complete run claiming %s keeps it', (claimed) => {
    const state = deriveRunState('complete', claimed);
    expect(state).toEqual({
      phase: 'complete',
      outcome: claimed,
      status: claimed === 'passed' ? 'passed' : 'failed',
      terminal: true,
    });
  });

  it('a complete run with no valid claim is unknown and failed, never passed', () => {
    for (const claim of [undefined, null, 'nonsense', 7, { outcome: 'passed' }]) {
      expect(deriveRunState('complete', claim), String(claim)).toEqual({
        phase: 'complete',
        outcome: 'unknown',
        status: 'failed',
        terminal: true,
      });
    }
  });
});
