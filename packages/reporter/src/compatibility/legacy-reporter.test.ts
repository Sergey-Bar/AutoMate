import { describe, expect, it } from 'vitest';
import type { CanonicalReporterEvent } from '@automate/shared-contracts';
import { digestRunOutcome, normalizeLegacyEvent } from './legacy-reporter.js';

const context = {
  workspaceId: 'ws-1',
  eventId: 'event-1',
  occurredAt: '2026-01-01T00:00:00.000Z',
};

function runEnded(payload: Record<string, unknown>) {
  return normalizeLegacyEvent({ type: 'run:end', runId: 'run-1', payload }, context);
}

/**
 * The `resultDigest` off a `run.completed` event.
 *
 * `CanonicalReporterEvent` is a discriminated union on `type`, and `resultDigest`
 * exists on the `run.completed` member alone. The previous version read
 * `event.data.resultDigest` behind a `data === null` check, which is not the
 * discriminant: `data` is required and non-nullable on every member, so the check
 * could never narrow anything and `tsc` rejected the access. `pnpm typecheck` had been
 * failing on this file, which means the `typecheck` step in `verify` could not pass —
 * a gate that cannot pass, the same class of defect as one that cannot fail.
 *
 * Narrowing on `type` is both the thing the compiler understands and the thing the
 * assertion means: a `run.end` that normalized to some other event type has no digest
 * to compare, and that is a failure worth naming rather than a `null` to guard.
 */
function resultDigestOf(event: CanonicalReporterEvent): string {
  if (event.type !== 'run.completed') {
    throw new Error(`expected a run.completed event, got ${String(event.type)}`);
  }
  return event.data.resultDigest;
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
    expect(failed.type).toBe('run.completed');
    expect(resultDigestOf(passed)).not.toBe(resultDigestOf(failed));
  });

  it('is stable for the same outcome, so a replay is not read as a new result', () => {
    const first = runEnded({ status: 'passed', tests: 10 });
    const replay = runEnded({ status: 'passed', tests: 10 });

    expect(resultDigestOf(first)).toBe(resultDigestOf(replay));
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
