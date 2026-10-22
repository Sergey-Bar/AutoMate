import { deriveRunState, isRequestablePhase, type DerivedRunState } from './phase-outcome.js';
import type {
  EventApplyResult,
  ExecutionEventInput,
  JobCompletionInput,
  RunOutcome,
  RunPhase,
} from './types.js';

/**
 * The decisions `DrizzleExecutionStore` makes inside its transactions, as pure functions.
 *
 * `appendEvents` and `completeJob` were each one transaction function that also held every
 * rule about what to write (ledger C-4: cognitive complexity 42 and 67, the two worst in the
 * repository). The rules need no database, so they are here, where a test can state each one
 * without PGlite, and the store is left with the reads and writes. Nothing in this file may
 * import a driver: that is what keeps it testable and what keeps the split honest.
 */

// ── Completing a job ────────────────────────────────────────────────────────────────────

/**
 * Lookups are `Map`s, not object literals, because the key is a runner-supplied string. A plain
 * object answers `'constructor'` and `'toString'` with `Object.prototype` members, which would
 * flow into a database column as a function.
 */
const STATUS_PHASES = new Map<string, RunPhase>([
  ['cancelled', 'cancelled'],
  ['timed_out', 'timed_out'],
  ['timed-out', 'timed_out'],
  ['runner_lost', 'runner_lost'],
  ['infra_failed', 'infra_failed'],
  ['config_failed', 'config_failed'],
]);

const STATUS_OUTCOMES = new Map<string, NonNullable<RunOutcome>>([
  ['passed', 'passed'],
  ['succeeded', 'passed'],
  ['success', 'passed'],
  ['failed', 'failed'],
  ['failure', 'failed'],
  ['cancelled', 'cancelled'],
  ['timed_out', 'timed_out'],
  ['timed-out', 'timed_out'],
  ['runner_lost', 'runner_lost'],
  ['infra_failed', 'infra_failed'],
  ['config_failed', 'config_failed'],
]);

/** The runner's own word for how the job ended, lower-cased; `unknown` when it said nothing. */
export function completionStatus(
  completion: Pick<JobCompletionInput, 'status' | 'outcome'>,
): string {
  return (completion.status ?? completion.outcome ?? 'unknown').toLowerCase();
}

/** The phase a completion lands the run in: what it asked for, else what its status implies. */
export function completionPhase(status: string, requested: JobCompletionInput['phase']): RunPhase {
  if (requested === 'completed') return 'complete';
  return requested ?? STATUS_PHASES.get(status) ?? 'complete';
}

/** The outcome a completion lands the run with: what it declared, else what its status implies. */
export function completionOutcome(status: string, declared: RunOutcome | undefined): RunOutcome {
  return declared ?? STATUS_OUTCOMES.get(status) ?? 'unknown';
}

/** The state the job row ends in. `failed` and `cancelled` are kept; everything else completed. */
export function jobStateFor(status: string): 'cancelled' | 'failed' | 'completed' {
  if (status === 'cancelled') return status;
  return status === 'failed' || status === 'failure' ? 'failed' : 'completed';
}

/**
 * Whether a lease is still live at `nowMs`. A missing or unparseable expiry is not live:
 * a lease nobody can date is not one anybody holds.
 */
export function leaseIsLive(leaseExpiresAt: string | null, nowMs: number): boolean {
  if (leaseExpiresAt === null) return false;
  const expires = Date.parse(leaseExpiresAt);
  return !Number.isNaN(expires) && expires > nowMs;
}

/**
 * The run status to store. A run that passed while reporting no tests, no passes, no failures
 * and no flakes has produced no evidence, so `passed` is not available to it; `interrupted` is
 * the existing "finished without a determinate outcome" value, which keeps the status
 * vocabulary at four members and needs no migration.
 */
export function runStatusFor(
  derived: Pick<DerivedRunState, 'outcome' | 'status'>,
  completion: Pick<JobCompletionInput, 'summary' | 'tests'>,
): DerivedRunState['status'] | 'interrupted' {
  const total = completion.summary?.total ?? completion.tests?.length ?? 0;
  const reportedNothing =
    total === 0 &&
    (completion.summary?.passed ?? 0) === 0 &&
    (completion.summary?.failed ?? 0) === 0 &&
    (completion.summary?.flaky ?? 0) === 0;
  return derived.outcome === 'passed' && reportedNothing ? 'interrupted' : derived.status;
}

/** What the quality gate is told about the browser domain, from the run's outcome. */
export function browserGateStatus(
  outcome: RunOutcome | undefined,
): 'passed' | 'failed' | 'warning' | 'unknown' {
  if (outcome === 'passed' || outcome === 'failed') return outcome;
  return outcome === 'partial' ? 'warning' : 'unknown';
}

// ── Appending events ────────────────────────────────────────────────────────────────────

/** One event of a batch once it has been checked, ready to be written or skipped. */
export interface PlannedEvent {
  input: ExecutionEventInput;
  hash: string;
  eventKey: string;
  /** Already stored with the same content: acknowledged, not written again. */
  duplicate: boolean;
}

export type BatchPlan =
  { kind: 'conflict'; results: EventApplyResult[] } | { kind: 'ready'; events: PlannedEvent[] };

export interface BatchContext {
  inputs: readonly ExecutionEventInput[];
  runId: string;
  /** `event_key` to stored hash, for the keys in this batch only. */
  storedHashes: ReadonlyMap<string, string>;
  /** The sequence the next new event must carry. */
  nextSequence: number;
  /** A terminal event was already appended by an earlier batch. */
  alreadyTerminal: boolean;
  hashOf: (input: ExecutionEventInput) => string;
}

/**
 * The run state an event asks for, or undefined when it asks for none.
 *
 * phase and outcome are derived together from the phase, never taken independently from the
 * payload. Writing them separately made the CHECK on 
uns reachable by a client's choice, which
 * rolled the transaction back and surfaced as a 500 for a merely malformed request.
 */
export function eventRunState(input: ExecutionEventInput): DerivedRunState | undefined {
  const payload = input.payload ?? {};
  const requested = input.type === 'run.completed' ? 'complete' : payload['phase'];
  return isRequestablePhase(requested) ? deriveRunState(requested, payload['outcome']) : undefined;
}

/** Every event of a batch refused for one reason, as when the lease is stale. */
export function refuseBatch(
  inputs: readonly ExecutionEventInput[],
  reason: string,
): EventApplyResult[] {
  return inputs.map((event) => ({
    eventId: event.eventId,
    sequence: event.sequence,
    status: 'conflict' as const,
    reason,
  }));
}

function conflict(
  input: ExecutionEventInput,
  reason: string,
  hash: string,
): { kind: 'conflict'; results: EventApplyResult[] } {
  return {
    kind: 'conflict',
    results: [
      { eventId: input.eventId, sequence: input.sequence, status: 'conflict', reason, hash },
    ],
  };
}

/** An event is terminal when it is the run's completion, or says so in its payload. */
function endsTheRun(input: ExecutionEventInput): boolean {
  return input.type === 'run.completed' || input.payload?.['terminal'] === true;
}

/**
 * Why one event cannot be taken, or null. A stored event with different content is a hash
 * mismatch and the same content is a replay; anything new after the run ended is refused, in
 * or out of sequence; and a new event must carry exactly the next sequence.
 */
function refusalReason(
  storedHash: string | undefined,
  hash: string,
  incoming: number,
  expected: number,
  terminal: boolean,
): string | null {
  if (storedHash !== undefined) return storedHash === hash ? null : 'event_hash_mismatch';
  if (terminal) return 'terminal_event';
  return incoming === expected ? null : 'sequence_gap';
}
/**
 * Check a batch against what is already stored, and say which events to write.
 *
 * The first problem ends the plan, and the whole batch is refused with that one result, because
 * a partly accepted batch would leave the run's sequence somewhere the runner cannot reason
 * about. Order matters and is the order the checks were always made in: a stored event with
 * different content is a hash mismatch; a new event out of sequence is a gap (or a terminal
 * event, when the run has already ended); and anything new after a terminal event is refused.
 */
export function planEventBatch(context: BatchContext): BatchPlan {
  const seen = new Map(context.storedHashes);
  const events: PlannedEvent[] = [];
  let sequence = context.nextSequence;
  let terminal = context.alreadyTerminal;
  for (const input of context.inputs) {
    const hash = context.hashOf(input);
    const eventKey = `${context.runId}:${input.eventId}`;
    const reason = refusalReason(seen.get(eventKey), hash, input.sequence, sequence, terminal);
    if (reason) return conflict(input, reason, hash);
    const duplicate = seen.has(eventKey);
    events.push({ input, hash, eventKey, duplicate });
    if (duplicate) continue;
    seen.set(eventKey, hash);
    sequence += 1;
    if (endsTheRun(input)) terminal = true;
  }
  return { kind: 'ready', events };
}
