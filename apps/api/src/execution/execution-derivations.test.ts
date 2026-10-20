import { describe, expect, it } from 'vitest';
import {
  browserGateStatus,
  completionOutcome,
  completionPhase,
  completionStatus,
  eventRunState,
  jobStateFor,
  leaseIsLive,
  planEventBatch,
  refuseBatch,
  runStatusFor,
  type BatchContext,
} from './execution-derivations.js';
import type { ExecutionEventInput, RunOutcome, RunPhase } from './types.js';

/**
 * An independent statement of the rules these functions replaced.
 *
 * The store used to compute phase and outcome with nested ternaries inline. This oracle says the
 * same thing a different way (`if` and `switch`, in the order the ternaries were read), and the
 * tests compare the extracted lookups against it over every status the runner can plausibly send,
 * so the refactor is checked for behaviour and not only for the cases someone thought to write
 * down. A mistake in transcribing the rules would have to be made twice, in two shapes.
 */
function oraclePhase(status: string, rawPhase: RunPhase | 'completed' | undefined): RunPhase {
  if (rawPhase === 'completed') return 'complete';
  if (rawPhase !== undefined) return rawPhase;
  switch (status) {
    case 'timed-out':
      return 'timed_out';
    case 'cancelled':
    case 'timed_out':
    case 'runner_lost':
    case 'infra_failed':
    case 'config_failed':
      return status;
    default:
      return 'complete';
  }
}

function oracleOutcome(status: string, declared: RunOutcome | undefined): RunOutcome {
  // A null outcome is not an answer: the expression this replaced (`outcome ?? ...`) fell through on it, and so does this.
  if (declared !== undefined && declared !== null) return declared;
  switch (status) {
    case 'passed':
    case 'succeeded':
    case 'success':
      return 'passed';
    case 'failure':
      return 'failed';
    case 'timed-out':
      return 'timed_out';
    case 'failed':
    case 'cancelled':
    case 'timed_out':
    case 'runner_lost':
    case 'infra_failed':
    case 'config_failed':
      return status;
    default:
      return 'unknown';
  }
}
const STATUSES = [
  'passed',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'runner_lost',
  'infra_failed',
  'config_failed',
  // Aliases the in-memory store always accepted; both stores accept them now.
  'success',
  'failure',
  'timed-out',
  'complete',
  'unknown',
  '',
  'PASSED',
  // Runner-supplied strings that name members of Object.prototype.
  'constructor',
  'toString',
  '__proto__',
  'hasOwnProperty',
];
const PHASES: Array<RunPhase | 'completed' | undefined> = [
  undefined,
  'completed',
  'complete',
  'running',
  'cancelled',
  'queued',
];
const OUTCOMES: Array<RunOutcome | undefined> = [undefined, null, 'passed', 'failed', 'blocked'];

describe('completion phase and outcome', () => {
  it('match the expressions they replaced for every status, requested phase and declared outcome', () => {
    for (const status of STATUSES) {
      for (const phase of PHASES)
        expect(completionPhase(status, phase), `${status}/${String(phase)}`).toBe(
          oraclePhase(status, phase),
        );
      for (const outcome of OUTCOMES)
        expect(completionOutcome(status, outcome), `${status}/${String(outcome)}`).toBe(
          oracleOutcome(status, outcome),
        );
    }
  });

  it('never let a runner-supplied status read a member of Object.prototype into a column', () => {
    for (const status of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(completionPhase(status, undefined)).toBe('complete');
      expect(completionOutcome(status, undefined)).toBe('unknown');
    }
  });

  it('read the status from the runner, falling back to its outcome, lower-cased', () => {
    expect(completionStatus({ status: 'Failed' })).toBe('failed');
    expect(completionStatus({ outcome: 'passed' })).toBe('passed');
    expect(completionStatus({})).toBe('unknown');
  });
});

describe('the job state and the gate status', () => {
  it('keep failed (and its alias failure) and cancelled, and call everything else completed', () => {
    expect(jobStateFor('failed')).toBe('failed');
    expect(jobStateFor('failure')).toBe('failed');
    expect(jobStateFor('cancelled')).toBe('cancelled');
    for (const status of ['passed', 'timed_out', 'unknown', 'constructor']) {
      expect(jobStateFor(status)).toBe('completed');
    }
  });

  it('tell the browser domain passed, failed, warning (partial) or unknown', () => {
    expect(browserGateStatus('passed')).toBe('passed');
    expect(browserGateStatus('failed')).toBe('failed');
    expect(browserGateStatus('partial')).toBe('warning');
    for (const outcome of ['cancelled', 'unknown', 'blocked', null] as const) {
      expect(browserGateStatus(outcome)).toBe('unknown');
    }
  });
});

describe('whether a lease is live', () => {
  const now = Date.parse('2026-10-20T12:00:00.000Z');

  it('is live only before its expiry', () => {
    expect(leaseIsLive('2026-10-20T12:00:01.000Z', now)).toBe(true);
    expect(leaseIsLive('2026-10-20T12:00:00.000Z', now), 'expiring now is expired').toBe(false);
    expect(leaseIsLive('2026-10-20T11:59:59.000Z', now)).toBe(false);
  });

  it('is not live when nobody can date it', () => {
    expect(leaseIsLive(null, now)).toBe(false);
    expect(leaseIsLive('not a date', now)).toBe(false);
  });
});

describe('the status stored for a finished run', () => {
  const passed = { outcome: 'passed' as const, status: 'passed' as const };

  it('is interrupted when a pass reported no evidence at all', () => {
    expect(runStatusFor(passed, { summary: { total: 0, passed: 0, failed: 0, flaky: 0 } })).toBe(
      'interrupted',
    );
    expect(runStatusFor(passed, {})).toBe('interrupted');
  });

  it.each([
    ['a test result', { tests: [{ id: 't', title: 't', status: 'passed' as const }] }],
    ['a total', { summary: { total: 3 } }],
    ['a pass', { summary: { total: 0, passed: 1 } }],
    ['a failure', { summary: { total: 0, failed: 1 } }],
    ['a flake', { summary: { total: 0, flaky: 1 } }],
  ])('is left alone when there is %s', (_label, completion) => {
    expect(runStatusFor(passed, completion)).toBe('passed');
  });

  it('is left alone for an outcome other than passed, even with nothing reported', () => {
    expect(runStatusFor({ outcome: 'failed', status: 'failed' }, {})).toBe('failed');
  });
});

describe('the run state an event asks for', () => {
  const ev = (type: string, payload?: Record<string, unknown>): ExecutionEventInput =>
    ({ eventId: 'e', sequence: 1, type, payload }) as ExecutionEventInput;

  it('is complete for a run.completed event, whatever its payload says', () => {
    expect(eventRunState(ev('run.completed', { phase: 'running' }))).toMatchObject({
      phase: 'complete',
      terminal: true,
    });
  });

  it('is the phase named in the payload, with the outcome derived from it and not taken from it', () => {
    const state = eventRunState(ev('run.phase_changed', { phase: 'running', outcome: 'passed' }));
    expect(state).toMatchObject({ phase: 'running', terminal: false });
    expect(state?.outcome, 'a running run has no outcome, whatever the client sent').toBeNull();
  });

  it('is nothing for an event that names no phase, or one that is not a phase', () => {
    expect(eventRunState(ev('test.started', { testId: 't' }))).toBeUndefined();
    expect(eventRunState(ev('run.phase_changed', { phase: 'not-a-phase' }))).toBeUndefined();
    expect(eventRunState(ev('run.phase_changed'))).toBeUndefined();
  });
});

describe('refusing a whole batch', () => {
  it('answers every event with the same conflict and no hash', () => {
    const inputs = [
      { eventId: 'a', sequence: 1, type: 'x' },
      { eventId: 'b', sequence: 2, type: 'x' },
    ] as ExecutionEventInput[];
    expect(refuseBatch(inputs, 'stale_lease')).toEqual([
      { eventId: 'a', sequence: 1, status: 'conflict', reason: 'stale_lease' },
      { eventId: 'b', sequence: 2, status: 'conflict', reason: 'stale_lease' },
    ]);
    expect(refuseBatch([], 'stale_lease')).toEqual([]);
  });
});

describe('planning an event batch', () => {
  const event = (
    eventId: string,
    sequence: number,
    extra: Partial<ExecutionEventInput> = {},
  ): ExecutionEventInput =>
    ({ eventId, sequence, type: 'test.started', ...extra }) as ExecutionEventInput;
  const hashOf = (input: ExecutionEventInput): string => `h(${input.eventId})`;
  const base = (inputs: ExecutionEventInput[], more: Partial<BatchContext> = {}): BatchContext => ({
    inputs,
    runId: 'run-1',
    storedHashes: new Map(),
    nextSequence: 1,
    alreadyTerminal: false,
    hashOf,
    ...more,
  });

  it('accepts a batch that continues the sequence', () => {
    const plan = planEventBatch(base([event('a', 1), event('b', 2)]));
    expect(plan).toEqual({
      kind: 'ready',
      events: [
        { input: event('a', 1), hash: 'h(a)', eventKey: 'run-1:a', duplicate: false },
        { input: event('b', 2), hash: 'h(b)', eventKey: 'run-1:b', duplicate: false },
      ],
    });
  });

  it('acknowledges an event already stored with the same content, without consuming a sequence number', () => {
    const plan = planEventBatch(
      base([event('a', 1), event('b', 2)], {
        storedHashes: new Map([['run-1:a', 'h(a)']]),
        nextSequence: 2,
      }),
    );
    expect(plan.kind).toBe('ready');
    if (plan.kind === 'ready') expect(plan.events.map((e) => e.duplicate)).toEqual([true, false]);
  });

  it('refuses the whole batch when a stored event comes back with different content', () => {
    const plan = planEventBatch(
      base([event('a', 1), event('b', 2)], {
        storedHashes: new Map([['run-1:a', 'something-else']]),
      }),
    );
    expect(plan).toEqual({
      kind: 'conflict',
      results: [
        {
          eventId: 'a',
          sequence: 1,
          status: 'conflict',
          reason: 'event_hash_mismatch',
          hash: 'h(a)',
        },
      ],
    });
  });

  it('refuses a gap in the sequence', () => {
    const plan = planEventBatch(base([event('a', 1), event('c', 3)]));
    expect(plan).toEqual({
      kind: 'conflict',
      results: [
        { eventId: 'c', sequence: 3, status: 'conflict', reason: 'sequence_gap', hash: 'h(c)' },
      ],
    });
  });

  it('reports an out-of-sequence event after the run ended as a terminal event, not a gap', () => {
    const plan = planEventBatch(base([event('z', 9)], { alreadyTerminal: true }));
    expect(plan).toMatchObject({ kind: 'conflict', results: [{ reason: 'terminal_event' }] });
  });

  it('refuses a correctly numbered new event once the run has ended', () => {
    const plan = planEventBatch(base([event('a', 1)], { alreadyTerminal: true }));
    expect(plan).toMatchObject({ kind: 'conflict', results: [{ reason: 'terminal_event' }] });
  });

  it.each([
    ['run.completed', { type: 'run.completed' }],
    ['a payload that says terminal', { payload: { terminal: true } }],
  ])(
    'treats %s as ending the run, so a later event in the same batch is refused',
    (_label, extra) => {
      const plan = planEventBatch(
        base([event('a', 1, extra as Partial<ExecutionEventInput>), event('b', 2)]),
      );
      expect(plan).toMatchObject({
        kind: 'conflict',
        results: [{ eventId: 'b', reason: 'terminal_event' }],
      });
    },
  );

  it('does not treat a payload that merely mentions terminal as ending the run', () => {
    const plan = planEventBatch(
      base([event('a', 1, { payload: { terminal: 'yes' } }), event('b', 2)]),
    );
    expect(plan.kind).toBe('ready');
  });

  it('plans an empty batch as ready with nothing to write', () => {
    expect(planEventBatch(base([]))).toEqual({ kind: 'ready', events: [] });
  });

  it('does not let an earlier event in the batch be replayed later in the same batch with other content', () => {
    const plan = planEventBatch(
      base([event('a', 1), event('a', 2)], {
        hashOf: (i) => `h(${i.eventId}:${String(i.sequence)})`,
      }),
    );
    expect(plan).toMatchObject({ kind: 'conflict', results: [{ reason: 'event_hash_mismatch' }] });
  });
});
