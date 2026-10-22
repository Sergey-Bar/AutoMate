import { AgentDomainSchema, AgentRequestSchema } from '@automate/shared-contracts';
import type { AgentDomain, AgentRequest, CanonicalRunResult } from '@automate/shared-contracts';
import { CanonicalRunResultSchema } from '@automate/shared-contracts';
import type { z } from 'zod';

export type { AgentDomain };
export type AgentAction = AgentRequest['action'];

/**
 * Read from the contract that declares them, as `routes/agents.ts` does, so the SDK and the
 * route cannot disagree about what exists.
 */
export const AGENT_DOMAINS: readonly AgentDomain[] = AgentDomainSchema.options;
export const AGENT_ACTIONS: readonly AgentAction[] = AgentRequestSchema.shape.action.options;

/** Attempts after the first, when an operation does not say. */
export const DEFAULT_RETRIES = 2;

/**
 * One thing a tool can be asked to do: its input contract, how its raw output becomes the
 * canonical result, and the two facts the retry rule needs.
 *
 * `idempotent` has no default on purpose. It is the claim `executeWithRetry` turns into
 * "may repeat a request whose outcome is unknown", and an operation that has not decided it
 * has not earned the retry.
 */
export interface ToolOperation<I, O> {
  readonly domain: AgentDomain;
  readonly action: AgentAction;
  /** Validated before any adapter runs. The adapter receives the parsed value. */
  readonly input: z.ZodType<I>;
  /** The normalised result must satisfy this, or the operation fails as `AGENT_OUTPUT_INVALID`. */
  readonly output: z.ZodType<O>;
  /** Turns whatever the adapter returned into the shape `output` describes. May throw. */
  readonly normalise: (raw: unknown, input: I) => unknown;
  readonly idempotent: boolean;
  /** Attempts after the first. */
  readonly retries: number;
  /** Per attempt, enforced even against an adapter that ignores its signal. */
  readonly timeoutMs: number;
}

export interface ToolOperationSpec<I, O> {
  domain: AgentDomain;
  action: AgentAction;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  normalise: (raw: unknown, input: I) => unknown;
  idempotent: boolean;
  retries?: number;
  timeoutMs: number;
}

/**
 * Declare an operation, refusing a declaration that cannot behave: a timeout that could never
 * be met, or a retry budget that is not a count.
 *
 * @throws {RangeError} naming the field
 */
export function defineOperation<I, O>(spec: ToolOperationSpec<I, O>): ToolOperation<I, O> {
  const retries = spec.retries ?? DEFAULT_RETRIES;
  if (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs <= 0) {
    throw new RangeError(
      `${spec.domain}.${spec.action}: timeoutMs must be a positive integer, got ${String(spec.timeoutMs)}`,
    );
  }
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError(
      `${spec.domain}.${spec.action}: retries must be a non-negative integer, got ${String(retries)}`,
    );
  }
  return Object.freeze({ ...spec, retries });
}

/**
 * An operation whose result is the canonical run result `packages/reporting` and the reporter
 * ingest - what `run` and `scan` produce. `generate` produces something else, so it declares
 * its own `output` through {@link defineOperation}.
 */
export function runResultOperation<I>(
  spec: Omit<ToolOperationSpec<I, CanonicalRunResult>, 'output'>,
): ToolOperation<I, CanonicalRunResult> {
  return defineOperation({ ...spec, output: CanonicalRunResultSchema });
}
