import { describe, expect, it } from 'vitest';
import {
  deriveRunState,
  isRequestablePhase,
  isTerminalPhase,
  RUN_PHASES,
} from './phase-outcome.js';
import type { RunOutcome, RunPhase } from './types.js';

/**
 * The database enforces `runs_phase_outcome_check`: a run is terminal exactly
 * when its outcome is not null. Both stores used to write the two columns
 * independently, taking the outcome from an event payload, so a client could
 * either violate the CHECK — which rolled the transaction back and surfaced as an
 * unhandled 500 for a merely malformed request — or name any outcome it liked on
 * a run that had done nothing.
 */
describe('deriveRunState', () => {
  it('makes the CHECK unreachable: a non-terminal phase never carries an outcome', () => {
    for (const phase of RUN_PHASES.filter((candidate) => !isTerminalPhase(candidate))) {
      for (const claimed of ['passed', 'failed', 'cancelled', 'unknown', null, 42, {}]) {
        const derived = deriveRunState(phase, claimed);
        // Whatever the payload claimed is dropped.
        expect(derived.outcome, `${phase} + ${String(claimed)}`).toBeNull();
        expect(derived.status).toBe('running');
        expect(derived.terminal).toBe(false);
      }
    }
  });

  it('never leaves a terminal phase without an outcome', () => {
    for (const phase of RUN_PHASES.filter((candidate) => isTerminalPhase(candidate))) {
      for (const claimed of [null, undefined, '', 'not-an-outcome', 0, []]) {
        const derived = deriveRunState(phase, claimed);
        expect(derived.outcome, `${phase} + ${String(claimed)}`).not.toBeNull();
        expect(derived.terminal).toBe(true);
      }
    }
  });

  it('lets a complete run claim a pass', () => {
    expect(deriveRunState('complete', 'passed')).toEqual({
      phase: 'complete',
      outcome: 'passed',
      status: 'passed',
      terminal: true,
    });
  });

  it('defaults a complete run with no usable claim to unknown, not passed', () => {
    for (const claimed of [undefined, null, '', 'nonsense', 7]) {
      const derived = deriveRunState('complete', claimed);
      expect(derived.outcome, String(claimed)).toBe('unknown');
      // `unknown` is not a pass, so the run does not read as green.
      expect(derived.status, String(claimed)).not.toBe('passed');
    }
  });

  it('does not let a payload reclassify a cancelled run as passed', () => {
    const derived = deriveRunState('cancelled', 'passed');
    // A cancelled run implies its own outcome; the payload has no authority.
    expect(derived.outcome).toBe('cancelled');
    expect(derived.status).toBe('interrupted');
  });

  it.each([
    ['cancelled', 'cancelled'],
    ['timed_out', 'timed_out'],
    ['runner_lost', 'runner_lost'],
    ['infra_failed', 'infra_failed'],
    ['config_failed', 'config_failed'],
    ['blocked', 'blocked'],
    ['partial', 'partial'],
  ] as Array<[RunPhase, RunOutcome]>)('gives %s its own outcome %s', (phase, outcome) => {
    const derived = deriveRunState(phase, 'passed');
    expect(derived.outcome).toBe(outcome);
    expect(derived.status).toBe('interrupted');
  });

  it('rejects a phase the vocabulary does not contain', () => {
    for (const phase of ['completed', 'done', '', 'COMPLETE', null, 7]) {
      expect(isRequestablePhase(phase), String(phase)).toBe(false);
    }
    for (const phase of RUN_PHASES) {
      expect(isRequestablePhase(phase), phase).toBe(true);
    }
  });
});
