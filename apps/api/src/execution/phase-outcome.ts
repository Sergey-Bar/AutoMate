import type { RunOutcome, RunPhase } from './types.js';

/**
 * The run's terminal state, derived as one value.
 *
 * The database enforces `runs_phase_outcome_check`: a run is terminal exactly
 * when its outcome is not null. Both stores used to write `phase` and `outcome`
 * *independently*, taking the outcome straight from an event payload — which is
 * attacker-controlled. Two consequences, both bad:
 *
 *  - a payload pairing a non-terminal phase with an outcome, or a terminal phase
 *    with none, violated the CHECK, rolled the whole transaction back, and
 *    surfaced as an unhandled 500 for a request that was simply malformed;
 *  - a payload could name any outcome it liked, so a `queued` run could claim
 *    `passed` without a single test having run.
 *
 * Deriving the pair from the phase makes the CHECK unreachable by construction
 * and removes the payload's authority over the outcome entirely.
 */

/**
 * Every phase a run can be in, in one list.
 *
 * This used to be two: a "requestable" list in the event handler and a
 * "terminal" list next to it, and a third pair inside the in-memory store. They
 * disagreed — the handler accepted `gate_evaluation` while the module named
 * phases that do not exist — which is how a second vocabulary gets created in
 * the first place. One list, one purpose: this is the phase vocabulary.
 */
export const RUN_PHASES: readonly RunPhase[] = [
  'queued',
  'assigned',
  'preparing',
  'running',
  'collecting',
  'normalizing',
  'analyzing',
  'gate_evaluation',
  'complete',
  'cancelled',
  'timed_out',
  'runner_lost',
  'infra_failed',
  'config_failed',
  'blocked',
  'partial',
] as const satisfies readonly RunPhase[];

const RUN_PHASE_SET: ReadonlySet<string> = new Set<string>(RUN_PHASES);

/** Phases after which no further progress is possible. */
export const TERMINAL_PHASES: readonly RunPhase[] = [
  'complete',
  'cancelled',
  'timed_out',
  'runner_lost',
  'infra_failed',
  'config_failed',
  'blocked',
  'partial',
] as const;

const TERMINAL_PHASE_SET: ReadonlySet<string> = new Set<string>(TERMINAL_PHASES);

export function isTerminalPhase(phase: RunPhase | null | undefined): boolean {
  return phase !== null && phase !== undefined && TERMINAL_PHASE_SET.has(phase);
}

/** True when a runner may name this phase in a `run.phase` event. */
export function isRequestablePhase(phase: unknown): phase is RunPhase {
  return typeof phase === 'string' && RUN_PHASE_SET.has(phase);
}

/** The outcome each terminal phase implies, when the payload does not name one. */
const PHASE_OUTCOME: Partial<Record<RunPhase, RunOutcome>> = {
  cancelled: 'cancelled',
  timed_out: 'timed_out',
  runner_lost: 'runner_lost',
  infra_failed: 'infra_failed',
  config_failed: 'config_failed',
  blocked: 'blocked',
  partial: 'partial',
};

/** Outcomes a payload may name on a `complete` run. `null` is not one. */
const COMPLETE_OUTCOMES: readonly Exclude<RunOutcome, null>[] = [
  'passed',
  'failed',
  'unknown',
  'partial',
  'cancelled',
  'timed_out',
  'runner_lost',
  'infra_failed',
  'config_failed',
  'blocked',
] as const;

const COMPLETE_OUTCOME_SET: ReadonlySet<string> = new Set<string>(COMPLETE_OUTCOMES);

/** Run statuses. `queued` is the DB default, not something this wave produces. */
export type RunStatus = 'running' | 'passed' | 'failed' | 'interrupted';

export interface DerivedRunState {
  phase: RunPhase;
  outcome: RunOutcome;
  status: RunStatus;
  /** True when the run has reached a phase it cannot leave. */
  terminal: boolean;
}

/**
 * Derives `phase`, `outcome` and `status` together from the requested phase and
 * the payload's claimed outcome.
 *
 * The payload can only choose the outcome for a `complete` run, and only from
 * the declared vocabulary; anything else falls back to the phase's own implied
 * outcome, or `unknown`. A payload naming an outcome for a non-terminal phase is
 * ignored rather than honoured.
 */
export function deriveRunState(requestedPhase: RunPhase, claimedOutcome: unknown): DerivedRunState {
  if (!isTerminalPhase(requestedPhase)) {
    // A non-terminal run has no outcome. Whatever the payload claimed is dropped:
    // this is the injection vector, and dropping it is what makes
    // `runs_phase_outcome_check` unreachable.
    return { phase: requestedPhase, outcome: null, status: 'running', terminal: false };
  }

  const implied = PHASE_OUTCOME[requestedPhase] ?? null;
  if (requestedPhase !== 'complete') {
    // Every terminal phase other than `complete` implies its own outcome, so a
    // payload cannot reclassify a cancelled run as passed.
    return { phase: requestedPhase, outcome: implied, status: 'interrupted', terminal: true };
  }

  const claimed =
    typeof claimedOutcome === 'string' && COMPLETE_OUTCOME_SET.has(claimedOutcome)
      ? (claimedOutcome as RunOutcome)
      : undefined;

  const outcome: RunOutcome = claimed ?? implied ?? 'unknown';
  const status: RunStatus = outcome === 'passed' ? 'passed' : 'failed';
  return { phase: requestedPhase, outcome, status, terminal: true };
}
