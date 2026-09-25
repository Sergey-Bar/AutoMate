export type RunPhase =
  | 'queued'
  | 'assigned'
  | 'preparing'
  | 'running'
  | 'collecting'
  | 'normalizing'
  | 'analyzing'
  | 'gate_evaluation'
  | 'complete'
  | 'cancelled'
  | 'timed_out'
  | 'runner_lost'
  | 'infra_failed'
  | 'config_failed'
  | 'blocked'
  | 'partial';

export type RunOutcome =
  | 'passed'
  | 'failed'
  | 'unknown'
  | 'partial'
  | 'cancelled'
  | 'timed_out'
  | 'runner_lost'
  | 'infra_failed'
  | 'config_failed'
  | 'blocked'
  | null;

export type ExecutionTestStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'flaky'
  | 'skipped'
  | 'blocked'
  | 'unknown'
  | 'cancelled'
  | 'timed_out';

export type JobState = 'queued' | 'leased' | 'completed' | 'failed' | 'cancelled' | 'requeued';
export type RunnerHealth = 'healthy' | 'degraded' | 'draining' | 'offline' | 'revoked';
export type GateStatus = 'passed' | 'failed' | 'warning' | 'unknown' | 'not_evaluated';
export type ReleaseDecision = 'ready' | 'ready_with_warnings' | 'blocked' | 'unknown';
export type ArtifactKind =
  | 'report'
  | 'junit'
  | 'json'
  | 'log'
  | 'stdout'
  | 'stderr'
  | 'screenshot'
  | 'video'
  | 'trace'
  | 'html'
  | 'attachment'
  | 'other';
export type DomainName =
  | 'browser'
  | 'api'
  | 'mobile'
  | 'performance'
  | 'security'
  | 'accessibility'
  | 'other';
export type DomainStatus =
  | 'passed'
  | 'failed'
  | 'warning'
  | 'unknown'
  | 'not_configured'
  | 'not_implemented';

export interface CreateRunInput {
  externalId?: string | null;
  source?: string;
  framework?: string;
  adapterVersion?: string;
  testType?: string;
  projectId?: string;
  environmentId?: string;
  releaseId?: string;
  branch?: string;
  commit?: string;
  suite?: string;
  selection?: string[];
  timeoutMs?: number;
  priority?: number;
  requiredCapabilities?: string[];
  labels?: string[];
  configuration?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  policyId?: string;
  retryOfRunId?: string;
  availableAt?: string;
}

export interface ExecutionTestResult {
  id: string;
  title: string;
  file?: string | null;
  status: ExecutionTestStatus;
  durationMs?: number | null;
  attempt?: number;
  error?: { code?: string; message: string } | null;
  metadata?: Record<string, unknown>;
}

export interface ExecutionSummary {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  blocked: number;
  unknown: number;
  durationMs: number | null;
}

export interface RunnerSummary {
  id: string;
  name?: string;
  version?: string;
  os?: string;
  arch?: string;
  health: RunnerHealth;
  lastHeartbeatAt: string | null;
}

export interface ExecutionRun {
  id: string;
  externalId: string | null;
  source: string;
  framework: string;
  adapterVersion: string;
  testType: string;
  projectId: string | null;
  environmentId: string | null;
  releaseId: string | null;
  branch: string | null;
  commit: string | null;
  suite: string | null;
  selection: string[];
  timeoutMs: number;
  priority: number;
  requiredCapabilities: string[];
  labels: string[];
  configuration: Record<string, unknown>;
  metadata: Record<string, unknown>;
  policyId: string | null;
  idempotencyKey: string;
  workspaceId: string;
  attempt: number;
  retryOfRunId: string | null;
  phase: RunPhase;
  outcome: RunOutcome;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  runner: RunnerSummary | null;
  tests: ExecutionTestResult[];
  summary: ExecutionSummary;
  error: { code: string; message: string } | null;
  rawEvidenceRefs: string[];
  artifacts: ArtifactDescriptor[];
  policyEvaluation: GateEvaluation | null;
  status: string;
}

export interface ExecutionJob {
  id: string;
  runId: string;
  attempt: number;
  priority: number;
  state: JobState;
  availableAt: string;
  requiredCapabilities: string[];
  labels: string[];
  leaseId: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  fencingToken: number;
  heartbeatAt: string | null;
  idempotencyKey: string;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunnerManifest {
  id: string;
  name: string;
  version: string;
  os: string;
  arch: string;
  capabilities: string[];
  labels: string[];
  slots: number;
}

export interface RegisteredRunner extends RunnerManifest {
  health: RunnerHealth;
  tokenHash: string;
  tokenExpiresAt: string;
  lastHeartbeatAt: string | null;
  activeJobIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RunnerHeartbeat {
  runnerId: string;
  health: RunnerHealth;
  lastHeartbeatAt: string;
  activeJobIds: string[];
  metrics?: Record<string, unknown>;
}

export interface JobClaim {
  jobId: string;
  runId: string;
  attempt: number;
  leaseId: string;
  fencingToken: number;
  timeoutMs: number;
  spec: Record<string, unknown>;
  availableAt: string;
  leaseExpiresAt: string;
}

export type ExecutionEventType =
  | 'run.phase'
  | 'run.progress'
  | 'test.started'
  | 'test.completed'
  | 'artifact.ready'
  | 'runner.log'
  | 'run.completed'
  | 'custom';

export interface ExecutionEventInput {
  eventId: string;
  sequence: number;
  type: ExecutionEventType | string;
  occurredAt?: string;
  payload?: Record<string, unknown>;
}

export interface ExecutionEvent extends Required<ExecutionEventInput> {
  runId: string;
  jobId: string;
  leaseId: string;
  fencingToken: number;
  receivedAt: string;
  hash: string;
}

export interface EventApplyResult {
  eventId: string;
  sequence: number;
  status: 'accepted' | 'duplicate' | 'conflict';
  hash?: string;
  reason?: string;
}

export interface ArtifactDescriptor {
  id: string;
  runId: string;
  jobId: string | null;
  testId: string | null;
  kind: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  storageKey: string;
  createdAt: string;
  expiresAt: string | null;
  legalHold: boolean;
  metadata: Record<string, unknown>;
}

export interface StoredArtifact extends ArtifactDescriptor {
  bytes: Uint8Array;
}

export interface QualityPolicy {
  id: string;
  workspaceId: string;
  name: string;
  version: string;
  hash: string;
  requiredDomains: DomainName[];
  browserPassRateThreshold: number;
  maxFlakyRate: number;
  maxDurationMs: number | null;
  rules: Array<{
    domain: DomainName;
    required: boolean;
    minimumPassRate?: number;
    requiredArtifactKinds: ArtifactKind[];
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface GateEvaluation {
  id: string;
  runId: string;
  releaseId: string | null;
  policyId: string;
  policyVersion: string;
  policyHash: string;
  status: GateStatus;
  decision: ReleaseDecision;
  reasons: string[];
  evidenceRefs: string[];
  domainStatuses: Record<DomainName, DomainStatus>;
  evaluatedAt: string;
}

export interface ReleaseReadiness {
  releaseId: string;
  decision: ReleaseDecision;
  browser: DomainStatus;
  domains: Record<DomainName, DomainStatus>;
  latestRunId: string | null;
  gate: GateEvaluation | null;
  evaluatedAt: string;
}

export interface CreateRunResult {
  run: ExecutionRun;
  job: ExecutionJob;
  duplicate: boolean;
}

export interface LeaseReapResult {
  jobId: string;
  runId: string;
  requeued: boolean;
  phase: RunPhase;
  status: JobState;
}

export interface JobCompletionInput {
  leaseId: string;
  fencingToken: number;
  status?: string;
  phase?: RunPhase | 'completed';
  outcome?: RunOutcome;
  summary?: Partial<ExecutionSummary>;
  tests?: ExecutionTestResult[];
  error?: { code?: string; message: string } | null;
}

export interface JobCompletionResult {
  run: ExecutionRun;
  job: ExecutionJob;
  status: 'accepted' | 'duplicate';
}

export interface ExecutionStore {
  createRun(
    input: CreateRunInput,
    idempotencyKey: string,
    workspaceId?: string,
  ): Promise<CreateRunResult>;
  create(
    input: CreateRunInput,
    idempotencyKey: string,
    workspaceId?: string,
  ): Promise<CreateRunResult>;
  listRuns(workspaceId?: string, releaseId?: string): Promise<ExecutionRun[]>;
  list(workspaceId?: string, releaseId?: string): Promise<ExecutionRun[]>;
  getRun(runId: string, workspaceId?: string): Promise<ExecutionRun | null>;
  get(runId: string, workspaceId?: string): Promise<ExecutionRun | null>;
  cancelRun(runId: string, workspaceId?: string): Promise<ExecutionRun | null>;
  cancel(runId: string, workspaceId?: string): Promise<ExecutionRun | null>;
  retryRun(
    runId: string,
    workspaceId?: string,
    idempotencyKey?: string,
  ): Promise<CreateRunResult | null>;
  retry(
    runId: string,
    workspaceId?: string,
    idempotencyKey?: string,
  ): Promise<CreateRunResult | null>;
  getJob(jobId: string): Promise<ExecutionJob | null>;
  listJobs(workspaceId?: string): Promise<ExecutionJob[]>;
  registerRunner(
    manifest: RunnerManifest,
    tokenHash: string,
    tokenExpiresAt: string,
    workspaceId?: string,
  ): Promise<RegisteredRunner>;
  getRunner(runnerId: string): Promise<RegisteredRunner | null>;
  authenticateRunner(token: string): Promise<RegisteredRunner | null>;
  heartbeatRunner(
    runnerId: string,
    activeJobIds?: string[],
    health?: RunnerHealth,
  ): Promise<RunnerHeartbeat | null>;
  claimJob(
    runnerId: string,
    capabilities?: string[],
    labels?: string[],
    now?: Date,
  ): Promise<JobClaim | null>;
  appendEvents(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    events: ExecutionEventInput[],
  ): Promise<EventApplyResult[]>;
  listEvents(runId: string): Promise<ExecutionEvent[]>;
  getRunEvents(runId: string): Promise<ExecutionEvent[]>;
  completeJob(jobId: string, completion: JobCompletionInput): Promise<JobCompletionResult | null>;
  addArtifact(
    input: Omit<StoredArtifact, 'id' | 'checksum' | 'sizeBytes' | 'createdAt'> & {
      bytes: Uint8Array;
    },
  ): Promise<ArtifactDescriptor>;
  getArtifact(artifactId: string): Promise<StoredArtifact | null>;
  listArtifacts(runId: string): Promise<ArtifactDescriptor[]>;
  createPolicy(
    input: Omit<QualityPolicy, 'id' | 'hash' | 'createdAt' | 'updatedAt'>,
  ): Promise<QualityPolicy>;
  listPolicies(workspaceId?: string): Promise<QualityPolicy[]>;
  getPolicy(policyId: string, workspaceId?: string): Promise<QualityPolicy | null>;
  saveGate(evaluation: GateEvaluation): Promise<GateEvaluation>;
  getGate(runId: string): Promise<GateEvaluation | null>;
  getRunGate(workspaceId: string, runId: string): Promise<GateEvaluation | null>;
  reapExpiredLeases(now?: Date): Promise<LeaseReapResult[]>;
  getReadiness(releaseId: string, workspaceId?: string): Promise<ReleaseReadiness>;
  getReleaseReadiness(workspaceId: string, releaseId: string): Promise<ReleaseReadiness>;
}

export interface ExecutionStoreOptions {
  now?: () => Date;
  leaseDurationMs?: number;
  leaseMs?: number;
  tokenTtlMs?: number;
}

export function isTerminalPhase(phase: RunPhase): boolean {
  return [
    'complete',
    'cancelled',
    'timed_out',
    'runner_lost',
    'infra_failed',
    'config_failed',
    'blocked',
    'partial',
  ].includes(phase);
}

export function isInfrastructurePhase(phase: RunPhase): boolean {
  return phase === 'runner_lost' || phase === 'infra_failed' || phase === 'config_failed';
}

export type RequestLike = Request;
