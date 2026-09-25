/**
 * reporter-persistence.test.ts — Integration-style tests for T14 persistence slice
 *
 * These tests send HTTP events through the full Hono route layer and then
 * inspect an InMemoryRunRepository to verify the expected rows were persisted.
 * No real Postgres instance is required.
 *
 * Covers:
 *  1. run:start event creates a persisted run record with expected id/status
 *  2. Invalid event returns 400 and creates no row (no partial state)
 *  3. Duplicate run:start event does not create a second row (idempotent upsert)
 *  4. Full run lifecycle: run:start → test:begin → test:end → run:end
 *  5. test:end counters (passed, failed, flaky, skipped, timedOut)
 *  6. Path-traversal in test file field is sanitized before persistence
 *  7. Versioned event format also persists correctly
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createReporterRoutes } from './reporter.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(
  secret: string | undefined,
  repo: InMemoryRunRepository,
): Hono {
  const app = new Hono();
  app.route('/', createReporterRoutes(secret, { repository: repo }));
  return app;
}

async function sendEvent(
  app: Hono,
  event: { type: string; runId: string; payload: Record<string, unknown> },
): Promise<Response> {
  return app.request('/api/v1/reporter/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
}

async function sendVersionedEvent(
  app: Hono,
  event: {
    version: string;
    type: string;
    runId: string;
    timestamp: string;
    payload: Record<string, unknown>;
  },
): Promise<Response> {
  return app.request('/api/v1/reporter/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
}

// ---------------------------------------------------------------------------
// 1. run:start → persisted run record
// ---------------------------------------------------------------------------

describe('Reporter persistence — run:start creates a run record', () => {
  it('persists a run row with expected id and status=running', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    const res = await sendEvent(app, {
      type: 'run:start',
      runId: 'run-persist-001',
      payload: { total: 5 },
    });

    expect(res.status).toBe(202);

    const run = await repo.getRun('run-persist-001');
    expect(run).not.toBeNull();
    expect(run!.id).toBe('run-persist-001');
    expect(run!.status).toBe('running');
    expect(run!.total).toBe(5);
    expect(run!.passed).toBe(0);
    expect(run!.failed).toBe(0);
    expect(run!.finishedAt).toBeNull();
  });

  it('persists branch and commitSha from payload when present', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    await sendEvent(app, {
      type: 'run:start',
      runId: 'run-persist-meta',
      payload: { total: 2, branch: 'main', commitSha: 'abc1234' },
    });

    const run = await repo.getRun('run-persist-meta');
    expect(run!.branch).toBe('main');
    expect(run!.commitSha).toBe('abc1234');
  });

  it('defaults total to 0 when payload omits it', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    await sendEvent(app, {
      type: 'run:start',
      runId: 'run-no-total',
      payload: {},
    });

    const run = await repo.getRun('run-no-total');
    expect(run!.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Invalid event → 400, no partial row created
// ---------------------------------------------------------------------------

describe('Reporter persistence — invalid event creates no row', () => {
  it('missing runId returns 400 and no run row is created', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'run:start', payload: { total: 3 } }),
    });

    expect(res.status).toBe(400);
    expect(repo.getAllRuns()).toHaveLength(0);
  });

  it('invalid JSON body returns 400 and no row is created', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json{{',
    });

    expect(res.status).toBe(400);
    expect(repo.getAllRuns()).toHaveLength(0);
    expect(repo.getAllTests()).toHaveLength(0);
  });

  it('unknown legacy event type returns 400 and no row is created', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    const res = await sendEvent(app, {
      type: 'unknown:custom',
      runId: 'run-bad-type',
      payload: {},
    });

    expect(res.status).toBe(400);
    expect(repo.getAllRuns()).toHaveLength(0);
  });

  it('array body returns 400 and no row is created', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'run:start', runId: 'x', payload: {} }]),
    });

    expect(res.status).toBe(400);
    expect(repo.getAllRuns()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Duplicate run:start → idempotent upsert (no duplicate row)
// ---------------------------------------------------------------------------

describe('Reporter persistence — duplicate run:start is idempotent', () => {
  it('sending run:start twice does not create two rows', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    for (let i = 0; i < 2; i++) {
      const res = await sendEvent(app, {
        type: 'run:start',
        runId: 'run-dup-001',
        payload: { total: 5 },
      });
      expect(res.status).toBe(202);
    }

    expect(repo.getAllRuns()).toHaveLength(1);
    const run = await repo.getRun('run-dup-001');
    expect(run!.status).toBe('running');
  });

  it('test:begin with same (testId, runId) twice is idempotent', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    await sendEvent(app, {
      type: 'run:start',
      runId: 'run-dup-test',
      payload: { total: 1 },
    });

    for (let i = 0; i < 2; i++) {
      await sendEvent(app, {
        type: 'test:begin',
        runId: 'run-dup-test',
        payload: { testId: 't-dup', title: 'my test', file: 'a.spec.ts' },
      });
    }

    expect(repo.getAllTests()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Full run lifecycle
// ---------------------------------------------------------------------------

describe('Reporter persistence — full run lifecycle', () => {
  it('run:start → test:begin → test:end → run:end persists full state', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    await sendEvent(app, {
      type: 'run:start',
      runId: 'run-lifecycle',
      payload: { total: 1 },
    });

    await sendEvent(app, {
      type: 'test:begin',
      runId: 'run-lifecycle',
      payload: { testId: 't-1', title: 'passes test', file: 'a.spec.ts' },
    });

    // Verify test row created with status=running
    const testMid = await repo.getTest('t-1', 'run-lifecycle');
    expect(testMid).not.toBeNull();
    expect(testMid!.status).toBe('running');

    await sendEvent(app, {
      type: 'test:end',
      runId: 'run-lifecycle',
      payload: { testId: 't-1', status: 'passed', durationMs: 42 },
    });

    await sendEvent(app, {
      type: 'run:end',
      runId: 'run-lifecycle',
      payload: { status: 'passed', durationMs: 100 },
    });

    const run = await repo.getRun('run-lifecycle');
    expect(run!.status).toBe('passed');
    expect(run!.passed).toBe(1);
    expect(run!.failed).toBe(0);
    expect(run!.durationMs).toBe(100);
    expect(run!.finishedAt).not.toBeNull();

    const test = await repo.getTest('t-1', 'run-lifecycle');
    expect(test!.status).toBe('passed');
    expect(test!.durationMs).toBe(42);
  });

  it('run:end with status=failed marks run as failed', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    await sendEvent(app, {
      type: 'run:start',
      runId: 'run-failed',
      payload: { total: 1 },
    });
    await sendEvent(app, {
      type: 'run:end',
      runId: 'run-failed',
      payload: { status: 'failed', durationMs: 200 },
    });

    const run = await repo.getRun('run-failed');
    expect(run!.status).toBe('failed');
    expect(run!.durationMs).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 5. Counter increments for each test:end status
// ---------------------------------------------------------------------------

describe('Reporter persistence — test:end counter increments', () => {
  async function setupRunWithTests(
    repo: InMemoryRunRepository,
    runId: string,
    testStatuses: string[],
  ): Promise<void> {
    const app = buildApp(undefined, repo);
    await sendEvent(app, {
      type: 'run:start',
      runId,
      payload: { total: testStatuses.length },
    });
    for (let i = 0; i < testStatuses.length; i++) {
      const testId = `t-${runId}-${i}`;
      await sendEvent(app, {
        type: 'test:begin',
        runId,
        payload: { testId, title: `test ${i}`, file: 'a.spec.ts' },
      });
      await sendEvent(app, {
        type: 'test:end',
        runId,
        payload: { testId, status: testStatuses[i], durationMs: 10 },
      });
    }
  }

  it('increments passed counter', async () => {
    const repo = new InMemoryRunRepository();
    await setupRunWithTests(repo, 'run-counters-pass', ['passed', 'passed']);
    const run = await repo.getRun('run-counters-pass');
    expect(run!.passed).toBe(2);
    expect(run!.failed).toBe(0);
  });

  it('increments failed counter', async () => {
    const repo = new InMemoryRunRepository();
    await setupRunWithTests(repo, 'run-counters-fail', ['failed']);
    const run = await repo.getRun('run-counters-fail');
    expect(run!.failed).toBe(1);
    expect(run!.passed).toBe(0);
  });

  it('increments failed counter for timedOut tests', async () => {
    const repo = new InMemoryRunRepository();
    await setupRunWithTests(repo, 'run-counters-timeout', ['timedOut']);
    const run = await repo.getRun('run-counters-timeout');
    expect(run!.failed).toBe(1);
  });

  it('increments flaky counter', async () => {
    const repo = new InMemoryRunRepository();
    await setupRunWithTests(repo, 'run-counters-flaky', ['flaky']);
    const run = await repo.getRun('run-counters-flaky');
    expect(run!.flaky).toBe(1);
    expect(run!.failed).toBe(0);
  });

  it('increments skipped counter', async () => {
    const repo = new InMemoryRunRepository();
    await setupRunWithTests(repo, 'run-counters-skip', ['skipped']);
    const run = await repo.getRun('run-counters-skip');
    expect(run!.skipped).toBe(1);
    expect(run!.passed).toBe(0);
  });

  it('increments mixed counters correctly', async () => {
    const repo = new InMemoryRunRepository();
    await setupRunWithTests(repo, 'run-counters-mixed', [
      'passed',
      'failed',
      'flaky',
      'skipped',
      'timedOut',
    ]);
    const run = await repo.getRun('run-counters-mixed');
    expect(run!.passed).toBe(1);
    expect(run!.failed).toBe(2); // failed + timedOut
    expect(run!.flaky).toBe(1);
    expect(run!.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Path-traversal in test file field is sanitized
// ---------------------------------------------------------------------------

describe('Reporter persistence — path safety for test file field', () => {
  it('strips traversal sequences from test file field', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    await sendEvent(app, {
      type: 'run:start',
      runId: 'run-path-safe',
      payload: { total: 1 },
    });

    await sendEvent(app, {
      type: 'test:begin',
      runId: 'run-path-safe',
      payload: {
        testId: 't-traverse',
        title: 'evil test',
        file: '../../../etc/passwd',
      },
    });

    const test = await repo.getTest('t-traverse', 'run-path-safe');
    expect(test).not.toBeNull();
    // Traversal path should be sanitized to just the basename
    expect(test!.file).not.toContain('..');
    expect(test!.file).toBe('passwd');
  });

  it('preserves normal relative test file path unchanged', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    await sendEvent(app, {
      type: 'run:start',
      runId: 'run-path-ok',
      payload: { total: 1 },
    });

    await sendEvent(app, {
      type: 'test:begin',
      runId: 'run-path-ok',
      payload: {
        testId: 't-normal',
        title: 'normal test',
        file: 'e2e/login.spec.ts',
      },
    });

    const test = await repo.getTest('t-normal', 'run-path-ok');
    expect(test!.file).toBe('e2e/login.spec.ts');
  });
});

// ---------------------------------------------------------------------------
// 7. Versioned event format also persists
// ---------------------------------------------------------------------------

describe('Reporter persistence — versioned event format', () => {
  it('versioned run:start event persists a run row', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    const res = await sendVersionedEvent(app, {
      version: '2',
      type: 'run:start',
      runId: 'run-versioned-persist',
      timestamp: '2026-05-05T10:00:00.000Z',
      payload: { total: 7, branch: 'feat/unified' },
    });

    expect(res.status).toBe(202);

    const run = await repo.getRun('run-versioned-persist');
    expect(run).not.toBeNull();
    expect(run!.status).toBe('running');
    expect(run!.total).toBe(7);
    expect(run!.branch).toBe('feat/unified');
  });

  it('non-persisted versioned event type (stdout) does not create a run row', async () => {
    const repo = new InMemoryRunRepository();
    const app = buildApp(undefined, repo);

    const res = await sendVersionedEvent(app, {
      version: '2',
      type: 'stdout',
      runId: 'run-stdout-no-row',
      timestamp: '2026-05-05T10:00:00.000Z',
      payload: { chunk: 'console output' },
    });

    // Route accepts and returns 202 (stdout is a valid versioned type)
    expect(res.status).toBe(202);
    // But no run row should have been created for stdout
    expect(repo.getAllRuns()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Backward-compat: createReporterRoutes without repository still works
// ---------------------------------------------------------------------------

describe('Reporter persistence — backward compatibility (no repository)', () => {
  it('accepts events without a repository and returns 202 (no-op persistence)', async () => {
    const app = new Hono();
    app.route('/', createReporterRoutes(undefined));

    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'run:start', runId: 'run-compat', payload: { total: 1 } }),
    });

    expect(res.status).toBe(202);
  });
});
