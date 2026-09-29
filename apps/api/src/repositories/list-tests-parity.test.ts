import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleRunRepository } from './drizzle-run-repository.js';
import { InMemoryRunRepository } from './in-memory-run-repository.js';
import type { PersistedRunStatus, RunRecord } from './run-repository.js';

/**
 * Two implementations of one method, and they must agree.
 *
 * `listTestsForRuns` was added to fix the dashboard's N+1 (ledger Q-47): the
 * aggregations used to call the single-run `listTests` once per run, so the cost
 * grew with the number of runs for a question whose answer does not.
 *
 * That fix introduced a second implementation to keep in step. The analytics half
 * of this module had the same shape and is guarded by `analytics-parity.test.ts`;
 * this is the same guard for the new method. Two implementations of one
 * definition is how a dashboard starts showing one set of tests in development
 * and another in production — and the two differ only in the environment, so
 * nothing notices until a reader counts rows.
 *
 * The `analytics-parity.test.ts` migration harness is reused verbatim: applying
 * the real journal against a fresh PGlite is the only way to know the batched
 * `inArray` query works against the actual schema rather than a hand-written one.
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

/** Run ids have to be uuids: the column is, so a fixture that is not fails in the insert. */
const RUN_A = '00000000-0000-4000-8000-0000000000a1';
const RUN_B = '00000000-0000-4000-8000-0000000000b1';
const RUN_C = '00000000-0000-4000-8000-0000000000c1';

function makeRun(id: string): RunRecord {
  return {
    id,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    status: 'passed' as PersistedRunStatus,
    total: 2,
    passed: 2,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: 1000,
    branch: null,
    commitSha: null,
    triggeredBy: 'manual',
  };
}

const FIXTURE: RunRecord[] = [makeRun(RUN_A), makeRun(RUN_B), makeRun(RUN_C)];

/**
 * `TestRecord` names its fields `id` and `title` — not `testId` and `name`, which
 * is what the API contract calls them. The first version of this fixture used the
 * contract names and `upsertTest` wrote NULL into the primary key, which failed
 * loudly at the insert rather than anywhere near the thing being tested.
 */
const testsFor = (runId: string, titles: string[]) =>
  titles.map((title) => ({
    id: `${runId}:${title}`,
    runId,
    title,
    file: 'tests/checkout.spec.ts',
    status: 'passed' as const,
    durationMs: 5,
  }));

/** Two tests on A, one on B, none on C — so "missing key" and "empty list" differ. */
const TESTS = [...testsFor(RUN_A, ['one', 'two']), ...testsFor(RUN_B, ['three'])];

describe('listTestsForRuns', () => {
  let client: PGlite;
  let sql: DrizzleRunRepository;

  beforeAll(async () => {
    const buildOutput = path.resolve(drizzleDirectory, '..', 'dist', 'index.js');
    const buildTime = statSync(buildOutput).mtimeMs;
    const stack = [path.resolve(drizzleDirectory, '..', 'src')];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name.endsWith('.ts') && statSync(full).mtimeMs > buildTime) {
          throw new Error('packages/db is not built; run pnpm --filter @automate/db build');
        }
      }
    }
    client = new PGlite();
    await client.exec(readMigrations());
    const db = drizzle(client, { schema });
    sql = new DrizzleRunRepository(db);
    for (const run of FIXTURE) await sql.upsertRun(run);
    for (const record of TESTS) {
      await sql.upsertTest(record);
    }
  }, 180_000);

  afterAll(async () => {
    if (client) await client.close();
  });

  it('groups identically in SQL and in memory', async () => {
    const memory = new InMemoryRunRepository();
    for (const run of FIXTURE) await memory.upsertRun(run);
    for (const record of TESTS) {
      await memory.upsertTest(record);
    }

    const ids = [RUN_A, RUN_B, RUN_C];
    const fromSql = await sql.listTestsForRuns(ids);
    const fromMemory = await memory.listTestsForRuns(ids);

    // Compared as sorted name lists rather than as records, because the two
    // implementations do not promise identical field sets — they promise the same
    // *grouping*, which is what the aggregations consume.
    const shape = (grouped: Map<string, unknown[]>) =>
      [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([runId, rows]) => [runId, rows.length]);

    expect(shape(fromSql)).toEqual(shape(fromMemory));
    expect(shape(fromSql)).toEqual([
      [RUN_A, 2],
      [RUN_B, 1],
    ]);
  });

  it('omits a run with no tests rather than reporting an empty list for it', async () => {
    // The distinction matters to the callers: the suites route iterates
    // `testsByRun.get(run.id) ?? []`, so a missing key and an empty array behave
    // the same — and both implementations must agree on which they produce.
    const grouped = await sql.listTestsForRuns([RUN_C]);
    expect(grouped.has(RUN_C)).toBe(false);

    const memory = new InMemoryRunRepository();
    for (const record of TESTS) {
      await memory.upsertTest(record);
    }
    expect((await memory.listTestsForRuns([RUN_C])).has(RUN_C)).toBe(false);
  });

  it('returns nothing for an empty id list, without querying', async () => {
    // `inArray([])` is a query Postgres rejects rather than answers, so both
    // implementations short-circuit. Asserted on the result, because the point
    // is the caller gets an empty answer rather than an exception.
    expect((await sql.listTestsForRuns([])).size).toBe(0);
    const memory = new InMemoryRunRepository();
    expect((await memory.listTestsForRuns([])).size).toBe(0);
  });

  it('agrees with the single-run method it is meant to replace', async () => {
    // The regression that would matter: a batched method that is subtly wrong
    // where the per-run one is right. For every run asked about, the two must
    // return the same rows.
    for (const runId of [RUN_A, RUN_B]) {
      const batched = (await sql.listTestsForRuns([runId])).get(runId) ?? [];
      const single = await sql.listTests(runId);
      expect(batched.map((t) => t.id).sort()).toEqual(single.map((t) => t.id).sort());
    }
  });
});
