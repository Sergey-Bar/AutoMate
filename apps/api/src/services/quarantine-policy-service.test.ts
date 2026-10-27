import { afterEach, describe, expect, it } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import { and, eq } from 'drizzle-orm';
import * as schema from '@automate/db';
import { ProjectQuarantineSchema } from '@automate/shared-contracts';
import { DrizzleQuarantineStore } from '../modules/dashboard/drizzle-stores.js';
import type { ExecutionRun, ExecutionTestResult } from '../execution/types.js';
import { createProjectQuarantineRoutes } from '../routes/project-quarantine.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  applyProjectQuarantinePolicy,
  projectQuarantine,
  readQuarantinePolicy,
  writeQuarantinePolicy,
} from './quarantine-policy-service.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const KEY = 'tests/pay.spec.ts › pays';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function project(db: MigratedDb, workspaceId: string, slug: string, codeowners?: string) {
  const [row] = await db
    .insert(schema.projects)
    .values({
      workspaceId,
      name: slug,
      slug,
      defaultBranch: 'main',
      ...(codeowners === undefined ? {} : { settings: { health: { codeowners } } }),
    })
    .returning({ id: schema.projects.id });
  return (row as { id: string }).id;
}

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const options = { db: db as never, workspaceId: 'ws-1' };
  const projectId = await project(db, 'ws-1', 'shop', 'tests/pay.spec.ts @payments-team\n');
  return { db, options, projectId, store: new DrizzleQuarantineStore(db as never, 'ws-1') };
}

function history(projectId: string, statuses: ExecutionTestResult['status'][]): ExecutionRun[] {
  return statuses.map(
    (status, index) =>
      ({
        id: `run-${String(index)}`,
        createdAt: new Date(NOW.getTime() - (statuses.length - index) * 3_600_000).toISOString(),
        commit: 'c1',
        branch: 'main',
        projectId,
        policyEvaluation: null,
        tests: [
          {
            id: 'pays',
            title: 'pays',
            file: 'tests/pay.spec.ts',
            stableId: KEY,
            status,
            durationMs: 4_000,
            attempt: status === 'flaky' ? 3 : 1,
          },
        ],
      }) as unknown as ExecutionRun,
  );
}

describe('the quarantine policy', () => {
  it('is suggest by default, and reads back what was written', async () => {
    const { options, projectId } = await setup();
    expect(await readQuarantinePolicy(options, projectId)).toEqual({
      mode: 'suggest',
      releaseAfter: 20,
    });
    await writeQuarantinePolicy(options, projectId, { mode: 'auto', releaseAfter: 25 });
    expect(await readQuarantinePolicy(options, projectId)).toEqual({
      mode: 'auto',
      releaseAfter: 25,
    });
  });

  it("cannot read or write another workspace's project", async () => {
    const { db, options } = await setup();
    const theirs = await project(db, 'ws-2', 'theirs');
    await expect(readQuarantinePolicy(options, theirs)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      writeQuarantinePolicy(options, theirs, { mode: 'auto', releaseAfter: 20 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select({ settings: schema.projects.settings })
      .from(schema.projects)
      .where(and(eq(schema.projects.workspaceId, 'ws-2'), eq(schema.projects.id, theirs)));
    expect(row?.settings).toEqual({});
  });

  it('quarantines a retry-flaky test only once the project is set to auto', async () => {
    const { options, projectId, store } = await setup();
    const runs = history(projectId, ['passed', 'flaky', 'passed', 'flaky', 'passed']);
    const deps = { ...options, store, history: async () => runs, now: () => NOW };
    expect((await applyProjectQuarantinePolicy(deps, projectId)).quarantined).toEqual([]);
    expect(await store.list()).toEqual([]);
    await writeQuarantinePolicy(options, projectId, { mode: 'auto', releaseAfter: 20 });
    expect((await applyProjectQuarantinePolicy(deps, projectId)).quarantined).toEqual([KEY]);
    const [entry] = await store.list();
    expect(entry).toMatchObject({ status: 'approved', quarantinedBy: 'automate', projectId });
  });
});

describe('the project quarantine view', () => {
  it('shows each entry with its owner, its cost, its age and its streak', async () => {
    const { options, projectId, store } = await setup();
    const runs = history(projectId, ['flaky', 'passed', 'flaky', 'passed', 'passed']);
    const entry = await store.add({
      testTitle: 'pays',
      testFile: 'tests/pay.spec.ts',
      stableId: KEY,
      projectId,
      reason: 'flaky',
    });
    const view = await projectQuarantine(
      {
        ...options,
        store,
        history: async () => runs,
        now: () => new Date(Date.parse(entry.quarantinedAt) + 3 * 86_400_000),
      },
      projectId,
    );
    expect(ProjectQuarantineSchema.parse(view)).toEqual(view);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({
      owner: '@payments-team',
      daysQuarantined: 3,
      // Two flaky results, two retries each: 2 × 4 000 × 2/3 ms spent repeating work.
      retriesSpent: 4,
      wastedMs: 5_333,
      cleanStreak: 2,
    });
  });

  it("does not list another project's entry", async () => {
    const { db, options, projectId, store } = await setup();
    const other = await project(db, 'ws-1', 'other');
    await store.add({ testTitle: 'x', testFile: 'x.spec.ts', projectId: other, reason: null });
    const view = await projectQuarantine(
      { ...options, store, history: async () => [], now: () => NOW },
      projectId,
    );
    expect(view.entries).toEqual([]);
  });
});

describe('the project quarantine routes', () => {
  it('reads with the viewer guard, writes with the admin guard, and audits the change', async () => {
    const { db, options, projectId, store } = await setup();
    const seen: string[] = [];
    const tag =
      (name: string): MiddlewareHandler =>
      async (_context, next) => {
        seen.push(name);
        await next();
      };
    const app = withErrorBoundary(
      new Hono().route(
        '/',
        createProjectQuarantineRoutes({
          ...options,
          viewer: tag('viewer'),
          admin: tag('admin'),
          actorOf: async () => 'admin:person',
          source: { store, history: async () => [] },
        }),
      ),
    );
    expect((await app.request(`/api/v1/projects/${projectId}/quarantine`)).status).toBe(200);
    const put = await app.request(`/api/v1/projects/${projectId}/quarantine/policy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'auto', releaseAfter: 20 }),
    });
    expect(put.status).toBe(200);
    expect(seen).toEqual(['viewer', 'admin']);
    const bad = await app.request(`/api/v1/projects/${projectId}/quarantine/policy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'always', releaseAfter: 1 }),
    });
    expect(bad.status).toBe(400);
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'quarantine.policy.set'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe('admin:person');
  });
});
