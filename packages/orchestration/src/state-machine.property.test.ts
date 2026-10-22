import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { JobState, RunOutcome, RunPhase } from '@automate/shared-contracts';
import {
  canTransition,
  decideTransition,
  holdsFence,
  isTerminal,
  transition,
  unownedFence,
} from './state-machine.js';
import {
  COMPLETE_OUTCOMES,
  deriveRunState,
  isTerminalPhase,
  PHASE_OUTCOME,
  RUN_PHASES,
  TERMINAL_PHASES,
} from './phase-outcome.js';

/**
 * Property suites for invariants ORCH-1 .. ORCH-4 in `docs/quality/property-invariants.json`.
 *
 * Deterministic on purpose: a fixed seed and a fixed `numRuns`, so a red run is the same red
 * run on every host. A regression found by a property is pinned as an `examples` entry (or a
 * dedicated `it`) rather than left to the seed to rediscover.
 */
const SEED = 20261022;
const RUNS = 500;
const params = { seed: SEED, numRuns: RUNS } as const;

/**
 * The specification, restated independently of the implementation's table. If the
 * implementation's table and this one disagree, one of them is wrong, and a reviewer reads
 * the difference.
 */
const SPEC: Record<JobState, readonly JobState[]> = {
  queued: ['leased', 'cancelled', 'expired'],
  leased: ['running', 'queued', 'expired', 'cancelled'],
  running: ['waiting_approval', 'cancelling', 'succeeded', 'failed', 'cancelled', 'expired'],
  waiting_approval: ['running', 'cancelling', 'failed', 'cancelled'],
  cancelling: ['cancelled', 'failed'],
  succeeded: [],
  failed: [],
  cancelled: [],
  expired: [],
};
const STATES = Object.keys(SPEC) as JobState[];
const TERMINAL_STATES = STATES.filter((state) => SPEC[state].length === 0);

const stateArb = fc.constantFrom(...STATES);
const terminalArb = fc.constantFrom(...TERMINAL_STATES);
/** A state-shaped value the machine has never heard of, including prototype keys. */
const foreignArb = fc
  .oneof(fc.string(), fc.constantFrom('__proto__', 'constructor', 'toString', 'hasOwnProperty'))
  .filter((value) => !STATES.includes(value as JobState));

describe('ORCH-1: no illegal job transition is accepted', () => {
  it('canTransition agrees with the specification on every ordered pair', () => {
    fc.assert(
      fc.property(stateArb, stateArb, (from, to) => {
        expect(canTransition(from, to)).toBe(SPEC[from].includes(to));
      }),
      params,
    );
  });

  it('transition() throws exactly when the specification forbids the edge', () => {
    fc.assert(
      fc.property(stateArb, stateArb, (from, to) => {
        if (SPEC[from].includes(to)) expect(transition(from, to)).toBe(to);
        else expect(() => transition(from, to)).toThrow(/Invalid job transition/);
      }),
      params,
    );
  });

  it('is total over foreign states: refuses, never throws a TypeError', () => {
    fc.assert(
      fc.property(foreignArb, stateArb, (from, to) => {
        expect(canTransition(from as JobState, to)).toBe(false);
        expect(canTransition(to, from as JobState)).toBe(false);
        // No edges out of a state nobody defined, so nothing can leave it either.
        expect(isTerminal(from as JobState)).toBe(true);
      }),
      {
        ...params,
        examples: [
          ['__proto__', 'queued'],
          ['constructor', 'running'],
        ],
      },
    );
  });

  it('a random walk of accepted edges only ever visits specified edges', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(8), { maxLength: 40 }), (picks) => {
        let state: JobState = 'queued';
        for (const pick of picks) {
          const options = STATES.filter((candidate) => canTransition(state, candidate));
          if (options.length === 0) break;
          const next = options[pick % options.length] as JobState;
          expect(SPEC[state]).toContain(next);
          state = transition(state, next);
        }
      }),
      params,
    );
  });
});

describe('ORCH-2: terminal job states absorb', () => {
  it('no edge leaves a terminal state, under any fence', () => {
    fc.assert(
      fc.property(terminalArb, stateArb, fc.nat(1000), (from, to, token) => {
        expect(isTerminal(from)).toBe(true);
        expect(canTransition(from, to)).toBe(false);
        expect(() => transition(from, to)).toThrow();
        const decision = decideTransition({ state: from, current: token, held: token }, to);
        expect(decision).toEqual({ allowed: false, reason: 'illegal', from, to });
      }),
      params,
    );
  });

  it('a state is terminal exactly when the specification has no edges out of it', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        expect(isTerminal(state)).toBe(SPEC[state].length === 0);
      }),
      params,
    );
  });

  it('every state can reach a terminal state, so nothing is a trap', () => {
    fc.assert(
      fc.property(stateArb, (start) => {
        const seen = new Set<JobState>([start]);
        const frontier: JobState[] = [start];
        while (frontier.length > 0) {
          const current = frontier.pop() as JobState;
          for (const next of SPEC[current]) {
            if (!seen.has(next)) {
              seen.add(next);
              frontier.push(next);
            }
          }
        }
        expect([...seen].some((state) => isTerminal(state))).toBe(true);
      }),
      params,
    );
  });
});

describe('ORCH-3: a fenced-out caller never moves a job', () => {
  it('a stale or foreign token is refused as fenced_out before legality is consulted', () => {
    fc.assert(
      fc.property(stateArb, stateArb, fc.nat(1000), fc.nat(1000), (from, to, current, held) => {
        const decision = decideTransition({ state: from, current, held }, to);
        if (held !== current) {
          expect(decision).toEqual({ allowed: false, reason: 'fenced_out', held, current });
          expect(holdsFence({ state: from, current, held })).toBe(false);
        } else if (SPEC[from].includes(to)) {
          expect(decision).toEqual({ allowed: true, state: to });
        } else {
          expect(decision).toEqual({ allowed: false, reason: 'illegal', from, to });
        }
      }),
      // 5 vs 4: a token newer than the store's is not authority either.
      { ...params, examples: [['running', 'succeeded', 4, 5]] },
    );
  });

  it('an unowned fence is held and obeys the table', () => {
    fc.assert(
      fc.property(stateArb, stateArb, (from, to) => {
        expect(decideTransition(unownedFence(from), to).allowed).toBe(SPEC[from].includes(to));
      }),
      params,
    );
  });
});

describe('ORCH-4: deriveRunState keeps phase, outcome and status consistent', () => {
  const phaseArb = fc.constantFrom<RunPhase>(...RUN_PHASES);
  /** Anything a hostile payload could carry in `outcome`. */
  const claimArb = fc.oneof(
    fc.constantFrom<unknown>(...COMPLETE_OUTCOMES),
    fc.string(),
    fc.constant(null),
    fc.constant(undefined),
    fc.integer(),
    fc.object(),
    fc.constantFrom<unknown>('__proto__', 'constructor', 'passed'),
  );

  it('terminal exactly when the outcome is set: runs_phase_outcome_check is unreachable', () => {
    fc.assert(
      fc.property(phaseArb, claimArb, (phase, claim) => {
        const derived = deriveRunState(phase, claim);
        expect(derived.phase).toBe(phase);
        expect(derived.terminal).toBe(isTerminalPhase(phase));
        expect(derived.outcome !== null).toBe(derived.terminal);
      }),
      params,
    );
  });

  it('a payload has no authority over the outcome of anything but a complete run', () => {
    fc.assert(
      fc.property(phaseArb, claimArb, (phase, claim) => {
        const derived = deriveRunState(phase, claim);
        if (phase === 'complete') {
          expect(COMPLETE_OUTCOMES).toContain(derived.outcome as Exclude<RunOutcome, null>);
        } else if (derived.terminal) {
          expect(derived.outcome).toBe(PHASE_OUTCOME[phase]);
        } else {
          expect(derived.outcome).toBeNull();
          expect(derived.status).toBe('running');
        }
      }),
      {
        ...params,
        // A queued run claiming `passed` without a test having run: the original injection.
        examples: [
          ['queued', 'passed'],
          ['cancelled', 'passed'],
          ['complete', '__proto__'],
        ],
      },
    );
  });

  it('status is passed only for a complete run that says passed', () => {
    fc.assert(
      fc.property(phaseArb, claimArb, (phase, claim) => {
        const derived = deriveRunState(phase, claim);
        expect(derived.status === 'passed').toBe(
          phase === 'complete' && derived.outcome === 'passed',
        );
        if (derived.terminal && phase !== 'complete') expect(derived.status).toBe('interrupted');
      }),
      params,
    );
  });

  it('every terminal phase is a requestable phase and the two lists never drift', () => {
    expect(new Set(TERMINAL_PHASES).size).toBe(TERMINAL_PHASES.length);
    for (const phase of TERMINAL_PHASES) expect(RUN_PHASES).toContain(phase);
  });
});

describe('the property harness can fail', () => {
  it('shrinks a seeded counterexample to the minimal illegal edge', () => {
    // A deliberately wrong claim ("every state may go to `queued`") must be refuted, and
    // refuted with a minimal, replayable counterexample. If this ever passes, the
    // generators have stopped producing the pairs the suites above depend on.
    const outcome = fc.check(
      fc.property(stateArb, (from) => canTransition(from, 'queued')),
      params,
    );
    expect(outcome.failed).toBe(true);
    expect(outcome.counterexample).not.toBeNull();
    expect(canTransition(outcome.counterexample?.[0] as JobState, 'queued')).toBe(false);
  });
});
