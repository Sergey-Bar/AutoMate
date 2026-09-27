import { describe, expect, it } from 'vitest';
import { digestRunOutcome, normalizeLegacyEvent } from './legacy-reporter.js';

const context = {
  workspaceId: 'ws-1',
  eventId: 'event-1',
  occurredAt: '2026-01-01T00:00:00.000Z',
};

function runEnded(payload: Record<string, unknown>) {
  return normalizeLegacyEvent({ type: 'run:end', runId: 'run-1', payload }, context);
}

describe('the result digest', () => {
  /**
   * It was `'0'.repeat(64)`. `DigestSchema` only checks that the value is 64 hex
   * characters, so 64 zeros passed it, and every run in the installation produced the
   * same digest. A digest that cannot distinguish two results makes two different runs
   * indistinguishable to anything comparing them, and makes a replay look fresh.
   */
  it('distinguishes two different outcomes', () => {
    const passed = runEnded({ status: 'passed', tests: 10, failures: 0 });
    const failed = runEnded({ status: 'failed', tests: 10, failures: 3 });

    expect(passed.type).toBe('run.completed');
    expect(passed.data).toHaveProperty('resultDigest');
    expect(failed.data).toHaveProperty('resultDigest');
    if (passed.data === null || failed.data === null)
      throw new Error('no digest on a run.completed');
    expect(passed.data.resultDigest).not.toBe(failed.data.resultDigest);
  });

  it('is stable for the same outcome, so a replay is not read as a new result', () => {
    const first = runEnded({ status: 'passed', tests: 10 });
    const replay = runEnded({ status: 'passed', tests: 10 });

    if (first.data === null) throw new Error('no digest on a run.completed');
    expect(first.data.resultDigest).toBe(replay.data?.resultDigest);
  });

  it('does not depend on the order the producer built its keys in', () => {
    // `JSON.stringify` preserves insertion order, so a producer that assembled the same
    // object in a different order would hash differently — a digest reporting a
    // difference where there is none, which breaks deduplication in the other direction.
    const ordered = digestRunOutcome({ status: 'passed', tests: 10, durationMs: 5 });
    const reordered = digestRunOutcome({ durationMs: 5, tests: 10, status: 'passed' });
    expect(ordered).toBe(reordered);
  });

  it('is not a run of zeros, or of any other constant', () => {
    expect(digestRunOutcome({ status: 'passed' })).not.toBe('0'.repeat(64));
    expect(digestRunOutcome({ status: 'passed' })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates a nested difference, not just a top-level one', () => {
    expect(digestRunOutcome({ suites: [{ name: 'a', passed: 1 }] })).not.toBe(
      digestRunOutcome({ suites: [{ name: 'a', passed: 2 }] }),
    );
  });

  it('survives a payload with no fields at all', () => {
    // The empty payload is a real case — a legacy producer that sent `run:end` with
    // nothing in it — and it must not throw or produce an invalid digest.
    expect(digestRunOutcome({})).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores keys the producer sent as undefined rather than failing on them', () => {
    // `JSON.stringify` drops undefined values from an object, so a producer including a
    // field it never set must hash the same as one that omitted it.
    expect(digestRunOutcome({ status: 'passed', note: undefined })).toBe(
      digestRunOutcome({ status: 'passed' }),
    );
  });
});
