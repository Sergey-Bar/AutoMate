import { describe, expect, it } from 'vitest';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import type { CreateRunInput } from './types.js';

const REGISTRATION_SECRET = 'registration-secret';

function runBody(key: string): Record<string, unknown> {
  return {
    externalId: `external-${key}`,
    source: 'api',
    testType: 'browser',
    framework: 'playwright',
    timeoutMs: 60_000,
    requiredCapabilities: ['playwright'],
    labels: ['reference'],
    configuration: {},
    idempotencyKey: key,
  };
}

async function harness() {
  // The in-memory store takes no options; the registration secret is the second
  // argument to `registerRunner`, alongside the token hash and its expiry.
  const store = new InMemoryExecutionStore();
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
    REGISTRATION_SECRET,
  );

  const created = await store.createRun(runBody('key-1') as CreateRunInput, 'key-1', 'ws-1');
  const run = created.run;
  const claim = await store.claimJob(runner.id, ['playwright'], ['reference']);
  if (claim === null) throw new Error('expected a claim');
  return { store, run, claim };
}

describe("a run's terminal state cannot be chosen by the payload", () => {
  it('ignores an outcome claimed for a non-terminal phase', async () => {
    const { store, run, claim } = await harness();
    await store.appendEvents(claim.jobId, claim.leaseId, claim.fencingToken, [
      {
        eventId: 'evt-1',
        type: 'run.phase',
        sequence: 1,
        payload: { phase: 'running', outcome: 'passed' },
      },
    ]);
    // The payload claimed a pass on a run that is still running.
    const current = await store.getRun(run.id, 'ws-1');
    expect(current?.phase).toBe('running');
    expect(current?.outcome).toBeNull();
    expect(current?.status).toBe('running');
  });

  it('does not let a payload reclassify a cancelled run as passed', async () => {
    const { store, run, claim } = await harness();
    await store.appendEvents(claim.jobId, claim.leaseId, claim.fencingToken, [
      {
        eventId: 'evt-1',
        type: 'run.phase',
        sequence: 1,
        payload: { phase: 'cancelled', outcome: 'passed' },
      },
    ]);
    const current = await store.getRun(run.id, 'ws-1');
    expect(current?.phase).toBe('cancelled');
    expect(current?.outcome).toBe('cancelled');
    expect(current?.status).not.toBe('passed');
  });

  it('does not record a green run when no test ever ran', async () => {
    const { store, run, claim } = await harness();
    const completion = await store.completeJob(claim.jobId, {
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
      status: 'passed',
      outcome: 'passed',
      // No tests and a zero total: a claim with nothing behind it.
      summary: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, blocked: 0, unknown: 0 },
    });
    expect(completion).not.toBeNull();
    const current = await store.getRun(run.id, 'ws-1');
    // The claim is recorded, but the run does not read as green.
    expect(current?.outcome).toBe('passed');
    expect(current?.status).not.toBe('passed');
    expect(current?.status).toBe('interrupted');
  });

  it('records a green run once a test actually passed', async () => {
    const { store, run, claim } = await harness();
    const completion = await store.completeJob(claim.jobId, {
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
      status: 'passed',
      outcome: 'passed',
      tests: [{ id: 't-1', title: 'login works', status: 'passed' }],
      summary: { total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, blocked: 0, unknown: 0 },
    });
    expect(completion).not.toBeNull();
    const current = await store.getRun(run.id, 'ws-1');
    expect(current?.status).toBe('passed');
    expect(current?.outcome).toBe('passed');
  });
});
