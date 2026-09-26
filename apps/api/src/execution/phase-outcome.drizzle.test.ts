import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleExecutionStore } from './drizzle-execution-store.js';

/**
 * The same guarantees the in-memory store is held to, asserted against the real
 * schema on PGlite.
 *
 * This is where the difference shows: `runs_phase_outcome_check` is a real
 * database constraint here, so a phase and outcome written independently would
 * roll the transaction back and surface as an unhandled 500 for a request that
 * was merely malformed. The in-memory store cannot catch that, which is exactly
 * why both need the same scenario — see Q0.12.
 */
const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/drizzle',
);

function readMigrations(): string {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

let client: PGlite;
let store: DrizzleExecutionStore;
let counter = 0;

beforeAll(async () => {
  // A stale build would make the store write yesterday's schema.
  const buildOutput = path.resolve(drizzleDirectory, '..', 'dist', 'index.js');
  const buildTime = statSync(buildOutput).mtimeMs;
  const stack = [path.resolve(drizzleDirectory, '..', 'src')];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.ts') && statSync(full).mtimeMs > buildTime)
        throw new Error('packages/db is not built; run pnpm --filter @automate/db build');
    }
  }

  client = new PGlite();
  await client.exec(readMigrations());
  const db = drizzle(client, { schema });
  // `runners.workspace_id` has a real foreign key, so the workspace must exist.
  await db.insert(schema.workspaces).values({
    id: 'ws-1',
    name: 'default',
    configPath: 'config',
    testResultsDir: 'var/results',
    // The migration gives `created_at` no database default, so Drizzle's
    // compile-time `default()` is not enough — this is the Q0.15 "drizzle
    // defaults are compile-time only" class.
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  store = new DrizzleExecutionStore({ db, workspaceId: 'ws-1' });
  // `runners.id` is a uuid internally, so the store maps the manifest's public
  // id to one. The mapped id is what claims and appends must use.
  const registered = (await store.registerRunner(
    {
      id: 'runner-1',
      name: 'runner-1',
      version: '1.0.0',
      os: 'linux',
      arch: 'x64',
      capabilities: ['playwright'],
      labels: ['reference'],
      slots: 4,
    },
    'a'.repeat(64),
    new Date(Date.now() + 3_600_000).toISOString(),
    'ws-1',
  )) as { id: string };
  runnerId = registered.id;
});

let runnerId = '';

afterAll(async () => {
  await client.close();
});

async function harness() {
  counter += 1;
  const key = `key-${counter}`;
  const { run } = await store.createRun(
    {
      externalId: `external-${key}`,
      source: 'api',
      testType: 'browser',
      framework: 'playwright',
      timeoutMs: 60_000,
      requiredCapabilities: ['playwright'],
      labels: ['reference'],
      configuration: {},
    } as never,
    key,
    'ws-1',
  );
  const claim = await store.claimJob(runnerId, ['playwright'], ['reference'], undefined, 'ws-1');
  if (claim === null) throw new Error('expected a claim');
  return { runId: run.id, claim };
}

describe('runs_phase_outcome_check is unreachable through the event path', () => {
  it('stores a non-terminal phase with no outcome, ignoring the payload', async () => {
    const { runId, claim } = await harness();
    const results = await store.appendEvents(claim.jobId, claim.leaseId, claim.fencingToken, [
      {
        eventId: `evt-${runId}-1`,
        type: 'run.phase',
        sequence: 1,
        payload: { phase: 'running', outcome: 'passed' },
      },
    ]);
    // The write succeeded: the CHECK was never a candidate for violation.
    expect(results[0]?.status).toBe('accepted');
    const run = await store.getRun(runId, 'ws-1');
    expect(run?.phase).toBe('running');
    expect(run?.outcome).toBeNull();
  });

  it('stores a terminal phase with the outcome that phase implies', async () => {
    const { runId, claim } = await harness();
    await store.appendEvents(claim.jobId, claim.leaseId, claim.fencingToken, [
      {
        eventId: `evt-${runId}-1`,
        type: 'run.phase',
        sequence: 1,
        payload: { phase: 'cancelled', outcome: 'passed' },
      },
    ]);
    const run = await store.getRun(runId, 'ws-1');
    expect(run?.phase).toBe('cancelled');
    expect(run?.outcome).toBe('cancelled');
    expect(run?.status).not.toBe('passed');
  });

  it('ignores a phase outside the vocabulary instead of failing the write', async () => {
    const { runId, claim } = await harness();
    const results = await store.appendEvents(claim.jobId, claim.leaseId, claim.fencingToken, [
      {
        eventId: `evt-${runId}-1`,
        type: 'run.phase',
        sequence: 1,
        payload: { phase: 'completed' },
      },
    ]);
    // `'completed'` is not a phase; the event is recorded and the run is untouched,
    // rather than a 500 or a silent rewrite into a terminal state.
    expect(results[0]?.status).toBe('accepted');
    const run = await store.getRun(runId, 'ws-1');
    expect(run?.phase).not.toBe('completed');
  });

  it('does not record a green run when nothing ran', async () => {
    const { runId, claim } = await harness();
    const result = await store.completeJob(
      claim.jobId,
      {
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        status: 'passed',
        outcome: 'passed',
        summary: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, blocked: 0, unknown: 0 },
      },
      'ws-1',
    );
    expect(result).not.toBeNull();
    const run = await store.getRun(runId, 'ws-1');
    expect(run?.status).not.toBe('passed');
  });

  it('records a green run once a test actually passed', async () => {
    const { runId, claim } = await harness();
    await store.completeJob(
      claim.jobId,
      {
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        status: 'passed',
        outcome: 'passed',
        tests: [{ id: 't-1', title: 'login works', status: 'passed' }],
        summary: { total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, blocked: 0, unknown: 0 },
      },
      'ws-1',
    );
    const run = await store.getRun(runId, 'ws-1');
    expect(run?.status).toBe('passed');
  });
});
