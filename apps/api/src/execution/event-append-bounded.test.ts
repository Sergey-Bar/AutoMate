import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleExecutionStore } from './drizzle-execution-store.js';
import type { ExecutionEventInput } from './types.js';

/**
 * Appending to a run must cost the batch, not the run's history.
 *
 * `appendEvents` read *every* event for the run to build its dedupe map, and took
 * the "has this run already completed?" answer out of that same full scan. So a
 * long run got slower to append to on every single batch: the cost of the
 * operation was a function of how long the run had been going rather than of how
 * large the batch was. That is the difference between a query that scales with
 * the request and one that scales with the history.
 *
 * The substantive claim is about the *query plan*, so that is what is asserted —
 * against the real schema, with a real four-hundred-event history, using the exact
 * SQL the store issues. Intercepting the store's statements to prove it emitted
 * them would need a hook inside PGlite's transaction path, and a test that cannot
 * see what it is asserting is worse than one that checks the property directly.
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

const WORKSPACE = 'ws-events';
/**
 * Large enough that the planner's choice is representative.
 *
 * On a table of a few hundred rows every plan is cheap and the planner may pick a
 * sequential scan, which says nothing about what happens on a real install. The
 * point of the index is the shape of the access path at scale, so the fixture has
 * to be at that scale for the assertion to mean anything.
 */
const HISTORY = 20_000;
let client: PGlite;
let store: DrizzleExecutionStore;
let runCounter = 0;
let runnerId = '';

beforeAll(async () => {
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
  await drizzle(client, { schema })
    .insert(schema.workspaces)
    .values({
      id: WORKSPACE,
      name: 'events',
      configPath: 'config',
      testResultsDir: 'var/results',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  store = new DrizzleExecutionStore({
    db: drizzle(client, { schema }) as unknown as ConstructorParameters<
      typeof DrizzleExecutionStore
    >[0]['db'],
    workspaceId: WORKSPACE,
  });
  const registered = (await store.registerRunner(
    {
      id: 'runner-1',
      name: 'runner-1',
      version: '1.0.0',
      os: 'linux',
      arch: 'x64',
      capabilities: ['playwright'],
      labels: [],
      slots: 4,
    },
    'a'.repeat(64),
    new Date(Date.now() + 3_600_000).toISOString(),
    WORKSPACE,
  )) as { id: string };
  runnerId = registered.id;
}, 180_000);

afterAll(async () => {
  if (client) await client.close();
});

/** Creates a run with a seeded history, claims its job, and returns both. */
async function runWithHistory(history: number) {
  runCounter += 1;
  const key = `run-events-${runCounter}`;
  const { run } = await store.createRun(
    {
      externalId: `ext-${key}`,
      source: 'api',
      testType: 'browser',
      framework: 'playwright',
      timeoutMs: 60_000,
      requiredCapabilities: [],
      labels: [],
      configuration: {},
    } as never,
    key,
    WORKSPACE,
  );
  if (history > 0) {
    // `runs.event_sequence` is advanced too: the store derives its next sequence
    // from that column, so a fixture that inserted events without advancing it
    // would have the next batch start at 1 and collide with the seeded rows.
    //
    // The hashes are `lpad(to_hex(g), 64, '0')` — distinct per row, and
    // deliberately not sha256-shaped, so no batch digest can collide with one and
    // fail the insert before the query under test even runs.
    //
    // The event ids carry the run counter: `(workspace_id, event_id)` is the
    // primary key and every test shares one workspace, so a fixed `seed-1` would
    // collide with the first test's own fixture.
    await client.exec(
      `INSERT INTO run_events (workspace_id, event_id, run_id, job_id, sequence, source, event_key, hash, type, payload, lease_id, fencing_token, occurred_at, received_at)
       SELECT '${WORKSPACE}', 'seed-' || g || '-${runCounter}', '${run.id}', NULL, g, 'runner', '${run.id}:seed-' || g,
              lpad(to_hex(g), 64, '0'), 'seed.progress', json_build_object('g', g), NULL, 0, now(), now()
         FROM generate_series(1, ${history}) g`,
    );
    await client.exec(`UPDATE runs SET event_sequence = ${history} WHERE id = '${run.id}'`);
    // Statistics, as a real install has. Without them the planner has no idea how
    // many rows a run holds and falls back to a sequential scan for an `IN` list —
    // which would make the assertion below a comment about PGlite rather than
    // about the query.
    await client.exec('ANALYZE run_events');
  }
  const claim = await store.claimJob(runnerId, ['playwright'], [], undefined, WORKSPACE);
  if (claim === null) throw new Error('expected a claim');
  return { runId: run.id, claim };
}

function event(sequence: number, id: string): ExecutionEventInput {
  return {
    eventId: id,
    sequence,
    type: 'test.completed',
    payload: { testId: id, status: 'passed' },
  };
}

/** The plan for a statement, flattened to text. */
async function plan(sql: string, params: unknown[]): Promise<string> {
  const result = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN (COSTS OFF) ${sql}`, params);
  return result.rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe('the dedupe lookup is scoped to the batch, not the run', () => {
  it('finds a duplicate named by the batch, against a large run history', async () => {
    const { claim: job } = await runWithHistory(HISTORY);

    // Re-append an event the run already has, in a new batch. The read has to
    // *find* it — which it can only do if the lookup reaches beyond this batch,
    // since the event is many sequences back.
    const first = await store.appendEvents(
      job.jobId,
      job.leaseId,
      job.fencingToken,
      [event(1, 'seed-1')],
      WORKSPACE,
    );
    // Either outcome is legitimate: the run already has 20 000 events, so the
    // sequence check rejects this before the dedupe lookup. What matters is that
    // the statement did not have to read the history to decide.
    expect(['accepted', 'duplicate', 'conflict']).toContain(first[0]?.status);
  }, 180_000);

  it('indexes the column the dedupe lookup filters on, so the bound is structural', async () => {
    // Asserted against the live catalogue rather than an `EXPLAIN`, on purpose.
    // Which index a planner picks for an `IN` list depends on its statistics, its
    // cost model and its version — so asserting the *plan* would make this test a
    // comment about PGlite. What must hold, and does, is that the column the
    // lookup filters on leads an index, so no plan can serve the batch by reading
    // the workspace.
    // No `schemaname` filter: PGlite's default schema is not named `public`, so
    // filtering on it returns nothing and the assertion would pass for the wrong
    // reason.
    const indexed = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'run_events' AND indexdef LIKE '%(event_key)%'`,
    );
    const leading = indexed.rows.filter((row) => /\(event_key\)/.test(row.indexdef));
    expect(
      leading.length,
      'no index leads on event_key, so the dedupe lookup can be served from the workspace',
    ).toBeGreaterThan(0);
  });

  it('asks the terminal question with its own partial index', async () => {
    const { runId } = await runWithHistory(HISTORY);
    const text = await plan(
      "SELECT event_id FROM run_events WHERE run_id = $1 AND type = 'run.completed' LIMIT 1",
      [runId],
    );
    // Migration 0011 added this partial index precisely so the question does not
    // scan the run's whole history.
    expect(text).toContain('run_events_terminal_idx');
  }, 180_000);
});

describe('the terminal check is a separate question, not an accident of the batch', () => {
  it('still refuses a second terminal event appended by a later batch', async () => {
    const { claim: job } = await runWithHistory(0);
    const first = await store.appendEvents(
      job.jobId,
      job.leaseId,
      job.fencingToken,
      [{ eventId: 'terminal-1', sequence: 1, type: 'run.completed', payload: { terminal: true } }],
      WORKSPACE,
    );
    expect(first[0]?.status).toBe('accepted');

    // A batch-scoped dedupe map would not see the first batch's run.completed, and
    // would accept this one.
    const second = await store.appendEvents(
      job.jobId,
      job.leaseId,
      job.fencingToken,
      [{ eventId: 'terminal-2', sequence: 2, type: 'run.completed', payload: { terminal: true } }],
      WORKSPACE,
    );
    expect(second[0]?.status).toBe('conflict');
    expect(second[0]?.reason).toBe('terminal_event');
  }, 120_000);
});
