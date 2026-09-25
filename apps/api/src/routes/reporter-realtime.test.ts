/**
 * reporter-realtime.test.ts — Integration tests for T15 realtime run update slice
 *
 * These tests send HTTP events through the full Hono route → persistence →
 * realtime-broadcast pipeline, then inspect an InMemoryRealtimeBus to verify
 * the expected events were (or were not) published.
 *
 * Covers:
 *  1. run:start emits exactly one run:updated event with status='running'
 *  2. run:end emits exactly one run:updated event with the final run status
 *  3. test:end emits run:updated (run counters updated on the run record)
 *  4. test:begin does NOT emit (test-only persistence, run unchanged)
 *  5. stdout event does NOT emit (not persisted)
 *  6. Malformed/rejected events (400) do NOT emit
 *  7. Payload contains ONLY safe fields — no user-supplied payload data
 *  8. Without a bus configured, events are silently accepted (backward compat)
 *  9. subscriber receives exactly one event per run-modifying ingestion
 * 10. Full lifecycle: run:start → test:end → run:end produces 3 events in order
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createReporterRoutes } from './reporter.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { InMemoryRealtimeBus } from '../realtime/realtime-bus.js';
import type { RunUpdatedPayload } from '../realtime/realtime-bus.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(
  repo: InMemoryRunRepository,
  bus: InMemoryRealtimeBus,
): Hono {
  const app = new Hono();
  app.route('/', createReporterRoutes(undefined, { repository: repo, bus }));
  return app;
}

async function post(
  app: Hono,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request('/api/v1/reporter/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 1. run:start → single run:updated event, status='running'
// ---------------------------------------------------------------------------

describe('Realtime broadcast — run:start', () => {
  it('emits exactly one run:updated event with status=running after run:start', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    const res = await post(app, {
      type: 'run:start',
      runId: 'rt-run-001',
      payload: { total: 5 },
    });

    expect(res.status).toBe(202);
    expect(bus.published).toHaveLength(1);

    const evt = bus.published[0] as RunUpdatedPayload;
    expect(evt.type).toBe('run:updated');
    expect(evt.version).toBe('1');
    expect(evt.runId).toBe('rt-run-001');
    expect(evt.status).toBe('running');
    expect(typeof evt.timestamp).toBe('string');
    expect(evt.timestamp.length).toBeGreaterThan(0);
  });

  it('versioned run:start also emits run:updated', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    await post(app, {
      version: '1',
      type: 'run:start',
      runId: 'rt-versioned-001',
      timestamp: '2026-05-05T10:00:00.000Z',
      payload: { total: 3, branch: 'main' },
    });

    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.runId).toBe('rt-versioned-001');
    expect(bus.published[0]?.status).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// 2. run:end → run:updated with final status
// ---------------------------------------------------------------------------

describe('Realtime broadcast — run:end', () => {
  it('emits run:updated with status=passed after run:end passed', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    // Seed the run first
    await post(app, { type: 'run:start', runId: 'rt-end-001', payload: { total: 1 } });
    bus.published.length = 0; // reset to check only the run:end broadcast

    await post(app, {
      type: 'run:end',
      runId: 'rt-end-001',
      payload: { status: 'passed', durationMs: 500 },
    });

    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.status).toBe('passed');
    expect(bus.published[0]?.runId).toBe('rt-end-001');
  });

  it('emits run:updated with status=failed after run:end failed', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    await post(app, { type: 'run:start', runId: 'rt-end-002', payload: { total: 1 } });
    bus.published.length = 0;

    await post(app, {
      type: 'run:end',
      runId: 'rt-end-002',
      payload: { status: 'failed', durationMs: 100 },
    });

    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// 3. test:end → run:updated (run counters updated)
// ---------------------------------------------------------------------------

describe('Realtime broadcast — test:end', () => {
  it('emits run:updated after test:end (run counters updated)', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    await post(app, { type: 'run:start', runId: 'rt-test-end-001', payload: { total: 1 } });

    await post(app, {
      type: 'test:begin',
      runId: 'rt-test-end-001',
      payload: { testId: 't-1', title: 'my test', file: 'a.spec.ts' },
    });

    const countBefore = bus.published.length; // run:start emit only

    await post(app, {
      type: 'test:end',
      runId: 'rt-test-end-001',
      payload: { testId: 't-1', status: 'passed', durationMs: 42 },
    });

    // test:end should have emitted one more event
    expect(bus.published).toHaveLength(countBefore + 1);
    const evt = bus.published[bus.published.length - 1] as RunUpdatedPayload;
    expect(evt.type).toBe('run:updated');
    expect(evt.runId).toBe('rt-test-end-001');
    expect(evt.status).toBe('running'); // run still running
  });
});

// ---------------------------------------------------------------------------
// 4. test:begin does NOT emit (test-only, run record unchanged)
// ---------------------------------------------------------------------------

describe('Realtime broadcast — test:begin does not emit', () => {
  it('test:begin does not broadcast a run:updated event', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    await post(app, { type: 'run:start', runId: 'rt-begin-001', payload: { total: 1 } });
    bus.published.length = 0; // reset — only count test:begin emission

    await post(app, {
      type: 'test:begin',
      runId: 'rt-begin-001',
      payload: { testId: 't-1', title: 'my test', file: 'a.spec.ts' },
    });

    expect(bus.published).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. stdout and non-persisted events do NOT emit
// ---------------------------------------------------------------------------

describe('Realtime broadcast — non-persisted events do not emit', () => {
  it('stdout event does not broadcast (non-persisted type)', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    const res = await post(app, {
      type: 'stdout',
      runId: 'rt-stdout-001',
      payload: { chunk: 'console output' },
    });

    expect(res.status).toBe(202);
    expect(bus.published).toHaveLength(0);
  });

  it('stderr event does not broadcast', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    await post(app, {
      type: 'stderr',
      runId: 'rt-stderr-001',
      payload: { chunk: 'error output' },
    });

    expect(bus.published).toHaveLength(0);
  });

  it('step:begin event does not broadcast', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    await post(app, {
      type: 'step:begin',
      runId: 'rt-step-001',
      payload: { stepId: 's-1', title: 'step' },
    });

    expect(bus.published).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Malformed / rejected events (400) do NOT emit
// ---------------------------------------------------------------------------

describe('Realtime broadcast — malformed events do not emit', () => {
  it('missing runId returns 400 and does not broadcast', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'run:start', payload: { total: 1 } }),
    });

    expect(res.status).toBe(400);
    expect(bus.published).toHaveLength(0);
  });

  it('invalid JSON body does not broadcast', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json{{',
    });

    expect(res.status).toBe(400);
    expect(bus.published).toHaveLength(0);
  });

  it('unknown legacy event type returns 400 and does not broadcast', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    const res = await post(app, {
      type: 'unknown:custom',
      runId: 'rt-bad-type',
      payload: {},
    });

    expect(res.status).toBe(400);
    expect(bus.published).toHaveLength(0);
  });

  it('array body returns 400 and does not broadcast', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    const res = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'run:start', runId: 'x', payload: {} }]),
    });

    expect(res.status).toBe(400);
    expect(bus.published).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Payload shape — ONLY safe fields, no user-supplied data
// ---------------------------------------------------------------------------

describe('Realtime broadcast — payload redaction', () => {
  it('broadcast payload contains only type, version, runId, status, timestamp', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    await post(app, {
      type: 'run:start',
      runId: 'rt-safe-001',
      payload: {
        total: 3,
        // These fields exist in the reporter payload but must NOT appear in broadcast
        secret: 'my-secret-token',
        apiKey: 'sk-1234',
        branch: 'main',
        commitSha: 'abc123',
        triggeredBy: 'ci',
      },
    });

    expect(bus.published).toHaveLength(1);
    const evt = bus.published[0] as RunUpdatedPayload;

    // Expected safe fields
    expect(evt.type).toBe('run:updated');
    expect(evt.version).toBe('1');
    expect(typeof evt.runId).toBe('string');
    expect(typeof evt.status).toBe('string');
    expect(typeof evt.timestamp).toBe('string');

    // Ensure no extra fields from user payload leaked through
    const keys = Object.keys(evt);
    expect(keys).toEqual(
      expect.arrayContaining(['type', 'version', 'runId', 'status', 'timestamp']),
    );
    expect(keys).toHaveLength(5);

    // Sensitive fields must not be present at all
    expect(evt).not.toHaveProperty('secret');
    expect(evt).not.toHaveProperty('apiKey');
    expect(evt).not.toHaveProperty('payload');
    expect(evt).not.toHaveProperty('branch');
    expect(evt).not.toHaveProperty('commitSha');
    expect(evt).not.toHaveProperty('triggeredBy');
  });

  it('run:updated payload shape validates against RunUpdatedEventSchema contract', async () => {
    // Validates that the broadcast payload is structurally compatible with
    // packages/realtime/src/events.ts RunUpdatedEventSchema
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    await post(app, {
      type: 'run:start',
      runId: 'rt-schema-001',
      payload: { total: 1 },
    });

    const evt = bus.published[0] as RunUpdatedPayload;

    // Inline schema mirroring RunUpdatedEventSchema from packages/realtime
    // { type: 'run:updated', version: '1', runId: string, status: string, timestamp: string }
    expect(evt.type).toBe('run:updated');
    expect(evt.version).toBe('1');
    expect(typeof evt.runId).toBe('string');
    expect(evt.runId.length).toBeGreaterThan(0);
    expect(typeof evt.status).toBe('string');
    expect(evt.status.length).toBeGreaterThan(0);
    expect(typeof evt.timestamp).toBe('string');
    // Validate ISO-8601 format
    expect(new Date(evt.timestamp).toISOString()).toBe(evt.timestamp);
  });
});

// ---------------------------------------------------------------------------
// 8. Backward compatibility — no bus configured, events still accepted
// ---------------------------------------------------------------------------

describe('Realtime broadcast — backward compatibility (no bus)', () => {
  it('accepts run:start without a bus and returns 202', async () => {
    const repo = new InMemoryRunRepository();
    const app = new Hono();
    app.route('/', createReporterRoutes(undefined, { repository: repo }));

    const res = await post(app, {
      type: 'run:start',
      runId: 'rt-compat-001',
      payload: { total: 1 },
    });

    expect(res.status).toBe(202);
    // Run should still be persisted
    const run = await repo.getRun('rt-compat-001');
    expect(run).not.toBeNull();
    expect(run!.status).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// 9. Exactly one event per run-modifying ingestion (no duplicates)
// ---------------------------------------------------------------------------

describe('Realtime broadcast — exactly one event per operation', () => {
  it('two sequential run:start events (same runId, upsert) emit exactly two events', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    await post(app, { type: 'run:start', runId: 'rt-dedup-001', payload: { total: 5 } });
    await post(app, { type: 'run:start', runId: 'rt-dedup-001', payload: { total: 5 } });

    // Both upserts succeed (idempotent), each emits exactly one run:updated
    expect(bus.published).toHaveLength(2);
    expect(bus.published[0]?.runId).toBe('rt-dedup-001');
    expect(bus.published[1]?.runId).toBe('rt-dedup-001');
  });
});

// ---------------------------------------------------------------------------
// 10. Full lifecycle — events emitted in correct order
// ---------------------------------------------------------------------------

describe('Realtime broadcast — full run lifecycle', () => {
  it('run:start → test:end → run:end emits 3 run:updated events in order', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    await post(app, { type: 'run:start', runId: 'rt-lifecycle-001', payload: { total: 1 } });

    await post(app, {
      type: 'test:begin',
      runId: 'rt-lifecycle-001',
      payload: { testId: 't-lc', title: 'lifecycle test', file: 'lc.spec.ts' },
    });

    await post(app, {
      type: 'test:end',
      runId: 'rt-lifecycle-001',
      payload: { testId: 't-lc', status: 'passed', durationMs: 100 },
    });

    await post(app, {
      type: 'run:end',
      runId: 'rt-lifecycle-001',
      payload: { status: 'passed', durationMs: 200 },
    });

    // run:start(1) + test:begin(0) + test:end(1) + run:end(1) = 3 events
    expect(bus.published).toHaveLength(3);

    const statuses = bus.published.map((e) => e.status);
    expect(statuses[0]).toBe('running'); // after run:start
    expect(statuses[1]).toBe('running'); // after test:end (run still running)
    expect(statuses[2]).toBe('passed');  // after run:end
  });

  it('all lifecycle events carry the same runId', async () => {
    const repo = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    const app = buildApp(repo, bus);

    const RUN_ID = 'rt-lifecycle-002';

    await post(app, { type: 'run:start', runId: RUN_ID, payload: { total: 1 } });
    await post(app, {
      type: 'test:end',
      runId: RUN_ID,
      payload: { testId: 't-x', status: 'failed', durationMs: 50 },
    });
    await post(app, {
      type: 'run:end',
      runId: RUN_ID,
      payload: { status: 'failed', durationMs: 300 },
    });

    expect(bus.published).toHaveLength(3);
    for (const evt of bus.published) {
      expect(evt.runId).toBe(RUN_ID);
    }
  });
});
