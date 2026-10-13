import { randomUUID } from 'node:crypto';
import { asc, and, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { executionJobs, runs, runners } from '@automate/db';
import { tokenMatches } from './digest.js';
import { reapOutcome } from './lease-reap.js';
import {
  digest,
  jobScope,
  mapJob,
  mapRunner,
  nullableString,
  nowDate,
  numberValue,
  rowValue,
  stringValue,
  uuidFor,
  type AnyPgDb,
  type DrizzleExecutionStoreOptions,
} from './drizzle-execution-store-rows.js';
import type {
  JobClaim,
  LeaseReapResult,
  RunnerHealth,
  RunnerManifest,
  RegisteredRunner,
  RunnerHeartbeat,
} from './types.js';

/**
 * The lease: who holds a job, for how long, and what happens when they stop
 * holding it.
 *
 * Enrolment lives here with it, because a runner is nothing but the identity a
 * lease is issued to — `registerRunner` and `heartbeatRunner` write the same two
 * tables this module's claiming and reaping do, and a runner that could not be
 * claimed against would be a row no other module reads.
 *
 * Everything in here is workspace-optional on purpose and the reaper is global:
 * a single process owns every runner, so the sweep is system-wide housekeeping.
 * That is a *decision*, and `runner-lifecycle.drizzle.test.ts` records the
 * question it raises rather than asserting it as settled — the test reads this
 * file's reaper and fails if it starts scoping by workspace without the note
 * above it being updated.
 */
export class DrizzleExecutionLeases {
  private readonly db: AnyPgDb;
  private readonly options: DrizzleExecutionStoreOptions;

  constructor(options: DrizzleExecutionStoreOptions) {
    this.db = options.db;
    this.options = options;
  }

  async registerRunner(
    manifest: RunnerManifest,
    tokenHash: string,
    tokenExpiresAt: string,
    workspaceId = this.options.workspaceId ?? 'default-workspace',
  ): Promise<RegisteredRunner> {
    const timestamp = nowDate(this.options);
    const runnerId = uuidFor(manifest.id);
    const row = {
      id: runnerId,
      workspaceId,
      name: manifest.name,
      version: manifest.version,
      os: manifest.os,
      arch: manifest.arch,
      capabilities: manifest.capabilities,
      labels: manifest.labels,
      slots: manifest.slots,
      health: 'healthy' as const,
      tokenHash,
      tokenExpiresAt: new Date(tokenExpiresAt),
      lastHeartbeatAt: timestamp,
      metrics: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db
      .insert(runners)
      .values(row)
      .onConflictDoUpdate({
        target: runners.id,
        set: {
          name: manifest.name,
          version: manifest.version,
          os: manifest.os,
          arch: manifest.arch,
          capabilities: manifest.capabilities,
          labels: manifest.labels,
          slots: manifest.slots,
          health: 'healthy',
          tokenHash,
          tokenExpiresAt: new Date(tokenExpiresAt),
          lastHeartbeatAt: timestamp,
          updatedAt: timestamp,
        },
      });
    return mapRunner(row);
  }

  async getRunner(runnerId: string): Promise<RegisteredRunner | null> {
    const row = (await this.db.select().from(runners).where(eq(runners.id, runnerId)).limit(1))[0];
    return row ? mapRunner(rowValue(row)) : null;
  }

  /**
   * One indexed lookup, not a scan of the table.
   *
   * This read **every row in `runners`** and compared each token hash in JavaScript.
   * That is finding 45, and it was still open: the plan recorded the finding as stale
   * on the grounds that `runners.token_hash` is uniquely indexed — which is true, and
   * irrelevant, because the query never used the index. Every authenticated request
   * paid a full table read whose cost grew with the number of runners enrolled.
   *
   * The `WHERE` now names the column, so `runners_token_hash_unique` serves it, and the
   * two remaining predicates move into SQL with it: a revoked runner and an expired
   * token are both refusals, and filtering them in JavaScript meant transferring rows
   * only to discard them.
   *
   * `token_hash` is not unique in the schema's intent — a rotation could leave two
   * rows with the same hash for an instant — so the candidate set is `limit`-ed rather
   * than assumed to be one row, and the comparison is still `timingSafeEqual` per
   * candidate. The constant-time comparison is kept deliberately: pushing equality into
   * SQL would be index-served and fast, and would also make the token's hash a timing
   * oracle, which is the one thing hashing it was for.
   */
  async authenticateRunner(token: string): Promise<RegisteredRunner | null> {
    const expected = digest(token);
    const rows = await this.db
      .select()
      .from(runners)
      .where(
        and(
          eq(runners.tokenHash, expected),
          ne(runners.health, 'revoked' as never),
          gt(runners.tokenExpiresAt, nowDate(this.options)),
        ),
      )
      // Two, not one: the hash is unique in practice but the column does not say so,
      // and a limit of 1 would silently pick a winner if it ever were not.
      .limit(2);
    for (const row of rows) {
      const data = rowValue(row);
      if (tokenMatches(token, stringValue(data['tokenHash']))) return mapRunner(data);
    }
    return null;
  }

  async heartbeatRunner(
    runnerId: string,
    activeJobIds: string[] = [],
    health: RunnerHealth = 'healthy',
  ): Promise<RunnerHeartbeat | null> {
    const timestamp = nowDate(this.options);
    const updated = await this.db
      .update(runners)
      .set({ lastHeartbeatAt: timestamp, health, updatedAt: timestamp })
      .where(eq(runners.id, runnerId))
      .returning();
    if (updated.length === 0) return null;
    const leaseMs = this.options.leaseDurationMs ?? this.options.leaseMs ?? 30_000;
    // **The renewal is not the whole heartbeat.** The lease is extended for every
    // job this runner holds — a suite that runs longer than one lease interval is
    // normal, and a renewal that did not happen would kill it — and the delay is
    // measured from `now` rather than from the run's start, so the budget is the
    // remaining time and not an accumulating total.
    await this.db
      .update(executionJobs)
      .set({
        heartbeatAt: timestamp,
        leaseExpiresAt: new Date(timestamp.getTime() + leaseMs),
        updatedAt: timestamp,
      })
      .where(and(eq(executionJobs.leaseOwner, runnerId), eq(executionJobs.state, 'leased')));
    /**
     * The jobs this runner holds that have been asked to stop.
     *
     * **`cancelRun` no longer clears the job's lease**, which is what used to make
     * a cancel un-deliverable: by the time the next heartbeat arrived there was no
     * owner left to ask. The request is recorded on the job (`cancel_requested_at`)
     * and survives here until the runner reports the job cancelled, so the
     * handshake is two-sided — a stopped child whose parent never asked is an
     * orphan, and a parent whose child never heard is the defect this fixes.
     */
    const requested = await this.db
      .select()
      .from(executionJobs)
      .where(
        jobScope(
          and(
            eq(executionJobs.leaseOwner, runnerId),
            eq(executionJobs.state, 'leased'),
            isNotNull(executionJobs.cancelRequestedAt),
          ),
          undefined,
        ),
      );
    return {
      runnerId,
      health,
      lastHeartbeatAt: timestamp.toISOString(),
      activeJobIds: [...new Set(activeJobIds)],
      cancelledJobIds: requested.map((row) => rowValue(row)['id'] as string),
      // The same answer under the runner's other name for it, so a runner that
      // unions the two lists and a runner that reads one both get the truth.
      cancelRequestedJobIds: requested.map((row) => rowValue(row)['id'] as string),
      leaseExpiresAt: new Date(timestamp.getTime() + leaseMs).toISOString(),
    };
  }

  async claimJob(
    runnerId: string,
    capabilities: string[] = [],
    labels: string[] = [],
    now = nowDate(this.options),
    workspaceId?: string,
  ): Promise<JobClaim | null> {
    await this.reapExpiredLeases(now);
    const runner = await this.getRunner(runnerId);
    if (!runner || runner.health === 'revoked' || runner.health === 'offline') return null;
    const active = await this.db
      .select()
      .from(executionJobs)
      .where(
        jobScope(
          and(eq(executionJobs.leaseOwner, runnerId), eq(executionJobs.state, 'leased')),
          workspaceId,
        ),
      );
    if (active.length >= Math.max(1, runner.slots)) return null;
    const effective = new Set([...runner.capabilities, ...capabilities]);
    const effectiveLabels = new Set([...runner.labels, ...labels]);
    const claim = await this.db.transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(executionJobs)
        .where(
          jobScope(
            and(
              inArray(executionJobs.state, ['queued', 'requeued']),
              // **A job that was asked to stop is not claimable.** The request
              // outlives the lease that was cancelled, and a job whose run is
              // already cancelled must not be picked up by a second runner.
              isNull(executionJobs.cancelRequestedAt),
            ),
            workspaceId,
          ),
        )
        .orderBy(desc(executionJobs.priority), asc(executionJobs.createdAt))
        .limit(50)
        .for('update', { skipLocked: true });
      const job = candidates
        .map((row) => mapJob(rowValue(row)))
        .find(
          (item) =>
            new Date(item.availableAt).getTime() <= now.getTime() &&
            item.requiredCapabilities.every((itemCapability) => effective.has(itemCapability)) &&
            item.labels.every((label) => effectiveLabels.has(label)),
        );
      if (!job) return null;
      const leaseId = randomUUID();
      const leaseExpiresAt = new Date(
        now.getTime() + (this.options.leaseDurationMs ?? this.options.leaseMs ?? 30_000),
      );
      const updatedRows = await tx
        .update(executionJobs)
        .set({
          state: 'leased',
          leaseId,
          leaseOwner: runnerId,
          leaseExpiresAt,
          heartbeatAt: now,
          fencingToken: job.fencingToken + 1,
          updatedAt: now,
        })
        .where(
          jobScope(
            and(eq(executionJobs.id, job.id), inArray(executionJobs.state, ['queued', 'requeued'])),
            workspaceId,
          ),
        )
        .returning();
      if (updatedRows.length === 0) return null;
      await tx
        .update(runs)
        .set({
          phase: 'assigned',
          status: 'running',
          startedAt: now,
          updatedAt: now,
          runnerId,
          currentJobId: job.id,
        })
        .where(eq(runs.id, job.runId));
      const run = (await tx.select().from(runs).where(eq(runs.id, job.runId)).limit(1))[0];
      return {
        job: mapJob(rowValue(updatedRows[0])),
        run: run ? rowValue(run) : null,
        leaseId,
        leaseExpiresAt,
      };
    });
    if (!claim?.run) return null;
    return {
      jobId: claim.job.id,
      runId: claim.job.runId,
      attempt: claim.job.attempt,
      leaseId: claim.leaseId,
      fencingToken: claim.job.fencingToken,
      timeoutMs: numberValue(claim.run['timeoutMs'], 1_800_000),
      spec:
        claim.job.requiredCapabilities.length >= 0
          ? {
              projectId: nullableString(claim.run['projectId']),
              environmentId: nullableString(claim.run['environmentId']),
              suite: nullableString(claim.run['suite']),
              selection: Array.isArray(claim.run['selection']) ? claim.run['selection'] : [],
              configuration:
                claim.run['config'] && typeof claim.run['config'] === 'object'
                  ? (claim.run['config'] as Record<string, unknown>)
                  : {},
            }
          : {},
      availableAt: claim.job.availableAt,
      leaseExpiresAt: claim.leaseExpiresAt.toISOString(),
    };
  }

  async reapExpiredLeases(now = nowDate(this.options)): Promise<LeaseReapResult[]> {
    const expired = await this.db
      .select()
      .from(executionJobs)
      .where(
        and(eq(executionJobs.state, 'leased'), sql`${executionJobs.leaseExpiresAt} <= ${now}`),
      );
    const results: LeaseReapResult[] = [];
    for (const row of expired) {
      const job = mapJob(rowValue(row));
      // **A job that was asked to stop is not re-run, whatever its lease says.**
      // The operator's decision has to survive the runner losing the lease, or a
      // cancelled run executes a second time and the second run's completion is
      // the one that lands. The table itself lives in `lease-reap.ts`, shared
      // with the in-memory store — two implementations of it was the way the two
      // stores could disagree about a cancelled job.
      const cancelRequested = job.cancelRequestedAt !== null;
      const outcome = reapOutcome(cancelRequested, job.attempt);
      const error = cancelRequested ? null : 'RUNNER_LOST';
      const errorMessage = cancelRequested ? null : 'Runner lease expired';
      await this.db.transaction(async (tx) => {
        await tx
          .update(executionJobs)
          .set({
            attempt: outcome.attempt,
            state: outcome.jobState,
            availableAt: outcome.canRequeue ? now : new Date(job.availableAt),
            leaseId: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            errorCode: error,
            errorMessage,
            updatedAt: now,
          })
          .where(eq(executionJobs.id, job.id));
        await tx
          .update(runs)
          .set({
            attempt: outcome.attempt,
            phase: outcome.phase,
            outcome: outcome.outcome,
            status: outcome.status,
            updatedAt: now,
            errorCode: error,
            errorMessage,
          })
          .where(eq(runs.id, job.runId));
      });
      results.push({
        jobId: job.id,
        runId: job.runId,
        requeued: outcome.result.requeued,
        phase: outcome.result.phase,
        status: outcome.result.status,
      });
    }
    return results;
  }
}
