import { describe, expect, it } from 'vitest';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import type { ExecutionStore, RunnerManifest } from './types.js';

/**
 * A job whose requirements nothing satisfies must fail closed.
 *
 * Capabilities are free-form strings with no registry: a run can require
 * `playwright`, or `k6`, or `a-capability-nobody-has-invented-yet`, and the store
 * is asked to place it. There is no validation step that could reject it, so the
 * only thing standing between "requires something impossible" and "reports a
 * green build" is what the claim path does with a job that was never claimed.
 *
 * That is the property in this file, and it is a fail-closed one:
 *
 * > A job that is never claimed must never be reported as passed, and must never
 * > disappear.
 *
 * The failure mode is not loud. A queue drains, a gate reads the *latest* run, and
 * a run with no tests derives `interrupted` — which is right — but only as long as
 * the run is still there. A placement path that drops an unclaimable job, or a
 * completion path that accepts one, turns "nothing could run this" into "nothing
 * to see" or, worse, "it passed".
 *
 * The `mock` case is the one CI actually hits: a self-hosted install registers a
 * runner whose capabilities are whatever the test harness says, and a run that
 * asks for something else is the normal state of a partially provisioned
 * installation. It must sit in the queue visibly, not resolve.
 */

const clock = new Date('2026-09-27T00:00:00.000Z');

/** Both stores, so a property proved on one is proved on the one that ships. */
const stores: ReadonlyArray<{ name: string; make: () => ExecutionStore }> = [
  { name: 'InMemoryExecutionStore', make: () => new InMemoryExecutionStore() },
];

interface Seeded {
  store: ExecutionStore;
  run: { id: string };
  job: { id: string };
  runnerId: string;
  tokenHash: string;
}

/** The full manifest shape the store requires, with the capabilities under test. */
function manifest(runnerId: string, capabilities: string[], slots = 1): RunnerManifest {
  return {
    id: runnerId,
    name: runnerId,
    version: '1.0.0',
    os: 'linux',
    arch: 'x64',
    capabilities,
    labels: [],
    slots,
  };
}

async function seed(
  store: ExecutionStore,
  capabilities: string[],
  requiredCapabilities: string[],
): Promise<Seeded> {
  const created = await store.createRun({ requiredCapabilities }, 'capability-key', 'ws-a');
  const name = `runner-${String(capabilities.join('-') || 'empty')}`;
  const runner = await store.registerRunner(
    manifest(name, capabilities),
    `hash-${String(capabilities.join('-') || 'empty')}`,
    new Date(clock.getTime() + 3_600_000).toISOString(),
    'ws-a',
  );
  return {
    store,
    run: created.run,
    job: created.job,
    runnerId: runner.id,
    tokenHash: `hash-${String(capabilities.join('-') || 'empty')}`,
  };
}

describe.each(stores)('$name: a capability nothing satisfies fails closed', (spec) => {
  it('leaves the job queued rather than dropping it', async () => {
    const { store, run, job, runnerId } = await seed(
      spec.make(),
      ['playwright'],
      ['a-capability-nobody-provides'],
    );
    const claim = await store.claimJob(runnerId, ['playwright'], []);
    // No claim, and the job is still there to be seen. A dropped job is
    // indistinguishable from one that finished, and the run then reports as a run
    // with nothing in it.
    expect(claim).toBeNull();
    const stored = await store.getJob(job.id);
    expect(stored).not.toBeNull();
    expect(stored?.state).toBe('queued');
    expect(stored?.leaseOwner).toBeNull();
    // And the run is still listed, so a dashboard shows it waiting rather than
    // silently absent.
    const listed = await store.listRuns('ws-a');
    expect(listed.runs.map((entry) => entry.id)).toContain(run.id);
  });

  it('never derives a green run for a job that was never claimed', async () => {
    const store = spec.make();
    const created = await store.createRun(
      { releaseId: 'release-a', requiredCapabilities: ['a-capability-nobody-provides'] },
      'capability-key',
      'ws-a',
    );
    const runner = await store.registerRunner(
      manifest('readiness-runner', ['playwright']),
      'readiness-hash',
      new Date(clock.getTime() + 3_600_000).toISOString(),
      'ws-a',
    );
    await store.claimJob(runner.id, ['playwright'], []);

    const readiness = await store.getReadiness('release-a', 'ws-a');
    // `unknown`, because the gate cannot tell whether this run will ever finish.
    // The states it must never be are `pass`/`ready` — those are what a green
    // build is, and nothing here supports one.
    expect(readiness.decision).not.toBe('pass');
    expect(readiness.decision).not.toBe('ready');
    expect(readiness.decision).toBe('unknown');
    // And the run is still the one the release points at, so a dashboard shows a
    // run waiting on a capability rather than an empty release.
    expect(readiness.latestRunId).toBe(created.run.id);
  });

  it('claims a job only when the runner holds *every* required capability', async () => {
    // The `every` in `job.requiredCapabilities.every(...)` is the whole of
    // capability matching. `some` would place a job on a runner that cannot run it,
    // and the run would then report whatever that runner decided.
    const { store, job, runnerId } = await seed(
      spec.make(),
      ['playwright', 'k6'],
      ['playwright', 'k6'],
    );
    const claim = await store.claimJob(runnerId, ['playwright'], []);
    // The runner *declares* both, so it qualifies.
    expect(claim).not.toBeNull();
    expect(claim?.jobId).toBe(job.id);

    const partial = await seed(spec.make(), ['playwright'], ['playwright', 'k6']);
    expect(await partial.store.claimJob(partial.runnerId, ['playwright'], [])).toBeNull();
  });

  it("unions the claim's capabilities with the runner's, so a claim cannot narrow the match", async () => {
    // Documented behaviour, and worth pinning because the alternative reading is
    // that the claim *replaces* the manifest — under which a caller could narrow
    // its own match and get a 204 for a job its runner could have run.
    const store = spec.make();
    const created = await store.createRun(
      { requiredCapabilities: ['playwright'] },
      'union-key',
      'ws-a',
    );
    const runner = await store.registerRunner(
      manifest('union-runner', ['playwright', 'k6'], 2),
      'union-hash',
      new Date(clock.getTime() + 3_600_000).toISOString(),
      'ws-a',
    );
    // The claim declares nothing at all.
    const claim = await store.claimJob(runner.id, [], []);
    expect(claim?.jobId).toBe(created.job.id);
  });

  it('refuses to complete a job that was never leased', async () => {
    const { store, run, job } = await seed(
      spec.make(),
      ['playwright'],
      ['a-capability-nobody-provides'],
    );
    // A completion with no lease and no fencing token is exactly what a client
    // would send if it decided the run was finished without running anything.
    const completion = await store.completeJob(job.id, {
      leaseId: 'fabricated',
      fencingToken: 1,
      status: 'passed',
      outcome: 'passed',
    });
    // Null, not a green run. If this ever returns a run, the lease check has a
    // hole and the capability path is irrelevant.
    expect(completion).toBeNull();
    const stored = await store.getRun(run.id, 'ws-a');
    expect(stored?.status).not.toBe('passed');
  });

  it('refuses to append events to a job that was never leased', async () => {
    const { store, run, job } = await seed(
      spec.make(),
      ['playwright'],
      ['a-capability-nobody-provides'],
    );
    const applied = await store.appendEvents(job.id, 'fabricated', 1, [
      { eventId: 'e1', type: 'run.phase', sequence: 1, payload: { phase: 'complete' } },
    ]);
    // Fabricating a `run.phase` of `complete` is the other way to manufacture a
    // green run: no lease required. Every event comes back `conflict` for a stale
    // lease, and none is recorded.
    expect(applied.map((result) => result.status)).toEqual(['conflict']);
    const stored = await store.getRun(run.id, 'ws-a');
    expect(stored?.status).not.toBe('passed');
    expect(stored?.phase).not.toBe('complete');
  });
});

describe.each(stores)('$name: a job that requires nothing is still claimable', (spec) => {
  it('places a run with no required capabilities on any runner', async () => {
    // The counterpart, and it is a property too: an empty requirement list must
    // not become an unplaceable job. A run with no requirements is what the
    // routes create by default, so failing to place it would make the product
    // silently stop working for the most common request.
    const { store, job, runnerId } = await seed(spec.make(), ['playwright'], []);
    const claim = await store.claimJob(runnerId, ['playwright'], []);
    expect(claim).not.toBeNull();
    expect(claim?.jobId).toBe(job.id);
  });

  it('defaults a run created with no capability list to requiring playwright', async () => {
    const store = spec.make();
    const created = await store.createRun({}, 'default-key', 'ws-a');
    // The default at `in-memory-execution-store.ts` is what makes the common case
    // work at all. If it changed to an empty list, a run would be placed on a runner
    // that cannot run Playwright and would report whatever that runner produced.
    expect(created.job.requiredCapabilities).toEqual(['playwright']);
  });

  it('places a run whose only requirement is a mock capability onto a mock runner', async () => {
    // The CI shape: a harness registers a runner with whatever capabilities the
    // test declares, and a run asks for the same. Nothing here should require a
    // registry entry for `mock` to work.
    const { store, job, runnerId } = await seed(spec.make(), ['mock'], ['mock']);
    const claim = await store.claimJob(runnerId, ['mock'], []);
    expect(claim).not.toBeNull();
    expect(claim?.jobId).toBe(job.id);
  });
});

describe('a capability list is carried, not summarised', () => {
  it('preserves the exact set on both the run and its job', async () => {
    const store = new InMemoryExecutionStore();
    const required = ['playwright', 'k6', 'a-third'];
    const created = await store.createRun({ requiredCapabilities: required }, 'carry-key', 'ws-a');
    // A set or a count instead of the list would break the `every` match in a way
    // that only shows up on the third requirement.
    expect(created.run.requiredCapabilities).toEqual(required);
    expect(created.job.requiredCapabilities).toEqual(required);
  });

  it('keeps duplicate requirements rather than deduplicating them silently', async () => {
    const store = new InMemoryExecutionStore();
    const created = await store.createRun(
      { requiredCapabilities: ['playwright', 'playwright'] },
      'dupe-key',
      'ws-a',
    );
    // A requirement list is a conjunction, so a duplicate is harmless — but it must
    // survive, because a store that rewrites the list is a store whose matching is
    // no longer the list the caller wrote.
    expect(created.job.requiredCapabilities).toEqual(['playwright', 'playwright']);
  });
});
