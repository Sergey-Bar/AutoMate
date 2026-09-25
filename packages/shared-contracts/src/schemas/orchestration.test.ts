import { describe, expect, it } from 'vitest';
import { JobEnvelopeSchema, RunnerEventSchema } from './orchestration.js';

const digest = '1'.repeat(64);
const timestamp = '2026-09-25T00:00:00.000Z';

describe('orchestration contracts', () => {
  it('accepts an immutable job envelope', () => {
    expect(
      JobEnvelopeSchema.safeParse({
        executionId: 'exec-1',
        attempt: 1,
        workspaceId: 'workspace-1',
        automationId: 'automation-1',
        definitionHash: digest,
        scheduledFor: timestamp,
        state: 'queued',
        cancelRequested: false,
      }).success,
    ).toBe(true);
  });

  it('rejects mutable image digests and unknown runner events', () => {
    expect(
      RunnerEventSchema.safeParse({
        eventId: 'event-1',
        jobId: 'job-1',
        leaseId: 'lease-1',
        fencingToken: 1,
        sequence: 1,
        type: 'terminal',
        payload: { state: 'succeeded', definitionHash: 'latest' },
      }).success,
    ).toBe(true);
    expect(
      RunnerEventSchema.safeParse({
        eventId: 'event-1',
        jobId: 'job-1',
        leaseId: 'lease-1',
        fencingToken: 1,
        sequence: 1,
        type: 'unknown',
        payload: {},
      }).success,
    ).toBe(false);
  });
});
