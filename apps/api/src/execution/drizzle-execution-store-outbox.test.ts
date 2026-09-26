import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { outboxEvents } from '@automate/db';
import { DrizzleExecutionStore } from './drizzle-execution-store.js';

const WORKSPACE = 'workspace-outbox';

const SCHEMA_SQL = `
  CREATE TABLE runners (
    id uuid PRIMARY KEY,
    workspace_id text NOT NULL,
    name text NOT NULL,
    version text NOT NULL,
    protocol_version text DEFAULT '1' NOT NULL,
    os text NOT NULL,
    arch text NOT NULL,
    capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    labels jsonb DEFAULT '[]'::jsonb NOT NULL,
    slots integer DEFAULT 1 NOT NULL,
    health text DEFAULT 'offline' NOT NULL,
    token_hash text NOT NULL,
    token_expires_at timestamptz NOT NULL,
    token_revoked_at timestamptz,
    last_heartbeat_at timestamptz,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE TABLE runs (
    id uuid PRIMARY KEY,
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
    completed_at timestamptz,
    status text NOT NULL DEFAULT 'running',
    total integer NOT NULL DEFAULT 0,
    passed integer NOT NULL DEFAULT 0,
    failed integer NOT NULL DEFAULT 0,
    flaky integer NOT NULL DEFAULT 0,
    skipped integer NOT NULL DEFAULT 0,
    duration_ms integer,
    branch text,
    commit text,
    commit_sha text,
    commit_message text,
    triggered_by text DEFAULT 'manual',
    config jsonb,
    configuration jsonb,
    raw_args text,
    source text NOT NULL DEFAULT 'live',
    gate_status text,
    workspace_id text,
    external_id text,
    phase text DEFAULT 'queued' NOT NULL,
    outcome text,
    attempt integer DEFAULT 1 NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    blocked integer NOT NULL DEFAULT 0,
    unknown integer NOT NULL DEFAULT 0,
    source_metadata jsonb,
    framework text,
    adapter_version text,
    test_type text,
    project_id uuid,
    environment_id uuid,
    release_id uuid,
    suite text,
    selection jsonb DEFAULT '[]'::jsonb NOT NULL,
    required_capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    labels jsonb DEFAULT '[]'::jsonb NOT NULL,
    timeout_ms integer,
    policy_id uuid,
    idempotency_key text,
    retry_of_run_id uuid,
    runner_id uuid,
    current_job_id uuid,
    event_sequence integer DEFAULT 0 NOT NULL,
    cancel_requested_at timestamptz,
    cancel_requested_by text,
    error_code text,
    error_message text,
    error_details jsonb,
    raw_evidence_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    queued_at timestamptz DEFAULT now() NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    pr_number integer,
    pr_branch text,
    base_branch text,
    commit_author text
  );
  CREATE UNIQUE INDEX runs_workspace_idempotency_unique ON runs (workspace_id, idempotency_key);
  CREATE TABLE execution_jobs (
    id uuid PRIMARY KEY,
    workspace_id text NOT NULL,
    run_id uuid NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    state text DEFAULT 'queued' NOT NULL,
    available_at timestamptz DEFAULT now() NOT NULL,
    timeout_ms integer NOT NULL,
    required_capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    labels jsonb DEFAULT '[]'::jsonb NOT NULL,
    spec jsonb DEFAULT '{}'::jsonb NOT NULL,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    lease_id text,
    lease_owner uuid,
    lease_expires_at timestamptz,
    heartbeat_at timestamptz,
    fencing_token integer DEFAULT 0 NOT NULL,
    idempotency_key text NOT NULL,
    error_code text,
    error_message text,
    completion_hash text,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX execution_jobs_run_attempt_unique ON execution_jobs (run_id, attempt);
  CREATE TABLE run_events (
    workspace_id text NOT NULL,
    event_id text NOT NULL,
    version text DEFAULT '1' NOT NULL,
    run_id uuid NOT NULL,
    job_id uuid,
    sequence bigint NOT NULL,
    source text NOT NULL,
    event_key text NOT NULL,
    hash text NOT NULL,
    type text NOT NULL,
    payload jsonb NOT NULL,
    lease_id text,
    fencing_token integer DEFAULT 0 NOT NULL,
    occurred_at timestamptz NOT NULL,
    received_at timestamptz DEFAULT now() NOT NULL,
    PRIMARY KEY (workspace_id, event_id)
  );
  CREATE UNIQUE INDEX run_events_run_sequence_unique ON run_events (run_id, sequence);
  CREATE UNIQUE INDEX run_events_workspace_event_key_unique ON run_events (workspace_id, event_key);
  CREATE TABLE tests (
    id text NOT NULL,
    run_id uuid NOT NULL,
    suite_id text,
    title text NOT NULL,
    file text NOT NULL,
    line integer,
    "column" integer,
    stable_id text,
    status text DEFAULT 'queued' NOT NULL,
    duration_ms integer,
    tags jsonb,
    annotations jsonb,
    retry_count integer DEFAULT 0,
    expected_status text,
    worker_index integer,
    PRIMARY KEY (id, run_id)
  );
  CREATE TABLE artifacts (
    id uuid PRIMARY KEY,
    legacy_attachment_id text,
    run_id uuid NOT NULL,
    job_id uuid,
    test_id text,
    result_id text,
    attempt integer,
    kind text DEFAULT 'other' NOT NULL,
    name text NOT NULL,
    content_type text NOT NULL,
    storage_key text NOT NULL,
    checksum_algorithm text DEFAULT 'sha256' NOT NULL,
    checksum text,
    size_bytes bigint,
    expires_at timestamptz,
    legal_hold boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE TABLE quality_policies (
    id uuid PRIMARY KEY,
    workspace_id text NOT NULL,
    name text NOT NULL,
    version text NOT NULL,
    hash text NOT NULL,
    required_domains jsonb DEFAULT '["browser"]'::jsonb NOT NULL,
    browser_pass_rate_threshold real DEFAULT 100 NOT NULL,
    max_flaky_rate real DEFAULT 0 NOT NULL,
    max_duration_ms integer,
    rules jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE TABLE gate_evaluations (
    id uuid PRIMARY KEY,
    workspace_id text NOT NULL,
    run_id uuid NOT NULL,
    release_id uuid,
    policy_id uuid NOT NULL,
    policy_version text NOT NULL,
    policy_hash text NOT NULL,
    status text NOT NULL,
    decision text NOT NULL,
    reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    evidence_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    domain_statuses jsonb NOT NULL,
    evaluated_at timestamptz NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX gate_evaluations_run_policy_hash_unique
    ON gate_evaluations (run_id, policy_id, policy_hash);
`;

const OUTBOX_SQL = `
  CREATE TABLE outbox_events (
    sequence integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id text,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    event_type text NOT NULL,
    event_version integer DEFAULT 2 NOT NULL,
    payload jsonb NOT NULL,
    dedupe_key text NOT NULL,
    occurred_at timestamptz DEFAULT now() NOT NULL,
    expires_at timestamptz
  );
  CREATE UNIQUE INDEX outbox_events_dedupe_idx ON outbox_events (dedupe_key);
`;

const clients: PGlite[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

interface Harness {
  store: DrizzleExecutionStore;
  db: ReturnType<typeof drizzle<typeof schema>>;
  outboxRows: () => Promise<
    Array<{
      event_type: string;
      aggregate_id: string;
      workspace_id: string | null;
      dedupe_key: string;
      payload: Record<string, unknown>;
    }>
  >;
}

async function createHarness(options: { withOutbox?: boolean } = {}): Promise<Harness> {
  const client = new PGlite();
  clients.push(client);
  await client.exec(SCHEMA_SQL);
  if (options.withOutbox !== false) await client.exec(OUTBOX_SQL);
  const db = drizzle(client, { schema });
  return {
    store: new DrizzleExecutionStore({ db, now: () => new Date('2026-05-06T00:00:00.000Z') }),
    db,
    outboxRows: async () => {
      const rows = await db
        .select({
          event_type: outboxEvents.eventType,
          aggregate_id: outboxEvents.aggregateId,
          workspace_id: outboxEvents.workspaceId,
          dedupe_key: outboxEvents.dedupeKey,
          payload: outboxEvents.payload,
        })
        .from(outboxEvents)
        .orderBy(asc(outboxEvents.sequence));
      return rows.map((row) => ({ ...row, payload: row.payload }));
    },
  };
}

const RUNNER_ID = '11111111-1111-4111-8111-111111111111';

async function leaseJob(store: DrizzleExecutionStore, runId: string) {
  await store.registerRunner(
    {
      id: RUNNER_ID,
      name: 'runner-1',
      version: '1.0.0',
      os: 'linux',
      arch: 'x64',
      capabilities: ['playwright'],
      labels: [],
      slots: 2,
    },
    'token-hash',
    '2026-05-07T00:00:00.000Z',
    WORKSPACE,
  );
  const claim = await store.claimJob(
    RUNNER_ID,
    ['playwright'],
    [],
    new Date('2026-05-06T00:00:00.000Z'),
  );
  if (!claim) throw new Error('expected the job to be claimed');
  if (claim.runId !== runId) throw new Error('claimed the wrong run');
  return claim;
}

describe('DrizzleExecutionStore outbox', () => {
  it('appends the run creation outbox row inside the createRun transaction', async () => {
    const { store, outboxRows } = await createHarness();

    const created = await store.createRun({ source: 'api' }, 'idem-1', WORKSPACE);

    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe('execution.run.created');
    expect(rows[0]?.aggregate_id).toBe(created.run.id);
    expect(rows[0]?.workspace_id).toBe(WORKSPACE);
    expect(rows[0]?.dedupe_key).toBe(`execution:${WORKSPACE}:run.created:${created.run.id}`);
    expect(rows[0]?.payload).toMatchObject({
      runId: created.run.id,
      jobId: created.job.id,
      attempt: 1,
      phase: 'queued',
      status: 'running',
    });
  });

  it('does not append a second outbox row for a duplicate createRun', async () => {
    const { store, outboxRows } = await createHarness();

    const first = await store.createRun({ source: 'api' }, 'idem-2', WORKSPACE);
    const second = await store.createRun({ source: 'api' }, 'idem-2', WORKSPACE);

    expect(second.duplicate).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedupe_key).toBe(`execution:${WORKSPACE}:run.created:${first.run.id}`);
  });

  it('appends one sanitized outbox row per accepted event and none for conflicts', async () => {
    const { store, outboxRows } = await createHarness();
    const created = await store.createRun({ source: 'api' }, 'idem-3', WORKSPACE);
    const claim = await leaseJob(store, created.run.id);

    const accepted = await store.appendEvents(claim.jobId, claim.leaseId, claim.fencingToken, [
      {
        eventId: 'evt-1',
        sequence: 1,
        type: 'test.started',
        occurredAt: '2026-05-06T00:00:00.000Z',
        payload: { testId: 'test-1', title: 'checkout', apiKey: 'super-secret' },
      },
    ]);
    const conflicted = await store.appendEvents(claim.jobId, claim.leaseId, claim.fencingToken, [
      {
        eventId: 'evt-gap',
        sequence: 9,
        type: 'test.completed',
        occurredAt: '2026-05-06T00:00:00.000Z',
        payload: { testId: 'test-1' },
      },
    ]);
    const stale = await store.appendEvents('00000000-0000-4000-8000-000000000000', 'nope', 0, [
      {
        eventId: 'evt-stale',
        sequence: 2,
        type: 'test.completed',
        occurredAt: '2026-05-06T00:00:00.000Z',
        payload: {},
      },
    ]);

    expect(accepted.map((result) => result.status)).toEqual(['accepted']);
    expect(conflicted[0]?.status).toBe('conflict');
    expect(stale[0]?.status).toBe('conflict');
    const rows = await outboxRows();
    const eventRows = rows.filter((row) => row.event_type === 'execution.event.appended');
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]?.dedupe_key).toBe(
      `execution:${WORKSPACE}:event.appended:${created.run.id}:evt-1`,
    );
    expect(eventRows[0]?.payload).toMatchObject({
      runId: created.run.id,
      jobId: claim.jobId,
      eventId: 'evt-1',
      sequence: 1,
      type: 'test.started',
      payload: { testId: 'test-1', title: 'checkout' },
    });
    const storedPayload = eventRows[0]?.payload['payload'] as Record<string, unknown>;
    expect(storedPayload['apiKey']).toBeUndefined();
    expect(JSON.stringify(eventRows[0]?.payload)).not.toContain('super-secret');
  });

  it('keeps a single outbox row when the same event is delivered twice', async () => {
    const { store, outboxRows } = await createHarness();
    const created = await store.createRun({ source: 'api' }, 'idem-4', WORKSPACE);
    const claim = await leaseJob(store, created.run.id);
    const event = {
      eventId: 'evt-dup',
      sequence: 1,
      type: 'test.started',
      occurredAt: '2026-05-06T00:00:00.000Z',
      payload: { testId: 'test-1' },
    };

    const first = await store.appendEvents(claim.jobId, claim.leaseId, claim.fencingToken, [event]);
    const second = await store.appendEvents(claim.jobId, claim.leaseId, claim.fencingToken, [
      event,
    ]);

    expect(first[0]?.status).toBe('accepted');
    expect(second[0]?.status).toBe('duplicate');
    const rows = await outboxRows();
    expect(rows.filter((row) => row.event_type === 'execution.event.appended')).toHaveLength(1);
    expect(rows).toHaveLength(2);
  });

  it('appends a single cancellation outbox row', async () => {
    const { store, outboxRows } = await createHarness();
    const created = await store.createRun({ source: 'api' }, 'idem-5', WORKSPACE);

    const cancelled = await store.cancelRun(created.run.id, WORKSPACE);
    const again = await store.cancelRun(created.run.id, WORKSPACE);

    expect(cancelled?.phase).toBe('cancelled');
    expect(again?.phase).toBe('cancelled');
    const rows = await outboxRows();
    const cancelRows = rows.filter((row) => row.event_type === 'execution.run.cancelled');
    expect(cancelRows).toHaveLength(1);
    expect(cancelRows[0]?.dedupe_key).toBe(
      `execution:${WORKSPACE}:run.cancelled:${created.run.id}`,
    );
    expect(cancelRows[0]?.payload).toMatchObject({ phase: 'cancelled', outcome: 'cancelled' });
  });

  it('appends one completion outbox row and none for a repeated completion', async () => {
    const { store, outboxRows } = await createHarness();
    const created = await store.createRun({ source: 'api' }, 'idem-6', WORKSPACE);
    const claim = await leaseJob(store, created.run.id);
    const completion = {
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
      status: 'passed',
      outcome: 'passed' as const,
      summary: { total: 1, passed: 1, failed: 0, unknown: 0 },
    };

    const accepted = await store.completeJob(claim.jobId, completion);
    const duplicate = await store.completeJob(claim.jobId, completion);

    expect(accepted?.status).toBe('accepted');
    expect(duplicate?.status).toBe('duplicate');
    const rows = await outboxRows();
    const jobRows = rows.filter((row) => row.event_type === 'execution.job.completed');
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0]?.dedupe_key).toBe(`execution:${WORKSPACE}:job.completed:${claim.jobId}`);
    expect(jobRows[0]?.payload).toMatchObject({ phase: 'complete', outcome: 'passed' });
  });

  it('rolls back the run write when the outbox insert fails', async () => {
    const { store, db } = await createHarness({ withOutbox: false });

    await expect(store.createRun({ source: 'api' }, 'idem-7', WORKSPACE)).rejects.toThrow();

    const runs = await db.select().from(schema.runs).where(eq(schema.runs.workspaceId, WORKSPACE));
    const jobs = await db
      .select()
      .from(schema.executionJobs)
      .where(eq(schema.executionJobs.workspaceId, WORKSPACE));
    expect(runs).toHaveLength(0);
    expect(jobs).toHaveLength(0);
  });
});
