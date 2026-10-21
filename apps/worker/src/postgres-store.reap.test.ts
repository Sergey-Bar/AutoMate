import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresExecutionStore } from './postgres-store.js';

/**
 * Lease recovery against the **real** migration graph.
 *
 * The rest of this package stubs `pg.Pool#query` and asserts on SQL text, which cannot
 * see what a statement leaves in a row. Here the pool hands out a client backed by
 * PGlite with every migration applied, so the assertions read the database back.
 */

const drizzle = path.resolve(import.meta.dirname, '../../../packages/db/drizzle');

function migrations(): string {
  const journal = JSON.parse(readFileSync(path.join(drizzle, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzle, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

let database: PGlite;

beforeAll(async () => {
  database = new PGlite();
  await database.exec(migrations());
}, 120_000);

afterAll(async () => {
  await database?.close();
});

/**
 * A store whose pool is PGlite. pg connects lazily, so the real pool built by the
 * constructor never opens a socket, and replacing it is the one seam the class has.
 */
function storeOnPglite(): PostgresExecutionStore {
  const store = new PostgresExecutionStore('postgres://unused/unused');
  const client = {
    query: (text: string, values?: unknown[]) => database.query(text, values ?? []),
    release: () => undefined,
  };
  (store as unknown as { pool: unknown }).pool = {
    connect: () => Promise.resolve(client),
    query: client.query,
    end: () => Promise.resolve(),
  };
  return store;
}

const WORKSPACE = 'default-workspace';
const RUNNER = '00000000-0000-4000-8000-0000000000a1';

async function expiredLease(runId: string, jobId: string, cancelRequested: boolean): Promise<void> {
  await database.query(
    `INSERT INTO runners (id, workspace_id, name, version, os, arch, token_hash, token_expires_at)
     VALUES ($1, $2, 'reaper-test', '1', 'linux', 'x64', 'reaper-test-token', now() + interval '1 day')
     ON CONFLICT (id) DO NOTHING`,
    [RUNNER, WORKSPACE],
  );
  await database.query(
    `INSERT INTO runs (id, workspace_id, status, phase, attempt, started_at, cancel_requested_at)
     VALUES ($1, $2, 'running', 'running', 1, $3, $4)`,
    [
      runId,
      WORKSPACE,
      new Date('2026-10-01T00:00:00Z'),
      cancelRequested ? new Date('2026-10-01T00:10:00Z') : null,
    ],
  );
  await database.query(
    `INSERT INTO execution_jobs
       (id, workspace_id, run_id, state, attempt, timeout_ms, idempotency_key,
        lease_id, lease_owner, lease_expires_at, fencing_token)
     VALUES ($1, $2, $3, 'leased', 1, 60000, $6, gen_random_uuid()::text, $4, $5, 1)`,
    [jobId, WORKSPACE, runId, RUNNER, new Date('2026-10-01T00:30:00Z'), `key-${jobId}`],
  );
}

async function timestamps(runId: string): Promise<{ completed: unknown; finished: unknown }> {
  const result = await database.query<{ completed_at: unknown; finished_at: unknown }>(
    'SELECT completed_at, finished_at FROM runs WHERE id = $1',
    [runId],
  );
  return { completed: result.rows[0]?.completed_at, finished: result.rows[0]?.finished_at };
}

describe('a reaped lease that ends its run stamps the run as ended', () => {
  const now = new Date('2026-10-01T01:00:00Z');

  it('dates a run cancelled while its runner was lost', async () => {
    // The cancelled branch wrote phase `cancelled` and outcome `cancelled` and left
    // both completion timestamps NULL, so every duration and "finished" query read a
    // terminal run as one that never ended.
    const runId = '00000000-0000-4000-8000-0000000000c1';
    await expiredLease(runId, '00000000-0000-4000-8000-0000000000d1', true);

    const [recovered] = await storeOnPglite().reapExpiredLeases(now);

    expect(recovered?.phase).toBe('cancelled');
    const stamped = await timestamps(runId);
    expect(stamped.completed).not.toBeNull();
    expect(stamped.finished).not.toBeNull();
  });

  it('dates a run whose runner was lost for good', async () => {
    // `runner_lost` set `completed_at` and never `finished_at`, which `completeJob`
    // always sets beside it.
    const runId = '00000000-0000-4000-8000-0000000000c2';
    await expiredLease(runId, '00000000-0000-4000-8000-0000000000d2', false);
    await database.query(`UPDATE runs SET metadata = '{"maxAttempts": 1}'::jsonb WHERE id = $1`, [
      runId,
    ]);

    const recovered = await storeOnPglite().reapExpiredLeases(now);

    expect(recovered.find((item) => item.runId === runId)?.phase).toBe('runner_lost');
    const stamped = await timestamps(runId);
    expect(stamped.completed).not.toBeNull();
    expect(stamped.finished).not.toBeNull();
  });
});
