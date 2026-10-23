/**
 * execution-bridge.ts — the generic bridge from an agent action to the execution pipeline.
 *
 * Every agent domain whose tool already runs *as an execution job* (browser today; api and
 * load once a runner image carries them) does the same three things: validate its own input,
 * turn it into a run request, and hand that to the execution store. Only the middle step
 * differs per domain, so it is the only thing a domain supplies:
 *
 * ```ts
 * registry.register(
 *   defineAcceptedRunOperation({ domain: 'load', action: 'run', input: LoadRunInputSchema }),
 *   createExecutionBridgeAdapter({
 *     id: 'load.execution',
 *     store, workspaceId, requireIdempotencyKey,
 *     toRunRequest: (input) => ({ ...fields the load runner reads }),
 *   }),
 * );
 * ```
 *
 * The bridge never creates a job itself: it calls `submitRun`, which `POST /api/v1/runs` also
 * calls, so an agent-created run and an API-created run are the same thing in the same table.
 * It does not wait for the run: the operation's answer is the accepted run and its links, and
 * status is read through the runs API.
 */
import { randomUUID } from 'node:crypto';
import type { z } from 'zod/v4';
import { AgentAcceptedRunSchema, type AgentAcceptedRun } from '@automate/shared-contracts';
import {
  ToolFailureError,
  ToolInputError,
  defineOperation,
  type AgentAction,
  type AgentAdapter,
  type AgentDomain,
  type ToolOperation,
} from '@automate/tool-sdk';
import { DomainError } from '../errors/domain-error.js';
import { submitRun, type SubmittableRun } from '../execution/run-submission.js';
import type { CreateRunResult, ExecutionStore } from '../execution/types.js';

/** What every bridged operation's input may carry besides its own fields. */
export interface BridgedInput {
  idempotencyKey?: string | undefined;
}

export const EXECUTION_STORE_FAILED_CODE = 'AGENT_EXECUTION_STORE_FAILED';

export interface ExecutionBridgeOptions<I extends BridgedInput> {
  /** The adapter's id, for logs and the registry's error messages. */
  id: string;
  store: ExecutionStore;
  /** The one tenancy boundary: every run the bridge creates belongs to this workspace. */
  workspaceId: string;
  /** Mirrors `POST /api/v1/runs`: required in production, generated otherwise. */
  requireIdempotencyKey: boolean;
  /** The domain-specific part: the run request this validated input stands for. */
  toRunRequest(input: I): SubmittableRun;
}

/** The location of a run's status, events and artifacts, all served by the runs API. */
export function runLinks(runId: string): AgentAcceptedRun['links'] {
  const run = `/api/v1/runs/${encodeURIComponent(runId)}`;
  return { run, events: `${run}/events`, artifacts: `${run}/artifacts` };
}

/** Resolve the key a request runs under, or refuse it as the runs API would. */
function resolveKey(supplied: string | undefined, required: boolean): string {
  if (supplied !== undefined) return supplied;
  if (required) {
    throw new ToolInputError('An idempotency key is required (Idempotency-Key header)');
  }
  return randomUUID();
}

/**
 * Store failures, as the tool-sdk classifies them. A 4xx `DomainError` is the caller's fault
 * and keeps its wording; anything else is reported without its message, which can carry
 * connection strings or SQL.
 */
function classifyStoreFailure(error: unknown): Error {
  if (error instanceof DomainError && error.status < 500) return new ToolInputError(error.message);
  return new ToolFailureError(
    EXECUTION_STORE_FAILED_CODE,
    'The execution store could not accept the run',
  );
}

/** An adapter that queues `toRunRequest(input)` in the configured workspace. */
export function createExecutionBridgeAdapter<I extends BridgedInput>(
  options: ExecutionBridgeOptions<I>,
): AgentAdapter<I> {
  return {
    id: options.id,
    async execute({ input }): Promise<CreateRunResult> {
      const key = resolveKey(input.idempotencyKey, options.requireIdempotencyKey);
      try {
        return await submitRun(
          { store: options.store, workspaceId: options.workspaceId },
          options.toRunRequest(input),
          key,
        );
      } catch (error) {
        throw classifyStoreFailure(error);
      }
    },
  };
}

export interface AcceptedRunOperationSpec<I> {
  domain: AgentDomain;
  action: AgentAction;
  input: z.ZodType<I>;
  /** Per attempt; acceptance is a single store write, so this is short. */
  timeoutMs?: number;
}

/**
 * Declare an operation whose answer is "accepted, here is the run".
 *
 * Never retried (`retries: 0`, not idempotent): a retry after an unknown outcome could queue a
 * second run, and the caller already has the remedy - send an `Idempotency-Key` and repeat.
 */
export function defineAcceptedRunOperation<I>(
  spec: AcceptedRunOperationSpec<I>,
): ToolOperation<I, AgentAcceptedRun> {
  return defineOperation<I, AgentAcceptedRun>({
    domain: spec.domain,
    action: spec.action,
    input: spec.input,
    output: AgentAcceptedRunSchema,
    idempotent: false,
    retries: 0,
    timeoutMs: spec.timeoutMs ?? 10_000,
    normalise: (raw) => {
      const created = raw as CreateRunResult;
      return {
        status: 'accepted',
        domain: spec.domain,
        action: spec.action,
        runId: created.run.id,
        jobId: created.job.id,
        phase: created.run.phase,
        duplicate: created.duplicate,
        links: runLinks(created.run.id),
      } satisfies AgentAcceptedRun;
    },
  });
}
