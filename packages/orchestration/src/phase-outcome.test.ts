import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PERSISTED_RUN_STATUS_VALUES } from '@automate/shared-contracts';
import type { RunOutcome, RunPhase } from '@automate/shared-contracts';
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
 * `deriveRunState` is the one place a run's `phase`, `outcome` and `status` are
 * decided together, and it moved here from `apps/api` for a reason: the worker had
 * the same three-column write from a hand-written table, nothing compared the two,
 * and the fallthrough in that table produced a pair `runs_phase_outcome_check`
 * rejects.
 *
 * So the invariant is asserted here, against the constraints read out of the
 * migration, over the *whole* phase vocabulary rather than over a caller's status
 * vocabulary. A new caller gets the guarantee for free; a new phase cannot pass
 * this without the database agreeing to store it.
 */

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/drizzle',
);

/** The quoted values of a named CHECK constraint, from the last migration naming it. */
function checkValues(name: string): Set<string> {
  const files = readdirSync(drizzleDirectory)
    .filter((entry) => entry.endsWith('.sql'))
    .sort();
  let body: string | undefined;
  for (const file of files) {
    const source = readFileSync(path.join(drizzleDirectory, file), 'utf8');
    const match = new RegExp(`ADD CONSTRAINT "${name}"\\s+CHECK\\s*\\(([\\s\\S]*?)\\);`).exec(
      source,
    );
    if (match?.[1] !== undefined) body = match[1];
  }
  if (body === undefined) throw new Error(`${name} not found in migrations`);
  const values = new Set<string>();
  for (const match of body.matchAll(/'([^']+)'/g)) {
    const value = match[1];
    if (value !== undefined) values.add(value);
  }
  if (values.size === 0) throw new Error(`${name} declares no values`);
  return values;
}

/** Every outcome any caller might claim, plus values no caller should. */
const CLAIMABLE: readonly unknown[] = [
  'passed',
  'failed',
  'unknown',
  'partial',
  'cancelled',
  'timed_out',
  'runner_lost',
  'infra_failed',
  'config_failed',
  'blocked',
  // And the shapes a malformed or hostile payload arrives as.
  null,
  undefined,
  '',
  'PASSED',
  'not-an-outcome',
  0,
  42,
  {},
  [],
];

describe('deriveRunState satisfies the runs CHECK constraints for every phase', () => {
  const terminalPhases = checkValues('runs_phase_outcome_check');
  const persistedStatuses = checkValues('runs_status_check');

  it.each(RUN_PHASES)('%s with every claimable outcome', (phase) => {
    for (const claimed of CLAIMABLE) {
      const derived = deriveRunState(phase as RunPhase, claimed);
      const label = `${phase} + ${String(claimed)}`;

      // `runs_phase_outcome_check`, stated as the constraint states it.
      const isTerminalPhaseValue = terminalPhases.has(derived.phase);
      const hasOutcome = derived.outcome !== null;
      expect(isTerminalPhaseValue, label).toBe(hasOutcome);

      // `runs_status_check`.
      expect(persistedStatuses.has(derived.status), `${label} -> ${derived.status}`).toBe(true);
    }
  });

  it('agrees with the constraints about which phases are terminal', () => {
    // Two lists claiming the same thing: the local one and the one in the
    // migration. They must be the same set, or one of them is lying.
    expect(new Set(TERMINAL_PHASES)).toEqual(terminalPhases);
  });

  it('agrees with the contract about the persisted statuses', () => {
    expect(new Set(PERSISTED_RUN_STATUS_VALUES)).toEqual(persistedStatuses);
  });

  it('never writes a non-null outcome for a phase outside the vocabulary', () => {
    // `deriveRunState` takes a `RunPhase` because callers are supposed to fold
    // their own vocabulary first. A caller that forgets is the worker's original
    // defect, so the guard is worth stating rather than assuming.
    for (const claimed of CLAIMABLE) {
      const derived = deriveRunState('requeue' as RunPhase, claimed);
      const isTerminalPhaseValue = terminalPhases.has(derived.phase);
      expect(isTerminalPhaseValue, `requeue + ${String(claimed)}`).toBe(
        derived.outcome !== null && derived.outcome !== undefined,
      );
    }
  });
});

describe('the vocabulary itself', () => {
  it('recognises exactly the phases it declares as terminal', () => {
    for (const phase of RUN_PHASES) {
      expect(isTerminalPhase(phase), phase).toBe(TERMINAL_PHASES.includes(phase));
    }
  });

  it('treats an absent phase as neither terminal nor requestable', () => {
    // `null` and `undefined` reach here from a row whose column is nullable, and
    // answering `true` for either would call an unfinished run finished.
    for (const absent of [null, undefined]) {
      expect(isTerminalPhase(absent)).toBe(false);
    }
  });

  it('accepts every declared phase as requestable and nothing else', () => {
    for (const phase of RUN_PHASES) {
      expect(isRequestablePhase(phase), phase).toBe(true);
    }
    // The vocabulary this module replaced had a phase in it that does not exist,
    // which is how the handler and the list came to disagree.
    for (const unknown of ['completed', 'done', 'COMPLETE', '', null, 7, {}, ['running']]) {
      expect(isRequestablePhase(unknown), String(unknown)).toBe(false);
    }
  });

  it('gives every terminal phase except complete an outcome of its own', () => {
    // `complete` is the one terminal phase whose outcome a caller may choose,
    // which is why it is absent here and present in `COMPLETE_OUTCOMES`.
    const implied = new Set(Object.keys(PHASE_OUTCOME));
    const expected = TERMINAL_PHASES.filter((phase) => phase !== 'complete');
    expect([...implied].sort()).toEqual([...expected].sort());
    for (const phase of expected) {
      expect(deriveRunState(phase, 'passed').outcome, phase).toBe(phase);
    }
  });

  it('offers outcomes a complete run may claim, and never null', () => {
    expect(COMPLETE_OUTCOMES).not.toContain(null);
    for (const claimed of COMPLETE_OUTCOMES) {
      expect(deriveRunState('complete', claimed).outcome).toBe(claimed as RunOutcome);
    }
  });
});
