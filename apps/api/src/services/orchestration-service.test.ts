import { describe, expect, it } from 'vitest';
import { OrchestrationService } from './orchestration-service.js';
import { isDomainError } from '../errors/domain-error.js';

const definition = {
  workspaceId: 'workspace-1',
  name: 'Playwright',
  tool: 'playwright' as const,
  toolVersion: '1.63.0',
  imageDigest: 'a'.repeat(64),
  input: {},
  timeoutMs: 1000,
  maxAttempts: 1,
  requiredCapabilities: ['playwright'],
};

describe('OrchestrationService', () => {
  it('creates, enqueues, lists, and cancels jobs', () => {
    const service = new OrchestrationService();
    const automation = service.createAutomation(definition);
    expect(service.listAutomations()).toHaveLength(1);
    const job = service.enqueue(automation.id);
    expect(service.listJobs()[0]?.executionId).toBe(job.executionId);
    expect(service.cancel(job.executionId).state).toBe('cancelled');
    expect(() => service.enqueue('missing')).toThrow();
    expect(() => service.cancel('missing')).toThrow();
  });

  it('records the request for cancellation on a legal transition', () => {
    const service = new OrchestrationService();
    const job = service.enqueue(service.createAutomation(definition).id);
    expect(service.cancel(job.executionId)).toMatchObject({
      state: 'cancelled',
      cancelRequested: true,
    });
  });
});

/**
 * An illegal transition must be refused, not absorbed.
 *
 * `cancel` used to be `if (canTransition(state, 'cancelled')) state = 'cancelled'` and
 * then return the job regardless. So cancelling a job that had already finished
 * returned HTTP 200 and a well-formed job envelope with `cancelRequested: true` — a
 * caller could not tell whether the job was now cancelled or was never going to be,
 * and the state it reported was whatever it already was. The route mapped that to a
 * 200, so the only way to notice was to read the envelope closely enough to see that
 * nothing had changed.
 */
describe('an illegal cancellation', () => {
  it('is refused with a conflict rather than answered as though it succeeded', () => {
    const service = new OrchestrationService();
    const job = service.enqueue(service.createAutomation(definition).id);
    service.cancel(job.executionId);

    let thrown: unknown;
    try {
      service.cancel(job.executionId);
    } catch (failure) {
      thrown = failure;
    }
    expect(isDomainError(thrown)).toBe(true);
    expect(thrown).toMatchObject({ code: 'INVALID_STATE_TRANSITION', status: 409 });
  });

  it('leaves the job exactly as it was', () => {
    // A refused request that still mutated the record would be the same defect one
    // layer down, so the job is compared field by field against its post-cancel self.
    const service = new OrchestrationService();
    const job = service.enqueue(service.createAutomation(definition).id);
    const afterFirst = service.cancel(job.executionId);
    expect(() => service.cancel(job.executionId)).toThrow();
    expect(service.listJobs()).toEqual([afterFirst]);
  });
});
