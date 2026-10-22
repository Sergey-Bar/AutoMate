import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  planEventBatch,
  type BatchContext,
  type BatchPlan,
  type PlannedEvent,
} from './execution-derivations.js';
import type { ExecutionEventInput } from './types.js';

/**
 * Property suite for invariants RUN-1 .. RUN-3 in `docs/quality/property-invariants.json`:
 * the run-level terminal rule, applied by `planEventBatch` to every batch both execution stores
 * accept. Fixed seed and `numRuns`.
 */
const SEED = 20261022;
const params = { seed: SEED, numRuns: 400 } as const;

/** The hash is a pure function of the content, as the real one is. */
const hashOf = (input: ExecutionEventInput): string =>
  `${input.type}|${JSON.stringify(input.payload ?? null)}`;

type Kind = 'step' | 'terminal-payload' | 'completed';
const inputFor = (kind: Kind, index: number, sequence: number): ExecutionEventInput => ({
  eventId: `e${String(index)}`,
  sequence,
  type: kind === 'completed' ? 'run.completed' : 'run.step',
  payload: kind === 'terminal-payload' ? { terminal: true } : { n: index },
});

const kindArb = fc.constantFrom<Kind>('step', 'step', 'step', 'terminal-payload', 'completed');
const isTerminalKind = (kind: Kind): boolean => kind !== 'step';

/** A batch that is in sequence from `start`, so it is plannable unless it breaks the rules. */
const batchArb = fc.record({
  kinds: fc.array(kindArb, { minLength: 1, maxLength: 12 }),
  start: fc.integer({ min: 1, max: 50 }),
});

function context(
  inputs: readonly ExecutionEventInput[],
  overrides: Partial<BatchContext> = {},
): BatchContext {
  return {
    inputs,
    runId: 'run-1',
    storedHashes: new Map(),
    nextSequence: inputs[0]?.sequence ?? 1,
    alreadyTerminal: false,
    hashOf,
    ...overrides,
  };
}

const planned = (plan: BatchPlan): PlannedEvent[] => (plan.kind === 'ready' ? plan.events : []);

describe('RUN-1: nothing new is accepted after the run has ended', () => {
  it('a ready plan never writes a new event after a terminal one', () => {
    fc.assert(
      fc.property(batchArb, ({ kinds, start }) => {
        const inputs = kinds.map((kind, index) => inputFor(kind, index, start + index));
        const plan = planEventBatch(context(inputs));
        const firstTerminal = kinds.findIndex(isTerminalKind);
        if (firstTerminal === -1 || firstTerminal === kinds.length - 1) {
          expect(plan.kind).toBe('ready');
        } else {
          // Something follows the terminal event: the whole batch is refused, with one reason.
          expect(plan).toMatchObject({ kind: 'conflict' });
          if (plan.kind === 'conflict') {
            expect(plan.results).toHaveLength(1);
            expect(plan.results[0]).toMatchObject({ reason: 'terminal_event' });
          }
        }
      }),
      {
        ...params,
        examples: [[{ kinds: ['completed', 'step'], start: 1 }]],
      },
    );
  });

  it('once an earlier batch ended the run, every new event is refused as terminal_event', () => {
    fc.assert(
      fc.property(batchArb, ({ kinds, start }) => {
        const inputs = kinds.map((kind, index) => inputFor(kind, index, start + index));
        const plan = planEventBatch(context(inputs, { alreadyTerminal: true }));
        expect(plan.kind).toBe('conflict');
        if (plan.kind === 'conflict') {
          expect(plan.results[0]).toMatchObject({ reason: 'terminal_event' });
        }
      }),
      params,
    );
  });
});

describe('RUN-2: replaying an accepted batch is idempotent', () => {
  it('the same events against their own stored hashes are all duplicates, and still ready', () => {
    fc.assert(
      fc.property(batchArb, ({ kinds, start }) => {
        // Keep only batches that plan: a terminal event may only be last.
        const trimmed = kinds.slice(
          0,
          Math.max(1, kinds.findIndex(isTerminalKind) + 1 || kinds.length),
        );
        const inputs = trimmed.map((kind, index) => inputFor(kind, index, start + index));
        const first = planEventBatch(context(inputs));
        expect(first.kind).toBe('ready');
        const stored = new Map(planned(first).map((event) => [event.eventKey, event.hash]));

        // The run has now ended iff the batch carried a terminal event; replay must not care.
        const replay = planEventBatch(
          context(inputs, {
            storedHashes: stored,
            nextSequence: start + inputs.length,
            alreadyTerminal: trimmed.some(isTerminalKind),
          }),
        );
        expect(replay.kind).toBe('ready');
        expect(planned(replay).every((event) => event.duplicate)).toBe(true);
        expect(planned(replay)).toHaveLength(inputs.length);
      }),
      params,
    );
  });

  it('the same event id with different content is a hash mismatch, never a silent overwrite', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), fc.string(), (start, other) => {
        const original = inputFor('step', 0, start);
        const changed: ExecutionEventInput = { ...original, payload: { n: 0, other } };
        fc.pre(hashOf(changed) !== hashOf(original));
        const plan = planEventBatch(
          context([changed], {
            storedHashes: new Map([[`run-1:${original.eventId}`, hashOf(original)]]),
            nextSequence: start + 1,
          }),
        );
        expect(plan).toMatchObject({ kind: 'conflict' });
        if (plan.kind === 'conflict') {
          expect(plan.results[0]).toMatchObject({ reason: 'event_hash_mismatch' });
        }
      }),
      params,
    );
  });
});

describe('RUN-3: new events are contiguous from the expected sequence', () => {
  it('a ready plan carries exactly nextSequence, nextSequence + 1, ... for its new events', () => {
    fc.assert(
      fc.property(batchArb, ({ kinds, start }) => {
        const upToTerminal = kinds.findIndex(isTerminalKind);
        const trimmed = upToTerminal === -1 ? kinds : kinds.slice(0, upToTerminal + 1);
        const inputs = trimmed.map((kind, index) => inputFor(kind, index, start + index));
        const plan = planEventBatch(context(inputs));
        expect(planned(plan).map((event) => event.input.sequence)).toEqual(
          inputs.map((_, index) => start + index),
        );
      }),
      params,
    );
  });

  it('any gap is refused whole, and names the gap rather than the terminal rule', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 20 }),
        (start, skip) => {
          const plan = planEventBatch(
            context([inputFor('step', 0, start + skip)], { nextSequence: start }),
          );
          expect(plan.kind).toBe('conflict');
          if (plan.kind === 'conflict')
            expect(plan.results[0]).toMatchObject({ reason: 'sequence_gap' });
        },
      ),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes a deliberately wrong claim ("a batch with a terminal event in the middle plans")', () => {
    const outcome = fc.check(
      fc.property(batchArb, ({ kinds, start }) => {
        const inputs = kinds.map((kind, index) => inputFor(kind, index, start + index));
        return planEventBatch(context(inputs)).kind === 'ready';
      }),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
});
