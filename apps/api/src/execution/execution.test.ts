import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  InMemoryExecutionStore,
  createRunnerToken,
  hashRunnerToken,
} from './in-memory-execution-store.js';
import { createGateEvaluation, defaultPolicy } from './quality-gate.js';
import { createExecutionRoutes } from '../routes/execution.js';
import { createAgentRoutes } from '../routes/agents.js';

function fixedStore(): { store: InMemoryExecutionStore; setNow: (value: Date) => void } {
  let current = new Date('2026-01-01T00:00:00.000Z');
  const store = new InMemoryExecutionStore({ now: () => current, leaseDurationMs: 1_000 });
  return {
    store,
    setNow: (value) => {
      current = value;
    },
  };
}

describe('InMemoryExecutionStore', () => {
  it('creates idempotently, cancels, and retries with linked evidence', async () => {
    const { store } = fixedStore();
    const first = await store.createRun(
      {
        projectId: 'project',
        environmentId: 'env',
        releaseId: 'release',
        branch: 'main',
        commit: 'abc',
        requiredCapabilities: ['playwright'],
      },
      'key-1',
    );
    const duplicate = await store.createRun({ projectId: 'project' }, 'key-1');
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.run.id).toBe(first.run.id);
    expect((await store.listRuns()).length).toBe(1);
    const cancelled = await store.cancelRun(first.run.id);
    expect(cancelled?.phase).toBe('cancelled');
    const retry = await store.retryRun(first.run.id);
    expect(retry?.run.retryOfRunId).toBe(first.run.id);
    expect(retry?.run.attempt).toBe(2);
  });

  it('claims by capability, rejects stale events, and acknowledges duplicates', async () => {
    const { store, setNow } = fixedStore();
    const created = await store.createRun(
      { requiredCapabilities: ['playwright'], labels: ['linux'] },
      'key-2',
    );
    const token = createRunnerToken();
    await store.registerRunner(
      {
        id: 'runner-1',
        name: 'runner',
        version: '1',
        os: 'linux',
        arch: 'x64',
        capabilities: ['playwright'],
        labels: ['linux'],
        slots: 1,
      },
      hashRunnerToken(token),
      '2026-01-01T01:00:00.000Z',
    );
    const claim = await store.claimJob('runner-1');
    expect(claim?.jobId).toBe(created.job.id);
    const event = {
      eventId: 'event-1',
      sequence: 1,
      type: 'run.started',
      occurredAt: '2026-01-01T00:00:01.000Z',
      payload: {},
    };
    expect(
      (await store.appendEvents(claim!.jobId, claim!.leaseId, claim!.fencingToken, [event]))[0]
        ?.status,
    ).toBe('accepted');
    expect(
      (await store.appendEvents(claim!.jobId, claim!.leaseId, claim!.fencingToken, [event]))[0]
        ?.status,
    ).toBe('duplicate');
    expect(
      (
        await store.appendEvents(claim!.jobId, claim!.leaseId, claim!.fencingToken, [
          { ...event, eventId: 'event-2' },
        ])
      )[0]?.status,
    ).toBe('conflict');
    setNow(new Date('2026-01-01T00:00:03.000Z'));
    expect((await store.reapExpiredLeases())[0]?.requeued).toBe(true);
    expect((await store.claimJob('runner-1'))?.fencingToken).toBe(2);
  });

  it('persists artifact bytes and metadata', async () => {
    const { store } = fixedStore();
    const created = await store.createRun({}, 'key-3');
    const descriptor = await store.addArtifact({
      runId: created.run.id,
      jobId: created.job.id,
      testId: null,
      kind: 'report',
      name: 'report.json',
      contentType: 'application/json',
      storageKey: 'runs/report.json',
      expiresAt: null,
      legalHold: false,
      metadata: { source: 'test' },
      bytes: new TextEncoder().encode('{"ok":true}'),
    });
    expect(descriptor.checksum).toHaveLength(64);
    expect((await store.getArtifact(descriptor.id))?.bytes.byteLength).toBe(11);
    expect((await store.listArtifacts(created.run.id))[0]?.metadata['source']).toBe('test');
  });
});

describe('quality gate', () => {
  it('is deterministic and distinguishes infrastructure failure', async () => {
    const { store } = fixedStore();
    const created = await store.createRun({ releaseId: 'release' }, 'key-4');
    const run = (await store.getRun(created.run.id))!;
    const policy = await store.createPolicy(defaultPolicy('default-workspace'));
    const first = createGateEvaluation({ run, policy, evaluatedAt: '2026-01-01T00:00:00.000Z' });
    const second = createGateEvaluation({ run, policy, evaluatedAt: '2026-01-01T00:00:00.000Z' });
    expect(first).toEqual(second);
    expect(first.status).toBe('unknown');
    const infra = { ...run, phase: 'infra_failed' as const, outcome: 'infra_failed' as const };
    expect(
      createGateEvaluation({ run: infra, policy, evaluatedAt: '2026-01-01T00:00:00.000Z' })
        .decision,
    ).toBe('blocked');
  });
});

describe('canonical execution routes', () => {
  it('supports enqueue, idempotent replay, runner auth, and artifact retrieval', async () => {
    const { store } = fixedStore();
    const app = new Hono().route(
      '/',
      createExecutionRoutes({ store, runnerRegistrationSecret: 'runner-registration-secret' }),
    );
    const runResponse = await app.request('/api/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'http-key' },
      body: JSON.stringify({
        projectId: 'p',
        environmentId: 'e',
        releaseId: 'r',
        branch: 'main',
        commit: 'abc',
        requiredCapabilities: ['playwright'],
      }),
    });
    expect(runResponse.status).toBe(202);
    const run = (await runResponse.json()) as { id: string; phase: string };
    expect(run.phase).toBe('queued');
    const replay = await app.request('/api/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'http-key' },
      body: JSON.stringify({ projectId: 'p' }),
    });
    expect(replay.headers.get('x-idempotent-replay')).toBe('true');
    const registered = await app.request('/api/v1/runners/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-runner-registration-secret': 'runner-registration-secret',
      },
      body: JSON.stringify({ runnerId: 'runner-http', capabilities: ['playwright'], slots: 1 }),
    });
    expect(registered.status).toBe(201);
    const registration = (await registered.json()) as { token: string };
    const unauthorized = await app.request('/api/v1/runners/runner-http/jobs/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(unauthorized.status).toBe(401);
    const claim = await app.request('/api/v1/runners/runner-http/jobs/claim', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${registration.token}`,
      },
      body: '{}',
    });
    expect(claim.status).toBe(200);
    const job = (await claim.json()) as { jobId: string; leaseId: string; fencingToken: number };
    const artifact = await app.request(`/api/v1/jobs/${job.jobId}/artifacts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${registration.token}`,
      },
      body: JSON.stringify({
        name: 'trace.zip',
        contentType: 'application/zip',
        contentBase64: Buffer.from('trace').toString('base64'),
      }),
    });
    expect(artifact.status).toBe(201);
    const descriptor = (await artifact.json()) as { id: string };
    const download = await app.request(`/api/v1/artifacts/${descriptor.id}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('trace');
  });

  it('returns explicit agent maturity for unconfigured integrations', async () => {
    const app = new Hono().route('/', createAgentRoutes());
    const response = await app.request('/api/v1/agents/api/generate', { method: 'POST' });
    expect(response.status).toBe(501);
    expect(((await response.json()) as { status: string }).status).toBe('not_configured');
  });
});
