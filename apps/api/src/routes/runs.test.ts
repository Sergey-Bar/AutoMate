/**
 * runs.test.ts — Unit + integration tests for the T17 runs and events routes
 *
 * Covers:
 *  1. GET /api/v1/runs returns empty array when no runs exist
 *  2. GET /api/v1/runs returns runs after a reporter event is ingested
 *  3. GET /api/v1/runs includes all expected RunRecord fields
 *  4. Multiple runs are returned
 *  5. Negative: invalid reporter event → run does not appear in list
 *  6. GET /api/v1/events returns 200 with text/event-stream content-type
 *  7. Full vertical-slice integration: POST reporter → GET runs → assert run present
 *     (saves evidence to .sisyphus/evidence/)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { createReporterRoutes } from './reporter.js';
import { createRunsRoutes } from './runs.js';
import { createEventsRoutes } from './events.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { InMemoryRealtimeBus } from '../realtime/realtime-bus.js';

// ---------------------------------------------------------------------------
// Evidence directory (relative to workspace root)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// From apps/api/src/routes/ → up 4 levels → workspace root → .sisyphus/evidence
const EVIDENCE_DIR = path.resolve(__dirname, '../../../../.sisyphus/evidence');

function ensureEvidenceDir(): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function saveEvidence(filename: string, data: unknown): void {
  ensureEvidenceDir();
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, filename),
    JSON.stringify(data, null, 2),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a full app wiring all three route factories through a shared
 * repository and bus — mirrors the production wiring in index.ts.
 */
function buildFullApp(
  repo: InMemoryRunRepository,
  bus: InMemoryRealtimeBus,
): Hono {
  const app = new Hono();
  app.route('/', createReporterRoutes(undefined, { repository: repo, bus }));
  app.route('/', createRunsRoutes({ repository: repo }));
  app.route('/', createEventsRoutes({ bus }));
  return app;
}

async function postEvent(
  app: Hono,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request('/api/v1/reporter/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getRuns(app: Hono): Promise<Response> {
  return app.request('/api/v1/runs');
}

// ---------------------------------------------------------------------------
// 1. Empty repository returns empty array
// ---------------------------------------------------------------------------

describe('GET /api/v1/runs — empty repository', () => {
  it('returns 200 with an empty array when no runs exist', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildFullApp(repo, bus);

    const res = await getRuns(app);
    expect(res.status).toBe(200);

    const body = (await res.json()) as unknown[];
    expect(body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Run appears after reporter event
// ---------------------------------------------------------------------------

describe('GET /api/v1/runs — after reporter ingestion', () => {
  it('returns the run after a run:start event', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildFullApp(repo, bus);

    const postRes = await postEvent(app, {
      type: 'run:start',
      runId: 'run-list-001',
      payload: { total: 3 },
    });
    expect(postRes.status).toBe(202);

    const res = await getRuns(app);
    expect(res.status).toBe(200);

    const runs = (await res.json()) as Array<Record<string, unknown>>;
    expect(runs).toHaveLength(1);
    expect(runs[0]?.['id']).toBe('run-list-001');
    expect(runs[0]?.['status']).toBe('running');
  });

  it('returns the run with all expected RunRecord fields', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildFullApp(repo, bus);

    await postEvent(app, {
      type: 'run:start',
      runId: 'run-fields-001',
      payload: { total: 5, branch: 'main', commitSha: 'abc1234' },
    });

    const res = await getRuns(app);
    const runs = (await res.json()) as Array<Record<string, unknown>>;
    const run = runs[0];

    expect(run).toBeDefined();
    expect(typeof run?.['id']).toBe('string');
    expect(typeof run?.['startedAt']).toBe('string');
    expect(typeof run?.['status']).toBe('string');
    expect(typeof run?.['total']).toBe('number');
    expect(typeof run?.['passed']).toBe('number');
    expect(typeof run?.['failed']).toBe('number');
    expect(typeof run?.['flaky']).toBe('number');
    expect(typeof run?.['skipped']).toBe('number');
    expect(typeof run?.['triggeredBy']).toBe('string');
    // Optional fields may be null
    expect(['string', null].includes(run?.['finishedAt'] as string | null)).toBe(true);
    expect(run?.['branch']).toBe('main');
    expect(run?.['commitSha']).toBe('abc1234');
  });
});

// ---------------------------------------------------------------------------
// 3. Multiple runs are returned
// ---------------------------------------------------------------------------

describe('GET /api/v1/runs — multiple runs', () => {
  it('returns all runs when multiple run:start events were ingested', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildFullApp(repo, bus);

    await postEvent(app, { type: 'run:start', runId: 'run-multi-001', payload: { total: 1 } });
    await postEvent(app, { type: 'run:start', runId: 'run-multi-002', payload: { total: 2 } });
    await postEvent(app, { type: 'run:start', runId: 'run-multi-003', payload: { total: 3 } });

    const res = await getRuns(app);
    const runs = (await res.json()) as Array<Record<string, unknown>>;

    expect(runs).toHaveLength(3);
    const ids = runs.map((r) => r['id']);
    expect(ids).toContain('run-multi-001');
    expect(ids).toContain('run-multi-002');
    expect(ids).toContain('run-multi-003');
  });
});

// ---------------------------------------------------------------------------
// 4. Run not created for invalid event — negative case
// ---------------------------------------------------------------------------

describe('GET /api/v1/runs — negative case (invalid event)', () => {
  it('invalid reporter event → 400 → run does not appear in list', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildFullApp(repo, bus);

    // POST invalid event (missing runId)
    const invalidRes = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'run:start', payload: { total: 1 } }),
    });
    expect(invalidRes.status).toBe(400);

    // No run should have been created
    const runsRes = await getRuns(app);
    const runs = (await runsRes.json()) as unknown[];
    expect(runs).toHaveLength(0);
  });

  it('invalid event type → 400 → run does not appear in list', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildFullApp(repo, bus);

    const invalidRes = await postEvent(app, {
      type: 'unknown:event',
      runId: 'should-not-exist',
      payload: {},
    });
    expect(invalidRes.status).toBe(400);

    const runsRes = await getRuns(app);
    const runs = (await runsRes.json()) as Array<Record<string, unknown>>;
    const ids = runs.map((r) => r['id']);
    expect(ids).not.toContain('should-not-exist');
  });
});

// ---------------------------------------------------------------------------
// 5. GET /api/v1/events returns text/event-stream
// ---------------------------------------------------------------------------

describe('GET /api/v1/events — SSE headers', () => {
  it('returns 200 with content-type text/event-stream', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildFullApp(repo, bus);

    const res = await app.request('/api/v1/events');
    expect(res.status).toBe(200);

    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('text/event-stream');
  });
});

// ---------------------------------------------------------------------------
// 6. Vertical slice — full integration (saves evidence files)
// ---------------------------------------------------------------------------

describe('Vertical slice — full path integration (T17 evidence)', () => {
  it('POST reporter event → GET /api/v1/runs → run appears (saves task-17-runs-api.json)', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildFullApp(repo, bus);

    const RUN_ID = 'slice_run_001';

    // Step 1: ingest a run:start event
    const postRes = await postEvent(app, {
      type: 'run:start',
      runId: RUN_ID,
      payload: { total: 5, branch: 'main', commitSha: 'deadbeef' },
    });
    expect(postRes.status).toBe(202);

    // Step 2: GET /api/v1/runs and assert run appears
    const getRes = await getRuns(app);
    expect(getRes.status).toBe(200);

    const runs = (await getRes.json()) as Array<Record<string, unknown>>;
    const found = runs.find((r) => r['id'] === RUN_ID);
    expect(found).toBeDefined();
    expect(found?.['status']).toBe('running');
    expect(found?.['total']).toBe(5);

    // Step 3: verify realtime bus received an event
    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.runId).toBe(RUN_ID);
    expect(bus.published[0]?.type).toBe('run:updated');

    // Step 4: save evidence
    saveEvidence('task-17-runs-api.json', runs);
  });

  it('POST invalid event → GET /api/v1/runs → no run created (saves task-17-invalid-reporter-response.json)', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildFullApp(repo, bus);

    // Step 1: POST invalid event (missing runId)
    const invalidPostRes = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'run:start', payload: { total: 3 } }),
    });
    expect(invalidPostRes.status).toBe(400);

    const invalidBody = (await invalidPostRes.json()) as Record<string, unknown>;
    expect(typeof invalidBody['error']).toBe('string');

    // Step 2: GET /api/v1/runs — no run was created
    const getRes = await getRuns(app);
    const runs = (await getRes.json()) as unknown[];
    expect(runs).toHaveLength(0);

    // Step 3: save evidence — the 400 response proves the guard works
    saveEvidence('task-17-invalid-reporter-response.json', {
      postStatus: invalidPostRes.status,
      postBody: invalidBody,
      runsAfterInvalidEvent: runs,
    });
  });

  it('full lifecycle: run:start → test:end → run:end → run appears as completed', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildFullApp(repo, bus);

    const RUN_ID = 'slice_lifecycle_001';

    // Ingest full lifecycle
    await postEvent(app, { type: 'run:start', runId: RUN_ID, payload: { total: 1 } });
    await postEvent(app, {
      type: 'test:begin',
      runId: RUN_ID,
      payload: { testId: 't-1', title: 'login test', file: 'e2e/login.spec.ts' },
    });
    await postEvent(app, {
      type: 'test:end',
      runId: RUN_ID,
      payload: { testId: 't-1', status: 'passed', durationMs: 1234 },
    });
    await postEvent(app, {
      type: 'run:end',
      runId: RUN_ID,
      payload: { status: 'passed', durationMs: 2000 },
    });

    // GET /api/v1/runs
    const getRes = await getRuns(app);
    const runs = (await getRes.json()) as Array<Record<string, unknown>>;
    const run = runs.find((r) => r['id'] === RUN_ID);

    expect(run).toBeDefined();
    expect(run?.['status']).toBe('passed');
    expect(run?.['passed']).toBe(1);
    expect(run?.['durationMs']).toBe(2000);
    expect(run?.['finishedAt']).not.toBeNull();

    // Realtime: 3 run:updated events (run:start + test:end + run:end)
    expect(bus.published).toHaveLength(3);
    expect(bus.published[2]?.status).toBe('passed');
  });
});
