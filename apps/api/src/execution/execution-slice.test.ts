import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createExecutionRoutes } from '../routes/execution.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import {
  InMemoryExecutionStore,
  createRunnerToken,
  hashRunnerToken,
} from './in-memory-execution-store.js';
import { evaluateQualityGate, defaultPolicy } from './quality-gate.js';
import { listIntegrationMaturity } from './maturity.js';

function requestBody(values: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values),
  };
}

function runBody(
  idempotencyKey: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    externalId: `external-${idempotencyKey}`,
    source: 'api',
    projectId: 'project-1',
    environmentId: 'environment-1',
    releaseId: 'release-1',
    branch: 'main',
    commit: 'abc123',
    testType: 'browser',
    framework: 'playwright',
    selection: { testIds: [], paths: ['smoke.spec.ts'], tags: [] },
    timeoutMs: 60_000,
    priority: 0,
    requiredCapabilities: ['playwright'],
    labels: ['reference'],
    configuration: {},
    idempotencyKey,
    ...overrides,
  };
}

async function registerRunner(
  app: Hono,
  id = 'runner-1',
): Promise<{ runnerId: string; token: string }> {
  const response = await app.request('/api/v1/runners/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-registration-secret': 'registration-secret',
    },
    body: JSON.stringify({
      runnerId: id,
      name: 'Reference runner',
      version: '1.0.0',
      os: 'linux',
      arch: 'x64',
      capabilities: ['playwright'],
      labels: ['reference'],
      slots: 2,
    }),
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ runnerId: string; token: string }>;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('canonical execution store and routes', () => {
  it('runs the create, claim, evidence, completion, gate, and readiness path', async () => {
    const store = new InMemoryExecutionStore();
    const app = createExecutionRoutes({
      store,
      workspaceId: 'workspace-1',
      requireIdempotencyKey: true,
      registrationSecret: 'registration-secret',
    });

    const createdResponse = await app.request('/api/v1/runs', requestBody(runBody('key-1')));
    expect(createdResponse.status).toBe(202);
    const created = (await createdResponse.json()) as {
      id: string;
      phase: string;
      idempotencyKey: string;
    };
    expect(created.phase).toBe('queued');
    expect(created.idempotencyKey).toBe('key-1');

    const replayResponse = await app.request('/api/v1/runs', requestBody(runBody('key-1')));
    expect(replayResponse.status).toBe(202);
    expect(replayResponse.headers.get('x-idempotent-replay')).toBe('true');
    expect(((await replayResponse.json()) as { id: string }).id).toBe(created.id);

    const registration = await registerRunner(app);
    const claimResponse = await app.request(`/api/v1/runners/${registration.runnerId}/jobs/claim`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: ['playwright'], labels: ['reference'] }),
    });
    expect(claimResponse.status).toBe(200);
    const claim = (await claimResponse.json()) as {
      jobId: string;
      leaseId: string;
      fencingToken: number;
      runId: string;
    };
    expect(claim.runId).toBe(created.id);

    const heartbeat = await app.request(`/api/v1/runners/${registration.runnerId}/heartbeat`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify({ health: 'healthy', activeJobIds: [claim.jobId] }),
    });
    expect(heartbeat.status).toBe(200);

    const eventBatch = {
      events: [
        {
          eventId: 'event-1',
          type: 'test.started',
          sequence: 1,
          payload: { testId: 'test-1', title: 'Smoke test', status: 'running' },
        },
        {
          eventId: 'event-2',
          type: 'test.completed',
          sequence: 2,
          payload: { testId: 'test-1', title: 'Smoke test', status: 'passed', durationMs: 12 },
        },
      ],
      nextSequence: 3,
      terminal: false,
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
    };
    const eventResponse = await app.request(`/api/v1/jobs/${claim.jobId}/events`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify(eventBatch),
    });
    expect(eventResponse.status).toBe(202);
    const duplicate = await app.request(`/api/v1/jobs/${claim.jobId}/events`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        events: [
          {
            eventId: 'event-1',
            type: 'test.started',
            sequence: 1,
            payload: { testId: 'test-1', title: 'Smoke test', status: 'running' },
          },
        ],
        nextSequence: 2,
        terminal: false,
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
      }),
    });
    expect(duplicate.status).toBe(202);
    expect(((await duplicate.json()) as { duplicate: boolean }).duplicate).toBe(true);

    const artifactResponse = await app.request(`/api/v1/jobs/${claim.jobId}/artifacts`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'screenshot',
        name: 'smoke.png',
        bytes: 'aGVsbG8=',
        sizeBytes: 5,
        checksum: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
      }),
    });
    expect(artifactResponse.status).toBe(201);
    const artifact = (await artifactResponse.json()) as {
      id: string;
      sizeBytes: number;
      checksum: string;
    };
    expect(artifact.sizeBytes).toBe(5);
    expect(artifact.checksum).toHaveLength(64);
    const downloadResponse = await app.request(
      `/api/v1/runs/${created.id}/artifacts/${artifact.id}`,
    );
    expect(downloadResponse.status).toBe(200);
    expect(await downloadResponse.text()).toBe('hello');
    expect((await app.request('/api/v1/quality-policies')).status).toBe(200);
    expect((await app.request('/api/v1/releases/release-1/readiness')).status).toBe(200);

    const completeResponse = await app.request(`/api/v1/jobs/${claim.jobId}/complete`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'passed',
        outcome: 'passed',
        phase: 'complete',
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        summary: { total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, blocked: 0, unknown: 0 },
        artifacts: [artifact.id],
      }),
    });
    expect(completeResponse.status).toBe(200);
    expect(
      ((await completeResponse.json()) as { phase: string; outcome: string | null }).outcome,
    ).toBe('passed');

    const detailResponse = await app.request(`/api/v1/runs/${created.id}`);
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      tests: unknown[];
      artifacts: unknown[];
      summary: { passed: number };
    };
    expect(detail.tests).toHaveLength(1);
    expect(detail.artifacts).toHaveLength(1);
    expect(detail.summary.passed).toBe(1);

    const gateResponse = await app.request(`/api/v1/runs/${created.id}/gate`);
    expect(gateResponse.status).toBe(200);
    const gate = (await gateResponse.json()) as { status: string };
    expect(gate.status).toBe('passed');
    const readiness = await store.getReleaseReadiness('workspace-1', 'release-1');
    expect(readiness.decision).toBe('ready');
    expect(readiness.browser).toBe('passed');
  });

  it('cancels and retries with linked attempt metadata', async () => {
    const store = new InMemoryExecutionStore();
    const app = createExecutionRoutes({ store, requireIdempotencyKey: true });
    const created = (await (
      await app.request('/api/v1/runs', requestBody(runBody('cancel-key')))
    ).json()) as { id: string };
    const cancelled = await app.request(`/api/v1/runs/${created.id}/cancel`, { method: 'POST' });
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as { phase: string }).phase).toBe('cancelled');

    const retryResponse = await app.request(`/api/v1/runs/${created.id}/retry`, {
      method: 'POST',
      headers: { 'idempotency-key': 'retry-key' },
    });
    expect(retryResponse.status).toBe(202);
    const retry = (await retryResponse.json()) as {
      attempt: number;
      retryOfRunId: string;
      phase: string;
    };
    expect(retry.attempt).toBe(2);
    expect(retry.retryOfRunId).toBe(created.id);
    expect(retry.phase).toBe('queued');
  });

  it('requeues expired leases and exposes maturity', async () => {
    const store = new InMemoryExecutionStore({ leaseMs: 20 });
    const app = createExecutionRoutes({ store, registrationSecret: 'registration-secret' });
    await app.request('/api/v1/runs', requestBody(runBody('lease-key')));
    const registration = await registerRunner(app, 'runner-lease');
    const claimResponse = await app.request(`/api/v1/runners/${registration.runnerId}/jobs/claim`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: ['playwright'], labels: ['reference'] }),
    });
    expect(claimResponse.status).toBe(200);
    expect(
      (await store.reapExpiredLeases(new Date(Date.now() + 120_000))).map((job) => job.requeued),
    ).toEqual([true]);
    const maturity = await app.request('/api/v1/integrations/maturity');
    expect(maturity.status).toBe(200);
    const body = (await maturity.json()) as { integrations: unknown[] };
    expect(body.integrations.length).toBeGreaterThan(5);
    expect(listIntegrationMaturity().some((item) => item.id === 'playwright-test')).toBe(true);
  });

  it('exercises direct store idempotency, leases, evidence, policies, and compatibility aliases', async () => {
    let clock = new Date('2026-01-01T00:00:00.000Z');
    const store = new InMemoryExecutionStore({ now: () => clock, leaseMs: 10, tokenTtlMs: 1000 });
    const input = {
      externalId: 'direct-run',
      source: 'api',
      testType: 'browser',
      selection: ['smoke.spec.ts'],
      requiredCapabilities: ['playwright'],
      labels: ['reference'],
      configuration: { targetUrl: 'http://127.0.0.1:5173' },
    };
    await expect(store.createRun(input, ' ')).rejects.toThrow();
    const created = await store.createRun(input, 'direct-key', 'workspace-direct');
    expect((await store.createRun(input, 'direct-key', 'workspace-direct')).duplicate).toBe(true);
    expect((await store.getRun(created.run.id, 'workspace-direct'))?.id).toBe(created.run.id);
    expect((await store.list('workspace-direct')).length).toBe(1);
    expect((await store.listRuns('workspace-direct', 'release-direct')).length).toBe(0);
    const job = await store.getJob(created.job.id);
    expect(job?.state).toBe('queued');
    expect((await store.listJobs('workspace-direct')).length).toBe(1);

    const token = createRunnerToken();
    const manifest = {
      id: 'direct-runner',
      name: 'Runner',
      version: '1',
      os: 'linux',
      arch: 'x64',
      capabilities: ['playwright'],
      labels: ['reference'],
      slots: 1,
    };
    const runner = await store.registerRunner(
      manifest,
      hashRunnerToken(token),
      new Date(clock.getTime() + 1000).toISOString(),
      'workspace-direct',
    );
    expect((await store.getRunner(runner.id))?.name).toBe('Runner');
    expect((await store.authenticateRunner(token))?.id).toBe(runner.id);
    expect(await store.authenticateRunner('wrong-token')).toBeNull();
    const heartbeat = await store.heartbeatRunner(runner.id, [], 'degraded');
    expect(heartbeat?.health).toBe('degraded');
    const claim = await store.claimJob(runner.id, [], [], clock);
    expect(claim?.jobId).toBe(created.job.id);
    expect(await store.claimJob(runner.id, [], [], clock)).toBeNull();

    const event = {
      eventId: 'direct-event',
      type: 'run.phase',
      sequence: 1,
      payload: { phase: 'running', outcome: null },
    };
    expect(
      (await store.appendEvents(claim!.jobId, claim!.leaseId, claim!.fencingToken, [event]))[0]
        ?.status,
    ).toBe('accepted');
    expect((await store.listEvents(created.run.id)).length).toBe(1);
    expect(
      (await store.appendEvents(claim!.jobId, claim!.leaseId, claim!.fencingToken, [event]))[0]
        ?.status,
    ).toBe('duplicate');
    expect(
      (
        await store.appendEvents(claim!.jobId, claim!.leaseId, claim!.fencingToken, [
          { ...event, sequence: 2 },
        ])
      )[0]?.status,
    ).toBe('conflict');
    const artifact = await store.addArtifact({
      runId: created.run.id,
      jobId: created.job.id,
      testId: null,
      kind: 'raw_report',
      name: 'report.json',
      contentType: 'application/json',
      storageKey: `runs/${created.run.id}/report.json`,
      expiresAt: null,
      legalHold: false,
      metadata: {},
      bytes: new TextEncoder().encode('{}'),
    });
    expect(artifact.checksum).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
    expect((await store.getArtifact(artifact.id))?.bytes.byteLength).toBe(2);
    expect((await store.listArtifacts(created.run.id)).length).toBe(1);
    const completion = await store.completeJob(claim!.jobId, {
      leaseId: claim!.leaseId,
      fencingToken: claim!.fencingToken,
      status: 'passed',
      phase: 'complete',
      outcome: 'passed',
    });
    expect(completion?.status).toBe('accepted');
    expect(
      (
        await store.completeJob(claim!.jobId, {
          leaseId: claim!.leaseId,
          fencingToken: claim!.fencingToken,
          status: 'passed',
          phase: 'complete',
          outcome: 'passed',
        })
      )?.status,
    ).toBe('duplicate');
    expect(
      await store.completeJob(claim!.jobId, {
        leaseId: claim!.leaseId,
        fencingToken: claim!.fencingToken,
        status: 'failed',
        phase: 'complete',
        outcome: 'failed',
      }),
    ).toBeNull();

    const policy = await store.createPolicy({
      workspaceId: 'workspace-direct',
      name: 'Direct policy',
      version: '1',
      requiredDomains: ['browser'],
      browserPassRateThreshold: 0.8,
      maxFlakyRate: 0.1,
      maxDurationMs: null,
      rules: [],
    });
    expect((await store.getPolicy(policy.id, 'workspace-direct'))?.name).toBe('Direct policy');
    expect((await store.listPolicies('workspace-direct')).length).toBeGreaterThanOrEqual(1);
    const gate = await store.getReadiness('release-direct', 'workspace-direct');
    expect(gate.decision).toBe('unknown');
    expect((await store.getReleaseReadiness('workspace-direct', 'release-direct')).releaseId).toBe(
      'release-direct',
    );
    const retried = await store.retry(created.run.id, 'workspace-direct', 'retry-direct');
    expect(retried?.run.attempt).toBe(2);
    expect((await store.cancel(retried!.run.id, 'workspace-direct'))?.phase).toBe('cancelled');
    const alias = await store.create(input, 'alias-key', 'workspace-direct');
    expect((await store.get(alias.run.id, 'workspace-direct'))?.id).toBe(alias.run.id);
    expect((await store.cancel(alias.run.id, 'workspace-direct'))?.phase).toBe('cancelled');
    expect(await store.getRun(alias.run.id, 'workspace-direct')).not.toBeNull();
    clock = new Date(clock.getTime() + 1000);
  });

  it('projects legacy runs, accepts bearer registration, and normalizes artifact kinds', async () => {
    const legacy = new InMemoryRunRepository();
    for (const status of ['running', 'passed', 'failed', 'interrupted'] as const) {
      await legacy.upsertRun({
        id: `legacy-${status}`,
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: status === 'running' ? null : '2026-01-01T00:00:01.000Z',
        status,
        total: 1,
        passed: status === 'passed' ? 1 : 0,
        failed: status === 'failed' ? 1 : 0,
        flaky: 0,
        skipped: 0,
        durationMs: 1,
        branch: 'main',
        commitSha: 'abc',
        triggeredBy: 'test',
      });
    }
    const store = new InMemoryExecutionStore();
    const app = createExecutionRoutes({
      store,
      legacyRepository: legacy,
      registrationSecret: 'secret',
    });
    const list = await app.request('/api/v1/runs');
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown[]).toHaveLength(4);
    const registration = await app.request('/api/v1/runners/register', {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify({
        runnerId: 'legacy-runner',
        name: 'legacy',
        capabilities: ['playwright'],
      }),
    });
    expect(registration.status).toBe(201);
    const registrationBody = (await registration.json()) as { token: string };
    await app.request('/api/v1/runs', requestBody(runBody('legacy-new')));
    const claimResponse = await app.request('/api/v1/runners/legacy-runner/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${registrationBody.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ capabilities: ['playwright'], labels: ['reference'] }),
    });
    expect(claimResponse.status, await claimResponse.clone().text()).toBe(200);
    const claim = (await claimResponse.json()) as {
      jobId: string;
      leaseId: string;
      fencingToken: number;
    };
    for (const kind of [
      'raw_report',
      'playwright-json',
      'junit',
      'html-report',
      'event-log',
      'unknown',
    ]) {
      const response = await app.request(`/api/v1/jobs/${claim.jobId}/artifacts`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${registrationBody.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          kind,
          name: `${kind}.bin`,
          contentBase64: 'eA==',
          leaseId: claim.leaseId,
          fencingToken: claim.fencingToken,
        }),
      });
      expect(response.status).toBe(201);
    }
  });

  it('handles terminal event conflicts, duplicate completion, and policy/readiness filters', async () => {
    const store = new InMemoryExecutionStore();
    const app = createExecutionRoutes({
      store,
      registrationSecret: 'registration-secret',
      workspaceId: 'workspace-edge',
    });
    const registration = await registerRunner(app, 'edge-runner');
    const createdResponse = await app.request('/api/v1/runs', requestBody(runBody('edge-key')));
    const created = (await createdResponse.json()) as { id: string };
    const claimResponse = await app.request(`/api/v1/runners/${registration.runnerId}/jobs/claim`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: ['playwright'], labels: ['reference'] }),
    });
    const claim = (await claimResponse.json()) as {
      jobId: string;
      leaseId: string;
      fencingToken: number;
    };
    const terminal = await app.request(`/api/v1/jobs/${claim.jobId}/events`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        events: [
          {
            eventId: 'terminal',
            type: 'run.completed',
            sequence: 1,
            payload: { phase: 'complete', outcome: 'passed' },
          },
        ],
      }),
    });
    expect(terminal.status).toBe(202);
    const afterTerminal = await app.request(`/api/v1/jobs/${claim.jobId}/events`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        events: [{ eventId: 'after-terminal', type: 'run.started', sequence: 2 }],
      }),
    });
    expect(afterTerminal.status).toBe(409);
    const completion = await app.request(`/api/v1/jobs/${claim.jobId}/complete`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        status: 'passed',
        phase: 'complete',
        outcome: 'passed',
      }),
    });
    expect(completion.status).toBe(200);
    const policy = await app.request('/api/v1/quality-policies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'edge-policy',
        version: '1',
        requiredDomains: ['browser'],
        rules: [],
      }),
    });
    expect(policy.status).toBe(201);
    expect((await app.request('/api/v1/quality-policies')).status).toBe(200);
    expect((await app.request('/api/v1/runs?releaseId=release-1')).status).toBe(200);
    expect((await app.request(`/api/v1/runs/${created.id}/events`)).status).toBe(200);
    expect((await app.request('/api/v1/releases/release-1/readiness')).status).toBe(200);
  });

  it('rejects malformed requests and stale runner actions', async () => {
    const store = new InMemoryExecutionStore();
    const app = createExecutionRoutes({
      store,
      requireIdempotencyKey: true,
      registrationSecret: 'registration-secret',
    });
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
          body: JSON.stringify(runBody('')),
        })
      ).status,
    ).toBe(400);
    expect((await app.request('/api/v1/runs/missing')).status).toBe(404);
    expect((await app.request('/api/v1/runs/missing/artifacts')).status).toBe(404);
    expect((await app.request('/api/v1/runs/missing/gate')).status).toBe(404);
    expect((await app.request('/api/v1/runs/missing/events')).status).toBe(404);
    expect((await app.request('/api/v1/runs/missing/cancel', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/v1/runs/missing/retry', { method: 'POST' })).status).toBe(409);
    expect((await app.request('/api/v1/artifacts/missing')).status).toBe(404);
    expect(
      (
        await app.request('/api/v1/quality-policies', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"name":1}',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request('/api/v1/runners/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ capabilities: ['playwright'], labels: ['reference'] }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request('/api/v1/runners/register', {
          method: 'POST',
          headers: {
            'x-runner-registration-secret': 'registration-secret',
            'content-type': 'application/json',
          },
          body: '{"name":1}',
        })
      ).status,
    ).toBe(400);

    const registration = await registerRunner(app, 'error-runner');
    const badToken = await app.request('/api/v1/runners/error-runner/heartbeat', {
      method: 'POST',
      headers: { authorization: 'Bearer invalid', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(badToken.status).toBe(401);
    const badHeartbeat = await app.request('/api/v1/runners/error-runner/heartbeat', {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: '{}',
    });
    expect(badHeartbeat.status).toBe(200);
    const badClaim = await app.request('/api/v1/runners/error-runner/jobs/claim', {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: '{"capabilities": 1}',
    });
    expect(badClaim.status).toBe(400);
    const noJobClaim = await app.request('/api/v1/runners/error-runner/jobs/claim', {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: '{}',
    });
    expect(noJobClaim.status).toBe(204);
    const badEvents = await app.request('/api/v1/jobs/missing/events', {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: '{}',
    });
    expect(badEvents.status).toBe(400);
    const badArtifact = await app.request('/api/v1/jobs/missing/artifacts', {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: '{"name":1}',
    });
    expect(badArtifact.status).toBe(400);
    const badCompletion = await app.request('/api/v1/jobs/missing/complete', {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: '{}',
    });
    expect(badCompletion.status).toBe(400);
  });

  it('normalizes artifact kinds and terminal infrastructure outcomes', async () => {
    const store = new InMemoryExecutionStore();
    const source = store;
    const created = await source.createRun(
      { releaseId: 'release-states' },
      'states-key',
      'workspace-states',
    );
    const job = created.job;
    const kinds = [
      'raw_report',
      'playwright-json',
      'html-report',
      'event-log',
      'log',
      'stdout',
      'stderr',
      'video',
      'trace',
      'other',
    ];
    for (const [index, kind] of kinds.entries()) {
      const artifact = await source.addArtifact({
        runId: created.run.id,
        jobId: job.id,
        testId: null,
        kind,
        name: `${kind}.bin`,
        contentType: 'application/octet-stream',
        storageKey: `runs/${created.run.id}/${index}`,
        expiresAt: null,
        legalHold: false,
        metadata: {},
        bytes: new Uint8Array([index]),
      });
      expect(artifact.kind).not.toBe(kind === 'raw_report' ? 'raw_report' : '');
    }
    for (const [index, status] of [
      'cancelled',
      'timed_out',
      'runner_lost',
      'infra_failed',
      'config_failed',
      'blocked',
      'partial',
    ].entries()) {
      const state = await source.createRun(
        { releaseId: `release-${index}` },
        `state-${index}`,
        'workspace-states',
      );
      const result = await source.completeJob(state.job.id, {
        leaseId: 'missing',
        fencingToken: 1,
        status,
        outcome: status as never,
      });
      expect(result).toBeNull();
    }
  });

  it('evaluates missing evidence as unknown', () => {
    const result = evaluateQualityGate({
      run: { outcome: null, tests: [], artifacts: [] },
      policy: defaultPolicy('workspace-1'),
    });
    expect(result.status).toBe('unknown');
    expect(result.decision).toBe('not_ready');
  });
});
