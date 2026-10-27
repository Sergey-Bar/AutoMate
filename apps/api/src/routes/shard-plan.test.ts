import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import { ShardPlanSchema } from '@automate/shared-contracts';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { agentProject } from '../test-support/agent-fixtures.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { DrizzleRunRepository } from '../repositories/drizzle-run-repository.js';
import type { RunRecord, RunRepository } from '../repositories/run-repository.js';
import { createShardPlanRoutes, SHARD_HISTORY_RUNS } from './shard-plan.js';

/**
 * `POST /api/v1/projects/:id/shards/plan`, and the durations it is planned from, in both
 * repositories. The Drizzle one runs on the real migration graph, because the workspace and
 * the project are columns there and nowhere else.
 */
const pass: MiddlewareHandler = async (_context, next) => next();
let db: MigratedDb;
let close: () => Promise<void>;
let project: string;
let otherProject: string;
let foreignProject: string;
let counter = 0;

beforeAll(async () => {
  ({ db, close } = await migratedDatabase());
  project = await agentProject(db);
  otherProject = await agentProject(db);
  foreignProject = await agentProject(db, {}, { workspaceId: 'ws-2' });
}, 180_000);

afterAll(async () => {
  await close();
});

async function seedRun(
  repository: RunRepository,
  workspaceId: string,
  projectId: string,
  finishedAt: string | null,
  files: Record<string, number[]>,
): Promise<string> {
  counter += 1;
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  const run: RunRecord = {
    id,
    workspaceId,
    phase: finishedAt === null ? 'running' : 'complete',
    outcome: finishedAt === null ? null : 'passed',
    startedAt: '2026-10-01T00:00:00.000Z',
    finishedAt,
    status: finishedAt === null ? 'running' : 'passed',
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: null,
    branch: 'main',
    commitSha: null,
    projectId,
    triggeredBy: 'ci',
  };
  await repository.upsertRun(run);
  for (const [file, durations] of Object.entries(files)) {
    for (const [index, durationMs] of durations.entries()) {
      await repository.upsertTest({
        id: `${file}-${String(index)}`,
        runId: id,
        title: `t${String(index)}`,
        file,
        stableId: `${file} › t${String(index)}`,
        status: 'passed',
        durationMs,
        errorCode: null,
        errorMessage: null,
      });
    }
  }
  return id;
}

const harnesses: Array<{ name: string; make: (workspaceId: string) => RunRepository }> = [
  { name: 'in-memory', make: () => new InMemoryRunRepository() },
  { name: 'drizzle', make: (workspaceId) => new DrizzleRunRepository(db as never, workspaceId) },
];

describe.each(harnesses)('fileDurations ($name)', ({ make }) => {
  it("sums each file's tests per run, newest run first, for this project only", async () => {
    const repository = make('ws-1');
    await seedRun(repository, 'ws-1', project, '2026-10-02T00:00:00.000Z', {
      'a.spec.ts': [100, 50],
    });
    await seedRun(repository, 'ws-1', project, '2026-10-03T00:00:00.000Z', {
      'a.spec.ts': [300],
      'b.spec.ts': [7],
    });
    // Another project's run, a run that has not finished, and one after the cut-off.
    await seedRun(repository, 'ws-1', otherProject, '2026-10-03T00:00:00.000Z', {
      'a.spec.ts': [9_999],
    });
    await seedRun(repository, 'ws-1', project, null, { 'a.spec.ts': [9_999] });
    await seedRun(repository, 'ws-1', project, '2026-10-09T00:00:00.000Z', {
      'a.spec.ts': [9_999],
    });

    const durations = await repository.fileDurations(project, {
      asOf: new Date('2026-10-05T00:00:00.000Z'),
      runs: SHARD_HISTORY_RUNS,
    });
    expect(durations.runs).toBe(2);
    expect(Object.fromEntries(durations.files)).toEqual({
      'a.spec.ts': [300, 150],
      'b.spec.ts': [7],
    });
  });

  it('reads at most the most recent runs it is asked for', async () => {
    const repository = make('ws-1');
    const recentProject = await agentProject(db);
    for (const day of [11, 12, 13]) {
      await seedRun(repository, 'ws-1', recentProject, `2026-10-${String(day)}T00:00:00.000Z`, {
        'c.spec.ts': [day],
      });
    }
    const durations = await repository.fileDurations(recentProject, {
      asOf: new Date('2026-10-20T00:00:00.000Z'),
      runs: 2,
    });
    expect(durations).toEqual({ runs: 2, files: new Map([['c.spec.ts', [13, 12]]]) });
  });
});

describe('fileDurations (drizzle) across workspaces', () => {
  it("never reads another workspace's runs, even for a project id it names", async () => {
    const theirs = new DrizzleRunRepository(db as never, 'ws-2');
    await seedRun(theirs, 'ws-2', foreignProject, '2026-10-02T00:00:00.000Z', { 'x.spec.ts': [5] });
    const mine = new DrizzleRunRepository(db as never, 'ws-1');
    const durations = await mine.fileDurations(foreignProject, {
      asOf: new Date('2026-10-30T00:00:00.000Z'),
      runs: SHARD_HISTORY_RUNS,
    });
    expect(durations).toEqual({ runs: 0, files: new Map() });
    // And the owner does see it, so the empty answer above is the boundary and not a bug.
    expect(
      (
        await theirs.fileDurations(foreignProject, {
          asOf: new Date('2026-10-30T00:00:00.000Z'),
          runs: SHARD_HISTORY_RUNS,
        })
      ).runs,
    ).toBe(1);
  });
});

function app(repository: RunRepository | undefined, projects: readonly string[]) {
  return withErrorBoundary(
    new Hono().route(
      '/',
      createShardPlanRoutes({
        uploader: pass,
        repository,
        projectExists: async (id) => projects.includes(id),
        now: () => new Date('2026-10-26T00:00:00.000Z'),
      }),
    ),
  );
}

const post = (target: Hono, projectId: string, body: unknown) =>
  target.request(`/api/v1/projects/${projectId}/shards/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/v1/projects/:id/shards/plan', () => {
  it('plans every requested file from the history, new files included', async () => {
    const repository = new InMemoryRunRepository();
    await seedRun(repository, 'ws-1', project, '2026-10-02T00:00:00.000Z', {
      'checkout/slow.spec.ts': [90_000],
      'checkout/fast.spec.ts': [10_000],
      'cart.spec.ts': [40_000],
    });
    const response = await post(app(repository, [project]), project, {
      total: 2,
      files: [
        'e2e/checkout/slow.spec.ts',
        'e2e/checkout/fast.spec.ts',
        'e2e/cart.spec.ts',
        'e2e/new.spec.ts',
      ],
      asOf: '2026-10-20T00:00:00.000Z',
    });
    expect(response.status).toBe(200);
    const plan = ShardPlanSchema.parse(await response.json());
    expect(plan).toEqual({
      total: 2,
      asOf: '2026-10-20T00:00:00.000Z',
      runs: 1,
      known: 3,
      unknown: 1,
      shards: [
        { index: 1, files: ['e2e/checkout/slow.spec.ts'], estimatedMs: 90_000 },
        {
          index: 2,
          files: ['e2e/cart.spec.ts', 'e2e/checkout/fast.spec.ts', 'e2e/new.spec.ts'],
          estimatedMs: 90_000,
        },
      ],
    });
  });

  it('defaults the cut-off to now', async () => {
    const response = await post(app(new InMemoryRunRepository(), [project]), project, {
      total: 1,
      files: ['a.spec.ts'],
    });
    expect(ShardPlanSchema.parse(await response.json()).asOf).toBe('2026-10-26T00:00:00.000Z');
  });

  it.each([
    [{ total: 0, files: ['a'] }],
    [{ total: 65, files: ['a'] }],
    [{ total: 2, files: [] }],
    [{ total: 2, files: ['a'], asOf: 'yesterday' }],
    [null],
  ])('refuses %j', async (body) => {
    const response = await post(app(new InMemoryRunRepository(), [project]), project, body);
    expect(response.status).toBe(400);
  });

  it('answers NOT_FOUND for a project this workspace does not have', async () => {
    const response = await post(app(new InMemoryRunRepository(), []), project, {
      total: 1,
      files: ['a'],
    });
    expect(response.status).toBe(404);
  });

  it('answers NOT_CONFIGURED without a run history', async () => {
    const response = await post(app(undefined, [project]), project, { total: 1, files: ['a'] });
    expect(response.status).toBe(503);
  });
});
