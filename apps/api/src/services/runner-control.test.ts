import { describe, expect, it } from 'vitest';
import { RunnerControlService } from './runner-control.js';

describe('RunnerControlService', () => {
  it('enrolls once and rejects invalid tokens', () => {
    const service = new RunnerControlService();
    const token = service.issueEnrollmentToken();
    const identity = service.enroll(token, ['playwright']);
    expect(() => service.enroll(token, [])).toThrow();
    expect(service.authenticate(identity.credential).id).toBe(identity.id);
    expect(() => service.authenticate('bad')).toThrow();
  });

  it('enforces lease fencing, ordered sequences, duplicate acknowledgement, and terminal immutability', () => {
    const service = new RunnerControlService();
    const identity = service.enroll(service.issueEnrollmentToken(), ['api']);
    const lease = service.acquire(identity, 'job-1', 'lease-1');
    const event = {
      jobId: 'job-1',
      leaseId: 'lease-1',
      fencingToken: lease.fencingToken,
      sequence: 1,
      type: 'progress' as const,
      payload: { message: 'started' },
    };
    expect(service.acceptEvent(identity, event)).toBe('accepted');
    expect(service.acceptEvent(identity, event)).toBe('duplicate');
    expect(service.acceptEvent(identity, { ...event, sequence: 3 })).toBe('conflict');
    const terminal = {
      ...event,
      sequence: 2,
      type: 'terminal' as const,
      terminal: true,
      payload: { status: 'succeeded' },
    };
    expect(service.acceptEvent(identity, terminal)).toBe('accepted');
    expect(
      service.acceptEvent(identity, {
        ...event,
        sequence: 3,
        type: 'terminal' as const,
        terminal: true,
      }),
    ).toBe('conflict');
    expect(service.eventsFor('job-1')).toHaveLength(2);
  });
});

/**
 * The lease id, and the identity of a retried event.
 *
 * Two defects, both of which a runner could exploit or suffer:
 *
 *  - `acquire` took a `leaseId` and named the parameter `_leaseId`, so the lease
 *    record never held one. `acceptEvent` could therefore only compare the runner and
 *    the fencing token, and any event naming a lease that was never issued was
 *    accepted. The token is what orders attempts; the id is what says *which* grant,
 *    and dropping it makes the first of a runner's two claims checkable but not the
 *    second.
 *
 *  - duplicate detection hashed `JSON.stringify(event)`, so `{a:1,b:2}` and
 *    `{b:2,a:1}` hashed differently. A runner that retried after a timeout, having
 *    rebuilt the payload in a different key order, was told `conflict` — and the
 *    caller cannot distinguish that from a genuine second event with the same
 *    sequence, so the correct recovery is to re-claim the job, which is the expensive
 *    recovery, over a resend, which is free.
 */
describe('the lease id and the identity of a retried event', () => {
  function aRunner() {
    const service = new RunnerControlService();
    const identity = service.enroll(service.issueEnrollmentToken(), ['api']);
    return { service, identity };
  }

  it('refuses an event naming a lease id that was never issued', () => {
    const { service, identity } = aRunner();
    const lease = service.acquire(identity, 'job-1', 'lease-1');

    const accepted = service.acceptEvent(identity, {
      jobId: 'job-1',
      // A lease id nobody was ever handed, with the right runner and the right
      // token. Before the fix this was accepted, because the lease record did not
      // hold an id to compare it against.
      leaseId: 'lease-that-was-never-issued',
      fencingToken: lease.fencingToken,
      sequence: 1,
      type: 'progress',
      payload: { message: 'started' },
    });

    expect(accepted).toBe('conflict');
    expect(service.eventsFor('job-1')).toHaveLength(0);
  });

  it('reports a reordered retry as the duplicate it is', () => {
    const { service, identity } = aRunner();
    const lease = service.acquire(identity, 'job-1', 'lease-1');
    const first = {
      jobId: 'job-1',
      leaseId: 'lease-1',
      fencingToken: lease.fencingToken,
      sequence: 1,
      type: 'progress' as const,
      payload: { message: 'started', elapsedMs: 12 },
    };
    expect(service.acceptEvent(identity, first)).toBe('accepted');

    // The same event, rebuilt after a timeout with the payload keys in the other
    // order. Before the fix this hashed differently and came back `conflict`, which
    // the runner can only resolve by re-claiming the job.
    expect(
      service.acceptEvent(identity, {
        ...first,
        payload: { elapsedMs: 12, message: 'started' },
      }),
    ).toBe('duplicate');
  });

  it('still reports a genuinely different event at the same sequence as a conflict', () => {
    // The counterweight: a canonical serialisation that compared less than the raw
    // string would call two different events the same event.
    const { service, identity } = aRunner();
    const lease = service.acquire(identity, 'job-1', 'lease-1');
    const first = {
      jobId: 'job-1',
      leaseId: 'lease-1',
      fencingToken: lease.fencingToken,
      sequence: 1,
      type: 'progress' as const,
      payload: { message: 'started' },
    };
    expect(service.acceptEvent(identity, first)).toBe('accepted');
    expect(
      service.acceptEvent(identity, { ...first, payload: { message: 'something else' } }),
    ).toBe('conflict');
  });

  it('refuses the previous attempt’s token after a re-lease, which is what the token is for', () => {
    const { service, identity } = aRunner();
    const first = service.acquire(identity, 'job-1', 'lease-1');
    const second = service.acquire(identity, 'job-1', 'lease-2');
    expect(second.fencingToken).toBeGreaterThan(first.fencingToken);

    // The runner that lost the lease keeps reporting. Its token is stale, so nothing
    // it sends lands — and this is the assertion that distinguishes the token from
    // the id: both are checked, and either one alone would let this through if the
    // other were dropped from the record.
    expect(
      service.acceptEvent(identity, {
        jobId: 'job-1',
        leaseId: 'lease-1',
        fencingToken: first.fencingToken,
        sequence: 1,
        type: 'progress',
        payload: { message: 'late' },
      }),
    ).toBe('conflict');
  });
});
