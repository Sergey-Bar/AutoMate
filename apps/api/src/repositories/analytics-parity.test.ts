import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleRunRepository } from './drizzle-run-repository.js';
import { InMemoryRunRepository } from './in-memory-run-repository.js';
import { aggregateRuns, type PersistedRunStatus, type RunRecord } from './run-repository.js';

/**
 * The dashboard's three numbers, and the query that produces them.
 *
 * `GET /api/v1/dashboard/analytics/summary` used to call `listRuns()` — selecting
 * every run in the installation, materialising it in Node and reducing it in
 * JavaScript — to compute a count, a percentage and an average. It is the page an
 * operator opens first after an incident, and its cost grew with how long the
 * install had been running.
 *
 * Two things are asserted here, and the second is the one that matters:
 *
 *  1. The SQL aggregation issues **one** query and does not select the table. A
 *     cheaper-looking implementation that still reads every row would pass a
 *     correctness test and fail in production, so the statement itself is checked.
 *  2. The SQL and the in-memory aggregation produce the **same numbers** on the
 *     same data. Two implementations of one definition is how a dashboard starts
 *     reporting a different pass rate depending on which repository is mounted.
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

/**
 * A run id has to be a uuid: the column is one, and a fixture that is not
 * fails in the insert rather than anywhere near the aggregation.
 */
const UUID_A = '00000000-0000-4000-8000-00000000000a';
const UUID_B = '00000000-0000-4000-8000-00000000000b';
const UUID_C = '00000000-0000-4000-8000-00000000000c';
const UUID_D = '00000000-0000-4000-8000-00000000000d';
const UUID_E = '00000000-0000-4000-8000-00000000000e';
const UUID_F = '00000000-0000-4000-8000-00000000000f';

function makeRun(
  id: string,
  status: PersistedRunStatus,
  durationMs: number | null,
  startedAt: string,
): RunRecord {
  return {
    id,
    startedAt,
    finishedAt: durationMs === null ? null : startedAt,
    status,
    total: 3,
    passed: status === 'passed' ? 3 : 0,
    failed: status === 'failed' ? 3 : 0,
    flaky: 0,
    skipped: 0,
    durationMs,
    branch: null,
    commitSha: null,
    triggeredBy: 'manual',
  };
}

/** 6 runs: 3 passed, 2 failed, 1 still running. Durations 1000, 2000, 3000, 4000, and none on the running one. */
const FIXTURE: RunRecord[] = [
  makeRun(UUID_A, 'passed', 1000, '2026-01-01T00:00:00.000Z'),
  makeRun(UUID_B, 'passed', 2000, '2026-01-02T00:00:00.000Z'),
  makeRun(UUID_C, 'passed', 3000, '2026-01-03T00:00:00.000Z'),
  makeRun(UUID_D, 'failed', 4000, '2026-01-04T00:00:00.000Z'),
  makeRun(UUID_E, 'failed', 1000, '2026-01-05T00:00:00.000Z'),
  makeRun(UUID_F, 'running', null, '2026-01-06T00:00:00.000Z'),
];

describe('the dashboard summary', () => {
  let client: PGlite;
  let sql: DrizzleRunRepository;
  let statements: string[] = [];

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
    const db = drizzle(client, { schema });
    sql = new DrizzleRunRepository(db);
    for (const run of FIXTURE) await sql.upsertRun(run);
  }, 180_000);

  afterAll(async () => {
    if (client) await client.close();
  });

  it('computes the same numbers as the in-memory aggregation', async () => {
    const memory = new InMemoryRunRepository();
    for (const run of FIXTURE) await memory.upsertRun(run);
    const fromSql = await sql.getAnalyticsSummary();
    const fromMemory = await memory.getAnalyticsSummary();
    expect(fromSql).toEqual(fromMemory);
    // And both agree with the definition, spelled out: 6 runs, 3 of 5 completed
    // passed, and the mean of the five durations that recorded one —
    // 1000 + 2000 + 3000 + 4000 + 1000 = 11000 over 5.
    expect(fromSql).toEqual({ totalRuns: 6, passRate: 60, avgDurationMs: 2200 });
  });

  it('excludes a running run from the pass rate but counts it as a run', () => {
    // The distinction the route comment claims: a run still executing is not a
    // failure, and is not evidence of a pass either.
    expect(aggregateRuns(FIXTURE).totalRuns).toBe(6);
    expect(aggregateRuns(FIXTURE).passRate).toBe(60);
    // 1000 + 2000 + 3000 + 4000 + 1000 over the five runs that recorded one.
    expect(aggregateRuns(FIXTURE).avgDurationMs).toBe(2200);
  });

  it('reports a null average when no run recorded a duration, not zero', () => {
    // Zero would read as "every run was instant".
    const withoutDurations = FIXTURE.map((run) => ({ ...run, durationMs: null }));
    expect(aggregateRuns(withoutDurations).avgDurationMs).toBeNull();
  });

  it('reports zero passes over zero completed runs, rather than dividing by zero', () => {
    const running = [makeRun(UUID_F, 'running', null, '2026-01-01T00:00:00.000Z')];
    expect(aggregateRuns(running)).toEqual({ totalRuns: 1, passRate: 0, avgDurationMs: null });
  });

  it('answers without selecting the run table', async () => {
    // The substantive claim. A version that still reads every row would pass
    // every correctness test above and still be the thing that hurts at scale.
    const originalQuery = client.query.bind(client);
    statements = [];
    client.query = ((...args: Parameters<typeof originalQuery>) => {
      statements.push(String(args[0]));
      return originalQuery(...args);
    }) as typeof originalQuery;
    try {
      await sql.getAnalyticsSummary();
    } finally {
      client.query = originalQuery;
    }
    expect(statements).toHaveLength(1);
    const statement = statements[0] ?? '';
    // An aggregate over the table, not a projection of the rows being aggregated.
    expect(statement).toContain('count(*)');
    expect(statement).not.toMatch(/select\s+"runs"\.\*|,\s*\n?\s*"runs"\./i);
  });
});
