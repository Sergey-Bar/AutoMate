import { createHash, randomUUID } from 'node:crypto';
import { canTransition } from '@automate/orchestration';
import type { AutomationDefinition, JobEnvelope, Schedule } from '@automate/shared-contracts';

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

  cancel(executionId: string): JobEnvelope {
    const job = this.jobs.get(executionId);
    if (!job) throw new Error('Job not found');
    if (canTransition(job.state, 'cancelled')) job.state = 'cancelled';
    job.cancelRequested = true;
    return job;
  }

  listJobs(): JobEnvelope[] {
    return [...this.jobs.values()];
  }
}
