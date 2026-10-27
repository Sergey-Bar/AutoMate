import { describe, expect, it } from 'vitest';
import { InMemoryQuarantineStore } from '../modules/dashboard/quarantine.js';
import type { ExecutionRun, ExecutionTestResult } from '../execution/types.js';
import { applyQuarantinePolicy, cleanStreak } from './auto-quarantine.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const KEY = 'a.spec.ts › pays';

let sequence = 0;
function run(
  status: ExecutionTestResult['status'],
  commit = 'c1',
  projectId = PROJECT,
): ExecutionRun {
  sequence += 1;
  const at = new Date(Date.UTC(2026, 9, 1) + sequence * 60_000).toISOString();
  return {
    id: `run-${String(sequence)}`,
    createdAt: at,
    commit,
    branch: 'main',
    projectId,
    policyEvaluation: null,
    tests: [
      {
        id: 'pays',
        title: 'pays',
        file: 'a.spec.ts',
        stableId: KEY,
        status,
        durationMs: 100,
        attempt: status === 'flaky' ? 2 : 1,
      },
    ],
  } as unknown as ExecutionRun;
}

/** Five observations with retry passes, ending in a pass: auto-eligible. */
const flakyHistory = () => [
  run('passed'),
  run('flaky'),
  run('passed'),
  run('flaky'),
  run('passed'),
];

describe('applyQuarantinePolicy', () => {
  it('writes nothing in suggest or off mode', async () => {
    for (const mode of ['suggest', 'off'] as const) {
      const store = new InMemoryQuarantineStore();
      const outcome = await applyQuarantinePolicy({
        policy: { mode, releaseAfter: 20 },
        projectId: PROJECT,
        history: flakyHistory(),
        store,
      });
      expect(outcome).toEqual({ quarantined: [], released: [] });
      expect(await store.list()).toEqual([]);
    }
  });

  it('quarantines and approves a test with retry evidence, once, as automate', async () => {
    const store = new InMemoryQuarantineStore();
    const input = {
      policy: { mode: 'auto' as const, releaseAfter: 20 },
      projectId: PROJECT,
      history: flakyHistory(),
      store,
    };
    expect((await applyQuarantinePolicy(input)).quarantined).toEqual([KEY]);
    // Idempotent: a second pass over the same history writes nothing new.
    expect((await applyQuarantinePolicy(input)).quarantined).toEqual([]);
    const entries = await store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      stableId: KEY,
      projectId: PROJECT,
      status: 'approved',
      quarantinedBy: 'automate',
    });
    expect(store.recorded.map((entry) => [entry.action, entry.actorId])).toEqual([
      ['quarantine.created', 'automate'],
      ['quarantine.approved', 'automate'],
    ]);
  });

  it('never quarantines a test whose only disagreement is across commits', async () => {
    const store = new InMemoryQuarantineStore();
    const history = [
      run('passed', 'a'),
      run('failed', 'b'),
      run('failed', 'b'),
      run('passed', 'c'),
      run('passed', 'c'),
      run('failed', 'd'),
      run('passed', 'e'),
    ];
    const outcome = await applyQuarantinePolicy({
      policy: { mode: 'auto', releaseAfter: 20 },
      projectId: PROJECT,
      history,
      store,
    });
    expect(outcome.quarantined).toEqual([]);
  });

  it('leaves a test a person has already decided about alone', async () => {
    const store = new InMemoryQuarantineStore();
    const pending = await store.add({
      testTitle: 'pays',
      testFile: 'a.spec.ts',
      stableId: KEY,
      reason: null,
    });
    await store.resolve(pending.id, { status: 'rejected', resolution: 'not flaky, a real bug' });
    const outcome = await applyQuarantinePolicy({
      policy: { mode: 'auto', releaseAfter: 20 },
      projectId: PROJECT,
      history: flakyHistory(),
      store,
    });
    expect(outcome.quarantined).toEqual([]);
    expect(await store.list()).toHaveLength(1);
  });

  it('releases an automatic entry at exactly releaseAfter clean passes, and not one sooner', async () => {
    const store = new InMemoryQuarantineStore();
    const policy = { mode: 'auto' as const, releaseAfter: 20 };
    const history = flakyHistory();
    await applyQuarantinePolicy({ policy, projectId: PROJECT, history, store });
    // The flaky history ends in a pass, which already starts the streak.
    while (cleanStreak(history, KEY) < 19) history.push(run('passed'));
    expect(
      (await applyQuarantinePolicy({ policy, projectId: PROJECT, history, store })).released,
    ).toEqual([]);
    history.push(run('passed'));
    const outcome = await applyQuarantinePolicy({ policy, projectId: PROJECT, history, store });
    expect(outcome.released).toEqual([KEY]);
    const [entry] = await store.list();
    expect(entry).toMatchObject({ status: 'released', resolutionType: 'auto-released' });
    expect(entry?.releasedAt).not.toBeNull();
  });

  it('resets the streak on a retry pass, and never releases a person’s entry', async () => {
    const history = [...flakyHistory(), ...Array.from({ length: 25 }, () => run('passed'))];
    expect(cleanStreak(history, KEY)).toBe(26);
    history.push(run('flaky'));
    expect(cleanStreak(history, KEY)).toBe(0);

    const store = new InMemoryQuarantineStore();
    const manual = await store.add({
      testTitle: 'pays',
      testFile: 'a.spec.ts',
      stableId: KEY,
      projectId: PROJECT,
      reason: null,
    });
    await store.resolve(manual.id, { status: 'approved', resolution: 'flaky on CI' });
    const clean = [...flakyHistory(), ...Array.from({ length: 25 }, () => run('passed'))];
    const outcome = await applyQuarantinePolicy({
      policy: { mode: 'auto', releaseAfter: 20 },
      projectId: PROJECT,
      history: clean,
      store,
    });
    expect(outcome.released).toEqual([]);
  });

  it('reads only the project it was asked about', async () => {
    const store = new InMemoryQuarantineStore();
    const history = flakyHistory().map((entry) => ({ ...entry, projectId: OTHER }));
    const outcome = await applyQuarantinePolicy({
      policy: { mode: 'auto', releaseAfter: 20 },
      projectId: PROJECT,
      history,
      store,
    });
    expect(outcome.quarantined).toEqual([]);
  });
});
