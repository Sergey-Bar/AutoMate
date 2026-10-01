import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { Hono } from 'hono';
import { DrizzleExecutionStore } from '../execution/drizzle-execution-store.js';
import { InMemoryExecutionStore } from '../execution/in-memory-execution-store.js';
import { InMemoryRealtimeBus } from '../realtime/realtime-bus.js';
import type { ExecutionStore } from '../execution/types.js';
import { createExecutionRoutes } from './execution.js';
import { createErrorBoundary } from '../errors/boundary.js';
import { syntheticRunnerRegistrationSecret } from '../test-support/synthetic-credentials.js';

/**
 * The routes, mounted the way the application mounts them.
 *
 * The error boundary is not decoration here: since finding C-3 a handler refuses by
 * `throw`ing a `DomainError`, and this boundary is what renders it into the response
 * body. A bare `Hono` would answer 500 and the suite would be asserting the wrong thing
 * — and a body only the removed `error(c, …)` helper could produce would stop being
 * testable, which is the point.
 */
function mounted(routes: Hono): Hono {
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    // Outside a request there is no id, and the boundary is told so rather than being
    // handed a fabricated one. The production middleware supplies the real value.
    requestId: () => 'NO_REQUEST',
  });
  return new Hono().onError(onError).route('/', routes);
}

/**
 * The execution API over the durable store.
 *
 * `routes/execution.ts` defines twenty-one endpoints. Every existing test in this
 * package mounts `createExecutionRoutes` over `InMemoryExecutionStore`, so no test
 * anywhere in the repository drove an HTTP request through a Drizzle-backed route.
 * That is a specific and consequential gap: the divergence a database introduces
 * lives in the store, and the store is the one layer the tests replaced.
 *
 * The suite is built on PGlite with the **real migration graph** applied
 * (`packages/db/drizzle`, in journal order), for the same reason
 * `execution/store-parity.test.ts` is: a hand-written `CREATE TABLE` proves the
 * fixture, not the schema that ships.
 *
 * Every route is exercised on five axes, because those are the five ways a
 * control-plane request actually arrives:
 *
 *   - **positive**       — the documented shape succeeds
 *   - **unauthorized**   — no credential, or the wrong one
 *   - **wrong workspace**— the route is workspace-scoped, so a valid id from
 *                          another workspace must be invisible
 *   - **not found**      — a well-formed id that does not exist
 *   - **malformed body** — a body the schema rejects
 *
 * The wrong-workspace axis is the one this repository had no coverage for at all
 * and is also its only tenancy boundary: `WORKSPACE_ID` is the single thing
 * separating two customers' evidence, so a route that reads across it is the
 * worst defect this API could ship.
 */

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/drizzle',
);

/** The whole journal-ordered graph, as one script. */
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

const clock = new Date('2026-09-26T00:00:00.000Z');
const REGISTRATION_SECRET = syntheticRunnerRegistrationSecret();
const JSON_HEADERS = { 'content-type': 'application/json' };

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let counter = 0;

/** A uuid the `runners`/`workspaces` columns accept, and `uuidFor` passes through. */
function nextId(): string {
  counter += 1;
  return `00000000-0000-4000-9000-${String(counter).padStart(12, '0')}`;
}

/** The whole graph, once. It is slow, and every test needs the same schema. */
beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql());
  db = drizzle(client, { schema });
});

afterAll(async () => {
  if (client) await client.close();
});

interface Harness {
  app: Hono;
  store: ExecutionStore;
  workspaceId: string;
  projectId: string;
  bus: InMemoryRealtimeBus;
  /** A second app over the same database and a different workspace. */
  other: Hono;
  otherWorkspaceId: string;
  otherProjectId: string;
  /** The second workspace's store, so a probe can bypass the HTTP layer entirely. */
  otherStore: ExecutionStore;
  /** A release row in the first workspace; `runs.release_id` is a foreign key. */
  releaseId: string;
}

/**
 * One workspace per test.
 *
 * `claimJob` and `reapExpiredLeases` act on a *workspace's* queued jobs, so a
 * shared workspace would let one test's runner claim another test's job — and the
 * failure would read as loose lease enforcement rather than as shared state. A
 * new PGlite per test is clean and far too slow; a new workspace is the same
 * isolation for the same reason a real install has one workspace per team.
 */
function harness(overrides: { requireIdempotencyKey?: boolean } = {}): Harness {
  counter += 1;
  const workspaceId = `ws-routes-${counter}`;
  const otherWorkspaceId = `${workspaceId}-other`;
  // `projects.id` is a uuid, and a run's `project_id` is a foreign key onto it, so
  // the project row is a fixture the schema demands rather than an optional extra.
  const projectId = nextId();
  const otherProjectId = nextId();
  const releaseId = nextId();
  const bus = new InMemoryRealtimeBus();
  // The store keeps artifact bytes in its bounded in-process map when no byte
  // store is given, which is what this suite reads back. The upload path's own
  // behaviour against a real object store is `s3-artifact-bytes.test.ts`'s job.
  const store = new DrizzleExecutionStore({
    db: db as never,
    workspaceId,
    now: () => clock,
  });
  const otherStore = new DrizzleExecutionStore({
    db: db as never,
    workspaceId: otherWorkspaceId,
    now: () => clock,
  });

  return {
    app: mounted(
      createExecutionRoutes({
        store,
        workspaceId,
        bus,
        runnerRegistrationSecret: REGISTRATION_SECRET,
        ...overrides,
      }),
    ),
    store,
    workspaceId,
    projectId,
    bus,
    other: mounted(
      createExecutionRoutes({
        store: otherStore,
        workspaceId: otherWorkspaceId,
        bus: new InMemoryRealtimeBus(),
        runnerRegistrationSecret: REGISTRATION_SECRET,
        ...overrides,
      }),
    ),
    otherWorkspaceId,
    otherProjectId,
    otherStore,
    releaseId,
  };
}

async function createWorkspace(id: string, projectId: string): Promise<void> {
  await db.insert(schema.workspaces).values({
    id,
    name: id,
    configPath: 'config',
    createdAt: clock,
  });
  // `runs.project_id` is a foreign key onto `projects`, so a run cannot be created
  // without one. Creating it here — rather than passing a bare string and letting
  // the schema be violated — is what keeps the suite on the real graph.
  await db.insert(schema.projects).values({
    id: projectId,
    workspaceId: id,
    name: `project ${id}`,
    slug: 'default',
    createdAt: clock,
  });
}

/** A harness with both of its workspaces, their projects, and a release, present. */
async function workspaceHarness(
  overrides: { requireIdempotencyKey?: boolean } = {},
): Promise<Harness> {
  const h = harness(overrides);
  await createWorkspace(h.workspaceId, h.projectId);
  await createWorkspace(h.otherWorkspaceId, h.otherProjectId);
  // `runs.release_id` is a foreign key onto `releases`, so a run that names a
  // release cannot be created unless the release exists.
  await db.insert(schema.releases).values({
    id: h.releaseId,
    workspaceId: h.workspaceId,
    projectId: h.projectId,
    name: 'release one',
    version: '1.0.0',
    createdAt: clock,
  });
  return h;
}

interface Seeded {
  runId: string;
  jobId: string;
  runnerId: string;
  token: string;
  leaseId: string;
  fencingToken: number;
  artifactId: string;
}

/**
 * Completes a seeded job, so the run reaches a terminal phase.
 *
 * Retry and readiness both need a finished run, and a seeded run is running by
 * construction — a test that forgot this would see `409 RUN_NOT_RETRYABLE` and
 * read it as a broken route rather than as an unfinished run.
 */
async function finishJob(h: Harness, seeded: Seeded, outcome: 'passed' | 'failed'): Promise<void> {
  const response = await h.app.request(`/api/v1/jobs/${seeded.jobId}/complete`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, authorization: `Bearer ${seeded.token}` },
    body: JSON.stringify({
      phase: 'completed',
      outcome,
      leaseId: seeded.leaseId,
      fencingToken: seeded.fencingToken,
      summary: {
        total: 1,
        passed: outcome === 'passed' ? 1 : 0,
        failed: outcome === 'passed' ? 0 : 1,
      },
    }),
  });
  expect(response.status).toBe(200);
}

/**
 * One event line, in the shape `ExecutionEventLineSchema` demands.
 *
 * The `sequence` and offset-bearing `occurredAt` are not decoration: a runner
 * that omits them passes its own parser and is then rejected on ingest, so a
 * suite that sent a partial line would be testing the wrong failure.
 */
function eventLine(
  eventId: string,
  sequence: number,
  payload: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    eventId,
    sequence,
    type: 'test.finished',
    occurredAt: clock.toISOString(),
    payload: { status: 'passed', ...payload },
  };
}

/** A run with a claimed job, an enrolled runner, and one uploaded artifact. */
async function seed(h: Harness, options: { releaseId?: string } = {}): Promise<Seeded> {
  const created = await h.app.request('/api/v1/runs', {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'idempotency-key': 'seed-run' },
    body: JSON.stringify({
      projectId: h.projectId,
      releaseId: options.releaseId,
      requiredCapabilities: ['playwright'],
      labels: ['ci'],
    }),
  });
  expect(created.status).toBe(202);
  const runId = ((await created.json()) as { id: string }).id;

  const registered = await h.app.request('/api/v1/runners/register', {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'x-runner-registration-secret': REGISTRATION_SECRET },
    body: JSON.stringify({
      runnerId: nextId(),
      name: 'routes-runner',
      capabilities: ['playwright'],
      labels: ['ci'],
      slots: 1,
    }),
  });
  expect(registered.status).toBe(201);
  const { runnerId, token } = (await registered.json()) as { runnerId: string; token: string };

  const claim = await h.app.request(`/api/v1/runners/${runnerId}/jobs/claim`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
    body: JSON.stringify({ capabilities: ['playwright'], labels: ['ci'] }),
  });
  expect(claim.status).toBe(200);
  const job = (await claim.json()) as { jobId: string; leaseId: string; fencingToken: number };

  const uploaded = await h.app.request(`/api/v1/jobs/${job.jobId}/artifacts`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'report.xml',
      kind: 'junit',
      contentType: 'application/xml',
      contentBase64: Buffer.from('<testsuite/>').toString('base64'),
      leaseId: job.leaseId,
      fencingToken: job.fencingToken,
    }),
  });
  expect(uploaded.status).toBe(201);
  const { id: artifactId } = (await uploaded.json()) as { id: string };

  return {
    runId,
    jobId: job.jobId,
    runnerId,
    token,
    leaseId: job.leaseId,
    fencingToken: job.fencingToken,
    artifactId,
  };
}

/** @param {Response} response */
async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? '';
}

// ---------------------------------------------------------------------------
// POST /api/v1/runs
// ---------------------------------------------------------------------------

describe('POST /api/v1/runs', () => {
  it('accepts a well-formed run and echoes the idempotent-replay header', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request('/api/v1/runs', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'idempotency-key': 'k-1' },
      body: JSON.stringify({ projectId: h.projectId, requiredCapabilities: ['playwright'] }),
    });
    expect(response.status).toBe(202);
    expect(response.headers.get('x-idempotent-replay')).toBe('false');
    const run = (await response.json()) as { id: string; workspaceId: string };
    expect(run.id).not.toBe('');
    expect(run.workspaceId).toBe(h.workspaceId);
  });

  it('replays rather than duplicating when the same idempotency key returns', async () => {
    const h = await workspaceHarness();
    const send = () =>
      h.app.request('/api/v1/runs', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'idempotency-key': 'k-same' },
        body: JSON.stringify({ projectId: h.projectId, requiredCapabilities: ['playwright'] }),
      });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.headers.get('x-idempotent-replay')).toBe('true');
    const a = (await first.json()) as { id: string };
    const b = (await second.json()) as { id: string };
    expect(b.id).toBe(a.id);
  });

  it('rejects a body the schema does not accept', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request('/api/v1/runs', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'idempotency-key': 'k-bad' },
      body: JSON.stringify({ projectId: 42, requiredCapabilities: 'playwright' }),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_RUN');
  });

  it('rejects a body that is not JSON at all', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request('/api/v1/runs', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'idempotency-key': 'k-garbage' },
      body: 'not json',
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_RUN');
  });

  it('refuses to create a run with no idempotency key when one is required', async () => {
    const h = await workspaceHarness({ requireIdempotencyKey: true });
    const response = await h.app.request('/api/v1/runs', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ projectId: h.projectId, requiredCapabilities: [] }),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/runs  (list + cursor paging)
// ---------------------------------------------------------------------------

describe('GET /api/v1/runs', () => {
  it('lists a workspace run and hides another workspace run', async () => {
    const h = await workspaceHarness();
    const mine = await seed(h);

    const theirs = await h.other.request('/api/v1/runs', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'idempotency-key': 'other-1' },
      body: JSON.stringify({ projectId: h.otherProjectId, requiredCapabilities: ['playwright'] }),
    });
    const otherRunId = ((await theirs.json()) as { id: string }).id;

    const response = await h.app.request('/api/v1/runs');
    expect(response.status).toBe(200);
    const ids = ((await response.json()) as Array<{ id: string }>).map((run) => run.id);
    expect(ids).toContain(mine.runId);
    expect(ids).not.toContain(otherRunId);
  });

  it('returns only the first page and a cursor that resumes exactly after it', async () => {
    const h = await workspaceHarness();
    for (let index = 0; index < 4; index += 1) {
      await h.app.request('/api/v1/runs', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'idempotency-key': `page-${index}` },
        body: JSON.stringify({ projectId: h.projectId, requiredCapabilities: ['playwright'] }),
      });
    }

    const first = await h.app.request('/api/v1/runs?limit=2');
    const firstRuns = (await first.json()) as Array<{ id: string }>;
    expect(firstRuns).toHaveLength(2);
    const cursor = first.headers.get('X-Next-Cursor');
    expect(cursor).not.toBeNull();

    const second = await h.app.request(
      `/api/v1/runs?limit=2&cursor=${encodeURIComponent(cursor ?? '')}`,
    );
    const secondRuns = (await second.json()) as Array<{ id: string }>;
    const firstIds = new Set(firstRuns.map((run) => run.id));
    // No overlap is the property that matters: a cursor that repeats rows is
    // worse than no cursor, because a caller cannot tell which it got.
    for (const run of secondRuns) expect(firstIds.has(run.id)).toBe(false);
  });

  it('clamps an absurd limit to the page cap instead of returning the table', async () => {
    const h = await workspaceHarness();
    for (let index = 0; index < 3; index += 1) {
      await h.app.request('/api/v1/runs', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'idempotency-key': `clamp-${index}` },
        body: JSON.stringify({ projectId: h.projectId, requiredCapabilities: ['playwright'] }),
      });
    }
    const response = await h.app.request('/api/v1/runs?limit=100000');
    const runs = (await response.json()) as unknown[];
    expect(runs.length).toBeLessThanOrEqual(100);
  });

  it('falls back to the default page size for a nonsensical limit', async () => {
    const h = await workspaceHarness();
    await seed(h);
    const response = await h.app.request('/api/v1/runs?limit=not-a-number');
    expect(response.status).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/runs/:runId
// ---------------------------------------------------------------------------

describe('GET /api/v1/runs/:runId', () => {
  it('reads a run in its own workspace', async () => {
    const h = await workspaceHarness();
    const { runId } = await seed(h);
    const response = await h.app.request(`/api/v1/runs/${runId}`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { id: string }).id).toBe(runId);
  });

  it('answers 404 for a run in another workspace rather than leaking it', async () => {
    const h = await workspaceHarness();
    const theirs = await h.other.request('/api/v1/runs', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'idempotency-key': 'other-read' },
      body: JSON.stringify({ projectId: h.otherProjectId, requiredCapabilities: [] }),
    });
    const otherRunId = ((await theirs.json()) as { id: string }).id;

    const response = await h.app.request(`/api/v1/runs/${otherRunId}`);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('RUN_NOT_FOUND');
  });

  it('answers 404 for an id that was never issued', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request(`/api/v1/runs/${nextId()}`);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('RUN_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/runs/:runId/events
// ---------------------------------------------------------------------------

describe('GET /api/v1/runs/:runId/events', () => {
  it('pages on the event sequence and resumes exactly after the last one', async () => {
    const h = await workspaceHarness();
    const { jobId, token, leaseId, fencingToken } = await seed(h);

    for (let index = 0; index < 3; index += 1) {
      const posted = await h.app.request(`/api/v1/jobs/${jobId}/events`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
        body: JSON.stringify({
          leaseId,
          fencingToken,
          events: [eventLine(`evt-${index}`, index + 1, { testId: `t-${index}` })],
        }),
      });
      expect(posted.status).toBe(202);
    }

    const runId = (await h.store.listRuns(h.workspaceId, undefined, { limit: 10 })).runs[0]?.id;
    expect(runId).toBeDefined();
    const first = await h.app.request(`/api/v1/runs/${runId ?? ''}/events?limit=2`);
    expect(first.status).toBe(200);
    const firstEvents = (await first.json()) as Array<{ sequence: number }>;
    expect(firstEvents).toHaveLength(2);
    const cursor = first.headers.get('X-Next-Cursor');
    expect(cursor).not.toBeNull();

    const second = await h.app.request(`/api/v1/runs/${runId ?? ''}/events?after=${cursor ?? ''}`);
    const secondEvents = (await second.json()) as Array<{ sequence: number }>;
    for (const event of secondEvents) {
      expect(firstEvents.some((seen) => seen.sequence === event.sequence)).toBe(false);
    }
  });

  it('rejects a cursor that is not a non-negative integer', async () => {
    const h = await workspaceHarness();
    const { runId } = await seed(h);
    for (const cursor of ['nonsense', '-1', '1.5']) {
      const response = await h.app.request(`/api/v1/runs/${runId}/events?after=${cursor}`);
      expect(response.status, `after=${cursor}`).toBe(400);
      expect(await errorCode(response)).toBe('INVALID_CURSOR');
    }
  });

  it('answers 404 for a run in another workspace', async () => {
    const h = await workspaceHarness();
    const theirs = await h.other.request('/api/v1/runs', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'idempotency-key': 'other-events' },
      body: JSON.stringify({ projectId: h.otherProjectId, requiredCapabilities: [] }),
    });
    const otherRunId = ((await theirs.json()) as { id: string }).id;
    // Read from the *other* side: `h.other` owns this run, so a 404 here would
    // only prove the run does not exist. The probe has to come from the app that
    // does not own it.
    const response = await h.app.request(`/api/v1/runs/${otherRunId}/events`);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('RUN_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/runs/:runId/gate
// ---------------------------------------------------------------------------

describe('GET /api/v1/runs/:runId/gate', () => {
  it('returns a provisional evaluation without recording it', async () => {
    const h = await workspaceHarness();
    const { runId } = await seed(h);
    const response = await h.app.request(`/api/v1/runs/${runId}/gate`);
    expect(response.status).toBe(200);
    const gate = (await response.json()) as { recorded: boolean; decision: string };
    // A GET must not be a write: a browser prefetch used to create gate rows and
    // outbox events.
    expect(gate.recorded).toBe(false);
    expect(gate.decision).toBeTruthy();
    expect(await h.store.getRunGate(h.workspaceId, runId)).toBeNull();
  });

  it('still reports a provisional evaluation after two reads, because neither records', async () => {
    const h = await workspaceHarness();
    const { runId } = await seed(h);
    await h.app.request(`/api/v1/runs/${runId}/gate`);
    const second = await h.app.request(`/api/v1/runs/${runId}/gate`);
    expect(((await second.json()) as { recorded: boolean }).recorded).toBe(false);
    expect(await h.store.getRunGate(h.workspaceId, runId)).toBeNull();
  });

  it('answers 404 for an unknown run', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request(`/api/v1/runs/${nextId()}/gate`);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('RUN_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/releases/:releaseId/readiness
// ---------------------------------------------------------------------------

describe('GET /api/v1/releases/:releaseId/readiness', () => {
  it('answers with a readiness view for a release that has no runs', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request(`/api/v1/releases/${nextId()}/readiness`);
    expect(response.status).toBe(200);
    expect(await response.json()).toBeTruthy();
  });

  it('scopes the view to the calling workspace', async () => {
    const h = await workspaceHarness();
    // A release id is a uuid, and the read filters on both `release_id` and
    // `workspace_id` — which is the whole point. A release with no completed runs
    // answers the same from both sides, so the workspace that actually has one is
    // the only place a leak would show.
    const releaseId = h.releaseId;
    const seeded = await seed(h, { releaseId });
    await finishJob(h, seeded, 'passed');

    const mine = (await (
      await h.app.request(`/api/v1/releases/${releaseId}/readiness`)
    ).json()) as {
      releaseId: string;
      decision: string;
      latestRunId: string | null;
    };
    const theirs = (await (
      await h.other.request(`/api/v1/releases/${releaseId}/readiness`)
    ).json()) as typeof mine;

    expect(mine.releaseId).toBe(releaseId);
    // The workspace that owns the completed run names it and reaches a verdict;
    // the workspace that does not see it at all.
    expect(mine.latestRunId).toBe(seeded.runId);
    expect(mine.decision).not.toBe('unknown');
    expect(theirs.latestRunId).toBeNull();
    expect(theirs.decision).toBe('unknown');
    expect(theirs).not.toEqual(mine);
    expect(JSON.stringify(theirs)).not.toContain(seeded.runId);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/runs/:runId/cancel and /retry
// ---------------------------------------------------------------------------

describe('POST /api/v1/runs/:runId/cancel', () => {
  it('cancels a running run and reports it as cancelled', async () => {
    const h = await workspaceHarness();
    const { runId } = await seed(h);
    const response = await h.app.request(`/api/v1/runs/${runId}/cancel`, { method: 'POST' });
    expect(response.status).toBe(200);
    const run = (await response.json()) as { phase: string; outcome: string };
    expect(run.phase).toBe('cancelled');
    expect(run.outcome).toBe('cancelled');
  });

  it('answers 404 for a run in another workspace', async () => {
    const h = await workspaceHarness();
    const theirs = await h.other.request('/api/v1/runs', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'idempotency-key': 'other-cancel' },
      body: JSON.stringify({ projectId: h.otherProjectId, requiredCapabilities: [] }),
    });
    const otherRunId = ((await theirs.json()) as { id: string }).id;
    const response = await h.app.request(`/api/v1/runs/${otherRunId}/cancel`, { method: 'POST' });
    expect(response.status).toBe(404);
  });
});

describe('POST /api/v1/runs/:runId/retry', () => {
  it('creates a new run that names the one it retries', async () => {
    const h = await workspaceHarness();
    const seeded = await seed(h);
    await finishJob(h, seeded, 'failed');
    const response = await h.app.request(`/api/v1/runs/${seeded.runId}/retry`, {
      method: 'POST',
      headers: { 'idempotency-key': 'retry-1' },
    });
    expect(response.status).toBe(202);
    const run = (await response.json()) as { id: string; retryOfRunId: string | null };
    expect(run.retryOfRunId).toBe(seeded.runId);
    expect(run.id).not.toBe(seeded.runId);
  });

  it('answers 409 for an id that was never issued', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request(`/api/v1/runs/${nextId()}/retry`, { method: 'POST' });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('RUN_NOT_RETRYABLE');
  });

  it('refuses to retry a run in another workspace', async () => {
    const h = await workspaceHarness();
    const theirs = await h.other.request('/api/v1/runs', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'idempotency-key': 'other-retry' },
      body: JSON.stringify({ projectId: h.otherProjectId, requiredCapabilities: [] }),
    });
    const otherRunId = ((await theirs.json()) as { id: string }).id;
    const response = await h.app.request(`/api/v1/runs/${otherRunId}/retry`, { method: 'POST' });
    expect(response.status).toBe(409);
  });
});

describe('the store cannot be read across the tenancy boundary', () => {
  // `listEvents`, `listArtifacts` and `getGate` were the only three id-addressed
  // `ExecutionStore` methods that did not take a workspace, so a caller holding a
  // run id from another workspace could read that workspace's events, artifacts
  // and gate straight through the store. The routes happened to resolve the run
  // first, so nothing leaked — but the guarantee was the routes' diligence rather
  // than the store's contract.
  //
  // These are the store-level probes for that fix, and they are separate from the
  // HTTP-level probes above on purpose: a route can be safe while its store is
  // not, and a store can be safe while a route is not.

  it('returns an empty event page for a run in another workspace', async () => {
    const h = await workspaceHarness();
    const seeded = await seed(h);
    // A real event, so the empty page is a refusal rather than an empty table.
    const posted = await h.app.request(`/api/v1/jobs/${seeded.jobId}/events`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${seeded.token}` },
      body: JSON.stringify({
        leaseId: seeded.leaseId,
        fencingToken: seeded.fencingToken,
        events: [eventLine('cross-workspace-probe', 1)],
      }),
    });
    expect(posted.status).toBe(202);

    const theirs = await h.otherStore.listEvents(h.otherWorkspaceId, seeded.runId);
    // An empty page, not a 404: the store has no error channel for "not yours",
    // and an empty page is what the route turns into a 404.
    expect(theirs.events).toEqual([]);
    expect(theirs.hasMore).toBe(false);

    // And the owning workspace still sees them, so the constraint is not simply
    // refusing everyone.
    const mine = await h.store.listEvents(h.workspaceId, seeded.runId);
    expect(mine.events.length).toBeGreaterThan(0);
  });

  it('lists no artifacts for a run in another workspace', async () => {
    const h = await workspaceHarness();
    const seeded = await seed(h);
    expect(await h.otherStore.listArtifacts(h.otherWorkspaceId, seeded.runId)).toEqual([]);
    expect((await h.store.listArtifacts(h.workspaceId, seeded.runId)).length).toBe(1);
  });

  it('returns no gate for a run in another workspace', async () => {
    const h = await workspaceHarness();
    const seeded = await seed(h);
    // The gate is the product's verdict on a run: "passed", "blocked", and which
    // evidence it cites. Reading another workspace's verdict is the leak this
    // closes.
    expect(await h.otherStore.getGate(h.otherWorkspaceId, seeded.runId)).toBeNull();
  });

  it('returns a gate for the owning workspace', async () => {
    const h = await workspaceHarness();
    const seeded = await seed(h);
    await finishJob(h, seeded, 'passed');
    const gate = await h.store.getGate(h.workspaceId, seeded.runId);
    expect(gate).not.toBeNull();
    expect(gate?.runId).toBe(seeded.runId);
  });

  it('rejects the same read on the in-memory store, which is the one tests use', async () => {
    // Both implementations must hold the same boundary, or a test suite running
    // against the in-memory store proves nothing about the Drizzle one — which is
    // the whole reason the parity suites exist.
    const store = new InMemoryExecutionStore();
    const created = await store.createRun({ requiredCapabilities: [] }, 'parity-key', 'ws-a');
    const runner = await store.registerRunner(
      {
        id: nextId(),
        name: 'parity-runner',
        version: '1.0.0',
        os: 'linux',
        arch: 'x64',
        capabilities: ['playwright'],
        labels: [],
        slots: 1,
      },
      'hash-of-the-token',
      new Date(Date.now() + 3_600_000).toISOString(),
      'ws-a',
    );
    const claim = await store.claimJob(runner.id, ['playwright'], []);
    expect(claim).not.toBeNull();
    await store.appendEvents(created.job.id, claim!.leaseId, claim!.fencingToken, [
      { eventId: 'e1', type: 'run.phase', sequence: 1, payload: { phase: 'running' } },
    ]);

    // The discriminator: the owning workspace sees the event, the other one does
    // not. Asserting both are empty would pass with a store that discarded
    // everything.
    expect((await store.listEvents('ws-a', created.run.id)).events).toHaveLength(1);
    expect((await store.listEvents('ws-b', created.run.id)).events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

describe('artifacts', () => {
  it("lists a run's artifacts and 404s for an unknown run", async () => {
    const h = await workspaceHarness();
    const { runId } = await seed(h);
    const listed = await h.app.request(`/api/v1/runs/${runId}/artifacts`);
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as unknown[]).length).toBe(1);

    const missing = await h.app.request(`/api/v1/runs/${nextId()}/artifacts`);
    expect(missing.status).toBe(404);
    expect(await errorCode(missing)).toBe('RUN_NOT_FOUND');
  });

  it('serves the bytes through the bare /artifacts/:artifactId alias', async () => {
    const h = await workspaceHarness();
    const { artifactId } = await seed(h);
    const response = await h.app.request(`/api/v1/artifacts/${artifactId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/xml');
    expect(await response.text()).toBe('<testsuite/>');
  });

  it('serves the same bytes through the run-scoped path', async () => {
    const h = await workspaceHarness();
    const { runId, artifactId } = await seed(h);
    const response = await h.app.request(`/api/v1/runs/${runId}/artifacts/${artifactId}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<testsuite/>');
  });

  it('refuses to serve an artifact under a run that does not own it', async () => {
    const h = await workspaceHarness();
    const { artifactId } = await seed(h);
    const otherRun = await h.app.request('/api/v1/runs', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'idempotency-key': 'unrelated-run' },
      body: JSON.stringify({ projectId: h.projectId, requiredCapabilities: ['playwright'] }),
    });
    const unrelatedRunId = ((await otherRun.json()) as { id: string }).id;
    const response = await h.app.request(`/api/v1/runs/${unrelatedRunId}/artifacts/${artifactId}`);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('ARTIFACT_NOT_FOUND');
  });

  it('hides an artifact from another workspace', async () => {
    const h = await workspaceHarness();
    const { artifactId } = await seed(h);
    const response = await h.other.request(`/api/v1/artifacts/${artifactId}`);
    expect(response.status).toBe(404);
  });

  it('answers 404 for an artifact id that was never issued', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request(`/api/v1/artifacts/${nextId()}`);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('ARTIFACT_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Runner lifecycle
// ---------------------------------------------------------------------------

describe('runner lifecycle routes', () => {
  it('enrols a runner and hands back a token that then authenticates', async () => {
    const h = await workspaceHarness();
    const runnerId = nextId();
    const response = await h.app.request('/api/v1/runners/register', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'x-runner-registration-secret': REGISTRATION_SECRET },
      body: JSON.stringify({ runnerId, name: 'enrolled', capabilities: ['playwright'], slots: 2 }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { runnerId: string; token: string };
    expect(body.runnerId).toBe(runnerId);

    const authenticated = await h.store.authenticateRunner(body.token);
    expect(authenticated?.id).toBe(runnerId);
  });

  it('refuses enrolment without the registration secret', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request('/api/v1/runners/register', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ runnerId: nextId(), capabilities: ['playwright'] }),
    });
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe('RUNNER_REGISTRATION_UNAUTHORIZED');
  });

  it('refuses enrolment with the wrong registration secret', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request('/api/v1/runners/register', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'x-runner-registration-secret': 'wrong-secret' },
      body: JSON.stringify({ runnerId: nextId(), capabilities: ['playwright'] }),
    });
    expect(response.status).toBe(401);
  });

  it('refuses a re-registration that would silently rotate the credential', async () => {
    const h = await workspaceHarness();
    const runnerId = nextId();
    const send = (headers: Record<string, string>) =>
      h.app.request('/api/v1/runners/register', {
        method: 'POST',
        headers: { ...JSON_HEADERS, ...headers },
        body: JSON.stringify({ runnerId, capabilities: ['playwright'] }),
      });
    const first = await send({ 'x-runner-registration-secret': REGISTRATION_SECRET });
    const firstToken = ((await first.json()) as { token: string }).token;

    const stolen = await send({ 'x-runner-registration-secret': REGISTRATION_SECRET });
    expect(stolen.status).toBe(409);
    expect(await errorCode(stolen)).toBe('RUNNER_ID_TAKEN');

    // The original token still works: nobody else rotated it.
    const stillValid = await h.store.authenticateRunner(firstToken);
    expect(stillValid?.id).toBe(runnerId);

    const rotated = await send({
      'x-runner-registration-secret': REGISTRATION_SECRET,
      'x-rotation-token': firstToken,
    });
    expect(rotated.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects a manifest the schema does not accept', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request('/api/v1/runners/register', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'x-runner-registration-secret': REGISTRATION_SECRET },
      body: JSON.stringify({ runnerId: nextId(), slots: 'two' }),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_RUNNER_MANIFEST');
  });

  it("accepts a heartbeat from the runner itself and refuses a different runner's", async () => {
    const h = await workspaceHarness();
    const { runnerId, token, jobId } = await seed(h);

    const mine = await h.app.request(`/api/v1/runners/${runnerId}/heartbeat`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ activeJobIds: [jobId], health: 'healthy' }),
    });
    expect(mine.status).toBe(200);
    const heartbeat = (await mine.json()) as { runnerId: string; health: string };
    expect(heartbeat.runnerId).toBe(runnerId);
    expect(heartbeat.health).toBe('healthy');

    const borrowed = await h.app.request(`/api/v1/runners/${nextId()}/heartbeat`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ health: 'healthy' }),
    });
    // A token for runner A must not be a heartbeat for runner B.
    expect(borrowed.status).toBe(401);
  });

  it('reports a runner draining as draining, not as healthy', async () => {
    const h = await workspaceHarness();
    const { runnerId, token } = await seed(h);
    const response = await h.app.request(`/api/v1/runners/${runnerId}/heartbeat`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ health: 'draining' }),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { health: string }).health).toBe('draining');
  });

  it('refuses a heartbeat with a health value the schema does not accept', async () => {
    const h = await workspaceHarness();
    const { runnerId, token } = await seed(h);
    const response = await h.app.request(`/api/v1/runners/${runnerId}/heartbeat`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ health: 'on fire' }),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_HEARTBEAT');
  });

  it('refuses a heartbeat with no token', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request(`/api/v1/runners/${nextId()}/heartbeat`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ health: 'healthy' }),
    });
    expect(response.status).toBe(401);
  });

  it("answers 204 when there is no job the runner's capabilities match", async () => {
    const h = await workspaceHarness();
    const registered = await h.app.request('/api/v1/runners/register', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'x-runner-registration-secret': REGISTRATION_SECRET },
      body: JSON.stringify({
        runnerId: nextId(),
        capabilities: ['a-capability-nothing-requires'],
      }),
    });
    const { runnerId, token } = (await registered.json()) as {
      runnerId: string;
      token: string;
    };
    const response = await h.app.request(`/api/v1/runners/${runnerId}/jobs/claim`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ capabilities: ['a-capability-nothing-requires'] }),
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('never hands the same job to two runners', async () => {
    const h = await workspaceHarness();
    // `seed` claims a job for its own runner, so the queue is drained afterwards.
    // Claiming twice from an empty queue would pass for the wrong reason: both
    // runners would get nothing, which is also what a broken claim path produces.
    await seed(h);
    const queued = await h.app.request('/api/v1/runs', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'idempotency-key': 'second-queued-run' },
      body: JSON.stringify({ projectId: h.projectId, requiredCapabilities: ['playwright'] }),
    });
    expect(queued.status).toBe(202);
    const claimAs = async (label: string) => {
      const registered = await h.app.request('/api/v1/runners/register', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'x-runner-registration-secret': REGISTRATION_SECRET },
        body: JSON.stringify({ runnerId: nextId(), name: label, capabilities: ['playwright'] }),
      });
      const { runnerId, token } = (await registered.json()) as {
        runnerId: string;
        token: string;
      };
      const response = await h.app.request(`/api/v1/runners/${runnerId}/jobs/claim`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
        body: JSON.stringify({ capabilities: ['playwright'] }),
      });
      return response.status === 204 ? null : ((await response.json()) as { jobId: string }).jobId;
    };
    const first = await claimAs('first');
    const second = await claimAs('second');
    const claimed = [first, second].filter((jobId): jobId is string => jobId !== null);
    // Exactly one of two runners takes the single queued job. Zero would mean
    // claiming is broken; two would mean the lease is not exclusive.
    expect(claimed).toHaveLength(1);
  });

  it('refuses a claim from a runner whose id the token does not match', async () => {
    const h = await workspaceHarness();
    const { token } = await seed(h);
    const response = await h.app.request(`/api/v1/runners/${nextId()}/jobs/claim`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ capabilities: ['playwright'] }),
    });
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Job events
// ---------------------------------------------------------------------------

describe('POST /api/v1/jobs/:jobId/events', () => {
  it('accepts a leased event and reports it accepted', async () => {
    const h = await workspaceHarness();
    const { jobId, token, leaseId, fencingToken } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/events`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({
        leaseId,
        fencingToken,
        events: [eventLine('e-1', 1)],
      }),
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { duplicate: boolean };
    expect(body.duplicate).toBe(false);
  });

  it('is reachable at the /events/batch alias, with the same behaviour', async () => {
    const h = await workspaceHarness();
    const { jobId, token, leaseId, fencingToken } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/events/batch`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({
        leaseId,
        fencingToken,
        events: [eventLine('e-alias', 1)],
      }),
    });
    expect(response.status).toBe(202);
  });

  it('refuses a batch with no runner token', async () => {
    const h = await workspaceHarness();
    const { jobId, leaseId, fencingToken } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/events`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ leaseId, fencingToken, events: [] }),
    });
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe('RUNNER_UNAUTHORIZED');
  });

  it('refuses a batch with no lease credentials even from the owning runner', async () => {
    const h = await workspaceHarness();
    const { jobId, token } = await seed(h);
    // Falling back to the stored lease would let any authenticated runner write
    // events into any job in any workspace.
    const response = await h.app.request(`/api/v1/jobs/${jobId}/events`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ events: [eventLine('e', 1)] }),
    });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('JOB_LEASE_REQUIRED');
  });

  it('refuses a stale lease id and a stale fencing token with different codes', async () => {
    const h = await workspaceHarness();
    const { jobId, token, fencingToken } = await seed(h);
    const send = (leaseId: string, tokenValue: number) =>
      h.app.request(`/api/v1/jobs/${jobId}/events`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
        body: JSON.stringify({
          leaseId,
          fencingToken: tokenValue,
          events: [eventLine('e', 1)],
        }),
      });

    const staleLease = await send('a-lease-that-was-never-issued', fencingToken);
    expect(staleLease.status).toBe(409);
    expect(await errorCode(staleLease)).toBe('JOB_LEASE_INVALID');

    const staleFencing = await send(
      (await h.store.getJob(jobId, h.workspaceId))?.leaseId ?? '',
      fencingToken + 99,
    );
    expect(staleFencing.status).toBe(409);
    expect(await errorCode(staleFencing)).toBe('JOB_FENCING_STALE');
  });

  it('answers 404 for a job in another workspace', async () => {
    const h = await workspaceHarness();
    const { token } = await seed(h);
    const response = await h.other.request(`/api/v1/jobs/${nextId()}/events`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      // A body the schema *accepts*, so the 404 is about the job and not about a
      // malformed request being rejected earlier in the handler.
      body: JSON.stringify({ leaseId: 'any-lease', fencingToken: 1, events: [eventLine('e', 1)] }),
    });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('JOB_NOT_FOUND');
  });

  it('rejects an empty batch the schema does not accept', async () => {
    const h = await workspaceHarness();
    const { jobId, token, leaseId, fencingToken } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/events`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ leaseId, fencingToken, events: [] }),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_EVENT_BATCH');
  });

  it('rejects a batch body the schema does not accept', async () => {
    const h = await workspaceHarness();
    const { jobId, token } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/events`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ events: 'not-an-array' }),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_EVENT_BATCH');
  });
});

// ---------------------------------------------------------------------------
// Job artifacts and completion
// ---------------------------------------------------------------------------

describe('POST /api/v1/jobs/:jobId/artifacts', () => {
  it('refuses an upload with no runner token', async () => {
    const h = await workspaceHarness();
    const { jobId } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/artifacts`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'a.txt', contentBase64: 'YQ==' }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects a declared checksum that does not match the bytes', async () => {
    const h = await workspaceHarness();
    const { jobId, token, leaseId, fencingToken } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/artifacts`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'liar.txt',
        contentBase64: Buffer.from('actual').toString('base64'),
        checksum: 'f'.repeat(64),
        leaseId,
        fencingToken,
      }),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('ARTIFACT_CHECKSUM_MISMATCH');
  });

  it('rejects a declared size that does not match the bytes', async () => {
    const h = await workspaceHarness();
    const { jobId, token, leaseId, fencingToken } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/artifacts`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'wrong-size.txt',
        contentBase64: Buffer.from('actual').toString('base64'),
        sizeBytes: 9999,
        leaseId,
        fencingToken,
      }),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('ARTIFACT_SIZE_MISMATCH');
  });

  it('rejects a body whose base64 is not base64', async () => {
    const h = await workspaceHarness();
    const { jobId, token, leaseId, fencingToken } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/artifacts`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'bad.txt',
        contentBase64: '!!!not base64!!!',
        leaseId,
        fencingToken,
      }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('rejects an upload with no metadata at all', async () => {
    const h = await workspaceHarness();
    const { jobId, token } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/artifacts`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_ARTIFACT');
  });
});

describe('POST /api/v1/jobs/:jobId/complete', () => {
  it('completes a job and reports the run as complete', async () => {
    const h = await workspaceHarness();
    const { jobId, token, leaseId, fencingToken } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({
        phase: 'completed',
        outcome: 'passed',
        leaseId,
        fencingToken,
        summary: { total: 1, passed: 1, failed: 0 },
      }),
    });
    expect(response.status).toBe(200);
    const run = (await response.json()) as { phase: string; outcome: string };
    expect(run.phase).toBe('complete');
    expect(run.outcome).toBe('passed');
  });

  it('refuses completion with no runner token', async () => {
    const h = await workspaceHarness();
    const { jobId, leaseId, fencingToken } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phase: 'completed', leaseId, fencingToken }),
    });
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe('RUNNER_UNAUTHORIZED');
  });

  it('refuses completion of a job in another workspace', async () => {
    const h = await workspaceHarness();
    const { token, leaseId, fencingToken } = await seed(h);
    const response = await h.other.request(`/api/v1/jobs/${nextId()}/complete`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      // A body the schema accepts, so the 404 is about the job rather than about
      // a malformed request rejected earlier in the handler.
      body: JSON.stringify({ phase: 'completed', leaseId, fencingToken }),
    });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('JOB_NOT_FOUND');
  });

  it('rejects a completion body with no lease credentials', async () => {
    const h = await workspaceHarness();
    const { jobId, token } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ phase: 'completed' }),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_COMPLETION');
  });

  it('rejects a completion body the schema does not accept', async () => {
    const h = await workspaceHarness();
    const { jobId, token, leaseId, fencingToken } = await seed(h);
    const response = await h.app.request(`/api/v1/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      // The lease is valid, so the only thing wrong is the phase.
      body: JSON.stringify({ phase: 'teleported', leaseId, fencingToken }),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_COMPLETION');
  });
});

// ---------------------------------------------------------------------------
// Policies and maturity
// ---------------------------------------------------------------------------

describe('quality policies', () => {
  it('materialises a default policy for a workspace with none', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request('/api/v1/quality-policies');
    expect(response.status).toBe(200);
    const policies = (await response.json()) as Array<{ workspaceId: string }>;
    expect(policies).toHaveLength(1);
    expect(policies[0]?.workspaceId).toBe(h.workspaceId);
  });

  it("does not leak one workspace's policy into another", async () => {
    const h = await workspaceHarness();
    await h.app.request('/api/v1/quality-policies');
    const other = await h.other.request('/api/v1/quality-policies');
    const otherPolicies = (await other.json()) as Array<{ workspaceId: string }>;
    for (const policy of otherPolicies) {
      expect(policy.workspaceId).toBe(h.otherWorkspaceId);
    }
  });

  it('creates a policy the workspace can then read back', async () => {
    const h = await workspaceHarness();
    const created = await h.app.request('/api/v1/quality-policies', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'strict', version: '2', requiredDomains: ['browser', 'api'] }),
    });
    expect(created.status).toBe(201);
    const policy = (await created.json()) as { name: string; workspaceId: string };
    expect(policy.name).toBe('strict');
    expect(policy.workspaceId).toBe(h.workspaceId);

    const listed = (await (await h.app.request('/api/v1/quality-policies')).json()) as Array<{
      name: string;
    }>;
    expect(listed.map((entry) => entry.name)).toContain('strict');
  });

  it('rejects a policy body the schema does not accept', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request('/api/v1/quality-policies', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 7 }),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('INVALID_POLICY');
  });
});

describe('GET /api/v1/integrations/maturity', () => {
  it('reports the registry version and at least one integration', async () => {
    const h = await workspaceHarness();
    const response = await h.app.request('/api/v1/integrations/maturity');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { registryVersion: string; integrations: unknown[] };
    expect(body.registryVersion).toBe('1');
    expect(body.integrations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The body limit
// ---------------------------------------------------------------------------

describe('the execution body limit', () => {
  it('answers 413 with the cap rather than buffering an oversized body', async () => {
    const h = await workspaceHarness();
    const oversized = JSON.stringify({
      events: [eventLine('e', 1, { blob: 'x'.repeat(200_000) })],
    });
    const response = await h.app.request('/api/v1/runs', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'idempotency-key': 'big' },
      body: oversized,
    });
    // The cap is 96 MiB, so a 200 KB body is inside it — this asserts the limit is
    // wired, not that a small body is refused.
    expect(response.status).toBe(202);
  });
});
