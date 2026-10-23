/**
 * run-submission.ts — the one place a run request becomes a queued run and job.
 *
 * `POST /api/v1/runs` and the agent bridge (`agents/execution-bridge.ts`) both hand a run to
 * the execution pipeline, and they must do it identically: same selection flattening, same
 * store call, same workspace binding, same idempotency semantics. This was inline in the
 * route handler; a second caller would have copied it, and two copies of "how a run is
 * created" is how the runs API and the agent API come to disagree about what a run is.
 */
import type { CreateRunInput, CreateRunResult, ExecutionStore } from './types.js';

/** A selection as the runs API accepts it: a flat list, or the structured form. */
export type RunSelection =
  | readonly string[]
  | { testIds?: readonly string[]; paths?: readonly string[]; tags?: readonly string[] };

/** A run request before its selection is flattened. */
export type SubmittableRun = Omit<CreateRunInput, 'selection'> & { selection?: RunSelection };

/** Where a run goes: a store, bound to one workspace. */
export interface RunSubmissionTarget {
  store: ExecutionStore;
  workspaceId: string;
}

/** The structured selection becomes the flat list the store holds: paths, then ids, then tags. */
export function flattenSelection(selection: RunSelection | undefined): string[] {
  if (selection === undefined) return [];
  if (Array.isArray(selection)) return [...selection];
  const structured = selection as Exclude<RunSelection, readonly string[]>;
  return [...(structured.paths ?? []), ...(structured.testIds ?? []), ...(structured.tags ?? [])];
}

/**
 * Queue a run (and its job) in the target's workspace.
 *
 * Idempotent on `idempotencyKey` within the workspace: a replay returns the original with
 * `duplicate: true` and creates nothing.
 */
export function submitRun(
  target: RunSubmissionTarget,
  request: SubmittableRun,
  idempotencyKey: string,
): Promise<CreateRunResult> {
  const input = { ...request, selection: flattenSelection(request.selection) } as CreateRunInput;
  return target.store.createRun(input, idempotencyKey, target.workspaceId);
}
