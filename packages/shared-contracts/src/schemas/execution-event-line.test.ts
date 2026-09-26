import { describe, expect, it } from 'vitest';
// A relative import, like every other test in this package: the contract
// package may not import itself by name, and `no-restricted-imports` says so.
import { ExecutionEventLineSchema } from './execution-event-line.js';

/**
 * A runner and the API validate the same line, and the contract they share must
 * accept exactly what each side sends.
 *
 * The divergence this closes: the runner's local schema accepted any
 * `Date.parse`-able `occurredAt`, while the API's own batch schema demanded an
 * ISO-8601 instant with an offset. So a runner emitting a zoneless timestamp
 * passed its own parser and was then rejected on ingest by the API that was
 * supposed to accept it — with no compile-time signal that the two disagreed,
 * because both were called "the event schema" and neither was the contract.
 */
const RUNNER_EMITS = {
  eventId: 'event-1',
  sequence: 1,
  type: 'test.completed',
  occurredAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  payload: { testId: 'test-1', status: 'passed' },
};

describe('the shared execution event line', () => {
  it('accepts a line shaped the way a runner writes one', () => {
    expect(ExecutionEventLineSchema.safeParse(RUNNER_EMITS).success).toBe(true);
  });

  it('rejects a zoneless timestamp, which the API already refused', () => {
    // The runner's old parser accepted this; the API's did not. One schema means
    // the rejection now happens in the runner, where it is fixable, rather than on
    // ingest, where it is a mystery.
    expect(
      ExecutionEventLineSchema.safeParse({ ...RUNNER_EMITS, occurredAt: '2026-01-01T00:00:00' })
        .success,
    ).toBe(false);
  });

  it('requires a timestamp, because a producer that omits one is a bug', () => {
    // The *reader* relaxes this field, and only this field, because the store
    // falls back to arrival time. The line itself is what a producer writes, and
    // an event with no instant cannot be ordered against anything.
    const { occurredAt: _omitted, ...withoutTimestamp } = RUNNER_EMITS;
    expect(ExecutionEventLineSchema.safeParse(withoutTimestamp).success).toBe(false);
  });

  it('rejects a line that is not addressable', () => {
    for (const broken of [
      { ...RUNNER_EMITS, eventId: '' },
      { ...RUNNER_EMITS, sequence: 0 },
      { ...RUNNER_EMITS, type: '' },
      { ...RUNNER_EMITS, occurredAt: 'not-a-date' },
    ]) {
      expect(ExecutionEventLineSchema.safeParse(broken).success, JSON.stringify(broken)).toBe(
        false,
      );
    }
  });

  it('defaults an absent payload rather than rejecting the line', () => {
    const { payload: _omitted, ...withoutPayload } = RUNNER_EMITS;
    const parsed = ExecutionEventLineSchema.safeParse(withoutPayload);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.payload).toEqual({});
  });

  it('accepts a type it has never seen, so a durable stream is not the place to drop it', () => {
    // Deciding a type is illegitimate belongs at the ingestion boundary, not in
    // the shared shape: rejecting here would silently discard a newer runner's
    // event with no record that it happened.
    expect(
      ExecutionEventLineSchema.safeParse({ ...RUNNER_EMITS, type: 'some.future.event' }).success,
    ).toBe(true);
  });
});
