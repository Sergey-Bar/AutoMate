/**
 * Whether a run status is one a run does not leave.
 *
 * The contract already draws the line for *test* statuses — `TerminalCanonicalTestStatus`
 * is `CanonicalTestStatus` minus `queued` and `running` — and the same distinction
 * applies to a run: a run that is `passed`, `failed`, `cancelled` or `timed_out` has
 * concluded, and a request that moves it is asking to un-conclude a run.
 *
 * This derives the run answer from the run statuses the contract already publishes
 * rather than declaring a second list, because two lists is how they come to disagree
 * — and a gate here that disagrees with the contract is a gate that lets a concluded
 * run back into flight.
 */
import { PERSISTED_RUN_STATUS_VALUES } from '@automate/shared-contracts';

/**
 * The statuses a run does not leave once it reaches them.
 *
 * `RUN_STATUS_VALUES` is `running`, `passed`, `failed`, `interrupted`, `queued`, and
 * only the first is a run still in progress — so everything else has concluded. The
 * list is derived from the contract's own values rather than written out, because a
 * second hand-maintained list of terminal states is exactly how a gate here comes to
 * disagree with the statuses the column can actually hold.
 */
export const TERMINAL_RUN_STATUSES: readonly string[] = PERSISTED_RUN_STATUS_VALUES.filter(
  (status) => status !== 'running',
);

const terminal = new Set(TERMINAL_RUN_STATUSES);

/**
 * @param status the run's current status
 * @returns true when the run has concluded and should not be moved
 */
export function isTerminalRunStatus(status: string | null | undefined): boolean {
  if (status === null || status === undefined) return false;
  return terminal.has(status);
}
