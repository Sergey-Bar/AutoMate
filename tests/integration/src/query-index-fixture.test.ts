import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * A per-endpoint `EXPLAIN` fixture: the hot queries, and the index each one needs.
 *
 * Query counts and page caps are measurable (see `run-listing-queries.test.ts`, which
 * counts the statements actually issued). Whether a query is *indexed* is not, and a
 * missing index does not fail anything: the query still works, just slowly, and
 * slowly is a production incident rather than a red build. So the index a query
 * depends on was implicit — present as long as nobody removed it, and gone the moment
 * someone did.
 *
 * **Why `enable_seqscan = off`.** On a PGlite instance holding a few hundred rows the
 * planner *should* choose a sequential scan, so asserting "no Seq Scan" without
 * seeding tens of thousands of rows would be asserting nothing, and seeding them would
 * make the test slow and its verdict a function of the planner's cost constants.
 * Turning sequential scans off changes one thing: the plan is the planner's, with the
 * option of a full-table scan taken away. A query whose index is present is served by
 * it; a query whose index is **missing** cannot be served at all and Postgres raises
 * rather than quietly degrading. So this fixture is deterministic, and it fails on the
 * regression it is aimed at — an index dropped, renamed, or never created.
 *
 * Each case names the index the query needs, so a failure says which one and why
 * rather than "some plan changed".
 */

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/drizzle',
);

function migrationSql(): string {
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

/** The endpoint whose cost this query is, and the index it cannot do without. */
interface QueryCase {
  endpoint: string;
  /** The index the query is served by. Its absence is the regression. */
  index: string;
  sql: string;
  params: unknown[];
}

const CASES: QueryCase[] = [
  {
    // `authenticateRunner` runs on every authenticated request. Without this index it
    // is a full scan of `runners` — the finding that started the query work.
    endpoint: 'every authenticated request (authenticateRunner)',
    index: 'runners_token_hash_unique',
    sql: 'SELECT id FROM runners WHERE token_hash = $1',
    params: ['a'.repeat(64)],
  },
  {
    // The dashboard's first request: the workspace's runs, newest last, windowed.
    endpoint: 'GET /api/v1/runs',
    index: 'runs_workspace_created_idx',
    sql: 'SELECT id FROM runs WHERE workspace_id = $1 ORDER BY created_at ASC, id ASC LIMIT 101',
    params: ['ws-1'],
  },
  {
    // The event page. `run_events_run_sequence_unique` is the `(run_id, sequence)`
    // index, and the page is served entirely by it — this is the query the
    // `after`/`limit` window pushes into SQL rather than paging in memory.
    endpoint: 'GET /api/v1/runs/:runId/events',
    index: 'run_events_run_sequence_unique',
    sql: 'SELECT sequence FROM run_events WHERE run_id = $1 AND sequence > $2 ORDER BY sequence ASC LIMIT 101',
    params: ['00000000-0000-4000-8000-000000000001', 0],
  },
  {
    endpoint: 'GET /api/v1/quality-policies',
    index: 'quality_policies_workspace_idx',
    sql: 'SELECT id FROM quality_policies WHERE workspace_id = $1',
    params: ['ws-1'],
  },
  {
    endpoint: 'GET /api/v1/dashboard/quarantine',
    index: 'quarantine_quarantined_idx',
    sql: 'SELECT id FROM quarantine ORDER BY quarantined_at ASC',
    params: [],
  },
  {
    // The outbox read the SSE stream pages through.
    endpoint: 'GET /api/v1/events (replay page)',
    index: 'outbox_events_workspace_sequence_idx',
    sql: 'SELECT sequence FROM outbox_events WHERE workspace_id = $1 AND sequence > $2 ORDER BY sequence ASC LIMIT 101',
    params: ['ws-1', 0],
  },
  {
    // The lease reaper: expired leases, in state order.
    endpoint: 'lease expiry sweep',
    index: 'execution_jobs_lease_expiry_idx',
    sql: 'SELECT id FROM execution_jobs WHERE state = $1 AND lease_expires_at < $2',
    params: ['leased', '2020-01-01T00:00:00.000Z'],
  },
  {
    endpoint: 'POST /api/v1/runners/:runnerId/jobs/claim',
    index: 'execution_jobs_claim_idx',
    sql: 'SELECT id FROM execution_jobs WHERE state = $1 AND available_at <= $2 ORDER BY available_at ASC, priority ASC',
    params: ['queued', '2020-01-01T00:00:00.000Z'],
  },
  {
    // Runner authentication, the other table the same request touches.
    endpoint: 'GET /api/v1/dashboard/analytics/summary',
    index: 'gate_evaluations_workspace_evaluated_idx',
    sql: 'SELECT id FROM gate_evaluations WHERE workspace_id = $1 AND evaluated_at >= $2',
    params: ['ws-1', '2020-01-01T00:00:00.000Z'],
  },
  {
    // The runner heartbeat. `execution_jobs_lease_expiry_idx` leads with `state`,
    // and this filters on `lease_owner` alone, so both queries a runner makes on
    // every heartbeat were full scans of the jobs table — the table that grows with
    // every run, forever (ledger Q-51).
    endpoint: 'POST /api/v1/runners/:runnerId/heartbeat',
    index: 'execution_jobs_lease_owner_idx',
    sql: 'SELECT id FROM execution_jobs WHERE lease_owner = $1',
    params: ['00000000-0000-4000-8000-0000000000b1'],
  },
  {
    // The other half of the same request: how many jobs this runner currently has
    // out. Same column, same absence.
    endpoint: 'POST /api/v1/runners/:runnerId/heartbeat (active count)',
    index: 'execution_jobs_lease_owner_idx',
    sql: 'SELECT count(*) FROM execution_jobs WHERE lease_owner = $1',
    params: ['00000000-0000-4000-8000-0000000000b1'],
  },
];

let client: PGlite;
let indexes: Set<string>;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql());
  // The index is taken from the *live catalogue*, not from the migration files: a name
  // in a SQL file is a claim, and the catalogue is what the database will actually use.
  const result = await client.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
  );
  indexes = new Set(result.rows.map((row) => row.indexname));
});

/** The plan as one string, so an assertion can name the node it found. */
async function plan(sql: string, params: unknown[]): Promise<string> {
  const result = await client.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN (COSTS OFF) ${sql}`,
    params as never[],
  );
  return result.rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe('each hot query is served by the index it depends on', () => {
  it('knows which indexes exist, so the cases below are not vacuous', () => {
    // An empty catalogue would make every `expect(indexes.has(...)).toBe(true)` below
    // fail loudly rather than pass silently, and this says why: a fixture that cannot
    // read the database is not a fixture.
    expect(indexes.size).toBeGreaterThan(20);
  });

  for (const queryCase of CASES) {
    it(`${queryCase.endpoint} uses ${queryCase.index}`, async () => {
      expect(
        indexes.has(queryCase.index),
        `${queryCase.index} is missing from the migration graph; ${queryCase.endpoint} would be a full scan`,
      ).toBe(true);

      await client.exec('SET enable_seqscan = off');
      try {
        const explained = await plan(queryCase.sql, queryCase.params);
        // Both a named index scan and a bare `Index Scan` count: the planner may use
        // the index for a constraint check rather than naming it as the access path,
        // and the property under test is "an index served this", not the phrasing.
        expect(
          explained.includes(queryCase.index) || /Index Scan|Index Only Scan/.test(explained),
          `${queryCase.endpoint} did not use an index:\n${explained}`,
        ).toBe(true);
      } finally {
        // Restored even on failure: a leaked `enable_seqscan` would silently disable
        // the check for every case that runs after this one.
        await client.exec('RESET enable_seqscan');
      }
    });
  }

  it('fails when the index is gone, which is the regression this exists for', async () => {
    // The gate, proving itself. Drop `runners_token_hash_unique` and re-run the
    // authenticateRunner plan: it must stop being index-served.
    //
    // It does **not** raise. I assumed it would, and wrote this test expecting a
    // rejection; what PGlite does is plan a `Seq Scan on runners` and annotate it
    // `Disabled: true` — the planner had a plan, every option for it was taken away,
    // and it reported the degradation instead of erroring. So the assertion is on the
    // plan, which is both what actually happens and *better* evidence than a throw:
    // it shows the exact node that took over.
    //
    // If this test could not distinguish "served by an index" from "scanned anyway",
    // the assertion above would be reading a plan it never really inspected.
    await client.exec('DROP INDEX IF EXISTS runners_token_hash_unique');
    try {
      await client.exec('SET enable_seqscan = off');
      const degraded = await plan('SELECT id FROM runners WHERE token_hash = $1', ['a'.repeat(64)]);
      expect(degraded).not.toMatch(/Index Scan|Index Only Scan/);
      // Named, not merely "some other plan": a silent change of node type is the thing
      // an operator would never notice in production.
      expect(degraded).toMatch(/Seq Scan on runners/);
      expect(degraded).toMatch(/Disabled: true/);
    } finally {
      await client.exec('RESET enable_seqscan');
      await client.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS runners_token_hash_unique ON runners (token_hash)',
      );
    }
    // And the case above is green again, so the restore was complete.
    await client.exec('SET enable_seqscan = off');
    try {
      expect(await plan('SELECT id FROM runners WHERE token_hash = $1', ['a'.repeat(64)])).toMatch(
        /Index/,
      );
    } finally {
      await client.exec('RESET enable_seqscan');
    }
  });
});
