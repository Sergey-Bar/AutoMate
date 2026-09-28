import { describe, expect, it } from 'vitest';
import {
  canTransition,
  decideTransition,
  holdsFence,
  isTerminal,
  transition,
  unownedFence,
} from './state-machine.js';
import { nextOccurrence } from './schedule.js';

describe('orchestration state machine', () => {
  it('allows lifecycle transitions and rejects terminal overwrites', () => {
    expect(canTransition('queued', 'leased')).toBe(true);
    expect(transition('running', 'succeeded')).toBe('succeeded');
    expect(isTerminal('succeeded')).toBe(true);
    expect(() => transition('succeeded', 'failed')).toThrow();
  });

  it('calculates interval schedules deterministically', () => {
    const from = new Date('2026-09-25T00:00:00.000Z');
    expect(nextOccurrence({ minute: 'step', hour: '*' }, from, 15)?.toISOString()).toBe(
      '2026-09-25T00:15:00.000Z',
    );
    expect(() => nextOccurrence({ minute: 99, hour: 0 }, from)).toThrow();
    expect(nextOccurrence({ minute: 30, hour: 2 }, from)?.toISOString()).toBe(
      '2026-09-25T02:30:00.000Z',
    );
    expect(
      nextOccurrence({ minute: 30, hour: 2 }, new Date('2026-09-25T03:00:00.000Z'))?.toISOString(),
    ).toBe('2026-09-26T02:30:00.000Z');
    expect(() => nextOccurrence({ minute: 30, hour: 99 }, from)).toThrow();
  });
});

/**
 * A superseded worker must not be able to finish the job it no longer owns.
 *
 * `canTransition('running', 'succeeded')` is `true` and always will be — the edge is
 * legal. That is exactly why the table alone was not the answer to "may I do this": a
 * worker whose lease expired mid-run still holds a token that looks entirely valid, and
 * the machine had no way to ask whether it had been superseded. These cases are the
 * hazard the row named, expressed as the decision a caller now makes.
 */
describe('the fence', () => {
  it('refuses a transition from a worker whose lease has been superseded', () => {
    // The job was claimed by runner-a on token 1. The lease expired, the reaper
    // requeued it, and runner-b claimed it on token 2. runner-a finishes first in
    // wall-clock terms and reports `succeeded`.
    const decision = decideTransition({ state: 'running', current: 2, held: 1 }, 'succeeded');

    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({ reason: 'fenced_out', held: 1, current: 2 });
  });

  it('allows the same transition from the worker that holds the newest lease', () => {
    // The negative. A machine that refused everything would satisfy the case above,
    // and would also break every job in the system.
    expect(decideTransition({ state: 'running', current: 2, held: 2 }, 'succeeded')).toEqual({
      allowed: true,
      state: 'succeeded',
    });
  });

  it('does not treat a token the store never issued as authority', () => {
    // `>=` instead of `===` would let this through: a caller holding token 3 for a job
    // the store last issued token 2 has a token from somewhere else, and that is a
    // defect upstream rather than permission to finish the job.
    expect(holdsFence({ state: 'running', current: 2, held: 3 })).toBe(false);
    expect(decideTransition({ state: 'running', current: 2, held: 3 }, 'succeeded')).toMatchObject({
      reason: 'fenced_out',
    });
  });

  it('still refuses an illegal transition to a worker that does hold the fence', () => {
    // Fencing is not a licence to make any edge legal. A finished job stays finished.
    expect(decideTransition({ state: 'succeeded', current: 4, held: 4 }, 'failed')).toEqual({
      allowed: false,
      reason: 'illegal',
      from: 'succeeded',
      to: 'failed',
    });
  });

  it('names the fence before the table, so a superseded worker learns nothing else', () => {
    // Both rules refuse this. The order is the assertion: a superseded worker must not
    // be able to probe which edges are legal for a job it does not own.
    expect(decideTransition({ state: 'succeeded', current: 9, held: 1 }, 'failed')).toMatchObject({
      reason: 'fenced_out',
    });
  });

  it('leaves an unowned caller — the control plane — unfenced', () => {
    // Cancelling a job is an operator action, not a lease-holder action, so it has no
    // token to be fenced out of. `unownedFence` makes that explicit rather than
    // leaving the caller to pass two zeroes it invented.
    expect(decideTransition(unownedFence('running'), 'cancelled')).toEqual({
      allowed: true,
      state: 'cancelled',
    });
    expect(decideTransition(unownedFence('succeeded'), 'cancelled')).toMatchObject({
      reason: 'illegal',
    });
  });
});
