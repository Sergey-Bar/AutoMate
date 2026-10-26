import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createReporterRoutes } from './reporter.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { DrizzleExecutionStore } from '../execution/drizzle-execution-store.js';
import { DrizzleRunRepository } from '../repositories/drizzle-run-repository.js';

/**
 * The live reporter's whole path in database mode, wired as `index.ts` wires it: the events
 * door writes the run through `DrizzleRunRepository`, and the artifact door files evidence
 * through `DrizzleExecutionStore`.
 *
 * **This is the claim the artifact door rests on**: the two are one `runs` table, so a run
 * the reporter created is a run the execution store can hold artifacts for and serve back.
 * The in-memory suite cannot say so — in memory they are two stores — so without this the
 * door would be tested only in the configuration where it answers NOT_FOUND.
 */
const SECRET = 'reporter-artifacts-drizzle';
const HEADERS = { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' };
let db: MigratedDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await migratedDatabase());
}, 180_000);

afterAll(async () => {
  await close();
});

function app(workspaceId: string) {
  const store = new DrizzleExecutionStore({ db: db as never, workspaceId });
  return {
    store,
    app: withErrorBoundary(
      createReporterRoutes(SECRET, {
        repository: new DrizzleRunRepository(db as never, workspaceId),
        artifacts: store,
        workspaceId,
      }),
    ),
  };
}

async function event(target: ReturnType<typeof app>['app'], body: Record<string, unknown>) {
  const response = await target.request('/api/v1/reporter/events', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  expect(response.status, JSON.stringify(body)).toBe(202);
}

describe('a streamed run, with its failure evidence, in database mode', () => {
  it('lands the run, the test and the trace, and serves the trace back from the run', async () => {
    const { app: target, store } = app('ws-1');
    const runId = randomUUID();
    await event(target, {
      type: 'run:start',
      runId,
      payload: { total: 1, triggeredBy: 'playwright-reporter' },
    });
    await event(target, {
      type: 'test:begin',
      runId,
      payload: {
        testId: 't-1',
        title: 'pays',
        file: 'checkout/pay.spec.ts',
        describePath: ['guest'],
        project: 'webkit',
      },
    });
    const uploaded = await target.request(`/api/v1/reporter/runs/${runId}/artifacts`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        testId: 't-1',
        name: 'trace.zip',
        kind: 'trace',
        contentType: 'application/zip',
        bytesBase64: Buffer.from('PK a real trace').toString('base64'),
        metadata: { attempt: 0 },
      }),
    });
    expect(uploaded.status).toBe(201);
    await event(target, {
      type: 'test:end',
      runId,
      payload: { testId: 't-1', status: 'failed', durationMs: 7, error: { message: 'boom' } },
    });
    await event(target, {
      type: 'run:end',
      runId,
      payload: { status: 'failed', durationMs: 1073 },
    });

    const run = await store.getRun(runId, 'ws-1');
    expect(run?.artifacts).toEqual([
      expect.objectContaining({
        jobId: null,
        testId: 't-1',
        kind: 'trace',
        name: 'trace.zip',
        metadata: { attempt: 0, source: 'reporter' },
      }),
    ]);
    const stored = await store.getArtifact(String(run?.artifacts[0]?.id), 'ws-1');
    expect(Buffer.from(stored?.bytes ?? []).toString()).toBe('PK a real trace');
  });

  it('refuses evidence for a run in another workspace, and writes no row', async () => {
    const theirs = app('ws-2');
    const runId = randomUUID();
    await event(theirs.app, { type: 'run:start', runId, payload: { total: 0 } });
    const mine = app('ws-1');
    const response = await mine.app.request(`/api/v1/reporter/runs/${runId}/artifacts`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        name: 'a.png',
        kind: 'screenshot',
        contentType: 'image/png',
        bytesBase64: 'AQID',
      }),
    });
    expect(response.status).toBe(404);
    expect((await theirs.store.getRun(runId, 'ws-2'))?.artifacts).toEqual([]);
  });
});
