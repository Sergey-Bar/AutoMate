import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createExecutionRoutes } from '../routes/execution.js';
import { createAgentRoutes } from '../routes/agents.js';
import { createHealthRoutes } from '../routes/health.js';
import { InMemoryExecutionStore, hashRunnerToken } from './in-memory-execution-store.js';
import { createGateEvaluation, defaultPolicy, policyDigest } from './quality-gate.js';
import { integrationMaturity, listIntegrationMaturity } from './maturity.js';

function clockStore(): { store: InMemoryExecutionStore; set: (value: Date) => void } {
  let now = new Date('2026-02-01T00:00:00.000Z');
  return {
    store: new InMemoryExecutionStore({ now: () => now, leaseMs: 50, tokenTtlMs: 1000 }),
    set: (value) => {
      now = value;
    },
  };
}

async function registeredApp(
  store: InMemoryExecutionStore,
  secret = 'registration-secret',
): Promise<{
  app: Hono;
  token: string;
  runnerId: string;
  jobId: string;
  leaseId: string;
  fencingToken: number;
}> {
  const app = new Hono().route(
    '/',
    createExecutionRoutes({ store, workspaceId: 'workspace-edge', registrationSecret: secret }),
  );
  const response = await app.request('/api/v1/runners/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-runner-registration-secret': secret },
    body: JSON.stringify({
      runnerId: 'runner-edge',
      name: 'edge',
      version: '1',
      os: 'linux',
      arch: 'x64',
      capabilities: ['playwright'],
      labels: ['edge'],
      slots: 2,
    }),
  });
  const registration = (await response.json()) as { token: string; runnerId: string };
  const created = await store.createRun(
    { requiredCapabilities: ['playwright'], labels: ['edge'], releaseId: 'release-edge' },
    'edge-key',
    'workspace-edge',
  );
  const claim = await store.claimJob(registration.runnerId, ['playwright'], ['edge']);
  if (!claim) throw new Error('expected claim');
  return {
    app,
    token: registration.token,
    runnerId: registration.runnerId,
    jobId: created.job.id,
    leaseId: claim.leaseId,
    fencingToken: claim.fencingToken,
  };
}

describe('execution edge cases', () => {
  it('handles missing entities and terminal idempotency', async () => {
    const { store } = clockStore();
    expect(await store.getRun('missing')).toBeNull();
    expect(await store.getJob('missing')).toBeNull();
    expect(await store.getRunner('missing')).toBeNull();
    expect(await store.getPolicy('missing')).toBeNull();
    expect(await store.getGate('missing')).toBeNull();
    expect(await store.getArtifact('missing')).toBeNull();
    expect(await store.retryRun('missing')).toBeNull();
    expect(await store.cancelRun('missing')).toBeNull();
    expect(await store.reapExpiredLeases(new Date('2026-02-01T00:00:00.000Z'))).toEqual([]);
    const created = await store.createRun({}, 'edge-missing', 'workspace-edge');
    expect(await store.retryRun(created.run.id, 'workspace-edge')).toBeNull();
    const cancelled = await store.cancelRun(created.run.id, 'workspace-edge');
    expect(cancelled?.phase).toBe('cancelled');
    expect((await store.cancelRun(created.run.id, 'workspace-edge'))?.phase).toBe('cancelled');
    const retry = await store.retryRun(created.run.id, 'workspace-edge', 'edge-retry');
    expect(retry?.duplicate).toBe(false);
    expect((await store.retryRun(created.run.id, 'workspace-edge', 'edge-retry'))?.duplicate).toBe(
      true,
    );
  });

  it('handles runner auth, lease, and event validation', async () => {
    const { store, set } = clockStore();
    const context = await registeredApp(store);
    expect(await store.authenticateRunner('bad')).toBeNull();
    expect(await store.heartbeatRunner('missing')).toBeNull();
    expect(await store.claimJob('missing')).toBeNull();
    expect(
      (
        await store.appendEvents(context.jobId, 'bad', 1, [
          { eventId: 'bad', sequence: 1, type: 'run.started' },
        ])
      )[0]?.status,
    ).toBe('conflict');
    expect(
      (
        await store.appendEvents(context.jobId, context.leaseId, context.fencingToken, [
          { eventId: 'bad', sequence: 0, type: 'run.started' },
        ])
      )[0]?.status,
    ).toBe('conflict');
    expect(
      (
        await store.appendEvents(context.jobId, context.leaseId, context.fencingToken, [
          { eventId: 'x', sequence: 3, type: 'run.started' },
        ])
      )[0]?.status,
    ).toBe('conflict');
    set(new Date('2026-02-01T00:00:01.000Z'));
    const reaped = await store.reapExpiredLeases();
    expect(reaped[0]?.status).toBe('queued');
    expect((await store.getJob(context.jobId))?.attempt).toBe(2);
  });

  it('handles policy/gate/readiness branches', async () => {
    const { store } = clockStore();
    const run = (
      await store.createRun({ releaseId: 'release-policy' }, 'policy-run', 'workspace-policy')
    ).run;
    const policy = await store.createPolicy(defaultPolicy('workspace-policy'));
    expect(policy.hash).toHaveLength(64);
    expect(policyDigest(policy)).toHaveLength(64);
    const gate = createGateEvaluation({ run, policy, evaluatedAt: '2026-02-01T00:00:00.000Z' });
    expect(await store.saveGate(gate)).toEqual(gate);
    expect((await store.getRunGate('workspace-policy', run.id))?.runId).toBe(run.id);
    const readiness = await store.getReleaseReadiness('workspace-policy', 'release-policy');
    expect(readiness.decision).toBe('unknown');
    expect((await store.listPolicies('workspace-policy')).length).toBe(1);
    expect(await store.listPolicies('other')).toEqual([]);
    expect(integrationMaturity('playwright.execution')?.id).toBe('playwright.execution');
    expect(integrationMaturity('missing')).toBeNull();
    expect(listIntegrationMaturity().length).toBeGreaterThan(10);
  });
});

describe('execution route edge cases', () => {
  it('returns structured errors for invalid and unauthenticated requests', async () => {
    const { store } = clockStore();
    const app = new Hono().route(
      '/',
      createExecutionRoutes({ store, registrationSecret: 'secret', requireIdempotencyKey: true }),
    );
    expect(
      (
        await app.request('/api/v1/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request('/api/v1/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(400);
    expect((await app.request('/api/v1/runs/missing')).status).toBe(404);
    expect((await app.request('/api/v1/runs/missing/cancel', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/v1/runs/missing/retry', { method: 'POST' })).status).toBe(409);
    expect((await app.request('/api/v1/runs/missing/gate')).status).toBe(404);
    expect((await app.request('/api/v1/runs/missing/artifacts')).status).toBe(404);
    expect((await app.request('/api/v1/artifacts/missing')).status).toBe(404);
    expect(
      (
        await app.request('/api/v1/runners/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-runner-registration-secret': 'wrong' },
          body: '{}',
        })
      ).status,
    ).toBe(401);
    expect(
      (await app.request('/api/v1/runners/r/jobs/claim', { method: 'POST', body: '{}' })).status,
    ).toBe(401);
    expect(
      (await app.request('/api/v1/runners/r/heartbeat', { method: 'POST', body: '{}' })).status,
    ).toBe(401);
    expect(
      (await app.request('/api/v1/jobs/j/events', { method: 'POST', body: '{}' })).status,
    ).toBe(401);
    expect(
      (await app.request('/api/v1/jobs/j/artifacts', { method: 'POST', body: '{}' })).status,
    ).toBe(401);
    expect(
      (await app.request('/api/v1/jobs/j/complete', { method: 'POST', body: '{}' })).status,
    ).toBe(401);
  });

  it('handles policy, gate, and canonical artifact endpoints', async () => {
    const { store } = clockStore();
    const app = new Hono().route('/', createExecutionRoutes({ store }));
    const policyResponse = await app.request('/api/v1/quality-policies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'edge',
        version: '2',
        rules: [{ domain: 'browser', required: true, requiredArtifactKinds: ['screenshot'] }],
      }),
    });
    expect(policyResponse.status).toBe(201);
    expect((await app.request('/api/v1/quality-policies')).status).toBe(200);
    const created = await store.createRun({ releaseId: 'release-route' }, 'route-run');
    const claimed = await store.claimJob('missing');
    expect(claimed).toBeNull();
    expect((await store.listEvents(created.run.id)).length).toBe(0);
    expect((await app.request(`/api/v1/runs/${created.run.id}/events`)).status).toBe(200);
    expect((await app.request(`/api/v1/runs/${created.run.id}/gate`)).status).toBe(200);
    expect((await app.request('/api/v1/releases/release-route/readiness')).status).toBe(200);
    const artifact = await store.addArtifact({
      runId: created.run.id,
      jobId: created.job.id,
      testId: null,
      kind: 'report',
      name: 'x.json',
      contentType: 'application/json',
      storageKey: 'runs/x.json',
      expiresAt: null,
      legalHold: false,
      metadata: {},
      bytes: new Uint8Array([1]),
    });
    expect(
      (await app.request(`/api/v1/runs/${created.run.id}/artifacts/${artifact.id}`)).status,
    ).toBe(200);
    expect(
      (await app.request(`/api/v1/runs/${created.run.id}/artifacts/${artifact.id}`)).status,
    ).toBe(200);
  });
});

describe('full in-memory execution branches', () => {
  it('covers terminal state mapping, token expiry, and lease recovery', async () => {
    let now = new Date('2026-03-01T00:00:00.000Z');
    const store = new InMemoryExecutionStore({ now: () => now, leaseMs: 20, tokenTtlMs: 30 });
    const token = 'registration-token';
    const runner = await store.registerRunner(
      {
        id: 'branch-runner',
        name: 'branch',
        version: '1',
        os: 'linux',
        arch: 'x64',
        capabilities: ['playwright'],
        labels: [],
        slots: 20,
      },
      hashRunnerToken(token),
      new Date(now.getTime() + 30).toISOString(),
      'branch-workspace',
    );
    expect(await store.getRunner(runner.id)).not.toBeNull();
    const statuses = [
      'passed',
      'failed',
      'skipped',
      'blocked',
      'timed_out',
      'cancelled',
      'partial',
      'infra_failed',
      'config_failed',
      'runner_lost',
    ] as const;
    for (const [index, status] of statuses.entries()) {
      const created = await store.createRun(
        { requiredCapabilities: ['playwright'], releaseId: `release-${index}` },
        `state-${index}`,
        'branch-workspace',
      );
      const claim = await store.claimJob(runner.id, ['playwright'], [], now);
      expect(claim).not.toBeNull();
      const phase =
        status === 'infra_failed'
          ? 'infra_failed'
          : status === 'config_failed'
            ? 'config_failed'
            : status === 'runner_lost'
              ? 'runner_lost'
              : status === 'timed_out'
                ? 'timed_out'
                : status === 'blocked'
                  ? 'blocked'
                  : 'running';
      await store.appendEvents(created.job.id, claim!.leaseId, claim!.fencingToken, [
        { eventId: `phase-${index}`, type: 'run.phase', sequence: 1, payload: { phase } },
      ]);
      await store.appendEvents(created.job.id, claim!.leaseId, claim!.fencingToken, [
        {
          eventId: `test-${index}`,
          type: 'test.completed',
          sequence: 2,
          payload: { testId: `test-${index}`, status },
        },
      ]);
      const result = await store.completeJob(created.job.id, {
        leaseId: claim!.leaseId,
        fencingToken: claim!.fencingToken,
        status,
        outcome: status === 'runner_lost' ? 'unknown' : (status as never),
      });
      expect(result).not.toBeNull();
    }
    const queued = await store.createRun(
      { requiredCapabilities: ['playwright'] },
      'reap-run',
      'branch-workspace',
    );
    const claim = await store.claimJob(runner.id, ['playwright'], [], now);
    expect(claim?.runId).toBe(queued.run.id);
    now = new Date(now.getTime() + 100);
    const reaped = await store.reapExpiredLeases(now);
    expect(reaped.length).toBeGreaterThan(0);
    expect(await store.authenticateRunner(token)).toBeNull();
  });
  it('covers readiness outcomes, stale events, and runner health branches', async () => {
    let now = new Date('2026-04-01T00:00:00.000Z');
    const store = new InMemoryExecutionStore({ now: () => now, leaseMs: 10 });
    const token = 'token-readiness';
    const runner = await store.registerRunner(
      {
        id: 'readiness-runner',
        name: 'readiness',
        version: '1',
        os: 'linux',
        arch: 'x64',
        capabilities: ['playwright'],
        labels: [],
        slots: 10,
      },
      hashRunnerToken(token),
      new Date(now.getTime() + 1000).toISOString(),
      'readiness-workspace',
    );
    const outcomes = [
      'passed',
      'failed',
      'partial',
      'cancelled',
      'timed_out',
      'runner_lost',
      'infra_failed',
      'config_failed',
      'unknown',
      null,
    ] as const;
    for (const [index, outcome] of outcomes.entries()) {
      const created = await store.createRun(
        { releaseId: `release-${index}` },
        `readiness-${index}`,
        'readiness-workspace',
      );
      const claim = await store.claimJob(runner.id, ['playwright'], [], now);
      expect(claim).not.toBeNull();
      await store.appendEvents(created.job.id, claim!.leaseId, claim!.fencingToken, [
        {
          eventId: `phase-${index}`,
          type: 'run.phase',
          sequence: 1,
          payload: { phase: outcome === null ? 'running' : 'complete', outcome },
        },
      ]);
      await store.completeJob(created.job.id, {
        leaseId: claim!.leaseId,
        fencingToken: claim!.fencingToken,
        status: outcome === null ? 'cancelled' : outcome === 'failed' ? 'failed' : 'passed',
        phase: 'complete',
        outcome: outcome === null ? 'cancelled' : (outcome as never),
      });
      expect(
        (await store.getReadiness(`release-${index}`, 'readiness-workspace')).decision,
      ).toBeDefined();
    }
    const stale = await store.createRun(
      { requiredCapabilities: ['playwright'] },
      'stale-event',
      'readiness-workspace',
    );
    const claim = await store.claimJob(runner.id, ['playwright'], [], now);
    expect(claim?.runId).toBe(stale.run.id);
    now = new Date(now.getTime() + 100);
    expect(
      (
        await store.appendEvents(stale.job.id, claim!.leaseId, claim!.fencingToken, [
          { eventId: 'stale', type: 'run.started', sequence: 1 },
        ])
      )[0]?.status,
    ).toBe('conflict');
    expect((await store.heartbeatRunner(runner.id, [stale.job.id], 'offline'))?.health).toBe(
      'offline',
    );
    expect(await store.claimJob(runner.id, ['playwright'], [], now)).toBeNull();
  });
});

describe('health and agents', () => {
  it('reports readiness with and without a database', async () => {
    const noDatabase = new Hono().route('/', createHealthRoutes());
    expect((await noDatabase.request('/api/v1/ready')).status).toBe(503);
    const ready = new Hono().route(
      '/',
      createHealthRoutes({ databaseUrl: 'postgres://test', checkDatabase: async () => undefined }),
    );
    expect((await ready.request('/api/v1/ready')).status).toBe(200);
    const unavailable = new Hono().route(
      '/',
      createHealthRoutes({
        databaseUrl: 'postgres://test',
        checkDatabase: async () => {
          throw new Error('down');
        },
      }),
    );
    expect((await unavailable.request('/api/v1/ready')).status).toBe(503);
  });

  it('returns explicit unknown and unconfigured agent responses', async () => {
    const app = new Hono().route('/', createAgentRoutes());
    expect((await app.request('/api/v1/agents/unknown/generate', { method: 'POST' })).status).toBe(
      404,
    );
    expect((await app.request('/api/v1/agents/browser', { method: 'GET' })).status).toBe(501);
    expect((await app.request('/api/v1/agents')).status).toBe(200);
  });
});
