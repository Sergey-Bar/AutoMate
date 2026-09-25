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
    const event = { jobId: 'job-1', leaseId: 'lease-1', fencingToken: lease.fencingToken, sequence: 1, type: 'progress' as const, payload: { message: 'started' } };
    expect(service.acceptEvent(identity, event)).toBe('accepted');
    expect(service.acceptEvent(identity, event)).toBe('duplicate');
    expect(service.acceptEvent(identity, { ...event, sequence: 3 })).toBe('conflict');
    const terminal = { ...event, sequence: 2, type: 'terminal' as const, terminal: true, payload: { status: 'succeeded' } };
    expect(service.acceptEvent(identity, terminal)).toBe('accepted');
    expect(service.acceptEvent(identity, { ...event, sequence: 3, type: 'terminal' as const, terminal: true })).toBe('conflict');
    expect(service.eventsFor('job-1')).toHaveLength(2);
  });
});
