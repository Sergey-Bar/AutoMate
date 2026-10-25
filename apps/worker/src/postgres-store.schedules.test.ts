import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresExecutionStore } from './postgres-store.js';
import { migratedDatabase, storeOnPglite } from './test-support/pglite.js';
import type { WorkerSchedule } from './types.js';

/**
 * Schedules against the real migration graph: which rows are due, how a row maps to a
 * `WorkerSchedule`, the compare-and-set that advances it, and the transaction that
 * turns one occurrence into a run.
 */

const WORKSPACE = 'default-workspace';

let database: PGlite;

beforeAll(async () => {
  database = await migratedDatabase();
}, 120_000);

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  // `listDueSchedules` reads the whole table, so every case starts from none.
  await database.query('DELETE FROM schedules');
});

const store = (): PostgresExecutionStore => storeOnPglite(database, { maxAttempts: 4 });

interface ScheduleSeed {
  runOptions?: Record<string, unknown> | null;
  enabled?: boolean;
  lastRunAt?: Date | null;
  createdAt?: Date;
  workspaceId?: string;
}

const baseRequest = {
  workspaceId: WORKSPACE,
  projectId: '00000000-0000-4000-8000-000000000001',
  environmentId: '00000000-0000-4000-8000-000000000002',
  releaseId: '00000000-0000-4000-8000-000000000003',
  branch: 'main',
  commit: 'abc123',
};

async function schedule(id: string, seed: ScheduleSeed = {}): Promise<void> {
  const runOptions = seed.runOptions === undefined ? { request: baseRequest } : seed.runOptions;
  await database.query(
    `INSERT INTO schedules (id, cron_expr, run_options, enabled, last_run_at, created_at, workspace_id)
     VALUES ($1, '*/5 * * * *', $2::jsonb, $3, $4, $5, $6)`,
    [
      id,
      runOptions === null ? null : JSON.stringify(runOptions),
      seed.enabled ?? true,
      seed.lastRunAt ?? null,
      seed.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
      seed.workspaceId ?? WORKSPACE,
    ],
  );
}

async function scheduleRow(id: string): Promise<Record<string, unknown>> {
  const result = await database.query<Record<string, unknown>>(
    'SELECT * FROM schedules WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`no schedule ${id}`);
  return row;
}

async function runsByKey(key: string): Promise<Array<Record<string, unknown>>> {
  const result = await database.query<Record<string, unknown>>(
    'SELECT * FROM runs WHERE workspace_id = $1 AND idempotency_key = $2',
    [WORKSPACE, key],
  );
  return result.rows;
}

const NOW = new Date('2026-03-01T12:00:00.000Z');

describe('PostgresExecutionStore.listDueSchedules', () => {
  it('returns enabled, due schedules oldest first, up to the limit', async () => {
    await schedule('late', {
      runOptions: { request: baseRequest, nextRunAt: '2026-03-01T11:00:00Z' },
    });
    await schedule('early', { lastRunAt: new Date('2026-02-01T00:00:00Z') });
    await schedule('oldest', { createdAt: new Date('2025-12-01T00:00:00Z') });
    await schedule('future', {
      runOptions: { request: baseRequest, nextRunAt: '2026-03-02T00:00:00Z' },
    });
    await schedule('disabled', { enabled: false });

    const due = await store().listDueSchedules(NOW, 10);
    expect(due.map((item) => item.id)).toEqual(['oldest', 'early', 'late']);
    // `nextRunAt` wins over `last_run_at`, which wins over `created_at`.
    expect(due.map((item) => item.nextRunAt)).toEqual([
      '2025-12-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T11:00:00.000Z',
    ]);

    const limited = await store().listDueSchedules(NOW, 2);
    expect(limited.map((item) => item.id)).toEqual(['oldest', 'early']);
  });

  it('fills the defaults a minimal row leaves out', async () => {
    await schedule('minimal');

    const [due] = await store().listDueSchedules(NOW, 10);

    expect(due).toEqual({
      id: 'minimal',
      cronExpr: '*/5 * * * *',
      timezone: 'UTC',
      enabled: true,
      nextRunAt: '2026-01-01T00:00:00.000Z',
      misfirePolicy: 'run_once',
      request: {
        ...baseRequest,
        testType: undefined,
        framework: undefined,
        suite: undefined,
        selection: [],
        timeoutMs: undefined,
        priority: undefined,
        requiredCapabilities: [],
        labels: [],
        configuration: {},
        policyId: undefined,
      },
    } satisfies WorkerSchedule);
  });

  it('maps every optional field, and reads a request written flat into run_options', async () => {
    const policyId = randomUUID();
    await schedule('full', {
      runOptions: {
        // Flat: the request fields sit beside the options rather than under `request`.
        ...baseRequest,
        timezone: 'Europe/Berlin',
        misfirePolicy: 'catch_up',
        blackoutWindows: [{ from: '00:00', to: '01:00' }],
        testType: 'api',
        framework: 'k6',
        suite: 'nightly',
        selection: ['a.spec.ts', 7, 'b.spec.ts'],
        timeoutMs: 120_000,
        priority: 3,
        requiredCapabilities: ['k6'],
        labels: ['gpu'],
        configuration: { vus: 10 },
        policyId,
      },
    });

    const [due] = await store().listDueSchedules(NOW, 10);

    expect(due).toMatchObject({
      timezone: 'Europe/Berlin',
      misfirePolicy: 'catch_up',
      blackoutWindows: [{ from: '00:00', to: '01:00' }],
      request: {
        workspaceId: WORKSPACE,
        testType: 'api',
        framework: 'k6',
        suite: 'nightly',
        // A non-string entry is dropped rather than passed to the runner.
        selection: ['a.spec.ts', 'b.spec.ts'],
        timeoutMs: 120_000,
        priority: 3,
        requiredCapabilities: ['k6'],
        labels: ['gpu'],
        configuration: { vus: 10 },
        policyId,
      },
    });
  });

  it.each(['projectId', 'environmentId', 'releaseId', 'branch', 'commit'] as const)(
    'refuses a row whose request has no %s',
    async (field) => {
      const request: Record<string, unknown> = { ...baseRequest };
      delete request[field];
      await schedule('broken', { runOptions: { request } });

      await expect(store().listDueSchedules(NOW, 10)).rejects.toThrow(
        `Schedule is missing ${field}`,
      );
    },
  );

  it('reads a repository-health schedule, which names no release, environment or commit', async () => {
    const {
      environmentId: _environment,
      releaseId: _release,
      commit: _commit,
      ...rest
    } = baseRequest;
    await schedule('health', { runOptions: { request: { ...rest, testType: 'health' } } });
    const [due] = await store().listDueSchedules(NOW, 10);
    expect(due?.request).toMatchObject({
      environmentId: null,
      releaseId: null,
      commit: null,
      testType: 'health',
    });
  });

  it('still refuses a health schedule with no project or branch', async () => {
    await schedule('health-broken', {
      runOptions: { request: { workspaceId: WORKSPACE, testType: 'health', branch: 'main' } },
    });
    await expect(store().listDueSchedules(NOW, 10)).rejects.toThrow(
      'Schedule is missing projectId',
    );
  });

  it('refuses a row with no run_options at all', async () => {
    await schedule('empty', { runOptions: null });

    await expect(store().listDueSchedules(NOW, 10)).rejects.toThrow(
      'Schedule is missing workspaceId',
    );
  });
});

describe('PostgresExecutionStore.advanceSchedule', () => {
  it('moves a due schedule forward exactly once', async () => {
    await schedule('cas');
    const target = store();
    const due = '2026-03-01T12:00:00.000Z';
    const next = '2026-03-01T12:05:00.000Z';

    await expect(target.advanceSchedule('cas', due, next)).resolves.toBe(true);
    // The pointer is now past `due`, so a second worker with the same view loses.
    await expect(target.advanceSchedule('cas', due, next)).resolves.toBe(false);

    const row = await scheduleRow('cas');
    expect((row['last_run_at'] as Date).toISOString()).toBe(due);
    expect(row['run_options']).toMatchObject({ nextRunAt: next, request: baseRequest });
  });

  it('advances a row whose run_options are null', async () => {
    await schedule('null-options', { runOptions: null });

    await expect(
      store().advanceSchedule('null-options', NOW.toISOString(), '2026-03-01T12:05:00.000Z'),
    ).resolves.toBe(true);
    expect((await scheduleRow('null-options'))['run_options']).toEqual({
      nextRunAt: '2026-03-01T12:05:00.000Z',
    });
  });

  it('refuses a schedule that is not due yet, and one that does not exist', async () => {
    await schedule('not-due', {
      runOptions: { request: baseRequest, nextRunAt: '2026-03-02T00:00:00.000Z' },
    });
    const target = store();

    await expect(
      target.advanceSchedule('not-due', NOW.toISOString(), '2026-03-03T00:00:00.000Z'),
    ).resolves.toBe(false);
    await expect(
      target.advanceSchedule('missing', NOW.toISOString(), '2026-03-03T00:00:00.000Z'),
    ).resolves.toBe(false);
    expect((await scheduleRow('not-due'))['last_run_at']).toBeNull();
  });
});

describe('PostgresExecutionStore.enqueueScheduledRun', () => {
  async function workerSchedule(id: string): Promise<WorkerSchedule> {
    await schedule(id);
    const [due] = await store().listDueSchedules(NOW, 10);
    if (!due) throw new Error('schedule is not due');
    return due;
  }

  it('returns null and enqueues nothing when another worker already advanced it', async () => {
    const due = await workerSchedule('raced');
    await store().advanceSchedule('raced', NOW.toISOString(), '2026-03-01T12:05:00.000Z');

    const result = await store().enqueueScheduledRun({
      schedule: due,
      scheduledFor: NOW.toISOString(),
      nextRunAt: '2026-03-01T12:05:00.000Z',
      idempotencyKey: 'schedule:raced:1',
    });

    expect(result).toBeNull();
    expect(await runsByKey('schedule:raced:1')).toEqual([]);
  });

  it('enqueues a fresh occurrence as a run and a job, with the run timeout on the job', async () => {
    // `execution_jobs.timeout_ms` is NOT NULL with no default, and the insert never set
    // it, so every fresh scheduled occurrence failed inside the transaction: the run was
    // rolled back, `pollSchedules` threw on every poll, and no schedule ever ran.
    const due = await workerSchedule('fresh');
    await database.query(
      `INSERT INTO projects (id, workspace_id, name, slug) VALUES ($1, $2, 'Fresh', 'fresh')
       ON CONFLICT (id) DO NOTHING`,
      [baseRequest.projectId, WORKSPACE],
    );
    await database.query(
      `INSERT INTO environments (id, workspace_id, project_id, name, slug)
       VALUES ($1, $2, $3, 'Staging', 'staging') ON CONFLICT (id) DO NOTHING`,
      [baseRequest.environmentId, WORKSPACE, baseRequest.projectId],
    );
    await database.query(
      `INSERT INTO releases (id, workspace_id, project_id, name, version)
       VALUES ($1, $2, $3, 'Release', '1.0.0') ON CONFLICT (id) DO NOTHING`,
      [baseRequest.releaseId, WORKSPACE, baseRequest.projectId],
    );

    const result = await store().enqueueScheduledRun({
      schedule: due,
      scheduledFor: NOW.toISOString(),
      nextRunAt: '2026-03-01T12:05:00.000Z',
      idempotencyKey: 'schedule:fresh:1',
    });

    expect(result).toMatchObject({ duplicate: false });
    const [run] = await runsByKey('schedule:fresh:1');
    const jobs = await database.query<{ id: string; timeout_ms: number; state: string }>(
      'SELECT id, timeout_ms, state FROM execution_jobs WHERE run_id = $1',
      [run?.['id']],
    );
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]?.state).toBe('queued');
    expect(jobs.rows[0]?.timeout_ms).toBe(run?.['timeout_ms']);
    expect(jobs.rows[0]?.id).toBe(result?.jobId);
  });

  it('answers with the existing run when the occurrence was already enqueued', async () => {
    const due = await workerSchedule('duplicate');
    const runId = randomUUID();
    const jobId = randomUUID();
    await database.query(
      `INSERT INTO runs (id, workspace_id, started_at, idempotency_key) VALUES ($1, $2, now(), $3)`,
      [runId, WORKSPACE, 'schedule:duplicate:1'],
    );
    await database.query(
      `INSERT INTO execution_jobs (id, workspace_id, run_id, timeout_ms, idempotency_key)
       VALUES ($1, $2, $3, 60000, 'schedule:duplicate:1:attempt:1')`,
      [jobId, WORKSPACE, runId],
    );
    await database.query('UPDATE runs SET current_job_id = $2 WHERE id = $1', [runId, jobId]);

    const result = await store().enqueueScheduledRun({
      schedule: due,
      scheduledFor: NOW.toISOString(),
      nextRunAt: '2026-03-01T12:05:00.000Z',
      idempotencyKey: 'schedule:duplicate:1',
    });

    expect(result).toEqual({ runId, jobId, duplicate: true });
    expect(await runsByKey('schedule:duplicate:1')).toHaveLength(1);
    // The occurrence is consumed either way: the schedule moved on.
    expect((await scheduleRow('duplicate'))['run_options']).toMatchObject({
      nextRunAt: '2026-03-01T12:05:00.000Z',
    });
  });

  it('returns null for an existing run that has no job', async () => {
    const due = await workerSchedule('jobless');
    await database.query(
      `INSERT INTO runs (id, workspace_id, started_at, idempotency_key) VALUES ($1, $2, now(), $3)`,
      [randomUUID(), WORKSPACE, 'schedule:jobless:1'],
    );

    await expect(
      store().enqueueScheduledRun({
        schedule: due,
        scheduledFor: NOW.toISOString(),
        nextRunAt: '2026-03-01T12:05:00.000Z',
        idempotencyKey: 'schedule:jobless:1',
      }),
    ).resolves.toBeNull();
  });

  it('rolls the schedule advance back when the run cannot be inserted', async () => {
    // The advance is the first statement and the run insert the second. A project id
    // that is not a UUID fails the second, and the advance must not survive it —
    // otherwise the occurrence is consumed with no run to show for it.
    const due = await workerSchedule('rollback');
    const broken: WorkerSchedule = { ...due, request: { ...due.request, projectId: 'nope' } };

    await expect(
      store().enqueueScheduledRun({
        schedule: broken,
        scheduledFor: NOW.toISOString(),
        nextRunAt: '2026-03-01T12:05:00.000Z',
        idempotencyKey: 'schedule:rollback:1',
      }),
    ).rejects.toThrow();

    const row = await scheduleRow('rollback');
    expect(row['last_run_at']).toBeNull();
    expect(row['run_options']).toEqual({ request: baseRequest });
    expect(await runsByKey('schedule:rollback:1')).toEqual([]);
  });
});
