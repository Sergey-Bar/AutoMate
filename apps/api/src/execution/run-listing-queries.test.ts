import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleExecutionStore } from './drizzle-execution-store.js';

/**
 * The run listing was N+1.
 *
 * `listRuns` called `mapRun` per row, and `mapRun` fetched that run's tests,
 * artifacts and runner — so twenty runs on a dashboard meant sixty-one round
 * trips. The dashboard is the first thing an operator opens, and the query
 * count grew with the size of their history rather than with the size of the
 * page.
 *
 * These tests run against the real schema on PGlite and count the queries
 * actually issued, because a claim about query counts that is not measured is
 * the same class of claim this plan removed elsewhere.
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

/** Wraps a Drizzle instance and counts the statements it issues. */
function countingDrizzle(inner: PGlite) {
  const statements: string[] = [];
  const db = drizzle(inner, { schema });
  // PGlite exposes a lower-level query hook; counting on the client's own
  // `query`/`exec` covers everything Drizzle issues.
  const originalQuery = inner.query.bind(inner);
  const originalExec = inner.exec.bind(inner);
  inner.query = ((...args: Parameters<typeof originalQuery>) => {
    statements.push(String(args[0]));
    return originalQuery(...args);
  }) as typeof originalQuery;
  inner.exec = ((sql: Parameters<typeof originalExec>[0]) => {
    statements.push(String(sql));
    return originalExec(sql);
  }) as typeof originalExec;
  return { db, statements };
}

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
  const counted = countingDrizzle(client);
  const db = counted.db as unknown as ConstructorParameters<typeof DrizzleExecutionStore>[0]['db'];
  store = new DrizzleExecutionStore({ db, workspaceId: 'ws-1' });
  await (
    counted.db as unknown as {
      insert: (table: unknown) => { values: (values: unknown) => Promise<unknown> };
    }
  )
    .insert(schema.workspaces)
    .values({
      id: 'ws-1',
      name: 'default',
      configPath: 'config',
      testResultsDir: 'var/results',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  await store.registerRunner(
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
    'ws-1',
  );
});

afterAll(async () => {
  await client.close();
});

async function seedRuns(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const key = `key-${index}`;
    await store.createRun(
      {
        externalId: `ext-${index}`,
        source: 'api',
        testType: 'browser',
        framework: 'playwright',
        timeoutMs: 60_000,
        requiredCapabilities: [],
        labels: [],
        configuration: {},
      } as never,
      key,
      'ws-1',
    );
  }
}

/**
 * Counts the statements one operation issues.
 *
 * The store is rebuilt against the counting client so every statement the
 * operation triggers is seen. A closure over the outer store would be measured
 * by a different client and report zero, which is the kind of vacuous assertion
 * this suite exists to avoid.
 */
async function countQueriesFor(operation: (target: DrizzleExecutionStore) => Promise<unknown>) {
  const counted = countingDrizzle(client);
  const target = new DrizzleExecutionStore({
    db: counted.db as unknown as ConstructorParameters<typeof DrizzleExecutionStore>[0]['db'],
    workspaceId: 'ws-1',
  });
  await operation(target);
  return counted.statements.length;
}

describe('the run listing does not issue a query per run', () => {
  it('scales with a constant number of queries, not with the page size', async () => {
    await seedRuns(2);
    const small = await countQueriesFor((target) => target.listRuns('ws-1'));

    await seedRuns(18);
    const large = await countQueriesFor((target) => target.listRuns('ws-1'));

    // Before the fix this was 1 + 3n: four for two runs, fifty-five for twenty.
    expect(large).toBe(small);
    // Four: the run page, the tests, the artifacts, the runners.
    expect(large).toBeLessThanOrEqual(4);
  });

  it('returns the same runs as a single-run read would', async () => {
    const listed = await store.listRuns('ws-1');
    expect(listed.length).toBeGreaterThan(0);
    for (const run of listed.slice(0, 5)) {
      const single = await store.getRun(run.id, 'ws-1');
      expect(single?.tests).toEqual(run.tests);
      expect(single?.artifacts).toEqual(run.artifacts);
      expect(single?.runner).toEqual(run.runner);
      expect(single?.summary).toEqual(run.summary);
    }
  });

  it('handles an empty page without a child query', async () => {
    const empty = await store.listRuns('ws-nonexistent');
    expect(empty).toEqual([]);
  });
});
