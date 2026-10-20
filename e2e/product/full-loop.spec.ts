/**
 * The whole loop, with the shipped processes: API ↔ PostgreSQL ↔ worker ↔ runner.
 *
 * Ledger **RF-6e**. W2's gate is "a job runs worker → runner on PostgreSQL", and until this spec
 * every proof of it was a proof of one half: the worker against an in-memory store, the durable
 * store without a worker in the process, the runner against a stub API, and `durable-path.spec.ts`
 * playing the runner by hand over HTTP. The claim is about three processes agreeing about one
 * row, so the three have to be there.
 *
 * **What happens, and what each step rules out.**
 *
 * 1. A run is queued and a stand-in runner **claims its job and goes silent**. That is the lost
 *    runner: it holds a lease it will never renew.
 * 2. **Only the real worker is started.** With no other claimer in the system, the only thing that
 *    can put that job back in the queue is the worker's lease reaper, so seeing the run return to
 *    `queued` is the worker's doing and nobody else's. (The API's `claimJob` reaps expired leases
 *    as well, which is exactly why the runner is not started yet: a runner started first would
 *    recover the lease itself and this spec would credit the worker for it.)
 * 3. **Then the real runner is started.** It enrols with the registration secret, claims the
 *    recovered job over HTTP, executes it with Playwright against the API's `/health`, streams
 *    events and uploads artifacts through the lease-fenced callbacks, and completes it.
 * 4. The stand-in's late completion, with the lease and fencing token it was once given, is
 *    refused. A recovery that left the old holder able to write would not be a recovery.
 *
 * It waits out a 30 s lease (`DEFAULT_LEASE_MS`), so it is a gate with its own project, like
 * `durable-path.spec.ts`, and is the first project in the config: the queue is empty when it
 * starts, which is what lets the real runner be sure the only job it can claim is this one.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  claimJob,
  createRun,
  getRun,
  registerRunner,
  waitForRunPhase,
  type JobClaim,
} from '../support/api.js';
import { API_AUTH_HEADERS, API_BASE, RUNNER_REGISTRATION_SECRET } from '../support/config.js';
import { startService, type ServiceHandle } from '../support/processes.js';

/** A lease is 30 s; the reaper has to see it expire, so wait comfortably longer than that. */
const RECOVERY_BUDGET_MS = 90_000;
/** Claim, a real Playwright run in Chromium, and the callbacks. */
const EXECUTION_BUDGET_MS = 90_000;

interface RunEvent {
  type: string;
  payload: Record<string, unknown>;
}

test.describe('the full loop', () => {
  test('a lost lease is recovered by the worker and the job is run to completion by the runner', async ({
    request,
  }) => {
    const databaseUrl = process.env['DATABASE_URL']?.trim() ?? '';
    expect(databaseUrl, 'this spec needs the same PostgreSQL the API is using').not.toBe('');

    const scratch = mkdtempSync(path.join(tmpdir(), 'automate-full-loop-'));
    const services: ServiceHandle[] = [];
    try {
      // ------------------------------------------------------------------ 1. a lost runner
      const lost = await registerRunner(request);
      const run = await createRun(request, { branch: 'feat/full-loop' });
      const held: JobClaim = await claimJob(request, lost, ['playwright'], run.id);
      expect(held.fencingToken, 'a lease carries a fencing token').toBeGreaterThan(0);

      // ------------------------------------------------------------------ 2. the worker alone
      const worker = await startService('worker', {
        DATABASE_URL: databaseUrl,
        WORKER_INSTANCE_ID: randomUUID(),
        WORKER_POLL_INTERVAL_MS: '500',
        WORKER_HEALTH_HOST: '127.0.0.1',
        WORKER_HEALTH_PORT: '0',
      });
      services.push(worker);

      const recovered = await waitForRunPhase(request, run.id, ['queued'], RECOVERY_BUDGET_MS);
      expect(
        recovered.outcome,
        'a recovered run is back in the queue, not finished by the recovery',
      ).toBeNull();

      // ------------------------------------------------------------------ 3. the runner
      const runnerInstance = randomUUID();
      const runner = await startService('runner', {
        AUTOMATE_API_URL: API_BASE,
        RUNNER_INSTANCE_ID: runnerInstance,
        RUNNER_REGISTRATION_SECRET,
        RUNNER_ALLOWED_TARGET_URLS: API_BASE,
        RUNNER_POLL_INTERVAL_MS: '500',
        RUNNER_HEALTH_HOST: '127.0.0.1',
        RUNNER_HEALTH_PORT: '0',
        RUNNER_SPOOL_ROOT: path.join(scratch, 'spool'),
        RUNNER_WORKSPACE_ROOT: path.join(scratch, 'workspace'),
      });
      services.push(runner);

      const finished = await waitForRunPhase(
        request,
        run.id,
        ['complete'],
        EXECUTION_BUDGET_MS,
      ).catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\n\n` +
            `--- ${worker.name}\n${worker.output()}\n--- ${runner.name}\n${runner.output()}`,
        );
      });

      expect(
        finished.outcome,
        `the real runner's smoke job against ${API_BASE}/health must pass\n${runner.output()}`,
      ).toBe('passed');

      // ------------------------------------------------------------------ the record
      const eventsResponse = await request.get(`${API_BASE}/api/v1/runs/${run.id}/events`, {
        headers: API_AUTH_HEADERS,
      });
      expect(eventsResponse.status()).toBe(200);
      const events = (await eventsResponse.json()) as RunEvent[];

      const assignedTo = events
        .filter((event) => event.type === 'run.assigned')
        .map((event) => event.payload['runnerId']);
      // Not `[lost, real]`: the API records `run.assigned` when a runner starts reporting on
      // a job, and the lost runner never did. What the record must say is who ended up with it.
      expect(assignedTo.at(-1), 'the job ended up with the real runner, not the lost one').toBe(
        runnerInstance,
      );
      expect(assignedTo, 'the lost runner is never recorded as having run it').not.toContain(
        lost.runnerId,
      );

      expect(
        events.some((event) => event.type === 'test.completed'),
        'the runner streamed per-test events through the fenced callback',
      ).toBe(true);

      const artifacts = await request.get(`${API_BASE}/api/v1/runs/${run.id}/artifacts`, {
        headers: API_AUTH_HEADERS,
      });
      expect(artifacts.status()).toBe(200);
      const names = ((await artifacts.json()) as Array<{ name: string }>).map((a) => a.name);
      expect(names, 'the runner declared its report and it is attached to the run').toEqual(
        expect.arrayContaining(['playwright-report.json', 'junit.xml']),
      );

      // ------------------------------------------------------------------ 4. the old holder
      const late = await request.post(`${API_BASE}/api/v1/jobs/${held.jobId}/complete`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lost.token}` },
        data: {
          leaseId: held.leaseId,
          fencingToken: held.fencingToken,
          phase: 'complete',
          outcome: 'failed',
          summary: { total: 1, passed: 0, failed: 1 },
        },
      });
      expect(
        late.status(),
        'the superseded runner must not be able to overwrite the recovered result',
      ).not.toBe(200);
      expect((await getRun(request, run.id))?.outcome).toBe('passed');
    } finally {
      for (const service of services.reverse()) await service.stop();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
