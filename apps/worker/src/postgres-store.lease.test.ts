import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PostgresExecutionStore } from './postgres-store.js';
import { migratedDatabase, storeOnPglite } from './test-support/pglite.js';
import type { ExecutionStoreOptions, JobClaim } from './types.js';

/**
 * The lease protocol of `PostgresExecutionStore` against the real migration graph:
 * claim, renew, release, complete, and the fencing token that makes a stale holder's
 * write a no-op rather than a corruption.
 *
 * Every test creates its own workspace. `claimJob` takes any eligible job in the
 * runner's workspace, so a shared workspace would make each test depend on the jobs
 * every earlier test left queued.
 */

let database: PGlite;
let workspaces = 0;

beforeAll(async () => {
  database = await migratedDatabase();
}, 120_000);

afterAll(async () => {
  await database?.close();
});

const store = (options: ExecutionStoreOptions = {}): PostgresExecutionStore =>
  storeOnPglite(database, options);

async function workspace(): Promise<string> {
  workspaces += 1;
  const id = `lease-workspace-${workspaces}`;
  await database.query(
    `INSERT INTO workspaces (id, name, config_path, created_at) VALUES ($1, $1, 'unused', now())`,
    [id],
  );
  return id;
}

interface RunnerSeed {
  slots?: number;
  health?: string;
  capabilities?: string[];
  labels?: string[];
  tokenExpiresAt?: Date;
  revoked?: boolean;
}

async function runner(workspaceId: string, seed: RunnerSeed = {}): Promise<string> {
  const id = randomUUID();
  await database.query(
    `INSERT INTO runners (id, workspace_id, name, version, os, arch, token_hash, token_expires_at,
                          health, slots, capabilities, labels, token_revoked_at)
     VALUES ($1, $2, $10, '1', 'linux', 'x64', $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    [
      id,
      workspaceId,
      `hash-${id}`,
      seed.tokenExpiresAt ?? new Date(Date.now() + 86_400_000),
      seed.health ?? 'healthy',
      seed.slots ?? 1,
      JSON.stringify(seed.capabilities ?? ['playwright']),
      JSON.stringify(seed.labels ?? []),
      seed.revoked ? new Date() : null,
      `runner-${id}`,
    ],
  );
  return id;
}

interface JobSeed {
  priority?: number;
  availableAt?: Date;
  createdAt?: Date;
  requiredCapabilities?: string[];
  labels?: string[];
  spec?: Record<string, unknown>;
  runTimeoutMs?: number | null;
  projectId?: string | null;
  cancelRequested?: boolean;
}

interface SeededJob {
  runId: string;
  jobId: string;
}

async function queuedJob(workspaceId: string, seed: JobSeed = {}): Promise<SeededJob> {
  const runId = randomUUID();
  const jobId = randomUUID();
  await database.query(
    `INSERT INTO runs (id, workspace_id, status, phase, attempt, started_at, timeout_ms,
                       project_id, cancel_requested_at)
     VALUES ($1, $2, 'running', 'queued', 1, now(), $3, $4, $5)`,
    [
      runId,
      workspaceId,
      seed.runTimeoutMs ?? null,
      seed.projectId ?? null,
      seed.cancelRequested ? new Date() : null,
    ],
  );
  await database.query(
    `INSERT INTO execution_jobs (id, workspace_id, run_id, state, attempt, priority, available_at,
                                 timeout_ms, required_capabilities, labels, spec, idempotency_key,
                                 created_at)
     VALUES ($1, $2, $3, 'queued', 1, $4, $5, 60000, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10)`,
    [
      jobId,
      workspaceId,
      runId,
      seed.priority ?? 0,
      seed.availableAt ?? new Date(Date.now() - 1_000),
      JSON.stringify(seed.requiredCapabilities ?? ['playwright']),
      JSON.stringify(seed.labels ?? []),
      JSON.stringify(seed.spec ?? {}),
      `key-${jobId}`,
      seed.createdAt ?? new Date(),
    ],
  );
  return { runId, jobId };
}

async function project(workspaceId: string): Promise<string> {
  const id = randomUUID();
  await database.query(
    `INSERT INTO projects (id, workspace_id, name, slug) VALUES ($1, $2, 'p', $3)`,
    [id, workspaceId, `p-${id}`],
  );
  return id;
}

type Row = Record<string, unknown>;

async function jobRow(jobId: string): Promise<Row> {
  const result = await database.query<Row>('SELECT * FROM execution_jobs WHERE id = $1', [jobId]);
  const row = result.rows[0];
  if (!row) throw new Error(`no job ${jobId}`);
  return row;
}

async function runRow(runId: string): Promise<Row> {
  const result = await database.query<Row>('SELECT * FROM runs WHERE id = $1', [runId]);
  const row = result.rows[0];
  if (!row) throw new Error(`no run ${runId}`);
  return row;
}

async function claimOrThrow(
  target: PostgresExecutionStore,
  runnerId: string,
  capabilities: readonly string[] = [],
): Promise<JobClaim> {
  const claim = await target.claimJob(runnerId, capabilities, [], new Date());
  if (!claim) throw new Error('expected a claim');
  return claim;
}

describe('PostgresExecutionStore.ping', () => {
  it('reports ready when the database answers', async () => {
    await expect(store().ping()).resolves.toBe(true);
  });
});

describe('PostgresExecutionStore.claimJob', () => {
  it('leases the job, stamps the run as assigned, and returns the claim', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws);
    const seeded = await queuedJob(ws, { spec: { suite: 'smoke', retries: [1, 2] } });
    const now = new Date();

    const claim = await store({ leaseDurationMs: 45_000 }).claimJob(runnerId, [], [], now);

    expect(claim).toMatchObject({
      jobId: seeded.jobId,
      runId: seeded.runId,
      workspaceId: ws,
      projectId: null,
      attempt: 1,
      leaseOwner: runnerId,
      fencingToken: 1,
      // The run carries no timeout, so the claim falls back to thirty minutes.
      timeoutMs: 30 * 60_000,
      spec: { suite: 'smoke', retries: [1, 2] },
      leaseExpiresAt: new Date(now.getTime() + 45_000).toISOString(),
    });
    const job = await jobRow(seeded.jobId);
    expect(job).toMatchObject({
      state: 'leased',
      lease_id: claim?.leaseId,
      lease_owner: runnerId,
      fencing_token: 1,
      error_code: null,
    });
    expect((job['lease_expires_at'] as Date).getTime()).toBe(now.getTime() + 45_000);
    expect((job['heartbeat_at'] as Date).getTime()).toBe(now.getTime());
    const run = await runRow(seeded.runId);
    expect(run).toMatchObject({
      phase: 'assigned',
      outcome: null,
      status: 'running',
      runner_id: runnerId,
      current_job_id: seeded.jobId,
    });
  });

  it("uses the run's own timeout when it has one", async () => {
    const ws = await workspace();
    const runnerId = await runner(ws);
    await queuedJob(ws, { runTimeoutMs: 90_000 });

    const claim = await claimOrThrow(store(), runnerId);

    expect(claim.timeoutMs).toBe(90_000);
  });

  it('refuses a runner that is unknown, unhealthy, revoked or expired', async () => {
    const ws = await workspace();
    await queuedJob(ws);
    const offline = await runner(ws, { health: 'offline' });
    const revoked = await runner(ws, { revoked: true });
    const expired = await runner(ws, { tokenExpiresAt: new Date(Date.now() - 1_000) });

    for (const runnerId of [randomUUID(), offline, revoked, expired]) {
      await expect(store().claimJob(runnerId, [], [], new Date())).resolves.toBeNull();
    }
    // The job is still there for a runner that is allowed to take it.
    const healthy = await runner(ws);
    await expect(store().claimJob(healthy, [], [], new Date())).resolves.not.toBeNull();
  });

  it('refuses a runner whose slots are all in use', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws, { slots: 1 });
    const first = await queuedJob(ws);
    const second = await queuedJob(ws);
    const target = store();

    const claim = await claimOrThrow(target, runnerId);
    await expect(target.claimJob(runnerId, [], [], new Date())).resolves.toBeNull();

    const other = claim.jobId === first.jobId ? second : first;
    expect((await jobRow(other.jobId))['state']).toBe('queued');
  });

  it('matches capabilities and labels from the runner row and the request together', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws, { capabilities: ['playwright'], labels: ['linux'] });
    const seeded = await queuedJob(ws, {
      requiredCapabilities: ['playwright', 'k6'],
      labels: ['linux', 'gpu'],
    });
    const target = store();

    await expect(target.claimJob(runnerId, ['k6'], [], new Date())).resolves.toBeNull();
    await expect(target.claimJob(runnerId, [], ['gpu'], new Date())).resolves.toBeNull();
    const claim = await target.claimJob(runnerId, ['k6'], ['gpu'], new Date());

    expect(claim?.jobId).toBe(seeded.jobId);
  });

  it('never claims a job from another workspace', async () => {
    const mine = await workspace();
    const theirs = await workspace();
    const runnerId = await runner(mine);
    const foreign = await queuedJob(theirs);

    await expect(store().claimJob(runnerId, [], [], new Date())).resolves.toBeNull();
    expect((await jobRow(foreign.jobId))['state']).toBe('queued');
  });

  it('skips a job whose run was cancelled or which is not yet available', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws);
    await queuedJob(ws, { cancelRequested: true });
    await queuedJob(ws, { availableAt: new Date(Date.now() + 60_000) });

    await expect(store().claimJob(runnerId, [], [], new Date())).resolves.toBeNull();
  });

  it('prefers the higher priority, and lets a starved job overtake it', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws, { slots: 2 });
    const now = new Date();
    const low = await queuedJob(ws, { priority: 0, createdAt: now });
    const high = await queuedJob(ws, { priority: 5, createdAt: now });

    const first = await store().claimJob(runnerId, [], [], now);
    expect(first?.jobId).toBe(high.jobId);

    const ws2 = await workspace();
    const runner2 = await runner(ws2);
    // Waited 10s with one point of priority per second: 0 + 10 beats 5 + 0.
    const starved = await queuedJob(ws2, {
      priority: 0,
      createdAt: new Date(now.getTime() - 10_000),
    });
    await queuedJob(ws2, { priority: 5, createdAt: now });

    const second = await store({ starvationAfterMs: 1_000 }).claimJob(runner2, [], [], now);
    expect(second?.jobId).toBe(starved.jobId);
    expect((await jobRow(low.jobId))['state']).toBe('queued');
  });

  it('holds a workspace to its quota of leased jobs', async () => {
    const ws = await workspace();
    const busy = await runner(ws);
    const idle = await runner(ws);
    const first = await queuedJob(ws);
    const second = await queuedJob(ws);
    const target = store({ workspaceQuota: 1 });

    const claim = await claimOrThrow(target, busy);
    await expect(target.claimJob(idle, [], [], new Date())).resolves.toBeNull();
    // Two jobs created in the same millisecond tie on age, so either may be the one taken.
    const waiting = claim.jobId === first.jobId ? second : first;
    expect((await jobRow(waiting.jobId))['state']).toBe('queued');
  });

  it('holds a project to its quota of leased jobs, and reports the project', async () => {
    const ws = await workspace();
    const projectId = await project(ws);
    const busy = await runner(ws);
    const idle = await runner(ws);
    await queuedJob(ws, { projectId });
    await queuedJob(ws, { projectId });
    const target = store({ projectQuota: 1 });

    const claim = await claimOrThrow(target, busy);
    expect(claim.projectId).toBe(projectId);
    await expect(target.claimJob(idle, [], [], new Date())).resolves.toBeNull();
  });

  it('rolls the transaction back when a statement fails, leaving the session usable', async () => {
    // A runner id that is not a UUID fails the first statement's cast. If the store
    // did not ROLLBACK, the shared session would stay in an aborted transaction and
    // every later statement would be refused.
    const target = store();
    await expect(target.claimJob('not-a-uuid', [], [], new Date())).rejects.toThrow();
    await expect(target.ping()).resolves.toBe(true);
  });
});

describe('PostgresExecutionStore.renewLease', () => {
  async function leased(): Promise<{ target: PostgresExecutionStore; claim: JobClaim }> {
    const ws = await workspace();
    const runnerId = await runner(ws);
    await queuedJob(ws);
    const target = store();
    return { target, claim: await claimOrThrow(target, runnerId) };
  }

  it('extends a live lease and records the heartbeat', async () => {
    const { target, claim } = await leased();
    const extended = new Date(Date.now() + 120_000);

    await expect(
      target.renewLease(claim.jobId, claim.leaseId, claim.fencingToken, extended),
    ).resolves.toBe(true);

    const job = await jobRow(claim.jobId);
    expect((job['lease_expires_at'] as Date).getTime()).toBe(extended.getTime());
    expect(job['heartbeat_at']).toBeInstanceOf(Date);
  });

  it('refuses a stale fencing token, a foreign lease id, or an expiry in the past', async () => {
    const { target, claim } = await leased();
    const before = await jobRow(claim.jobId);
    const future = new Date(Date.now() + 120_000);

    await expect(target.renewLease(claim.jobId, claim.leaseId, 99, future)).resolves.toBe(false);
    await expect(target.renewLease(claim.jobId, randomUUID(), 1, future)).resolves.toBe(false);
    await expect(
      target.renewLease(claim.jobId, claim.leaseId, 1, new Date(Date.now() - 1_000)),
    ).resolves.toBe(false);

    const after = await jobRow(claim.jobId);
    expect(after['lease_expires_at']).toEqual(before['lease_expires_at']);
  });

  it('refuses to revive a lease that has already expired', async () => {
    const { target, claim } = await leased();
    await database.query(
      `UPDATE execution_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [claim.jobId],
    );

    await expect(
      target.renewLease(claim.jobId, claim.leaseId, 1, new Date(Date.now() + 60_000)),
    ).resolves.toBe(false);
  });
});

describe('PostgresExecutionStore.releaseJob', () => {
  it('returns the job to the queue and the run to queued', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws);
    const seeded = await queuedJob(ws);
    const target = store();
    const claim = await claimOrThrow(target, runnerId);
    const availableAt = new Date(Date.now() + 5_000);

    await expect(
      target.releaseJob(claim.jobId, claim.leaseId, claim.fencingToken, availableAt),
    ).resolves.toBe(true);

    const job = await jobRow(seeded.jobId);
    expect(job).toMatchObject({
      state: 'queued',
      lease_id: null,
      lease_owner: null,
      lease_expires_at: null,
      heartbeat_at: null,
      // The token is not reset: the next lease must outrank every earlier one.
      fencing_token: 1,
    });
    expect((job['available_at'] as Date).getTime()).toBe(availableAt.getTime());
    expect(await runRow(seeded.runId)).toMatchObject({
      phase: 'queued',
      outcome: null,
      status: 'running',
      runner_id: null,
    });
  });

  it('refuses a release under a stale fencing token and leaves the lease alone', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws);
    await queuedJob(ws);
    const target = store();
    const claim = await claimOrThrow(target, runnerId);

    await expect(target.releaseJob(claim.jobId, claim.leaseId, 7)).resolves.toBe(false);

    expect(await jobRow(claim.jobId)).toMatchObject({ state: 'leased', lease_id: claim.leaseId });
  });
});

describe('PostgresExecutionStore.completeJob', () => {
  it('finishes a completed job as a passed run', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws);
    const seeded = await queuedJob(ws);
    const target = store();
    const claim = await claimOrThrow(target, runnerId);

    await expect(
      target.completeJob(claim.jobId, {
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        status: 'completed',
      }),
    ).resolves.toBe(true);

    const job = await jobRow(seeded.jobId);
    expect(job).toMatchObject({
      state: 'completed',
      lease_id: null,
      lease_owner: null,
      lease_expires_at: null,
      error_code: null,
      error_message: null,
    });
    expect(job['completed_at']).toBeInstanceOf(Date);
    const run = await runRow(seeded.runId);
    expect(run).toMatchObject({ phase: 'complete', outcome: 'passed', status: 'passed' });
    expect(run['finished_at']).toBeInstanceOf(Date);
    expect(run['completed_at']).toBeInstanceOf(Date);
  });

  it('records the error on both rows for a failed job', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws);
    const seeded = await queuedJob(ws);
    const target = store();
    const claim = await claimOrThrow(target, runnerId);

    await target.completeJob(claim.jobId, {
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
      status: 'timed_out',
      error: { code: 'TIMED_OUT', message: 'Job ended as timed_out' },
    });

    expect(await jobRow(seeded.jobId)).toMatchObject({
      state: 'failed',
      error_code: 'TIMED_OUT',
      error_message: 'Job ended as timed_out',
    });
    expect(await runRow(seeded.runId)).toMatchObject({
      phase: 'timed_out',
      outcome: 'timed_out',
      // `deriveRunState` maps a phase that never reached a verdict to `interrupted`.
      status: 'interrupted',
      error_code: 'TIMED_OUT',
      error_message: 'Job ended as timed_out',
    });
  });

  it('lands a cancelled job in cancelled', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws);
    const seeded = await queuedJob(ws);
    const target = store();
    const claim = await claimOrThrow(target, runnerId);

    await target.completeJob(claim.jobId, {
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
      status: 'cancelled',
    });

    expect((await jobRow(seeded.jobId))['state']).toBe('cancelled');
    expect(await runRow(seeded.runId)).toMatchObject({ phase: 'cancelled', outcome: 'cancelled' });
  });

  it('refuses the stale holder after a re-lease, and accepts the current one', async () => {
    // The fencing scenario: the first holder's lease is released and the job is
    // claimed again. The token went 1 -> 2, so the first holder's completion is
    // refused, and the run keeps the state the current holder gave it.
    const ws = await workspace();
    const runnerId = await runner(ws);
    const seeded = await queuedJob(ws);
    const target = store();
    const stale = await claimOrThrow(target, runnerId);
    await target.releaseJob(stale.jobId, stale.leaseId, stale.fencingToken);
    const current = await claimOrThrow(target, runnerId);
    expect(current.fencingToken).toBe(2);
    expect(current.leaseId).not.toBe(stale.leaseId);

    await expect(
      target.completeJob(seeded.jobId, {
        leaseId: stale.leaseId,
        fencingToken: stale.fencingToken,
        status: 'failed',
      }),
    ).resolves.toBe(false);
    await expect(
      target.completeJob(seeded.jobId, {
        leaseId: current.leaseId,
        fencingToken: 1,
        status: 'failed',
      }),
    ).resolves.toBe(false);
    expect(await jobRow(seeded.jobId)).toMatchObject({ state: 'leased', fencing_token: 2 });
    expect((await runRow(seeded.runId))['phase']).toBe('assigned');

    await expect(
      target.completeJob(seeded.jobId, {
        leaseId: current.leaseId,
        fencingToken: current.fencingToken,
        status: 'completed',
      }),
    ).resolves.toBe(true);
    expect((await jobRow(seeded.jobId))['state']).toBe('completed');
  });

  it('refuses to complete under an expired lease', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws);
    const seeded = await queuedJob(ws);
    const target = store();
    const claim = await claimOrThrow(target, runnerId);
    await database.query(
      `UPDATE execution_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [claim.jobId],
    );

    await expect(
      target.completeJob(claim.jobId, {
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        status: 'completed',
      }),
    ).resolves.toBe(false);
    expect((await runRow(seeded.runId))['outcome']).toBeNull();
  });
});

describe('PostgresExecutionStore.reapExpiredLeases requeues a job with attempts left', () => {
  it('puts the job back on the queue one attempt later, after the backoff', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws);
    const seeded = await queuedJob(ws);
    const claimedAt = new Date();
    const target = store({ leaseDurationMs: 10_000, retryBackoffMs: 2_500 });
    await target.claimJob(runnerId, [], [], claimedAt);
    const later = new Date(claimedAt.getTime() + 10_000);

    const recovered = await target.reapExpiredLeases(later);

    expect(recovered.find((item) => item.jobId === seeded.jobId)).toEqual({
      jobId: seeded.jobId,
      runId: seeded.runId,
      previousOwner: runnerId,
      requeued: true,
      nextAttempt: 2,
      phase: 'queued',
    });
    const job = await jobRow(seeded.jobId);
    expect(job).toMatchObject({
      state: 'queued',
      attempt: 2,
      lease_id: null,
      lease_owner: null,
      error_code: 'RUNNER_LOST',
    });
    expect((job['available_at'] as Date).getTime()).toBe(later.getTime() + 2_500);
    const run = await runRow(seeded.runId);
    expect(run).toMatchObject({
      attempt: 2,
      phase: 'queued',
      outcome: null,
      status: 'running',
      runner_id: null,
      completed_at: null,
      finished_at: null,
    });
  });

  it('honours a per-run maxAttempts over the store default', async () => {
    const ws = await workspace();
    const runnerId = await runner(ws);
    const seeded = await queuedJob(ws);
    await database.query(`UPDATE runs SET metadata = '{"maxAttempts": 1.9}'::jsonb WHERE id = $1`, [
      seeded.runId,
    ]);
    const claimedAt = new Date();
    const target = store({ leaseDurationMs: 10_000, maxAttempts: 5 });
    await target.claimJob(runnerId, [], [], claimedAt);

    const recovered = await target.reapExpiredLeases(new Date(claimedAt.getTime() + 10_000));

    // 1.9 floors to 1, so the first attempt was the last one.
    expect(recovered.find((item) => item.jobId === seeded.jobId)).toMatchObject({
      requeued: false,
      nextAttempt: 1,
      phase: 'runner_lost',
    });
    expect((await jobRow(seeded.jobId))['state']).toBe('failed');
  });
});

describe('PostgresExecutionStore.close', () => {
  it('ends the pool', async () => {
    await expect(store().close()).resolves.toBeUndefined();
  });
});
