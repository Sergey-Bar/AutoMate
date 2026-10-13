import type { ArtifactBytesStore } from '../infrastructure/artifact-store.js';
import { DrizzleExecutionArtifacts } from './drizzle-execution-store-artifacts.js';
import { DrizzleExecutionCanonical } from './drizzle-execution-store-canonical.js';
import { DrizzleExecutionLeases } from './drizzle-execution-store-leases.js';
import { DrizzleExecutionOutbox } from './drizzle-execution-store-outbox.js';
import type { AnyPgDb, DrizzleExecutionStoreOptions } from './drizzle-execution-store-rows.js';
import type {
  ArtifactDescriptor,
  CreateRunInput,
  CreateRunResult,
  EventApplyResult,
  EventPage,
  ExecutionEventInput,
  ExecutionJob,
  ExecutionRun,
  ExecutionStore,
  GateEvaluation,
  JobClaim,
  JobCompletionInput,
  JobCompletionResult,
  LeaseReapResult,
  QualityPolicy,
  ReleaseReadiness,
  RegisteredRunner,
  RunPage,
  RunnerHealth,
  RunnerHeartbeat,
  RunnerManifest,
  StoredArtifact,
} from './types.js';

export type { ArtifactBytesStore, DrizzleExecutionStoreOptions };

/**
 * The durable `ExecutionStore`, composed from its four seams.
 *
 * This class holds **no logic**. It owns the four collaborators the store was
 * split into — outbox, artifacts, leases, canonical — and forwards every method
 * of the interface to the one that owns it, so the interface is answered by
 * exactly one implementation each and no two of them can answer the same
 * question differently.
 *
 * The split is along seams the file already contained, and the interface did not
 * move: `store-parity.test.ts` runs the same twenty-six scenarios against this
 * store and against the in-memory one, which is what makes the refactor provable
 * rather than hopeful. The four modules and the row vocabulary they share:
 *
 * | Module | Owns |
 * |---|---|
 * | `drizzle-execution-store-outbox.ts` | event append, batch writes, retention policy |
 * | `drizzle-execution-store-artifacts.ts` | artifact bytes, compensation, bounded maps |
 * | `drizzle-execution-store-leases.ts` | claim, heartbeat, reap, the lease-scope predicate |
 * | `drizzle-execution-store-canonical.ts` | runs, tests, results, summaries, the projection reads |
 * | `drizzle-execution-store-rows.ts` | the row vocabulary every module reads through |
 *
 * The canonical half is the only one with a collaborator of its own: every
 * durable write records an outbox envelope beside it, so the outbox is
 * constructor-injected and cannot be quietly replaced by a write that emits
 * nothing.
 */
export class DrizzleExecutionStore implements ExecutionStore {
  private readonly outbox: DrizzleExecutionOutbox;
  private readonly artifacts: DrizzleExecutionArtifacts;
  private readonly leases: DrizzleExecutionLeases;
  private readonly canonical: DrizzleExecutionCanonical;

  constructor(options: DrizzleExecutionStoreOptions) {
    this.outbox = new DrizzleExecutionOutbox(options);
    this.artifacts = new DrizzleExecutionArtifacts(options);
    this.leases = new DrizzleExecutionLeases(options);
    this.canonical = new DrizzleExecutionCanonical(options, this.outbox);
  }

  async createRun(
    input: CreateRunInput,
    idempotencyKey: string,
    workspaceId?: string,
  ): Promise<CreateRunResult> {
    return this.canonical.createRun(input, idempotencyKey, workspaceId);
  }

  async create(
    input: CreateRunInput,
    idempotencyKey: string,
    workspaceId?: string,
  ): Promise<CreateRunResult> {
    return this.canonical.createRun(input, idempotencyKey, workspaceId);
  }

  async listRuns(
    workspaceId?: string,
    releaseId?: string,
    options?: { limit?: number; after?: string },
  ): Promise<RunPage> {
    return this.canonical.listRuns(workspaceId, releaseId, options);
  }

  async list(workspaceId?: string, releaseId?: string): Promise<ExecutionRun[]> {
    return (await this.canonical.listRuns(workspaceId, releaseId)).runs;
  }

  async getRun(runId: string, workspaceId?: string): Promise<ExecutionRun | null> {
    return this.canonical.getRun(runId, workspaceId);
  }

  async get(runId: string, workspaceId?: string): Promise<ExecutionRun | null> {
    return this.canonical.getRun(runId, workspaceId);
  }

  async cancelRun(runId: string, workspaceId?: string): Promise<ExecutionRun | null> {
    return this.canonical.cancelRun(runId, workspaceId);
  }

  async cancel(runId: string, workspaceId?: string): Promise<ExecutionRun | null> {
    return this.canonical.cancelRun(runId, workspaceId);
  }

  async retryRun(
    runId: string,
    workspaceId?: string,
    idempotencyKey?: string,
  ): Promise<CreateRunResult | null> {
    return this.canonical.retryRun(runId, workspaceId, idempotencyKey);
  }

  async retry(
    runId: string,
    workspaceId?: string,
    idempotencyKey?: string,
  ): Promise<CreateRunResult | null> {
    return this.canonical.retryRun(runId, workspaceId, idempotencyKey);
  }

  async getJob(jobId: string, workspaceId?: string): Promise<ExecutionJob | null> {
    return this.canonical.getJob(jobId, workspaceId);
  }

  async listJobs(workspaceId?: string): Promise<ExecutionJob[]> {
    return this.canonical.listJobs(workspaceId);
  }

  async registerRunner(
    manifest: RunnerManifest,
    tokenHash: string,
    tokenExpiresAt: string,
    workspaceId?: string,
  ): Promise<RegisteredRunner> {
    return this.leases.registerRunner(manifest, tokenHash, tokenExpiresAt, workspaceId);
  }

  async getRunner(runnerId: string): Promise<RegisteredRunner | null> {
    return this.leases.getRunner(runnerId);
  }

  async authenticateRunner(token: string): Promise<RegisteredRunner | null> {
    return this.leases.authenticateRunner(token);
  }

  async heartbeatRunner(
    runnerId: string,
    activeJobIds?: string[],
    health?: RunnerHealth,
  ): Promise<RunnerHeartbeat | null> {
    return this.leases.heartbeatRunner(runnerId, activeJobIds, health);
  }

  async claimJob(
    runnerId: string,
    capabilities: string[] = [],
    labels: string[] = [],
    now?: Date,
    workspaceId?: string,
  ): Promise<JobClaim | null> {
    return this.leases.claimJob(runnerId, capabilities, labels, now, workspaceId);
  }

  async appendEvents(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    events: ExecutionEventInput[],
    workspaceId?: string,
  ): Promise<EventApplyResult[]> {
    return this.canonical.appendEvents(jobId, leaseId, fencingToken, events, workspaceId);
  }

  async listEvents(
    workspaceId: string,
    runId: string,
    page?: { afterSequence?: number; limit?: number },
  ): Promise<EventPage> {
    return this.canonical.listEvents(workspaceId, runId, page);
  }

  async completeJob(
    jobId: string,
    completion: JobCompletionInput,
    workspaceId?: string,
  ): Promise<JobCompletionResult | null> {
    return this.canonical.completeJob(jobId, completion, workspaceId);
  }

  async addArtifact(
    input: Omit<StoredArtifact, 'id' | 'checksum' | 'sizeBytes' | 'createdAt'> & {
      bytes: Uint8Array;
    },
  ): Promise<ArtifactDescriptor> {
    return this.artifacts.addArtifact(input);
  }

  async getArtifact(artifactId: string, workspaceId?: string): Promise<StoredArtifact | null> {
    return this.artifacts.getArtifact(artifactId, workspaceId);
  }

  async getArtifactDescriptor(
    artifactId: string,
    workspaceId?: string,
  ): Promise<ArtifactDescriptor | null> {
    return this.artifacts.getArtifactDescriptor(artifactId, workspaceId);
  }

  async listArtifacts(workspaceId: string, runId: string): Promise<ArtifactDescriptor[]> {
    return this.artifacts.listArtifacts(workspaceId, runId);
  }

  async createPolicy(
    input: Omit<QualityPolicy, 'id' | 'hash' | 'createdAt' | 'updatedAt'>,
  ): Promise<QualityPolicy> {
    return this.canonical.createPolicy(input);
  }

  async listPolicies(workspaceId?: string): Promise<QualityPolicy[]> {
    return this.canonical.listPolicies(workspaceId);
  }

  async getPolicy(policyId: string, workspaceId?: string): Promise<QualityPolicy | null> {
    return this.canonical.getPolicy(policyId, workspaceId);
  }

  async saveGate(evaluation: GateEvaluation): Promise<GateEvaluation> {
    return this.canonical.saveGate(evaluation);
  }

  async getGate(workspaceId: string, runId: string): Promise<GateEvaluation | null> {
    return this.canonical.getGate(workspaceId, runId);
  }

  async getRunGate(workspaceId: string, runId: string): Promise<GateEvaluation | null> {
    return this.canonical.getRunGate(workspaceId, runId);
  }

  async reapExpiredLeases(now?: Date): Promise<LeaseReapResult[]> {
    return this.leases.reapExpiredLeases(now);
  }

  async getReadiness(releaseId: string, workspaceId?: string): Promise<ReleaseReadiness> {
    return this.canonical.getReadiness(releaseId, workspaceId);
  }

  async getReleaseReadiness(workspaceId: string, releaseId: string): Promise<ReleaseReadiness> {
    return this.canonical.getReleaseReadiness(workspaceId, releaseId);
  }
}

export function createDrizzleExecutionStore(
  db: AnyPgDb,
  options: Omit<DrizzleExecutionStoreOptions, 'db'> = {},
): DrizzleExecutionStore {
  return new DrizzleExecutionStore({ ...options, db });
}
