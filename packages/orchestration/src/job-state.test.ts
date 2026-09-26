import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { JobState } from '@automate/shared-contracts';
import { canTransition, isTerminal } from './state-machine.js';
import {
  allMappedStoredStates,
  fromStoredJobState,
  STORED_JOB_STATES,
  toStoredJobState,
} from './job-state.js';

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/drizzle',
);

const CONTRACT_STATES: readonly JobState[] = [
  'queued',
  'leased',
  'running',
  'waiting_approval',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
];

/**
 * The states `execution_jobs.state_check` actually permits, read out of the
 * migration rather than restated here.
 *
 * Reading the constraint is the point: a test that compared the mapping against
 * its own declared list would pass while the database rejected every value. This
 * one cannot.
 */
function statesAllowedByTheDatabase(): Set<string> {
  const files = [
    '0000_fixed_outlaw_kid.sql',
    '0001_phase3_foundation.sql',
    '0002_phase3_key_constraint.sql',
    '0003_durable_execution.sql',
  ];
  let constraint: string | undefined;
  for (const file of files) {
    const source = readFileSync(path.join(drizzleDirectory, file), 'utf8');
    const match = /CONSTRAINT\s+"execution_jobs_state_check"\s+CHECK\s*\(([^)]*)\)/.exec(source);
    if (match?.[1] !== undefined) constraint = match[1];
  }
  if (constraint === undefined)
    throw new Error('execution_jobs_state_check not found in migrations');
  const states = new Set<string>();
  for (const match of constraint.matchAll(/'([a-z_]+)'/g)) {
    const value = match[1];
    if (value !== undefined) states.add(value);
  }
  if (states.size === 0) throw new Error('execution_jobs_state_check declares no states');
  return states;
}

describe('the contract state machine and the stored column', () => {
  it('produces only states the database actually accepts', () => {
    const allowed = statesAllowedByTheDatabase();
    for (const state of allMappedStoredStates()) {
      expect(allowed.has(state), `${state} violates execution_jobs_state_check`).toBe(true);
    }
    // And the local list matches the constraint, so the two copies cannot drift.
    for (const state of STORED_JOB_STATES) {
      expect(allowed.has(state), `${state} is declared locally but not by the database`).toBe(true);
    }
    expect(allowed.size).toBe(STORED_JOB_STATES.length);
  });

  it('round-trips every state the state machine can produce or hold', () => {
    // This is the case the plan names: the state machine transitions to
    // `running`, `succeeded`, `waiting_approval` and `expired`, none of which the
    // column accepts, so persisting one threw a raw constraint violation.
    for (const state of CONTRACT_STATES) {
      const stored = toStoredJobState(state);
      expect(stored, `no stored state for ${state}`).toBeDefined();
    }
  });

  it('never persists a terminal contract state as a non-terminal stored state', () => {
    // A caller reading the column must be able to tell "done" from "not done".
    for (const state of CONTRACT_STATES.filter((candidate) => isTerminal(candidate))) {
      const stored = toStoredJobState(state);
      expect(
        stored === 'completed' || stored === 'failed' || stored === 'cancelled',
        `terminal state ${state} is stored as non-terminal ${stored}`,
      ).toBe(true);
    }
  });

  it('preserves the product meaning of each lossy case', () => {
    expect(toStoredJobState('succeeded')).toBe('completed');
    expect(toStoredJobState('expired')).toBe('failed');
    // A job awaiting approval is held by someone, not finished.
    expect(toStoredJobState('waiting_approval')).toBe('leased');
    expect(toStoredJobState('cancelling')).toBe('leased');
    // Execution in progress is still a lease as far as the store is concerned.
    expect(toStoredJobState('running')).toBe('leased');
  });

  it('keeps the states that need no translation identical', () => {
    for (const state of ['queued', 'leased', 'failed', 'cancelled'] as const) {
      expect(toStoredJobState(state)).toBe(state);
      expect(fromStoredJobState(state)).toBe(state);
    }
  });

  it('maps the positive terminal state back to the contract name', () => {
    expect(fromStoredJobState('completed')).toBe('succeeded');
    expect(fromStoredJobState('requeued')).toBe('queued');
  });

  it('survives a round trip through the column for every state', () => {
    // Not invertible by design — `running` and `leased` are one stored value —
    // so the assertion is that nothing becomes invalid, not that nothing is lost.
    for (const state of CONTRACT_STATES) {
      const stored = toStoredJobState(state);
      const back = fromStoredJobState(stored);
      expect(CONTRACT_STATES).toContain(back);
    }
  });

  it('treats an unrecognised origin as not legal rather than crashing', () => {
    // `canTransition` used to read `transitions[from].includes(...)`, which threw
    // a `TypeError` on a state it did not know. `cancel()` consults this, so a
    // malformed state crashed a cancellation.
    for (const unknown of ['completed', 'requeued', 'not-a-state', '']) {
      expect(canTransition(unknown as JobState, 'cancelled'), unknown).toBe(false);
      expect(isTerminal(unknown as JobState), unknown).toBe(true);
    }
    // A known state still behaves.
    expect(canTransition('queued', 'cancelled')).toBe(true);
  });

  it('applies to every transition the machine permits', () => {
    // The plan's own wording: round-trip every canTransition(from, to) pair.
    let pairs = 0;
    for (const from of CONTRACT_STATES) {
      for (const to of CONTRACT_STATES) {
        if (!canTransition(from, to)) continue;
        pairs += 1;
        const stored = toStoredJobState(to);
        expect(statesAllowedByTheDatabase().has(stored), `${from} -> ${to} stores ${stored}`).toBe(
          true,
        );
        // A terminal target is always a terminal stored state.
        if (isTerminal(to)) {
          expect(
            stored === 'completed' || stored === 'failed' || stored === 'cancelled',
            `${from} -> ${to} stores non-terminal ${stored}`,
          ).toBe(true);
        }
      }
    }
    // If the machine ever gains states, this must not silently cover zero pairs.
    expect(pairs).toBeGreaterThan(10);
  });
});
