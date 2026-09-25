import { randomUUID } from 'node:crypto';
import pg, { type PoolClient, type QueryResultRow } from 'pg';
import type {
  ExecutionStore,
  ExecutionStoreOptions,
  JobClaim,
  JobCompletion,
  LeaseRecovery,
  ScheduledEnqueue,
  ScheduledEnqueueResult,
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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Schedule is missing ${field}`);
  return value;
}

function terminalState(status: JobCompletion['status']): {
  job: 'completed' | 'failed' | 'cancelled';
  phase: string;
  outcome: string;
  legacy: string;
} {
  if (status === 'completed') {
    return { job: 'completed', phase: 'complete', outcome: 'passed', legacy: 'passed' };
  }
  if (status === 'cancelled') {
    return { job: 'cancelled', phase: 'cancelled', outcome: 'cancelled', legacy: 'interrupted' };
  }
  if (status === 'failed') {
    return { job: 'failed', phase: 'complete', outcome: 'failed', legacy: 'failed' };
  }
  return {
    job: 'failed',
    phase: status,
    outcome: status,
    legacy: status === 'timed_out' ? 'interrupted' : 'failed',
  };
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
      const terminal = terminalState(completion.status);
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
          terminal.job,
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
          terminal.phase,
          terminal.outcome,
          terminal.legacy,
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
      for (const row of expired.rows) {
        const configuredMax = row.metadata['maxAttempts'];
        const maxAttempts =
          typeof configuredMax === 'number' && configuredMax > 0
            ? Math.floor(configuredMax)
            : this.maxAttempts;
        const requeued = !row.cancel_requested_at && row.attempt < maxAttempts;
        const nextAttempt = requeued ? row.attempt + 1 : row.attempt;
        await client.query(
          `UPDATE execution_jobs
           SET state = $2, attempt = $3, available_at = $4, lease_id = NULL,
               lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
               error_code = 'RUNNER_LOST', error_message = 'Runner lease expired', updated_at = $5
           WHERE id = $1::uuid`,
          [
            row.id,
            requeued ? 'queued' : row.cancel_requested_at ? 'cancelled' : 'failed',
            nextAttempt,
            new Date(now.getTime() + this.retryBackoffMs),
            now,
          ],
        );
        await client.query(
          `UPDATE runs
           SET attempt = $2, phase = $3, outcome = $4, status = $5,
               runner_id = NULL, error_code = 'RUNNER_LOST',
               error_message = 'Runner lease expired', updated_at = $6,
               completed_at = CASE WHEN $3 = 'runner_lost' THEN $6 ELSE completed_at END
           WHERE id = $1::uuid`,
          [
            row.run_id,
            nextAttempt,
            requeued ? 'queued' : row.cancel_requested_at ? 'cancelled' : 'runner_lost',
            requeued ? null : row.cancel_requested_at ? 'cancelled' : 'runner_lost',
            requeued ? 'running' : 'failed',
            now,
          ],
        );
        recovered.push({
          jobId: row.id,
          runId: row.run_id,
          previousOwner: row.lease_owner ?? 'unknown',
          requeued,
          nextAttempt,
          phase: requeued ? 'queued' : row.cancel_requested_at ? 'cancelled' : 'runner_lost',
        });
      }
      return recovered;
    });
  }

  async listDueSchedules(now: Date, limit: number): Promise<WorkerSchedule[]> {
    const result = await this.pool.query<ScheduleRow>(
      `SELECT id, cron_expr, run_options, enabled,
              COALESCE((run_options->>'nextRunAt')::timestamptz, last_run_at, created_at) AS next_run_at
       FROM schedules
       WHERE enabled = true
         AND COALESCE((run_options->>'nextRunAt')::timestamptz, last_run_at, created_at) <= $1::timestamptz
       ORDER BY next_run_at ASC
       LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => {
      const options = record(row.run_options);
      const request = { ...options, ...record(options['request']) };
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
          workspaceId: requiredString(request['workspaceId'], 'workspaceId'),
          projectId: requiredString(request['projectId'], 'projectId'),
          environmentId: requiredString(request['environmentId'], 'environmentId'),
          releaseId: requiredString(request['releaseId'], 'releaseId'),
          branch: requiredString(request['branch'], 'branch'),
          commit: requiredString(request['commit'], 'commit'),
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
           required_capabilities, labels, spec, input, idempotency_key
         ) VALUES ($1::uuid, $2, $3::uuid, 1, $4, 'queued', $5::timestamptz,
                   $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)`,
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
