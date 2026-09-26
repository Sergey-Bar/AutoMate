import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createExecutionRoutes } from '../routes/execution.js';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';

const REGISTRATION_SECRET = 'registration-secret';

function runBody(idempotencyKey: string): Record<string, unknown> {
  return {
    externalId: `external-${idempotencyKey}`,
    source: 'api',
    testType: 'browser',
    framework: 'playwright',
    timeoutMs: 60_000,
    requiredCapabilities: ['playwright'],
    labels: ['reference'],
    configuration: {},
    idempotencyKey,
  };
}

async function registerRunner(
  app: Hono,
  id: string,
  slots = 2,
): Promise<{ runnerId: string; token: string }> {
  const response = await app.request('/api/v1/runners/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-registration-secret': REGISTRATION_SECRET,
    },
    body: JSON.stringify({
      runnerId: id,
      name: id,
      version: '1.0.0',
      os: 'linux',
      arch: 'x64',
      capabilities: ['playwright'],
      labels: ['reference'],
      slots,
    }),
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ runnerId: string; token: string }>;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function build(store: InMemoryExecutionStore, workspaceId: string): Hono {
  return createExecutionRoutes({
    store,
    workspaceId,
    requireIdempotencyKey: true,
    registrationSecret: REGISTRATION_SECRET,
  });
}

async function createRun(app: Hono, key: string): Promise<string> {
  const response = await app.request('/api/v1/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(runBody(key)),
  });
  expect(response.status).toBe(202);
  return ((await response.json()) as { id: string }).id;
}

async function claim(
  app: Hono,
  runnerId: string,
  token: string,
): Promise<{ jobId: string; runId: string; leaseId: string; fencingToken: number }> {
  const response = await app.request(`/api/v1/runners/${runnerId}/jobs/claim`, {
    method: 'POST',
    headers: { ...auth(token), 'content-type': 'application/json' },
    body: JSON.stringify({ capabilities: ['playwright'], labels: ['reference'] }),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    jobId: string;
    runId: string;
    leaseId: string;
    fencingToken: number;
  }>;
}

function eventBatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    events: [
      {
        eventId: 'attacker-event',
        type: 'run.completed',
        sequence: 1,
        payload: { phase: 'complete', outcome: 'passed' },
      },
    ],
    ...overrides,
  };
}

describe('runner lease credentials are required, never inferred', () => {
  it('rejects a batch that omits the lease id and fencing token', async () => {
    const store = new InMemoryExecutionStore();
    const app = build(store, 'workspace-1');
    const registration = await registerRunner(app, 'runner-1');
    const runId = await createRun(app, 'key-1');
    const claimed = await claim(app, registration.runnerId, registration.token);

    const response = await app.request(`/api/v1/jobs/${claimed.jobId}/events`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify(eventBatch()),
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('JOB_LEASE_REQUIRED');
    expect(await store.listEvents(runId)).toEqual([]);
  });

  it('rejects a batch that presents only one of the two credentials', async () => {
    const store = new InMemoryExecutionStore();
    const app = build(store, 'workspace-1');
    const registration = await registerRunner(app, 'runner-1');
    await createRun(app, 'key-1');
    const claimed = await claim(app, registration.runnerId, registration.token);

    const onlyLease = await app.request(`/api/v1/jobs/${claimed.jobId}/events`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify(eventBatch({ leaseId: claimed.leaseId })),
    });
    expect(onlyLease.status).toBe(409);
    expect(((await onlyLease.json()) as { error: { code: string } }).error.code).toBe(
      'JOB_LEASE_REQUIRED',
    );

    const onlyToken = await app.request(`/api/v1/jobs/${claimed.jobId}/events`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify(eventBatch({ fencingToken: claimed.fencingToken })),
    });
    expect(onlyToken.status).toBe(409);
    expect(((await onlyToken.json()) as { error: { code: string } }).error.code).toBe(
      'JOB_LEASE_REQUIRED',
    );
  });

  it('rejects a batch whose credentials belong to a different lease', async () => {
    const store = new InMemoryExecutionStore();
    const app = build(store, 'workspace-1');
    const registration = await registerRunner(app, 'runner-1');
    await createRun(app, 'key-1');
    const claimed = await claim(app, registration.runnerId, registration.token);

    const staleLease = await app.request(`/api/v1/jobs/${claimed.jobId}/events`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify(
        eventBatch({ leaseId: 'forged-lease', fencingToken: claimed.fencingToken }),
      ),
    });
    expect(staleLease.status).toBe(409);
    expect(((await staleLease.json()) as { error: { code: string } }).error.code).toBe(
      'JOB_LEASE_INVALID',
    );

    const staleToken = await app.request(`/api/v1/jobs/${claimed.jobId}/events`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify(
        eventBatch({ leaseId: claimed.leaseId, fencingToken: claimed.fencingToken + 99 }),
      ),
    });
    expect(staleToken.status).toBe(409);
    expect(((await staleToken.json()) as { error: { code: string } }).error.code).toBe(
      'JOB_FENCING_STALE',
    );
  });

  it('rejects an event batch addressed to a job that does not exist', async () => {
    const app = build(new InMemoryExecutionStore(), 'workspace-1');
    const registration = await registerRunner(app, 'runner-1');

    const response = await app.request('/api/v1/jobs/00000000-0000-4000-8000-000000000000/events', {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify(eventBatch({ leaseId: 'lease', fencingToken: 1 })),
    });

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'JOB_NOT_FOUND',
    );
  });
});

describe('a runner cannot write into another runner lease', () => {
  it('rejects events from a runner that does not own the job', async () => {
    const store = new InMemoryExecutionStore();
    const app = build(store, 'workspace-1');
    const owner = await registerRunner(app, 'runner-owner');
    const intruder = await registerRunner(app, 'runner-intruder');
    const runId = await createRun(app, 'key-1');
    const claimed = await claim(app, owner.runnerId, owner.token);

    const response = await app.request(`/api/v1/jobs/${claimed.jobId}/events`, {
      method: 'POST',
      headers: { ...auth(intruder.token), 'content-type': 'application/json' },
      body: JSON.stringify(
        eventBatch({ leaseId: claimed.leaseId, fencingToken: claimed.fencingToken }),
      ),
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'JOB_LEASE_NOT_OWNED',
    );
    const run = await store.getRun(runId, 'workspace-1');
    expect(run?.outcome).toBeNull();
    expect(run?.phase).not.toBe('complete');
  });

  it('rejects completion from a runner that does not own the job', async () => {
    const store = new InMemoryExecutionStore();
    const app = build(store, 'workspace-1');
    const owner = await registerRunner(app, 'runner-owner');
    const intruder = await registerRunner(app, 'runner-intruder');
    const runId = await createRun(app, 'key-1');
    const claimed = await claim(app, owner.runnerId, owner.token);

    const response = await app.request(`/api/v1/jobs/${claimed.jobId}/complete`, {
      method: 'POST',
      headers: { ...auth(intruder.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        leaseId: claimed.leaseId,
        fencingToken: claimed.fencingToken,
        status: 'passed',
        outcome: 'passed',
      }),
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'JOB_LEASE_NOT_OWNED',
    );
    const run = await store.getRun(runId, 'workspace-1');
    expect(run?.outcome).toBeNull();
  });

  it('rejects an artifact upload from a runner that does not own the job', async () => {
    const store = new InMemoryExecutionStore();
    const app = build(store, 'workspace-1');
    const owner = await registerRunner(app, 'runner-owner');
    const intruder = await registerRunner(app, 'runner-intruder');
    await createRun(app, 'key-1');
    const claimed = await claim(app, owner.runnerId, owner.token);

    const response = await app.request(`/api/v1/jobs/${claimed.jobId}/artifacts`, {
      method: 'POST',
      headers: { ...auth(intruder.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'screenshot',
        name: 'intruder.png',
        bytes: 'aGVsbG8=',
        sizeBytes: 5,
      }),
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'JOB_LEASE_NOT_OWNED',
    );
  });
});

describe('write-path store methods honour the workspace scope', () => {
  it('does not return a job that belongs to another workspace', async () => {
    const store = new InMemoryExecutionStore();
    const scopeA = build(store, 'workspace-a');
    const scopeB = build(store, 'workspace-b');
    await createRun(scopeA, 'key-a');
    const registration = await registerRunner(scopeA, 'runner-a');
    const claimed = await claim(scopeA, registration.runnerId, registration.token);

    expect(await store.getJob(claimed.jobId, 'workspace-a')).not.toBeNull();
    expect(await store.getJob(claimed.jobId, 'workspace-b')).toBeNull();

    // Scope B's runner sees an empty queue, and its own tokens are refused.
    const scopeBRegistration = await registerRunner(scopeB, 'runner-b');
    const foreign = await scopeB.request(`/api/v1/jobs/${claimed.jobId}/events`, {
      method: 'POST',
      headers: { ...auth(scopeBRegistration.token), 'content-type': 'application/json' },
      body: JSON.stringify(
        eventBatch({ leaseId: claimed.leaseId, fencingToken: claimed.fencingToken }),
      ),
    });
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe(
      'JOB_NOT_FOUND',
    );
  });

  it('does not append events, complete jobs, or read artifacts across workspaces', async () => {
    const store = new InMemoryExecutionStore();
    const app = build(store, 'workspace-a');
    await createRun(app, 'key-a');
    const registration = await registerRunner(app, 'runner-a');
    const claimed = await claim(app, registration.runnerId, registration.token);

    expect(
      await store.appendEvents(
        claimed.jobId,
        claimed.leaseId,
        claimed.fencingToken,
        [
          {
            eventId: 'cross-workspace',
            type: 'run.started',
            sequence: 1,
            payload: {},
          },
        ],
        'workspace-b',
      ),
    ).toEqual([
      {
        eventId: 'cross-workspace',
        sequence: 1,
        status: 'conflict',
        reason: 'stale_lease',
      },
    ]);

    expect(
      await store.completeJob(
        claimed.jobId,
        { leaseId: claimed.leaseId, fencingToken: claimed.fencingToken, outcome: 'passed' },
        'workspace-b',
      ),
    ).toBeNull();

    const artifact = await store.addArtifact({
      runId: claimed.runId,
      jobId: claimed.jobId,
      testId: null,
      kind: 'log',
      name: 'run.log',
      contentType: 'text/plain',
      storageKey: 'runs/a/1-run.log',
      expiresAt: null,
      legalHold: false,
      metadata: {},
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(await store.getArtifact(artifact.id, 'workspace-a')).not.toBeNull();
    expect(await store.getArtifact(artifact.id, 'workspace-b')).toBeNull();
    expect(await store.getArtifactDescriptor?.(artifact.id, 'workspace-b')).toBeNull();
  });

  it('does not claim another workspace job and does not read another workspace gate', async () => {
    const store = new InMemoryExecutionStore();
    const scopeA = build(store, 'workspace-a');
    const scopeB = build(store, 'workspace-b');
    const runIdA = await createRun(scopeA, 'key-a');
    const registrationA = await registerRunner(scopeA, 'runner-a');

    const registrationB = await registerRunner(scopeB, 'runner-b');
    expect(
      await store.claimJob(registrationB.runnerId, [], [], undefined, 'workspace-b'),
    ).toBeNull();
    expect(
      await store.claimJob(registrationA.runnerId, [], [], undefined, 'workspace-a'),
    ).not.toBeNull();

    expect(await store.getRunGate('workspace-a', runIdA)).toBeNull();
    const evaluation = await store.saveGate({
      id: 'eval-1',
      runId: runIdA,
      releaseId: null,
      policyId: 'policy-1',
      policyVersion: '1',
      policyHash: 'hash-1',
      status: 'passed',
      decision: 'ready',
      reasons: [],
      evidenceRefs: [],
      domainStatuses: {
        browser: 'passed',
        api: 'not_configured',
        mobile: 'not_configured',
        performance: 'not_configured',
        security: 'not_configured',
        accessibility: 'not_configured',
        other: 'not_configured',
      },
      evaluatedAt: new Date().toISOString(),
    });
    expect(evaluation.runId).toBe(runIdA);
    expect((await store.getRunGate('workspace-a', runIdA))?.runId).toBe(runIdA);
    expect(await store.getRunGate('workspace-b', runIdA)).toBeNull();
  });
});

describe('runner credential rotation', () => {
  it('refuses to re-register an existing runner id without a rotation proof', async () => {
    const app = build(new InMemoryExecutionStore(), 'workspace-1');
    await registerRunner(app, 'runner-1');

    // Same registration secret, same id, no proof: this used to hand out a
    // fresh token and let the caller impersonate the runner.
    const response = await app.request('/api/v1/runners/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-runner-registration-secret': REGISTRATION_SECRET,
      },
      body: JSON.stringify({
        runnerId: 'runner-1',
        name: 'impostor',
        version: '1.0.0',
        os: 'linux',
        arch: 'x64',
        capabilities: ['playwright'],
        labels: ['reference'],
        slots: 2,
      }),
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'RUNNER_ID_TAKEN',
    );
  });

  it('refuses a rotation proof that authenticates a different runner', async () => {
    const app = build(new InMemoryExecutionStore(), 'workspace-1');
    await registerRunner(app, 'runner-1');
    const other = await registerRunner(app, 'runner-2');

    const response = await app.request('/api/v1/runners/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-runner-registration-secret': REGISTRATION_SECRET,
      },
      body: JSON.stringify({
        runnerId: 'runner-1',
        name: 'runner-1',
        version: '1.0.0',
        os: 'linux',
        arch: 'x64',
        capabilities: ['playwright'],
        labels: ['reference'],
        slots: 2,
        rotationToken: other.token,
      }),
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'RUNNER_ROTATION_UNAUTHORIZED',
    );
  });

  it('rotates the credential when the runner proves possession of its token', async () => {
    const store = new InMemoryExecutionStore();
    const app = build(store, 'workspace-1');
    const first = await registerRunner(app, 'runner-1');

    const rotated = await app.request('/api/v1/runners/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-runner-registration-secret': REGISTRATION_SECRET,
      },
      body: JSON.stringify({
        runnerId: 'runner-1',
        name: 'runner-1',
        version: '1.1.0',
        os: 'linux',
        arch: 'x64',
        capabilities: ['playwright'],
        labels: ['reference'],
        slots: 2,
        rotationToken: first.token,
      }),
    });

    expect(rotated.status).toBe(201);
    const second = (await rotated.json()) as { runnerId: string; token: string };
    expect(second.token).not.toBe(first.token);
    expect(await store.authenticateRunner(first.token)).toBeNull();
    expect((await store.authenticateRunner(second.token))?.id).toBe('runner-1');
  });
});

describe('completion payload validation', () => {
  it('rejects a summary whose counters are not integers instead of 500-ing on the write', async () => {
    const app = build(new InMemoryExecutionStore(), 'workspace-1');
    const registration = await registerRunner(app, 'runner-1');
    await createRun(app, 'key-1');
    const claimed = await claim(app, registration.runnerId, registration.token);

    const response = await app.request(`/api/v1/jobs/${claimed.jobId}/complete`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        leaseId: claimed.leaseId,
        fencingToken: claimed.fencingToken,
        status: 'passed',
        summary: { total: 'many', passed: 3 },
      }),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'INVALID_COMPLETION',
    );
  });

  it('rejects a negative counter in the summary', async () => {
    const app = build(new InMemoryExecutionStore(), 'workspace-1');
    const registration = await registerRunner(app, 'runner-1');
    await createRun(app, 'key-1');
    const claimed = await claim(app, registration.runnerId, registration.token);

    const response = await app.request(`/api/v1/jobs/${claimed.jobId}/complete`, {
      method: 'POST',
      headers: { ...auth(registration.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        leaseId: claimed.leaseId,
        fencingToken: claimed.fencingToken,
        status: 'passed',
        summary: { total: 3, passed: -1 },
      }),
    });

    expect(response.status).toBe(400);
  });
});
