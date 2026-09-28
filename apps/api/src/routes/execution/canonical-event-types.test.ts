import { describe, expect, it } from 'vitest';
import { RunEventTypeSchema } from '@automate/shared-contracts';
import { CANONICAL_EVENT_TYPES } from './schemas.js';
import type { CanonicalRealtimeEvent } from '../../realtime/realtime-bus.js';

/**
 * `CANONICAL_EVENT_TYPES` used to be a hand-written `Set<string>` holding the same
 * ten names as the contract's `RunEventTypeSchema`, and the gate at
 * `jobs.routes.ts:72` then **cast** its result — `type as CanonicalRealtimeEvent['type']`.
 * The cast existed only because the set was `Set<string>`, so the eleventh event name
 * could be added to the contract and silently missed here, with the cast hiding it.
 *
 * Both halves are derived now, and the cast is gone, so the same addition is a
 * compile error instead of a runtime surprise.
 */
describe('canonical event type derivation', () => {
  it('derives CANONICAL_EVENT_TYPES from the contract rather than repeating it', () => {
    expect([...CANONICAL_EVENT_TYPES].sort()).toEqual([...RunEventTypeSchema.options].sort());
  });

  it('gives the set the contract’s element type, so a new name cannot be missed', () => {
    // A compile-time assertion: if the set widens back to `Set<string>`, `has` starts
    // accepting strings the contract does not declare and this line stops compiling.
    const declared: readonly string[] = RunEventTypeSchema.options;
    for (const type of declared) {
      expect(CANONICAL_EVENT_TYPES.has(type as CanonicalRealtimeEvent['type'])).toBe(true);
    }
  });

  it('keeps `run.phase` out of the set, so the alias in jobs.routes.ts still has work to do', () => {
    // `run.phase` is rewritten to `run.phase_changed` before the membership guard.
    // It is not an enum member, so the guard is still doing the work it was written
    // for and must not be deleted as redundant.
    expect(RunEventTypeSchema.options).not.toContain('run.phase');
    expect(CANONICAL_EVENT_TYPES.has('run.phase' as CanonicalRealtimeEvent['type'])).toBe(false);
  });
});
