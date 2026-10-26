import { randomUUID } from 'node:crypto';
import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { deriveRunState, type DerivedRunState } from '@automate/orchestration';
import type { RunPhase } from '@automate/shared-contracts';
import type {
  DeliverySourceDue,
  DeliverySyncEnqueue,
  ExecutionStore,
  ExecutionStoreOptions,
  JobClaim,
  JobCompletion,
  JobResultStatus,
  LeaseRecovery,
  ReportSchedule,
  ScheduledEnqueue,
  ScheduledEnqueueResult,
  ScheduledReportEnqueue,
  WorkerSchedule,
} from './types.js';

interface RunnerRow extends QueryResultRow {
  workspace_id: string;
  capabilities: unknown;
  labels: unknown;
  slots: number;
}

interface CandidateRow extends QueryResultRow {
  id: string;
  run_id: string;
  workspace_id: string;
  project_id: string | null;
  attempt: number;
  timeout_ms: number | null;
  spec: Record<string, unknown>;
}

interface RecoveryRow extends QueryResultRow {
  id: string;
  run_id: string;
  lease_owner: string | null;
  attempt: number;
  run_attempt: number;
  metadata: Record<string, unknown>;
  cancel_requested_at: Date | null;
}

interface ScheduleRow extends QueryResultRow {
  id: string;
  /**
   * The authoritative tenant. `NOT NULL` since
   * `0015_schedule_workspace_scope.sql`, which is what makes it usable as a comparison
   * against `run_options` rather than a second place to keep a value in sync by hand.
   */
  workspace_id: string;
  cron_expr: string;
  run_options: Record<string, unknown>;
  enabled: boolean;
  next_run_at: Date;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Required for every schedule except a repository-health scan, which has none of them. */
function releaseScoped(request: Record<string, unknown>, field: string): string | null {
  if (request['testType'] === 'health' && request[field] === undefined) return null;
  return requiredString(request[field], field);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Schedule is missing ${field}`);
  return value;
}

/**
 * The `execution_jobs.state` a finished job lands in.
 *
 * Separate from the run state because the job column and the run column answer
 * different questions: the job is *done*, and the run is *how it ended*.
 */
function terminalJobState(status: JobResultStatus): 'completed' | 'failed' | 'cancelled' {
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  return 'failed';
}

/**
 * Folds the worker's result vocabulary into a run phase.
 *
 * The worker's vocabulary is **not** a phase vocabulary â€” `JobResultStatus` names
 * job outcomes, and `'completed'` is not a `RunPhase`. So the fold belongs here,
 * where the vocabulary is known, while the derivation that follows belongs in
 * `@automate/orchestration`.
 *
 * It is a closed, total map with no fallthrough, because a fallthrough is what
 * produced the defect: an unmatched status became `phase: status,
 * outcome: status`, and `'requeue'` is not a phase at all, so the pair violated
 * `runs_phase_outcome_check` â€” an unhandled 500 on the recovery path for a
 * well-formed request.
 */
function phaseForResult(status: JobResultStatus): RunPhase {
  switch (status) {
    case 'completed':
    case 'failed':
      return 'complete';
    case 'cancelled':
      return 'cancelled';
    case 'timed_out':
      return 'timed_out';
    case 'infra_failed':
      return 'infra_failed';
    case 'config_failed':
      return 'config_failed';
    case 'runner_lost':
      return 'runner_lost';
    case 'requeue':
      // Not a terminal state at all: the job goes back on the queue, so the run
      // is running again. `worker.execute` routes this to `releaseJob`, so the
      // fold exists to be total rather than because this path is reached.
      return 'queued';
  }
}

/**
 * The run triple for a finished job, derived as one value.
 *
 * `deriveRunState` is the authority and writes `phase`, `outcome` and `status`
 * together, which is what makes `runs_phase_outcome_check` unreachable â€” the same
 * thing `drizzle-execution-store.ts` does, and what this path did not.
 */
function terminalRunState(status: JobResultStatus): DerivedRunState {
  // A `completed` job claims `passed`; a `failed` one claims `failed`. Every
  // other status is a phase that implies its own outcome, so nothing is claimed.
  const claimed = status === 'completed' ? 'passed' : status === 'failed' ? 'failed' : null;
  return deriveRunState(phaseForResult(status), claimed);
}

export class PostgresExecutionStore implements ExecutionStore {
  private readonly pool: pg.Pool;
  private readonly leaseDurationMs: number;
  private readonly retryBackoffMs: number;
  private readonly starvationAfterMs: number;
  private readonly maxAttempts: number;
  private readonly workspaceQuota: number;
  private readonly projectQuota: number;
  private readonly now: () => Date;

  constructor(connectionString: string, options: ExecutionStoreOptions = {}) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
    this.leaseDurationMs = options.leaseDurationMs ?? 60_000;
    this.retryBackoffMs = options.retryBackoffMs ?? 1_000;
    this.starvationAfterMs = options.starvationAfterMs ?? 60_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.workspaceQuota = options.workspaceQuota ?? 100;
    this.projectQuota = options.projectQuota ?? 20;
    this.now = options.now ?? (() => new Date());
  }

  async ping(): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 AS ready');
    return result.rows[0]?.['ready'] === 1;
  }

  async claimJob(
    runnerId: string,
    capabilities: readonly string[],
    labels: readonly string[],
    now = this.now(),
  ): Promise<JobClaim | null> {
    return this.transaction(async (client) => {
      const runnerResult = await client.query<RunnerRow>(
        `SELECT workspace_id, capabilities, labels, slots
         FROM runners
         WHERE id = $1::uuid
           AND health = 'healthy'
           AND token_revoked_at IS NULL
           AND (token_expires_at IS NULL OR token_expires_at > $2::timestamptz)
         FOR UPDATE`,
        [runnerId, now],
      );
      const runner = runnerResult.rows[0];
      if (!runner) return null;
      const activeResult = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM execution_jobs
         WHERE lease_owner = $1::uuid AND state = 'leased'`,
        [runnerId],
      );
      if (Number(activeResult.rows[0]?.count ?? 0) >= runner.slots) return null;
      const effectiveCapabilities = [
        ...new Set([...strings(runner.capabilities), ...capabilities]),
      ];
      const effectiveLabels = [...new Set([...strings(runner.labels), ...labels])];
      const candidateResult = await client.query<CandidateRow>(
        `SELECT j.id, j.run_id, j.workspace_id, r.project_id, j.attempt,
                r.timeout_ms, j.spec
         FROM execution_jobs j
         JOIN runs r ON r.id = j.run_id
         WHERE j.state IN ('queued', 'requeued')
           AND j.workspace_id = $7
           AND j.available_at <= $1::timestamptz
           AND r.cancel_requested_at IS NULL
           AND j.required_capabilities <@ $2::jsonb
           AND j.labels <@ $3::jsonb
           AND (
             SELECT count(*) FROM execution_jobs workspace_active
             WHERE workspace_active.workspace_id = j.workspace_id
               AND workspace_active.state = 'leased'
           ) < $4
           AND (
             r.project_id IS NULL OR (
               SELECT count(*)
               FROM execution_jobs project_active
               JOIN runs project_run ON project_run.id = project_active.run_id
               WHERE project_run.project_id = r.project_id
                 AND project_active.state = 'leased'
             ) < $5
           )
         ORDER BY
           j.priority + floor(
             greatest(0, extract(epoch FROM ($1::timestamptz - j.created_at)))
             / greatest(1, $6::double precision / 1000)
           ) DESC,
           j.created_at ASC,
           j.id ASC
         FOR UPDATE OF j SKIP LOCKED
         LIMIT 1`,
        [
          now,
          JSON.stringify(effectiveCapabilities),
          JSON.stringify(effectiveLabels),
          this.workspaceQuota,
          this.projectQuota,
          this.starvationAfterMs,
          runner.workspace_id,
        ],
      );
      const candidate = candidateResult.rows[0];
      if (!candidate) return null;
      const leaseId = randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs);
      const leased = await client.query<{ fencing_token: number }>(
        `UPDATE execution_jobs
         SET state = 'leased', lease_id = $2, lease_owner = $1::uuid,
             lease_expires_at = $3, heartbeat_at = $5::timestamptz,
             fencing_token = fencing_token + 1, updated_at = $5::timestamptz,
             error_code = NULL, error_message = NULL
         WHERE id = $4::uuid
         RETURNING fencing_token`,
        [runnerId, leaseId, leaseExpiresAt, candidate.id, now],
      );
      await client.query(
        `UPDATE runs
         SET phase = 'assigned', outcome = NULL, status = 'running', runner_id = $1::uuid,
             current_job_id = $2::uuid, started_at = COALESCE(started_at, $3::timestamptz),
             updated_at = $3::timestamptz
         WHERE id = $4::uuid`,
        [runnerId, candidate.id, now, candidate.run_id],
      );
      const fencingToken = leased.rows[0]?.fencing_token;
      if (!fencingToken) throw new Error('Lease update did not return a fencing token');
      return {
        jobId: candidate.id,
        runId: candidate.run_id,
        workspaceId: candidate.workspace_id,
        projectId: candidate.project_id,
        attempt: candidate.attempt,
        leaseId,
        leaseOwner: runnerId,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        fencingToken,
        timeoutMs: candidate.timeout_ms ?? 30 * 60_000,
        spec: structuredClone(candidate.spec),
      } satisfies JobClaim;
    });
  }

  async renewLease(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    leaseExpiresAt: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE execution_jobs
       SET lease_expires_at = $4, heartbeat_at = now(), updated_at = now()
       WHERE id = $1::uuid AND state = 'leased' AND lease_id = $2 AND fencing_token = $3
         AND lease_expires_at > now() AND $4::timestamptz > now()`,
      [jobId, leaseId, fencingToken, leaseExpiresAt],
    );
    return result.rowCount === 1;
  }

  async releaseJob(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    availableAt = this.now(),
  ): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query<{ run_id: string }>(
        `UPDATE execution_jobs
         SET state = 'queued', available_at = $4, lease_id = NULL, lease_owner = NULL,
             lease_expires_at = NULL, heartbeat_at = NULL, updated_at = now()
         WHERE id = $1::uuid AND state = 'leased' AND lease_id = $2 AND fencing_token = $3
           AND lease_expires_at > now()
         RETURNING run_id`,
        [jobId, leaseId, fencingToken, availableAt],
      );
      const runId = result.rows[0]?.run_id;
      if (!runId) return false;
      await client.query(
        `UPDATE runs
         SET phase = 'queued', outcome = NULL, status = 'running', runner_id = NULL,
             updated_at = now()
         WHERE id = $1::uuid`,
        [runId],
      );
      return true;
    });
  }

  async completeJob(jobId: string, completion: JobCompletion): Promise<boolean> {
    return this.transaction(async (client) => {
      const status = completion.status;
      const run = terminalRunState(status);
      const result = await client.query<{ run_id: string }>(
        `UPDATE execution_jobs
         SET state = $4, completed_at = now(), lease_id = NULL, lease_owner = NULL,
             lease_expires_at = NULL, heartbeat_at = NULL, updated_at = now(),
             error_code = $5, error_message = $6
         WHERE id = $1::uuid AND state = 'leased' AND lease_id = $2 AND fencing_token = $3
           AND lease_expires_at > now()
         RETURNING run_id`,
        [
          jobId,
          completion.leaseId,
          completion.fencingToken,
          terminalJobState(status),
          completion.error?.code ?? null,
          completion.error?.message ?? null,
        ],
      );
      const runId = result.rows[0]?.run_id;
      if (!runId) return false;
      await client.query(
        `UPDATE runs
         SET phase = $2, outcome = $3, status = $4, finished_at = now(), completed_at = now(),
             error_code = $5, error_message = $6, updated_at = now()
         WHERE id = $1::uuid`,
        [
          runId,
          run.phase,
          run.outcome,
          run.status,
          completion.error?.code ?? null,
          completion.error?.message ?? null,
        ],
      );
      return true;
    });
  }

  async reapExpiredLeases(now = this.now()): Promise<LeaseRecovery[]> {
    return this.transaction(async (client) => {
      const expired = await client.query<RecoveryRow>(
        `SELECT j.id, j.run_id, j.lease_owner, j.attempt, r.attempt AS run_attempt,
                r.metadata, r.cancel_requested_at
         FROM execution_jobs j
         JOIN runs r ON r.id = j.run_id
         WHERE j.state = 'leased' AND j.lease_expires_at <= $1::timestamptz
         ORDER BY j.lease_expires_at ASC
         FOR UPDATE OF j SKIP LOCKED`,
        [now],
      );
      const recovered: LeaseRecovery[] = [];
      for (const row of expired.rows) recovered.push(await this.recoverLease(client, row, now));
      return recovered;
    });
  }

  /** Put one expired lease's job and run into the state `planRecovery` chose for it. */
  private async recoverLease(
    client: PoolClient,
    row: RecoveryRow,
    now: Date,
  ): Promise<LeaseRecovery> {
    const plan = planRecovery(row, maxAttemptsFor(row.metadata, this.maxAttempts));
    await client.query(
      `UPDATE execution_jobs
       SET state = $2, attempt = $3, available_at = $4, lease_id = NULL,
           lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
           error_code = 'RUNNER_LOST', error_message = 'Runner lease expired', updated_at = $5
       WHERE id = $1::uuid`,
      [row.id, plan.jobState, plan.nextAttempt, new Date(now.getTime() + this.retryBackoffMs), now],
    );
    await client.query(
      `UPDATE runs
       SET attempt = $2, phase = $3, outcome = $4, status = $5,
           runner_id = NULL, error_code = 'RUNNER_LOST',
           error_message = 'Runner lease expired', updated_at = $6,
           -- A run the reaper ends is ended: dated like \`completeJob\` dates one,
           -- whether it ended lost or cancelled. A requeued run is not ended.
           completed_at = CASE WHEN $3 IN ('runner_lost', 'cancelled') THEN $6 ELSE completed_at END,
           finished_at = CASE WHEN $3 IN ('runner_lost', 'cancelled') THEN $6 ELSE finished_at END
       WHERE id = $1::uuid`,
      [row.run_id, plan.nextAttempt, plan.phase, plan.outcome, plan.runStatus, now],
    );
    return {
      jobId: row.id,
      runId: row.run_id,
      previousOwner: row.lease_owner ?? 'unknown',
      requeued: plan.requeued,
      nextAttempt: plan.nextAttempt,
      phase: plan.phase,
    };
  }
  async listDueSchedules(now: Date, limit: number): Promise<WorkerSchedule[]> {
    const result = await this.pool.query<ScheduleRow>(
      `SELECT id, workspace_id, cron_expr, run_options, enabled,
              COALESCE((run_options->>'nextRunAt')::timestamptz, last_run_at, created_at) AS next_run_at
       FROM schedules
       WHERE enabled = true
         -- A report schedule fires a delivery, not a run; see listDueReportSchedules.
         AND (run_options->>'kind') IS DISTINCT FROM 'report'
         AND COALESCE((run_options->>'nextRunAt')::timestamptz, last_run_at, created_at) <= $1::timestamptz
       ORDER BY next_run_at ASC
       LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => {
      const options = record(row.run_options);
      const request = { ...options, ...record(options['request']) };
      const declaredWorkspaceId = requiredString(request['workspaceId'], 'workspaceId');
      // The tenant comes from the **column**, never from the JSONB.
      //
      // Before `0015_schedule_workspace_scope.sql` the workspace existed only as
      // `run_options->'request'->>'workspaceId'`, so the value a run executed in was
      // whatever a writer put in an untyped blob, and this function had nothing to
      // validate it against. Now the column is authoritative and the JSONB is a second
      // opinion, so a row where the two disagree is a defect rather than a run in
      // whichever workspace the blob claimed.
      //
      // Refusing is the only safe response. Silently preferring the column would mean a
      // row whose payload disagrees still runs â€” in a workspace its author did not name
      // â€” and the disagreement would stay invisible forever. Throwing stops the whole
      // poll, which is blunt on purpose: a schedule that cannot be trusted must not be
      // enqueued, and a loud failure is recoverable where a cross-tenant run is not.
      if (declaredWorkspaceId !== row.workspace_id) {
        throw new Error(
          `Schedule ${row.id} declares workspace ${row.workspace_id} but its run_options ` +
            `name ${declaredWorkspaceId}. The workspace column is authoritative; the ` +
            'run_options disagree and the row must be repaired before it can run.',
        );
      }
      const misfirePolicy = options['misfirePolicy'];
      if (
        misfirePolicy !== undefined &&
        misfirePolicy !== 'skip' &&
        misfirePolicy !== 'run_once' &&
        misfirePolicy !== 'catch_up'
      ) {
        throw new Error(`Schedule ${row.id} has an invalid misfire policy`);
      }
      return {
        id: row.id,
        cronExpr: row.cron_expr,
        timezone: typeof options['timezone'] === 'string' ? options['timezone'] : 'UTC',
        enabled: row.enabled,
        nextRunAt: row.next_run_at.toISOString(),
        request: {
          workspaceId: row.workspace_id,
          projectId: requiredString(request['projectId'], 'projectId'),
          // A repository-health scan is about a branch's current state: it has no release,
          // no environment, and no commit until the checkout says which one it read. Every
          // other schedule still names all three.
          environmentId: releaseScoped(request, 'environmentId'),
          releaseId: releaseScoped(request, 'releaseId'),
          branch: requiredString(request['branch'], 'branch'),
          commit: releaseScoped(request, 'commit'),
          testType: typeof request['testType'] === 'string' ? request['testType'] : undefined,
          framework: typeof request['framework'] === 'string' ? request['framework'] : undefined,
          suite: typeof request['suite'] === 'string' ? request['suite'] : undefined,
          selection: strings(request['selection']),
          timeoutMs: typeof request['timeoutMs'] === 'number' ? request['timeoutMs'] : undefined,
          priority: typeof request['priority'] === 'number' ? request['priority'] : undefined,
          requiredCapabilities: strings(request['requiredCapabilities']),
          labels: strings(request['labels']),
          configuration: record(request['configuration']),
          policyId: typeof request['policyId'] === 'string' ? request['policyId'] : undefined,
        },
        misfirePolicy: misfirePolicy ?? 'run_once',
        ...(options['blackoutWindows'] === undefined
          ? {}
          : { blackoutWindows: options['blackoutWindows'] }),
      } satisfies WorkerSchedule;
    });
  }

  async listDueReportSchedules(now: Date, limit: number): Promise<ReportSchedule[]> {
    const result = await this.pool.query<ScheduleRow>(
      `SELECT id, workspace_id, cron_expr, run_options, enabled,
              COALESCE((run_options->>'nextRunAt')::timestamptz, last_run_at, created_at) AS next_run_at
       FROM schedules
       WHERE enabled = true
         AND run_options->>'kind' = 'report'
         AND COALESCE((run_options->>'nextRunAt')::timestamptz, last_run_at, created_at) <= $1::timestamptz
       ORDER BY next_run_at ASC
       LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => {
      const options = record(row.run_options);
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        subscriptionId: requiredString(options['subscriptionId'], 'subscriptionId'),
        cronExpr: row.cron_expr,
        timezone: typeof options['timezone'] === 'string' ? options['timezone'] : 'UTC',
        nextRunAt: row.next_run_at.toISOString(),
      };
    });
  }

  async enqueueScheduledReport(input: ScheduledReportEnqueue): Promise<boolean> {
    return this.transaction(async (client) => {
      const advanced = await this.advanceScheduleWithClient(
        client,
        input.schedule.id,
        input.scheduledFor,
        input.nextRunAt,
      );
      if (!advanced) return false;
      // The workspace and the subscription come from the schedule row the API wrote. The
      // channel is resolved by the dispatcher when it sends, so a channel edited between
      // now and then is the channel the report reaches.
      const inserted = await client.query(
        `INSERT INTO report_deliveries (workspace_id, subscription_id, idempotency_key, scheduled_for)
         VALUES ($1, $2::uuid, $3, $4::timestamptz)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          input.schedule.workspaceId,
          input.schedule.subscriptionId,
          input.idempotencyKey,
          input.scheduledFor,
        ],
      );
      return inserted.rowCount === 1;
    });
  }

  async listDueDeliverySources(now: Date, limit: number): Promise<DeliverySourceDue[]> {
    const result = await this.pool.query<{
      id: string;
      workspace_id: string;
      project_id: string;
      cadence: string;
      next_sync_at: Date;
    }>(
      `SELECT id, workspace_id, project_id, cadence, next_sync_at
       FROM delivery_sources
       WHERE enabled = true AND next_sync_at <= $1::timestamptz
       ORDER BY next_sync_at ASC
       LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      cadence: row.cadence === 'hourly' ? 'hourly' : 'daily',
      nextSyncAt: new Date(row.next_sync_at).toISOString(),
    }));
  }

  async enqueueDeliverySync(input: DeliverySyncEnqueue): Promise<boolean> {
    return this.transaction(async (client) => {
      // Still enabled and still due: the row lock makes a second worker re-read the moved
      // pointer and match nothing, and the slot's unique key is the second guard.
      const advanced = await client.query(
        `UPDATE delivery_sources SET next_sync_at = $3::timestamptz
         WHERE id = $1::uuid AND workspace_id = $2 AND enabled = true
           AND next_sync_at <= $4::timestamptz`,
        [input.source.id, input.source.workspaceId, input.nextSyncAt, input.now],
      );
      if (advanced.rowCount !== 1) return false;
      const inserted = await client.query(
        `INSERT INTO delivery_syncs
           (workspace_id, project_id, source_id, requested_by, idempotency_key, next_attempt_at)
         VALUES ($1, $2::uuid, $3::uuid, 'schedule', $4, $5::timestamptz)
         -- Either key: the slot's idempotency key, or the source's one queued sync (0044).
         ON CONFLICT DO NOTHING`,
        [
          input.source.workspaceId,
          input.source.projectId,
          input.source.id,
          input.idempotencyKey,
          input.now,
        ],
      );
      return inserted.rowCount === 1;
    });
  }

  async advanceSchedule(
    scheduleId: string,
    expectedRunAt: string,
    nextRunAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE schedules
       SET last_run_at = $2::timestamptz,
           run_options = jsonb_set(COALESCE(run_options, '{}'::jsonb), '{nextRunAt}', to_jsonb($3::text), true)
       WHERE id = $1
         AND COALESCE((run_options->>'nextRunAt')::timestamptz, last_run_at, created_at) <= $2::timestamptz`,
      [scheduleId, expectedRunAt, nextRunAt],
    );
    return result.rowCount === 1;
  }

  async enqueueScheduledRun(input: ScheduledEnqueue): Promise<ScheduledEnqueueResult | null> {
    return this.transaction(async (client) => {
      const advanced = await this.advanceScheduleWithClient(
        client,
        input.schedule.id,
        input.scheduledFor,
        input.nextRunAt,
      );
      if (!advanced) return null;
      const request = input.schedule.request;
      const runId = randomUUID();
      const jobId = randomUUID();
      const configuration = structuredClone(request.configuration ?? {});
      const spec = {
        projectId: request.projectId,
        environmentId: request.environmentId,
        releaseId: request.releaseId,
        framework: request.framework ?? 'playwright',
        testType: request.testType ?? 'browser',
        suite: request.suite ?? null,
        selection: request.selection ?? [],
        configuration,
      };
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO runs (
           id, started_at, status, phase, outcome, attempt, priority, source, framework,
           test_type, project_id, environment_id, release_id, branch, commit_sha, suite,
           selection, required_capabilities, labels, timeout_ms, config, policy_id,
           idempotency_key, workspace_id, metadata, triggered_by, queued_at
         ) VALUES (
           $1::uuid, now(), 'running', 'queued', NULL, 1, $2, 'schedule', $3,
           $4, $5::uuid, $6::uuid, $7::uuid, $8, $9, $10,
           $11::jsonb, $12::jsonb, $13::jsonb, $14, $15::jsonb, $16::uuid,
           $17, $18, $19::jsonb, $20, now()
         )
         ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          runId,
          request.priority ?? 0,
          request.framework ?? 'playwright',
          request.testType ?? 'browser',
          request.projectId,
          request.environmentId,
          request.releaseId,
          request.branch,
          request.commit,
          request.suite ?? null,
          JSON.stringify(request.selection ?? []),
          JSON.stringify(request.requiredCapabilities ?? ['playwright']),
          JSON.stringify(request.labels ?? []),
          request.timeoutMs ?? 30 * 60_000,
          JSON.stringify(configuration),
          request.policyId ?? null,
          input.idempotencyKey,
          request.workspaceId,
          JSON.stringify({ scheduled: true, maxAttempts: this.maxAttempts }),
          `schedule:${input.schedule.id}`,
        ],
      );
      if (!inserted.rows[0]) {
        const existing = await client.query<{ id: string; current_job_id: string | null }>(
          `SELECT id, current_job_id FROM runs
           WHERE workspace_id = $1 AND idempotency_key = $2`,
          [request.workspaceId, input.idempotencyKey],
        );
        const existingRun = existing.rows[0];
        return existingRun?.current_job_id
          ? {
              runId: existingRun.id,
              jobId: existingRun.current_job_id,
              duplicate: true,
            }
          : null;
      }
      await client.query(
        `INSERT INTO execution_jobs (
           id, workspace_id, run_id, attempt, priority, state, available_at,
           required_capabilities, labels, spec, input, idempotency_key, timeout_ms
         ) VALUES ($1::uuid, $2, $3::uuid, 1, $4, 'queued', $5::timestamptz,
                   $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)`,
        [
          jobId,
          request.workspaceId,
          runId,
          request.priority ?? 0,
          input.scheduledFor,
          JSON.stringify(request.requiredCapabilities ?? ['playwright']),
          JSON.stringify(request.labels ?? []),
          JSON.stringify(spec),
          JSON.stringify(configuration),
          `${input.idempotencyKey}:attempt:1`,
          // NOT NULL with no default; the same value the run row above carries.
          request.timeoutMs ?? 30 * 60_000,
        ],
      );
      await client.query(
        `UPDATE runs SET current_job_id = $2::uuid, updated_at = now() WHERE id = $1::uuid`,
        [runId, jobId],
      );
      return { runId, jobId, duplicate: false };
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async advanceScheduleWithClient(
    client: PoolClient,
    scheduleId: string,
    expectedRunAt: string,
    nextRunAt: string,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE schedules
       SET last_run_at = $2::timestamptz,
           run_options = jsonb_set(COALESCE(run_options, '{}'::jsonb), '{nextRunAt}', to_jsonb($3::text), true)
       WHERE id = $1
         AND COALESCE((run_options->>'nextRunAt')::timestamptz, last_run_at, created_at) <= $2::timestamptz`,
      [scheduleId, expectedRunAt, nextRunAt],
    );
    return result.rowCount === 1;
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

/** A job may declare its own attempt budget in its run metadata; otherwise the store's applies. */
function maxAttemptsFor(metadata: Record<string, unknown>, fallback: number): number {
  const configured = metadata['maxAttempts'];
  return typeof configured === 'number' && configured > 0 ? Math.floor(configured) : fallback;
}

interface RecoveryPlan {
  requeued: boolean;
  nextAttempt: number;
  jobState: 'queued' | 'cancelled' | 'failed';
  phase: LeaseRecovery['phase'];
  outcome: 'cancelled' | 'runner_lost' | null;
  runStatus: 'running' | 'failed';
}

/**
 * What becomes of a job whose lease expired: requeued while it has attempts left and nobody asked
 * to cancel it; cancelled if a cancel was pending; otherwise lost.
 */
function planRecovery(row: RecoveryRow, maxAttempts: number): RecoveryPlan {
  if (!row.cancel_requested_at && row.attempt < maxAttempts) {
    return {
      requeued: true,
      nextAttempt: row.attempt + 1,
      jobState: 'queued',
      phase: 'queued',
      outcome: null,
      runStatus: 'running',
    };
  }
  const cancelled = Boolean(row.cancel_requested_at);
  return {
    requeued: false,
    nextAttempt: row.attempt,
    jobState: cancelled ? 'cancelled' : 'failed',
    phase: cancelled ? 'cancelled' : 'runner_lost',
    outcome: cancelled ? 'cancelled' : 'runner_lost',
    runStatus: 'failed',
  };
}
