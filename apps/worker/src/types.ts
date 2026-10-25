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
  /** 
ull only for a repository-health scan (	estType: 'health'). */
  environmentId: string | null;
  releaseId: string | null;
  branch: string;
  commit: string | null;
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

/**
 * A `schedules` row whose `run_options.kind` is `report`: it fires a scheduled report,
 * not a run. The API writes it (id `report:<subscriptionId>`) when a subscription is saved.
 */
export interface ReportSchedule {
  id: string;
  workspaceId: string;
  subscriptionId: string;
  cronExpr: string;
  timezone: string;
  nextRunAt: string;
}

export interface ScheduledReportEnqueue {
  schedule: ReportSchedule;
  scheduledFor: string;
  nextRunAt: string;
  idempotencyKey: string;
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
  /** Report schedules that are due. Absent on a store that cannot hold them. */
  listDueReportSchedules?(now: Date, limit: number): Promise<ReportSchedule[]>;
  /**
   * Advances the schedule and queues one `report_deliveries` row, atomically. `false` when
   * the occurrence was already taken — by another worker, or by this one a poll ago.
   */
  enqueueScheduledReport?(input: ScheduledReportEnqueue): Promise<boolean>;
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
