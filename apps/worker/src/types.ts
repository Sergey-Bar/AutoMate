export type QueueJobState = 'queued' | 'leased' | 'completed' | 'failed' | 'cancelled' | 'requeued';

export type JobResultStatus =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'infra_failed'
  | 'config_failed'
  | 'runner_lost'
  | 'requeue';

export interface QueueJob {
  id: string;
  runId: string;
  workspaceId: string;
  projectId: string | null;
  attempt: number;
  maxAttempts: number;
  priority: number;
  state: QueueJobState;
  availableAt: string;
  requiredCapabilities: string[];
  labels: string[];
  timeoutMs: number;
  spec: Record<string, unknown>;
  leaseId: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  fencingToken: number;
  cancelRequested: boolean;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobClaim {
  jobId: string;
  runId: string;
  workspaceId: string;
  projectId: string | null;
  attempt: number;
  leaseId: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  fencingToken: number;
  timeoutMs: number;
  spec: Record<string, unknown>;
}

export interface LeaseRecovery {
  jobId: string;
  runId: string;
  previousOwner: string;
  requeued: boolean;
  nextAttempt: number;
  phase: 'queued' | 'runner_lost' | 'cancelled';
}

export interface JobCompletion {
  leaseId: string;
  fencingToken: number;
  status: Exclude<JobResultStatus, 'requeue'>;
  error?: { code: string; message: string } | null;
}

export interface ScheduledRunRequest {
  workspaceId: string;
  projectId: string;
  environmentId: string;
  releaseId: string;
  branch: string;
  commit: string;
  testType?: string;
  framework?: string;
  suite?: string;
  selection?: string[];
  timeoutMs?: number;
  priority?: number;
  requiredCapabilities?: string[];
  labels?: string[];
  configuration?: Record<string, unknown>;
  policyId?: string;
}

export interface WorkerSchedule {
  id: string;
  cronExpr: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string;
  request: ScheduledRunRequest;
  misfirePolicy: 'skip' | 'run_once' | 'catch_up';
  blackoutWindows?: unknown;
}

export interface ScheduledEnqueue {
  schedule: WorkerSchedule;
  scheduledFor: string;
  nextRunAt: string;
  idempotencyKey: string;
}

export interface ScheduledEnqueueResult {
  runId: string;
  jobId: string;
  duplicate: boolean;
}

export interface ExecutionStore {
  ping(): Promise<boolean>;
  claimJob(
    runnerId: string,
    capabilities: readonly string[],
    labels: readonly string[],
    now?: Date,
  ): Promise<JobClaim | null>;
  renewLease(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    leaseExpiresAt: Date,
  ): Promise<boolean>;
  releaseJob(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    availableAt?: Date,
  ): Promise<boolean>;
  completeJob(jobId: string, completion: JobCompletion): Promise<boolean>;
  reapExpiredLeases(now?: Date): Promise<LeaseRecovery[]>;
  listDueSchedules(now: Date, limit: number): Promise<WorkerSchedule[]>;
  advanceSchedule(scheduleId: string, expectedRunAt: string, nextRunAt: string): Promise<boolean>;
  enqueueScheduledRun(input: ScheduledEnqueue): Promise<ScheduledEnqueueResult | null>;
  close?(): Promise<void>;
}

export interface ExecutionStoreOptions {
  leaseDurationMs?: number;
  retryBackoffMs?: number;
  starvationAfterMs?: number;
  maxAttempts?: number;
  workspaceQuota?: number;
  projectQuota?: number;
  now?: () => Date;
}

export interface JobHandler {
  execute(claim: JobClaim, signal: AbortSignal): Promise<JobResultStatus>;
}
