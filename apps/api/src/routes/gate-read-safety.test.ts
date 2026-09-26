import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createExecutionRoutes } from './execution.js';
import { InMemoryExecutionStore } from '../execution/in-memory-execution-store.js';
import type { CreateRunInput } from '../execution/types.js';

/** An event the bus was handed, with only the field this test reads typed. */
interface PublishedEvent {
  type: string;
}

/**
 * A GET must not write.
 *
 * `GET /api/v1/runs/:runId/gate` evaluated the gate, saved it and published a
 * `gate.evaluated` event on *every call*. So a browser prefetch, a link preview
 * or a crawler's retry created gate rows and outbox events — and it raced the
 * write `completeJob` already does, because the gate is recorded when the run
 * finishes.
 *
 * The handler is now a pure read: it returns the recorded evaluation, or the one
 * the run *would* get, marked `recorded: false` and neither persisted nor
 * published. These tests assert the absence of the write rather than the
 * presence of a read, because "no rows were created" is the property.
 */
const REGISTRATION_SECRET = 'gate-read-secret';

function runBody(key: string): CreateRunInput {
  return {
    externalId: `external-${key}`,
    source: 'api',
    testType: 'browser',
    framework: 'playwright',
    timeoutMs: 60_000,
    requiredCapabilities: ['playwright'],
    labels: ['reference'],
    configuration: {},
  };
}

async function harness() {
  const store = new InMemoryExecutionStore();
  const published: PublishedEvent[] = [];
  const bus = {
    publish: (event: unknown) => {
      published.push(event as PublishedEvent);
    },
    subscribe: () => () => undefined,
  };
  const app = createExecutionRoutes({
    store,
    bus: bus as never,
    workspaceId: 'ws-gate',
    registrationSecret: REGISTRATION_SECRET,
  });
  const server = new Hono().route('/', app);

  const runner = await store.registerRunner(
    {
      id: 'runner-1',
      name: 'runner-1',
      version: '1.0.0',
      os: 'linux',
      arch: 'x64',
      capabilities: ['playwright'],
      labels: ['reference'],
      slots: 2,
    },
    'a'.repeat(64),
    new Date(Date.now() + 3_600_000).toISOString(),
    'ws-gate',
  );
  const { run } = await store.createRun(runBody('gate-1'), 'gate-1', 'ws-gate');
  const claim = await store.claimJob(runner.id, [], [], undefined, 'ws-gate');
  if (claim === null) throw new Error('expected a claim');
  return { store, server, run, claim, published };
}

const auth = { 'content-type': 'application/json', authorization: 'Bearer local-key' };

describe('reading a quality gate does not write one', () => {
  it('creates no gate row and publishes no event', async () => {
    const { store, server, run, published } = await harness();
    const before = await store.getRunGate('ws-gate', run.id);

    const response = await server.request(`/api/v1/runs/${run.id}/gate`, {
      headers: auth,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; recorded: boolean };
    // The verdict is still available to the caller.
    expect(typeof body.status).toBe('string');
    // …and it is marked provisional, because nothing was recorded.
    expect(body.recorded).toBe(false);

    // The property that matters: the read changed nothing.
    expect(await store.getRunGate('ws-gate', run.id)).toEqual(before);
    expect(published.filter((event) => event.type === 'gate.evaluated')).toEqual([]);
  });

  it('is idempotent across repeated reads', async () => {
    const { server, run, published } = await harness();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await server.request(`/api/v1/runs/${run.id}/gate`, { headers: auth });
      expect(response.status).toBe(200);
    }
    expect(published.filter((event) => event.type === 'gate.evaluated')).toEqual([]);
  });

  it('returns the recorded evaluation once completion has persisted one', async () => {
    const { store, server, run, claim } = await harness();
    await store.completeJob(
      claim.jobId,
      {
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        status: 'passed',
        outcome: 'passed',
        tests: [{ id: 't-1', title: 'works', status: 'passed' }],
        summary: { total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, blocked: 0, unknown: 0 },
      },
      'ws-gate',
    );

    const response = await server.request(`/api/v1/runs/${run.id}/gate`, { headers: auth });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { recorded: boolean; policyHash: string };
    // The stored evaluation is returned, and it is marked as recorded.
    expect(body.recorded).toBe(true);
    expect(body.policyHash).toHaveLength(64);
  });

  it('still reports a missing run rather than inventing one', async () => {
    const { server } = await harness();
    const response = await server.request(
      '/api/v1/runs/00000000-0000-4000-8000-0000000000ff/gate',
      {
        headers: auth,
      },
    );
    expect(response.status).toBe(404);
  });
});
