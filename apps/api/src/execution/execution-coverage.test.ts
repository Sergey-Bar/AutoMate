import { describe, expect, it } from 'vitest';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { Hono } from 'hono';
import { createExecutionRoutes } from '../routes/execution.js';
import { createAgentRoutes } from '../routes/agents.js';
import { createHealthRoutes } from '../routes/health.js';
import { InMemoryExecutionStore, hashRunnerToken } from './in-memory-execution-store.js';
import { createGateEvaluation, defaultPolicy, policyDigest } from './quality-gate.js';
import { integrationMaturity, listIntegrationMaturity } from './maturity.js';
import { createErrorBoundary } from '../errors/boundary.js';

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
  const app = mounted(
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
    expect(await store.getGate('branch-workspace', 'missing')).toBeNull();
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
    const app = mounted(
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
    const app = mounted(createExecutionRoutes({ store }));
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
    expect((await store.listEvents('branch-workspace', created.run.id)).events).toHaveLength(0);
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
    /**
     * What a completed job's outcome does to the run.
     *
     * This table used to be an `expect(result).not.toBeNull()` per status. A loop
     * like that exists to move the V8 counter, and it would pass just as happily
     * if `completeJob` reported `passed` for a run that reported `failed` — the
     * one thing `phase-outcome.ts` exists to make impossible.
     *
     * `completeJob` is a *completion*, so the run lands on the `complete` phase
     * and the outcome is the one the completion named. Only two of them are
     * `passed`; everything else is `failed`, including `unknown` and
     * `interrupted`-shaped verdicts. That is the mapping, stated.
     */
    const completionOutcomes: ReadonlyArray<{ outcome: string; persistedStatus: string }> = [
      { outcome: 'passed', persistedStatus: 'passed' },
      { outcome: 'failed', persistedStatus: 'failed' },
      { outcome: 'partial', persistedStatus: 'failed' },
      { outcome: 'unknown', persistedStatus: 'failed' },
      { outcome: 'blocked', persistedStatus: 'failed' },
      { outcome: 'cancelled', persistedStatus: 'failed' },
      { outcome: 'timed_out', persistedStatus: 'failed' },
      { outcome: 'runner_lost', persistedStatus: 'failed' },
      { outcome: 'infra_failed', persistedStatus: 'failed' },
      { outcome: 'config_failed', persistedStatus: 'failed' },
    ];

    for (const [index, expected] of completionOutcomes.entries()) {
      const created = await store.createRun(
        { requiredCapabilities: ['playwright'], releaseId: `release-${index}` },
        `state-${index}`,
        'branch-workspace',
      );
      const claim = await store.claimJob(runner.id, ['playwright'], [], now);
      expect(claim, `a claim for release-${index}`).not.toBeNull();
      await store.appendEvents(created.job.id, claim!.leaseId, claim!.fencingToken, [
        {
          eventId: `test-${index}`,
          type: 'test.completed',
          sequence: 1,
          payload: { testId: `test-${index}`, status: 'passed' },
        },
      ]);
      const result = await store.completeJob(created.job.id, {
        leaseId: claim!.leaseId,
        fencingToken: claim!.fencingToken,
        status: 'passed',
        outcome: expected.outcome as never,
      });
      expect(result, `completion for ${expected.outcome}`).not.toBeNull();
      expect(
        { phase: result!.run.phase, outcome: result!.run.outcome, status: result!.run.status },
        `completion outcome "${expected.outcome}"`,
      ).toEqual({
        phase: 'complete',
        outcome: expected.outcome,
        status: expected.persistedStatus,
      });
    }

    /**
     * The other half: a `run.phase` event naming a terminal phase other than
     * `complete` must be able to reclassify the run, and must be able to do so
     * *only* with its own outcome.
     *
     * A payload claiming `passed` on a `cancelled` run is the injection vector
     * `deriveRunState` was written to close, so it is asserted directly rather
     * than left to the branch coverage of the loop above.
     */
    const terminalPhaseMapping: ReadonlyArray<{ phase: string; outcome: string }> = [
      { phase: 'cancelled', outcome: 'cancelled' },
      { phase: 'timed_out', outcome: 'timed_out' },
      { phase: 'runner_lost', outcome: 'runner_lost' },
      { phase: 'infra_failed', outcome: 'infra_failed' },
      { phase: 'config_failed', outcome: 'config_failed' },
      { phase: 'blocked', outcome: 'blocked' },
      { phase: 'partial', outcome: 'partial' },
    ];

    for (const [offset, expected] of terminalPhaseMapping.entries()) {
      const index = completionOutcomes.length + offset;
      const created = await store.createRun(
        { requiredCapabilities: ['playwright'], releaseId: `release-${index}` },
        `state-${index}`,
        'branch-workspace',
      );
      const claim = await store.claimJob(runner.id, ['playwright'], [], now);
      expect(claim, `a claim for release-${index}`).not.toBeNull();
      await store.appendEvents(created.job.id, claim!.leaseId, claim!.fencingToken, [
        {
          eventId: `phase-${index}`,
          type: 'run.phase',
          sequence: 1,
          // `passed` is on purpose. A non-`complete` terminal phase implies its
          // own outcome and must ignore whatever the payload claims.
          payload: { phase: expected.phase, outcome: 'passed' },
        },
      ]);
      const run = await store.getRun(created.run.id, 'branch-workspace');
      expect(run, `run for ${expected.phase}`).not.toBeNull();
      expect(
        { phase: run!.phase, outcome: run!.outcome, status: run!.status },
        `run.phase event naming ${expected.phase} and claiming passed`,
      ).toEqual({ phase: expected.phase, outcome: expected.outcome, status: 'interrupted' });
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
    /**
     * What each outcome does to a release's readiness: the `browser` domain
     * status, the gate decision, and the reason that decided it.
     *
     * The assertion here used to be `expect(decision).toBeDefined()`, which is
     * true for every outcome including a wrong one — it could not fail on a
     * mis-mapped verdict, and the loop existed to move the V8 counter.
     *
     * Four decision sources, and naming them is the point:
     *
     *  - `passed` with no test behind it is `blocked` on `evidence:NO_TESTS` —
     *    the promise this product makes, which each per-threshold check silently
     *    skips because it sits behind `if (summary.total > 0)`.
     *  - `failed` is `blocked` on `product_failure:TEST_FAILURE`.
     *  - `runner_lost`, `infra_failed` and `config_failed` are `blocked` as
     *    infrastructure, not product: they say the harness broke, so a red build
     *    from them would blame the code under test.
     *  - `cancelled` and `timed_out` are `unknown`. They carry an execution
     *    reason, but not one ending in `RUNNER_INFRASTRUCTURE` or
     *    `CONFIGURATION`, so they do not reach the infrastructure branch and fall
     *    through to "cannot tell". Asserted explicitly because the difference is
     *    the whole reason the reason strings are written the way they are.
     *  - `unknown` and a `null` outcome are `unknown` for the same reason.
     *
     * `partial` is the one that is not a verdict at all: a warning.
     */
    const readinessMapping: ReadonlyArray<{
      outcome: string | null;
      domainStatus: string;
      decision: string;
      reason: string;
    }> = [
      {
        outcome: 'passed',
        domainStatus: 'passed',
        decision: 'blocked',
        reason: 'evidence:NO_TESTS',
      },
      {
        outcome: 'failed',
        domainStatus: 'failed',
        decision: 'blocked',
        reason: 'product_failure:TEST_FAILURE',
      },
      {
        outcome: 'partial',
        domainStatus: 'warning',
        decision: 'ready_with_warnings',
        reason: 'browser:WARNING',
      },
      {
        outcome: 'cancelled',
        domainStatus: 'unknown',
        decision: 'unknown',
        reason: 'cancelled:EXECUTION_CANCELLED',
      },
      {
        outcome: 'timed_out',
        domainStatus: 'unknown',
        decision: 'unknown',
        reason: 'timed_out:EXECUTION_TIMEOUT',
      },
      {
        outcome: 'runner_lost',
        domainStatus: 'unknown',
        decision: 'blocked',
        reason: 'runner_lost:RUNNER_INFRASTRUCTURE',
      },
      {
        outcome: 'infra_failed',
        domainStatus: 'unknown',
        decision: 'blocked',
        reason: 'infra_failed:RUNNER_INFRASTRUCTURE',
      },
      {
        outcome: 'config_failed',
        domainStatus: 'unknown',
        decision: 'blocked',
        reason: 'config_failed:CONFIGURATION',
      },
      {
        outcome: 'unknown',
        domainStatus: 'unknown',
        decision: 'unknown',
        reason: 'browser:UNKNOWN',
      },
      { outcome: null, domainStatus: 'unknown', decision: 'unknown', reason: 'browser:UNKNOWN' },
    ];
    for (const [index, expected] of readinessMapping.entries()) {
      const created = await store.createRun(
        { releaseId: `release-${index}` },
        `readiness-${index}`,
        'readiness-workspace',
      );
      const claim = await store.claimJob(runner.id, ['playwright'], [], now);
      expect(claim, `a claim for release-${index}`).not.toBeNull();
      await store.appendEvents(created.job.id, claim!.leaseId, claim!.fencingToken, [
        {
          eventId: `phase-${index}`,
          type: 'run.phase',
          sequence: 1,
          payload: {
            phase: expected.outcome === null ? 'running' : 'complete',
            outcome: expected.outcome,
          },
        },
      ]);
      await store.completeJob(created.job.id, {
        leaseId: claim!.leaseId,
        fencingToken: claim!.fencingToken,
        status: expected.outcome === 'failed' ? 'failed' : 'passed',
        phase: 'complete',
        outcome: (expected.outcome ?? 'cancelled') as never,
      });
      const readiness = await store.getReadiness(`release-${index}`, 'readiness-workspace');
      expect(
        {
          decision: readiness.decision,
          browser: readiness.browser,
          namesThisRun: readiness.latestRunId === created.run.id,
          reasons: readiness.gate?.reasons ?? [],
        },
        `readiness for outcome ${String(expected.outcome)}`,
      ).toEqual({
        decision: expected.decision,
        browser: expected.domainStatus,
        namesThisRun: true,
        // A reason the assertion names is a reason the gate actually produced; a
        // gate that produced none would have said so in the diff.
        reasons: expect.arrayContaining([expected.reason]),
      });
    }

    // The same `passed` outcome, with a test behind it, is not yet a verdict
    // either: the default policy requires a junit artifact, and a `browser:
    // passed` domain with no evidence refs is refused on
    // `evidence:MISSING_REQUIRED_EVIDENCE`.
    const withEvidence = await store.createRun(
      { releaseId: 'release-with-evidence' },
      'readiness-with-evidence',
      'readiness-workspace',
    );
    const evidenceClaim = await store.claimJob(runner.id, ['playwright'], [], now);
    expect(evidenceClaim).not.toBeNull();
    await store.appendEvents(
      withEvidence.job.id,
      evidenceClaim!.leaseId,
      evidenceClaim!.fencingToken,
      [
        {
          eventId: 'evidence-test',
          type: 'test.completed',
          sequence: 1,
          payload: { testId: 'evidence-test', status: 'passed' },
        },
      ],
    );
    await store.completeJob(withEvidence.job.id, {
      leaseId: evidenceClaim!.leaseId,
      fencingToken: evidenceClaim!.fencingToken,
      status: 'passed',
      phase: 'complete',
      outcome: 'passed',
      summary: { total: 1, passed: 1, failed: 0 },
      tests: [{ id: 'evidence-test', title: 'evidence-test', status: 'passed' }],
    });
    const withoutArtifact = await store.getReadiness(
      'release-with-evidence',
      'readiness-workspace',
    );
    expect({
      decision: withoutArtifact.decision,
      browser: withoutArtifact.browser,
      reasons: withoutArtifact.gate?.reasons ?? [],
    }).toEqual({
      decision: 'unknown',
      browser: 'passed',
      reasons: expect.arrayContaining(['evidence:MISSING_REQUIRED_EVIDENCE']),
    });

    /**
     * A recorded gate is never re-evaluated, so the artifact arriving afterwards
     * does not change the release's answer.
     *
     * Both stores save the gate on the first read and return it unchanged
     * afterwards (`getReadiness` in each: `if (latest && !gate)`). That makes
     * readiness a function of *whichever read happened first*, which is worth
     * stating rather than leaving to chance: a release read by a dashboard poll
     * before its JUnit landed is permanently `unknown`.
     */
    await store.addArtifact({
      runId: withEvidence.run.id,
      jobId: withEvidence.job.id,
      testId: null,
      kind: 'junit',
      name: 'evidence.xml',
      contentType: 'application/xml',
      storageKey: `runs/${withEvidence.run.id}/evidence.xml`,
      expiresAt: null,
      legalHold: false,
      metadata: {},
      bytes: new TextEncoder().encode('<testsuite/>'),
    });
    const stillUnknown = await store.getReadiness('release-with-evidence', 'readiness-workspace');
    expect({
      decision: stillUnknown.decision,
      reasons: stillUnknown.gate?.reasons ?? [],
    }).toEqual({
      decision: 'unknown',
      reasons: expect.arrayContaining(['evidence:MISSING_REQUIRED_EVIDENCE']),
    });

    // So the green path is asserted on a run that has never been read — which is
    // the only way a gate is `ready`. Without this, the mapping above would leave
    // `ready` unasserted and a gate that could never go green would pass.
    const greenRelease = await store.createRun(
      { releaseId: 'release-green' },
      'readiness-green',
      'readiness-workspace',
    );
    const greenClaim = await store.claimJob(runner.id, ['playwright'], [], now);
    expect(greenClaim).not.toBeNull();
    await store.addArtifact({
      runId: greenRelease.run.id,
      jobId: greenRelease.job.id,
      testId: null,
      kind: 'junit',
      name: 'green.xml',
      contentType: 'application/xml',
      storageKey: `runs/${greenRelease.run.id}/green.xml`,
      expiresAt: null,
      legalHold: false,
      metadata: {},
      bytes: new TextEncoder().encode('<testsuite/>'),
    });
    await store.appendEvents(greenRelease.job.id, greenClaim!.leaseId, greenClaim!.fencingToken, [
      {
        eventId: 'green-test',
        type: 'test.completed',
        sequence: 1,
        payload: { testId: 'green-test', status: 'passed' },
      },
    ]);
    await store.completeJob(greenRelease.job.id, {
      leaseId: greenClaim!.leaseId,
      fencingToken: greenClaim!.fencingToken,
      status: 'passed',
      phase: 'complete',
      outcome: 'passed',
      summary: { total: 1, passed: 1, failed: 0 },
      tests: [{ id: 'green-test', title: 'green-test', status: 'passed' }],
    });
    const green = await store.getReadiness('release-green', 'readiness-workspace');
    expect({
      decision: green.decision,
      browser: green.browser,
      reasons: green.gate?.reasons ?? [],
      evidenceRefs: green.gate?.evidenceRefs ?? [],
    }).toEqual({
      decision: 'ready',
      browser: 'passed',
      // Exactly empty, not "contains the expected reason": a passing domain
      // contributes no reason at all, so a green gate is a gate with nothing to
      // say. Any reason here would mean something is still objecting.
      reasons: [],
      evidenceRefs: expect.arrayContaining([expect.stringContaining('artifact:')]),
    });
    // Neither of the two blockers that keep an evidence-free run from being
    // green is present, so the decision is not green by accident.
    expect(green.gate?.reasons ?? []).not.toContain('evidence:MISSING_REQUIRED_EVIDENCE');
    expect(green.gate?.reasons ?? []).not.toContain('evidence:NO_TESTS');
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
    const noDatabase = withErrorBoundary(createHealthRoutes());
    expect((await noDatabase.request('/api/v1/ready')).status).toBe(503);
    const ready = withErrorBoundary(
      createHealthRoutes({ databaseUrl: 'postgres://test', checkDatabase: async () => undefined }),
    );
    expect((await ready.request('/api/v1/ready')).status).toBe(200);
    const unavailable = withErrorBoundary(
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
    const app = withErrorBoundary(createAgentRoutes());
    expect((await app.request('/api/v1/agents/unknown/generate', { method: 'POST' })).status).toBe(
      404,
    );
    expect((await app.request('/api/v1/agents/browser', { method: 'GET' })).status).toBe(501);
    expect((await app.request('/api/v1/agents')).status).toBe(200);
  });
});
