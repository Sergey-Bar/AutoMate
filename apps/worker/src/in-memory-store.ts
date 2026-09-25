import { randomUUID } from 'node:crypto';
import type {
  ExecutionStore,
  ExecutionStoreOptions,
  JobClaim,
  JobCompletion,
  LeaseRecovery,
  QueueJob,
  ScheduledEnqueue,
  ScheduledEnqueueResult,
  WorkerSchedule,
} from './types.js';

export interface SeedJob {
  id: string;
  runId: string;
  workspaceId: string;
  projectId?: string | null;
  attempt?: number;
  maxAttempts?: number;
  priority?: number;
  availableAt?: string;
  requiredCapabilities?: string[];
  labels?: string[];
  timeoutMs?: number;
  spec?: Record<string, unknown>;
  createdAt?: string;
}

export interface SeedRunner {
  id: string;
  capabilities: string[];
  labels?: string[];
  slots?: number;
  health?: 'healthy' | 'draining' | 'offline' | 'revoked';
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryExecutionStore implements ExecutionStore {
  private readonly jobs = new Map<string, QueueJob>();
  private readonly runners = new Map<
    string,
    {
      capabilities: Set<string>;
      labels: Set<string>;
      slots: number;
      health: 'healthy' | 'draining' | 'offline' | 'revoked';
    }
  >();
  private readonly schedules = new Map<string, WorkerSchedule>();
  private readonly scheduledResults = new Map<string, ScheduledEnqueueResult>();
  private readonly leaseDurationMs: number;
  private readonly retryBackoffMs: number;
  private readonly starvationAfterMs: number;
  private readonly maxAttempts: number;
  private readonly workspaceQuota: number;
  private readonly projectQuota: number;
  private readonly now: () => Date;

  constructor(options: ExecutionStoreOptions = {}) {
    this.leaseDurationMs = options.leaseDurationMs ?? 60_000;
    this.retryBackoffMs = options.retryBackoffMs ?? 1_000;
    this.starvationAfterMs = options.starvationAfterMs ?? 60_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.workspaceQuota = options.workspaceQuota ?? 100;
    this.projectQuota = options.projectQuota ?? 20;
    this.now = options.now ?? (() => new Date());
  }

  addRunner(runner: SeedRunner): void {
    this.runners.set(runner.id, {
      capabilities: new Set(runner.capabilities),
      labels: new Set(runner.labels ?? []),
      slots: runner.slots ?? 1,
      health: runner.health ?? 'healthy',
    });
  }

  addJob(input: SeedJob): QueueJob {
    const timestamp = this.now().toISOString();
    const job: QueueJob = {
      id: input.id,
      runId: input.runId,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      attempt: input.attempt ?? 1,
      maxAttempts: input.maxAttempts ?? this.maxAttempts,
      priority: input.priority ?? 0,
      state: 'queued',
      availableAt: input.availableAt ?? timestamp,
      requiredCapabilities: [...(input.requiredCapabilities ?? [])],
      labels: [...(input.labels ?? [])],
      timeoutMs: input.timeoutMs ?? 30 * 60_000,
      spec: clone(input.spec ?? {}),
      leaseId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      fencingToken: 0,
      cancelRequested: false,
      error: null,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.jobs.set(job.id, job);
    return clone(job);
  }

  addSchedule(schedule: WorkerSchedule): void {
    this.schedules.set(schedule.id, clone(schedule));
  }

  requestCancellation(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.cancelRequested = true;
    if (job.state === 'queued' || job.state === 'requeued') job.state = 'cancelled';
    job.updatedAt = this.now().toISOString();
    return true;
  }

  getJob(jobId: string): QueueJob | null {
    const job = this.jobs.get(jobId);
    return job ? clone(job) : null;
  }

  listJobs(): QueueJob[] {
    return [...this.jobs.values()].map((job) => clone(job));
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async claimJob(
    runnerId: string,
    capabilities: readonly string[],
    labels: readonly string[],
    now = this.now(),
  ): Promise<JobClaim | null> {
    await this.reapExpiredLeases(now);
    const runner = this.runners.get(runnerId);
    if (!runner || runner.health !== 'healthy') return null;
    const active = [...this.jobs.values()].filter(
      (job) => job.leaseOwner === runnerId && job.state === 'leased',
    );
    if (active.length >= runner.slots) return null;
    const effectiveCapabilities = new Set([...runner.capabilities, ...capabilities]);
    const effectiveLabels = new Set([...runner.labels, ...labels]);
    const activeJobs = [...this.jobs.values()].filter((job) => job.state === 'leased');
    const candidates = [...this.jobs.values()]
      .filter((job) => job.state === 'queued' || job.state === 'requeued')
      .filter((job) => !job.cancelRequested)
      .filter((job) => new Date(job.availableAt).getTime() <= now.getTime())
      .filter((job) =>
        job.requiredCapabilities.every((capability) => effectiveCapabilities.has(capability)),
      )
      .filter((job) => job.labels.every((label) => effectiveLabels.has(label)))
      .filter(
        (job) =>
          activeJobs.filter((activeJob) => activeJob.workspaceId === job.workspaceId).length <
          this.workspaceQuota,
      )
      .filter(
        (job) =>
          !job.projectId ||
          activeJobs.filter((activeJob) => activeJob.projectId === job.projectId).length <
            this.projectQuota,
      )
      .sort((left, right) => {
        const waitedLeft = now.getTime() - new Date(left.createdAt).getTime();
        const waitedRight = now.getTime() - new Date(right.createdAt).getTime();
        const priorityLeft = left.priority + Math.floor(waitedLeft / this.starvationAfterMs);
        const priorityRight = right.priority + Math.floor(waitedRight / this.starvationAfterMs);
        return (
          priorityRight - priorityLeft ||
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
          left.id.localeCompare(right.id)
        );
      });
    const job = candidates[0];
    if (!job) return null;
    const timestamp = now.toISOString();
    job.state = 'leased';
    job.leaseId = randomUUID();
    job.leaseOwner = runnerId;
    job.leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs).toISOString();
    job.fencingToken += 1;
    job.updatedAt = timestamp;
    return {
      jobId: job.id,
      runId: job.runId,
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      attempt: job.attempt,
      leaseId: job.leaseId,
      leaseOwner: runnerId,
      leaseExpiresAt: job.leaseExpiresAt,
      fencingToken: job.fencingToken,
      timeoutMs: job.timeoutMs,
      spec: clone(job.spec),
    };
  }

  async renewLease(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    leaseExpiresAt: Date,
  ): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!this.matchesLease(job, leaseId, fencingToken)) return false;
    job.leaseExpiresAt = leaseExpiresAt.toISOString();
    job.updatedAt = this.now().toISOString();
    return true;
  }

  async releaseJob(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    availableAt = this.now(),
  ): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!this.matchesLease(job, leaseId, fencingToken)) return false;
    job.state = 'queued';
    job.availableAt = availableAt.toISOString();
    this.clearLease(job);
    job.updatedAt = this.now().toISOString();
    return true;
  }

  async completeJob(jobId: string, completion: JobCompletion): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!this.matchesLease(job, completion.leaseId, completion.fencingToken)) return false;
    job.state =
      completion.status === 'completed'
        ? 'completed'
        : completion.status === 'cancelled'
          ? 'cancelled'
          : 'failed';
    job.error = completion.error ?? null;
    job.updatedAt = this.now().toISOString();
    this.clearLease(job);
    return true;
  }

  async reapExpiredLeases(now = this.now()): Promise<LeaseRecovery[]> {
    const recovered: LeaseRecovery[] = [];
    for (const job of this.jobs.values()) {
      if (
        job.state !== 'leased' ||
        !job.leaseExpiresAt ||
        new Date(job.leaseExpiresAt).getTime() > now.getTime()
      ) {
        continue;
      }
      const previousOwner = job.leaseOwner ?? 'unknown';
      const requeued = !job.cancelRequested && job.attempt < job.maxAttempts;
      const timestamp = now.toISOString();
      job.attempt = requeued ? job.attempt + 1 : job.attempt;
      job.state = requeued ? 'queued' : job.cancelRequested ? 'cancelled' : 'failed';
      job.availableAt = new Date(now.getTime() + this.retryBackoffMs).toISOString();
      job.error = { code: 'RUNNER_LOST', message: 'Runner lease expired' };
      job.updatedAt = timestamp;
      this.clearLease(job);
      recovered.push({
        jobId: job.id,
        runId: job.runId,
        previousOwner,
        requeued,
        nextAttempt: job.attempt,
        phase: requeued ? 'queued' : job.cancelRequested ? 'cancelled' : 'runner_lost',
      });
    }
    return recovered;
  }

  async listDueSchedules(now: Date, limit: number): Promise<WorkerSchedule[]> {
    return [...this.schedules.values()]
      .filter((schedule) => schedule.enabled)
      .filter((schedule) => new Date(schedule.nextRunAt).getTime() <= now.getTime())
      .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt))
      .slice(0, limit)
      .map((schedule) => clone(schedule));
  }

  async advanceSchedule(
    scheduleId: string,
    expectedRunAt: string,
    nextRunAt: string,
  ): Promise<boolean> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule || schedule.nextRunAt !== expectedRunAt) return false;
    schedule.nextRunAt = nextRunAt;
    return true;
  }

  async enqueueScheduledRun(input: ScheduledEnqueue): Promise<ScheduledEnqueueResult | null> {
    const existing = this.scheduledResults.get(input.idempotencyKey);
    if (existing) return { ...clone(existing), duplicate: true };
    const schedule = this.schedules.get(input.schedule.id);
    if (!schedule || schedule.nextRunAt !== input.scheduledFor) return null;
    if (!(await this.advanceSchedule(schedule.id, input.scheduledFor, input.nextRunAt)))
      return null;
    const runId = randomUUID();
    const jobId = randomUUID();
    const request = input.schedule.request;
    this.addJob({
      id: jobId,
      runId,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      priority: request.priority ?? 0,
      availableAt: input.scheduledFor,
      requiredCapabilities: request.requiredCapabilities ?? ['playwright'],
      labels: request.labels ?? [],
      timeoutMs: request.timeoutMs,
      spec: request.configuration ?? {},
    });
    const result = { runId, jobId, duplicate: false };
    this.scheduledResults.set(input.idempotencyKey, result);
    return clone(result);
  }

  private matchesLease(
    job: QueueJob | undefined,
    leaseId: string,
    fencingToken: number,
  ): job is QueueJob {
    if (
      !job ||
      job.state !== 'leased' ||
      job.leaseId !== leaseId ||
      job.fencingToken !== fencingToken ||
      !job.leaseExpiresAt ||
      new Date(job.leaseExpiresAt).getTime() <= this.now().getTime()
    ) {
      return false;
    }
    return true;
  }

  private clearLease(job: QueueJob): void {
    job.leaseId = null;
    job.leaseOwner = null;
    job.leaseExpiresAt = null;
  }
}
