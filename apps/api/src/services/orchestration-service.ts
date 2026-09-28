import { createHash, randomUUID } from 'node:crypto';
import { decideTransition, unownedFence } from '@automate/orchestration';
import type { AutomationDefinition, JobEnvelope, Schedule } from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';

export class OrchestrationService {
  private readonly automations = new Map<string, AutomationDefinition>();
  private readonly schedules = new Map<string, Schedule>();
  private readonly jobs = new Map<string, JobEnvelope>();

  createAutomation(input: Omit<AutomationDefinition, 'id'>): AutomationDefinition {
    const automation = { ...input, id: randomUUID() };
    this.automations.set(automation.id, automation);
    return automation;
  }

  listAutomations(): AutomationDefinition[] {
    return [...this.automations.values()];
  }

  createSchedule(input: Omit<Schedule, 'id'>): Schedule {
    const schedule = { ...input, id: randomUUID() };
    this.schedules.set(schedule.id, schedule);
    return schedule;
  }

  enqueue(automationId: string): JobEnvelope {
    const automation = this.automations.get(automationId);
    if (!automation) throw new Error('Automation not found');
    const definitionHash = createHash('sha256').update(JSON.stringify(automation)).digest('hex');
    const job: JobEnvelope = {
      executionId: randomUUID(),
      attempt: 1,
      workspaceId: automation.workspaceId,
      automationId,
      definitionHash,
      scheduledFor: new Date().toISOString(),
      state: 'queued',
      cancelRequested: false,
    };
    this.jobs.set(job.executionId, job);
    return job;
  }

  /**
   * Requests cancellation, and refuses it when the job cannot be cancelled.
   *
   * This used to be `if (canTransition(state, 'cancelled')) state = 'cancelled'` and
   * then return the job either way, so cancelling something already finished
   * answered 200 with a well-formed envelope whose state had not moved — a caller
   * could not tell a job that was cancelled from one that never could be. The
   * decision now comes from the state machine, which distinguishes a legal edge from
   * an illegal one, and an illegal one is a 409 the caller can branch on.
   *
   * The fence is `unownedFence` because cancelling is a control-plane action, not
   * something a lease holder does: there is no token to be fenced out of, and
   * inventing one would be a second claim about the job.
   */
  cancel(executionId: string): JobEnvelope {
    const job = this.jobs.get(executionId);
    if (!job) throw new Error('Job not found');
    const decision = decideTransition(unownedFence(job.state), 'cancelled');
    if (!decision.allowed) {
      // Only an illegal edge can reach here — an unowned fence is never fenced out —
      // so the refusal names the edge rather than branching on the reason.
      throw new DomainError(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Job in state ${job.state} cannot be cancelled`,
        { details: { from: job.state, to: 'cancelled' } },
      );
    }
    job.state = decision.state;
    job.cancelRequested = true;
    return job;
  }

  listJobs(): JobEnvelope[] {
    return [...this.jobs.values()];
  }
}
