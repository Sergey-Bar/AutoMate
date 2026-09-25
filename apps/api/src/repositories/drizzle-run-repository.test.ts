/**
 * drizzle-run-repository.test.ts — Integration tests for DrizzleRunRepository
 *
 * Uses pg-mem (in-memory PostgreSQL) to test all 8 RunRepository methods.
 * No real Postgres instance is required.
 *
 * Covers:
 *   1. Reporter lifecycle: run:start → test:begin → test:end → run:end
 *   2. Idempotency: duplicate upsertRun and upsertTest do not create extra rows
 *   3. Delta counter safety: patchRun accumulates counters; no-op on missing run
 *   4. Restart survival: new repo instance over same DB sees prior writes
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@automate/db';
import { DrizzleRunRepository } from './drizzle-run-repository.js';
import type { RunRecord, TestRecord } from './run-repository.js';

// ---------------------------------------------------------------------------
// Shared SQL to create the minimal tables needed for tests
// (matches packages/db/src/schema/dashboard.ts)
// ---------------------------------------------------------------------------

const CREATE_RUNS_TABLE = `
  CREATE TABLE IF NOT EXISTS runs (
    id uuid PRIMARY KEY,
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
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
    completed_at timestamptz,
    phase text DEFAULT 'queued' NOT NULL,
    outcome text,
    attempt integer DEFAULT 1 NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    blocked integer DEFAULT 0 NOT NULL,
    unknown integer DEFAULT 0 NOT NULL,
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
  )
`;

const CREATE_TESTS_TABLE = `
  CREATE TABLE IF NOT EXISTS tests (
    id text NOT NULL,
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    suite_id text,
    title text NOT NULL,
    file text NOT NULL,
    line integer,
    "column" integer,
    stable_id text,
    status text NOT NULL DEFAULT 'queued',
    duration_ms integer,
    tags jsonb,
    annotations jsonb,
    retry_count integer DEFAULT 0,
    expected_status text,
    worker_index integer,
    PRIMARY KEY (id, run_id)
  )
`;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface TestContext {
  repo: DrizzleRunRepository;
  createRepo: () => DrizzleRunRepository;
}

async function createTestContext(): Promise<TestContext> {
  const client = new PGlite();
  await client.exec(CREATE_RUNS_TABLE);
  await client.exec(CREATE_TESTS_TABLE);

  const createRepo = () => {
    const db = drizzle(client, { schema });
    return new DrizzleRunRepository(db);
  };

  return { repo: createRepo(), createRepo };
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: '550e8400-e29b-41d4-a716-446655440001',
    startedAt: '2026-05-05T10:00:00.000Z',
    finishedAt: null,
    status: 'running',
    total: 5,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: null,
    branch: 'main',
    commitSha: 'abc1234',
    triggeredBy: 'manual',
    ...overrides,
  };
}

function makeTest(overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id: 'test-id-001',
    runId: '550e8400-e29b-41d4-a716-446655440001',
    title: 'should render login form',
    file: 'e2e/login.spec.ts',
    status: 'queued',
    durationMs: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Reporter lifecycle
// ---------------------------------------------------------------------------

describe('DrizzleRunRepository — reporter lifecycle (task-18-postgres-lifecycle)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  it('run:start creates a run with status=running', async () => {
    const run = makeRun();
    await ctx.repo.upsertRun(run);

    const found = await ctx.repo.getRun(run.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(run.id);
    expect(found!.status).toBe('running');
    expect(found!.total).toBe(5);
    expect(found!.passed).toBe(0);
    expect(found!.finishedAt).toBeNull();
  });

  it('test:begin creates a test row with status=running', async () => {
    const run = makeRun();
    await ctx.repo.upsertRun(run);

    const test = makeTest({ status: 'running' });
    await ctx.repo.upsertTest(test);

    const found = await ctx.repo.getTest(test.id, test.runId);
    expect(found).not.toBeNull();
    expect(found!.status).toBe('running');
    expect(found!.title).toBe(test.title);
    expect(found!.file).toBe(test.file);
  });

  it('test:end patches test status and durationMs', async () => {
    const run = makeRun();
    await ctx.repo.upsertRun(run);

    const test = makeTest({ status: 'running' });
    await ctx.repo.upsertTest(test);

    await ctx.repo.patchTest(test.id, test.runId, {
      status: 'passed',
      durationMs: 42,
    });

    const found = await ctx.repo.getTest(test.id, test.runId);
    expect(found!.status).toBe('passed');
    expect(found!.durationMs).toBe(42);
  });

  it('run:end patches run status, finishedAt, durationMs', async () => {
    const run = makeRun();
    await ctx.repo.upsertRun(run);

    const finishedAt = '2026-05-05T10:01:00.000Z';
    await ctx.repo.patchRun(run.id, {
      status: 'passed',
      finishedAt,
      durationMs: 1000,
    });

    const found = await ctx.repo.getRun(run.id);
    expect(found!.status).toBe('passed');
    expect(found!.durationMs).toBe(1000);
    expect(found!.finishedAt).not.toBeNull();
  });

  it('full lifecycle: run:start → test:begin → test:end → run:end', async () => {
    const { repo } = ctx;
    const runId = '550e8400-e29b-41d4-a716-446655440002';

    // run:start
    await repo.upsertRun(makeRun({ id: runId, total: 1 }));

    // test:begin
    await repo.upsertTest(makeTest({ id: 't-lc-1', runId, status: 'running' }));

    // verify mid-state
    const midTest = await repo.getTest('t-lc-1', runId);
    expect(midTest!.status).toBe('running');

    // test:end
    await repo.patchTest('t-lc-1', runId, { status: 'passed', durationMs: 50 });
    await repo.patchRun(runId, { passedDelta: 1 });

    // run:end
    await repo.patchRun(runId, {
      status: 'passed',
      finishedAt: '2026-05-05T10:02:00.000Z',
      durationMs: 500,
    });

    const finalRun = await repo.getRun(runId);
    expect(finalRun!.status).toBe('passed');
    expect(finalRun!.passed).toBe(1);
    expect(finalRun!.durationMs).toBe(500);
    expect(finalRun!.finishedAt).not.toBeNull();

    const finalTest = await repo.getTest('t-lc-1', runId);
    expect(finalTest!.status).toBe('passed');
    expect(finalTest!.durationMs).toBe(50);
  });

  it('listRuns returns all inserted runs ordered by startedAt', async () => {
    await ctx.repo.upsertRun(
      makeRun({
        id: '550e8400-e29b-41d4-a716-446655440010',
        startedAt: '2026-05-05T10:00:00.000Z',
      }),
    );
    await ctx.repo.upsertRun(
      makeRun({
        id: '550e8400-e29b-41d4-a716-446655440011',
        startedAt: '2026-05-05T11:00:00.000Z',
      }),
    );

    const runs = await ctx.repo.listRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].startedAt < runs[1].startedAt).toBe(true);
  });

  it('listTests returns all tests for a given run', async () => {
    const runId = '550e8400-e29b-41d4-a716-446655440012';
    await ctx.repo.upsertRun(makeRun({ id: runId }));
    await ctx.repo.upsertTest(makeTest({ id: 't-lt-1', runId }));
    await ctx.repo.upsertTest(makeTest({ id: 't-lt-2', runId }));

    const tests = await ctx.repo.listTests(runId);
    expect(tests).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Idempotency
// ---------------------------------------------------------------------------

describe('DrizzleRunRepository — idempotency (task-18-idempotency)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  it('upsertRun with same id twice does not create a second row', async () => {
    const run = makeRun({ total: 5 });
    await ctx.repo.upsertRun(run);
    await ctx.repo.upsertRun({ ...run, total: 10 }); // overwrite

    const runs = await ctx.repo.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].total).toBe(10); // latest value wins
  });

  it('upsertTest with same (id, runId) twice does not create a second row', async () => {
    const run = makeRun();
    await ctx.repo.upsertRun(run);

    const test = makeTest({ status: 'queued' });
    await ctx.repo.upsertTest(test);
    await ctx.repo.upsertTest({ ...test, status: 'running' }); // overwrite

    const tests = await ctx.repo.listTests(run.id);
    expect(tests).toHaveLength(1);
    expect(tests[0].status).toBe('running'); // latest value wins
  });

  it('sending the same run twice via upsert confirms no duplicate rows', async () => {
    const run = makeRun({ id: '550e8400-e29b-41d4-a716-446655440020' });

    for (let i = 0; i < 3; i++) {
      await ctx.repo.upsertRun(run);
    }

    const runs = await ctx.repo.listRuns();
    expect(runs).toHaveLength(1);
  });

  it('upsertRun overwrites all fields including finishedAt', async () => {
    const run = makeRun({ finishedAt: null });
    await ctx.repo.upsertRun(run);

    const finishedAt = '2026-05-05T11:00:00.000Z';
    await ctx.repo.upsertRun({ ...run, status: 'passed', finishedAt });

    const found = await ctx.repo.getRun(run.id);
    expect(found!.status).toBe('passed');
    expect(found!.finishedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Delta counter safety
// ---------------------------------------------------------------------------

describe('DrizzleRunRepository — delta counter safety', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  it('passedDelta accumulates across multiple patchRun calls', async () => {
    const run = makeRun({ id: '550e8400-e29b-41d4-a716-446655440030' });
    await ctx.repo.upsertRun(run);

    await ctx.repo.patchRun(run.id, { passedDelta: 1 });
    await ctx.repo.patchRun(run.id, { passedDelta: 1 });
    await ctx.repo.patchRun(run.id, { passedDelta: 1 });

    const found = await ctx.repo.getRun(run.id);
    expect(found!.passed).toBe(3);
  });

  it('failedDelta and flakyDelta accumulate independently', async () => {
    const run = makeRun({ id: '550e8400-e29b-41d4-a716-446655440031' });
    await ctx.repo.upsertRun(run);

    await ctx.repo.patchRun(run.id, { failedDelta: 2 });
    await ctx.repo.patchRun(run.id, { flakyDelta: 1 });
    await ctx.repo.patchRun(run.id, { skippedDelta: 3 });

    const found = await ctx.repo.getRun(run.id);
    expect(found!.failed).toBe(2);
    expect(found!.flaky).toBe(1);
    expect(found!.skipped).toBe(3);
    expect(found!.passed).toBe(0);
  });

  it('patchRun on non-existent run is a no-op', async () => {
    const nonExistentId = '550e8400-e29b-41d4-a716-446655440099';
    // Should not throw
    await expect(
      ctx.repo.patchRun(nonExistentId, { status: 'passed', passedDelta: 5 }),
    ).resolves.toBeUndefined();

    const found = await ctx.repo.getRun(nonExistentId);
    expect(found).toBeNull();
  });

  it('patchTest on non-existent test is a no-op', async () => {
    const run = makeRun({ id: '550e8400-e29b-41d4-a716-446655440032' });
    await ctx.repo.upsertRun(run);

    await expect(
      ctx.repo.patchTest('non-existent-test', run.id, { status: 'passed' }),
    ).resolves.toBeUndefined();
  });

  it('getRun returns null for unknown id', async () => {
    const found = await ctx.repo.getRun('550e8400-e29b-41d4-a716-000000000000');
    expect(found).toBeNull();
  });

  it('getTest returns null for unknown (testId, runId)', async () => {
    const run = makeRun({ id: '550e8400-e29b-41d4-a716-446655440033' });
    await ctx.repo.upsertRun(run);

    const found = await ctx.repo.getTest('non-existent', run.id);
    expect(found).toBeNull();
  });

  it('listRuns returns empty array when no runs exist', async () => {
    const runs = await ctx.repo.listRuns();
    expect(runs).toEqual([]);
  });

  it('listTests returns empty array when no tests exist for run', async () => {
    const run = makeRun({ id: '550e8400-e29b-41d4-a716-446655440034' });
    await ctx.repo.upsertRun(run);

    const tests = await ctx.repo.listTests(run.id);
    expect(tests).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Restart survival (cross-instance data visibility)
// ---------------------------------------------------------------------------

describe('DrizzleRunRepository — restart survival', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  it('instance B reads data written by instance A (same PGlite client)', async () => {
    const { createRepo } = ctx;

    const repoA = createRepo();
    const runId = '550e8400-e29b-41d4-a716-446655440040';
    await repoA.upsertRun(makeRun({ id: runId, branch: 'feat/restart' }));
    await repoA.upsertTest(makeTest({ id: 't-rs-1', runId, status: 'running' }));

    // Create a brand-new DrizzleRunRepository instance over the same pool
    const repoB = createRepo();
    const foundRun = await repoB.getRun(runId);
    expect(foundRun).not.toBeNull();
    expect(foundRun!.branch).toBe('feat/restart');

    const foundTest = await repoB.getTest('t-rs-1', runId);
    expect(foundTest).not.toBeNull();
    expect(foundTest!.status).toBe('running');
  });

  it('instance B sees patches applied by instance A', async () => {
    const { createRepo } = ctx;

    const runId = '550e8400-e29b-41d4-a716-446655440041';
    const repoA = createRepo();
    await repoA.upsertRun(makeRun({ id: runId }));
    await repoA.patchRun(runId, { passedDelta: 5, status: 'passed' });

    const repoB = createRepo();
    const found = await repoB.getRun(runId);
    expect(found!.passed).toBe(5);
    expect(found!.status).toBe('passed');
  });
});
