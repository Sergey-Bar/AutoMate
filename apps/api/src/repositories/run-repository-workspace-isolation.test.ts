/**
 * Cross-workspace isolation for `runs` and `tests` through `DrizzleRunRepository`
 * (ledger MNT-17).
 *
 * The repository is the reporter path and the whole dashboard's run and test reads, and
 * until MNT-17 **none of its reads named a workspace**: `getRun`, `listRuns`, `listTests`
 * and the analytics summary answered for the whole installation, and `upsertRun`'s
 * conflict branch moved an existing run into whichever workspace wrote last. The
 * repository is now bound to one workspace at construction, the way the reporter
 * ingestion service is, and every statement it issues carries it.
 *
 * On PGlite with the **real migration graph**, because the boundary being proved is the
 * column and its foreign key, and a hand-written `CREATE TABLE` would prove the fixture.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleRunRepository } from './drizzle-run-repository.js';
import type { RunRecord, TestRecord } from './run-repository.js';

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/drizzle',
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

const WS_A = 'ws-isolation-a';
const WS_B = 'ws-isolation-b';

let client: PGlite;
let mine: DrizzleRunRepository;
let theirs: DrizzleRunRepository;
let counter = 0;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql());
  const db = drizzle(client, { schema });
  for (const id of [WS_A, WS_B]) {
    await db
      .insert(schema.workspaces)
      .values({ id, name: id, configPath: 'config', createdAt: new Date() });
  }
  mine = new DrizzleRunRepository(db, WS_A);
  theirs = new DrizzleRunRepository(db, WS_B);
});

afterAll(async () => {
  if (client) await client.close();
});

function run(workspaceId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    workspaceId,
    phase: 'running',
    outcome: null,
    startedAt: '2026-10-01T00:00:00.000Z',
    finishedAt: null,
    status: 'running',
    total: 1,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: null,
    branch: 'main',
    commitSha: null,
    triggeredBy: 'reporter',
    ...overrides,
  };
}

function test(runId: string, overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id: 'login works',
    runId,
    title: 'login works',
    file: 'e2e/login.spec.ts',
    status: 'running',
    durationMs: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

async function stored(runId: string) {
  const runsRows = await client.query<{ workspace_id: string; status: string }>(
    'SELECT workspace_id, status FROM runs WHERE id = $1',
    [runId],
  );
  const testRows = await client.query<{ workspace_id: string; status: string }>(
    'SELECT workspace_id, status FROM tests WHERE run_id = $1',
    [runId],
  );
  return { run: runsRows.rows[0], tests: testRows.rows };
}

describe('runs and tests written in one workspace', () => {
  it('are stamped with that workspace, the test included', async () => {
    const written = run(WS_A);
    await mine.upsertRun(written);
    await mine.upsertTest(test(written.id));

    const row = await stored(written.id);
    expect(row.run?.workspace_id).toBe(WS_A);
    expect(row.tests.map((entry) => entry.workspace_id)).toEqual([WS_A]);
  });

  it('are invisible to every read from another workspace', async () => {
    const written = run(WS_A);
    await mine.upsertRun(written);
    await mine.upsertTest(test(written.id));

    expect(await theirs.getRun(written.id)).toBeNull();
    expect((await theirs.listRuns()).map((entry) => entry.id)).not.toContain(written.id);
    expect(await theirs.listTests(written.id)).toEqual([]);
    expect(await theirs.getTest('login works', written.id)).toBeNull();
    expect((await theirs.listTestsForRuns([written.id])).has(written.id)).toBe(false);
    expect((await theirs.getAnalyticsSummary()).totalRuns).toBe(0);

    // And the owner still sees all of it, so the empty answers are about the workspace.
    expect((await mine.getRun(written.id))?.workspaceId).toBe(WS_A);
    expect(await mine.listTests(written.id)).toHaveLength(1);
    expect((await mine.getAnalyticsSummary()).totalRuns).toBeGreaterThan(0);
  });

  it('cannot be patched, re-tested or taken over by another workspace', async () => {
    const written = run(WS_A);
    await mine.upsertRun(written);
    await mine.upsertTest(test(written.id));

    await theirs.patchRun(written.id, { status: 'failed', failedDelta: 5 });
    await theirs.patchTest('login works', written.id, { status: 'failed' });
    // The conflict branch used to set `workspace_id` to the writer's, so a second
    // workspace reusing a run id *moved the run* into itself.
    await expect(
      theirs.upsertRun({ ...written, workspaceId: WS_B, status: 'passed' }),
    ).rejects.toThrow();
    await expect(theirs.upsertTest(test(written.id, { id: 'injected' }))).rejects.toThrow();

    const row = await stored(written.id);
    expect(row.run).toEqual({ workspace_id: WS_A, status: 'running' });
    expect(row.tests).toEqual([{ workspace_id: WS_A, status: 'running' }]);
  });

  it('refuses a record naming a workspace other than the repository’s', async () => {
    // Two authorities for one value is the shape this repository records as P-5: the
    // record and the repository must agree, and a disagreement is a wiring defect.
    await expect(mine.upsertRun(run(WS_B))).rejects.toThrow(/workspace/);
  });
});
