import {
  ConnectorHttpError,
  ConnectorInputError,
  executeWithRetry,
  isRetryableStatus,
} from '@automate/connectors-sdk';
import { raceAbort } from './abort.js';
import {
  ToolCancelledError,
  ToolConfigurationError,
  ToolFailureError,
  ToolTimeoutError,
} from './errors.js';
import {
  AGENT_ACTIONS,
  AGENT_DOMAINS,
  type AgentAction,
  type AgentDomain,
  type ToolOperation,
} from './operation.js';
import {
  ACTION_NOT_FOUND_CODE,
  NOT_CONFIGURED_CODE,
  ROUTE_NOT_FOUND_CODE,
  notConfigured,
  type ToolFailure,
} from './problem.js';

/** What an adapter is handed for one attempt. */
export interface AdapterCall<I> {
  readonly domain: AgentDomain;
  readonly action: AgentAction;
  /** Already validated by the operation's input schema. */
  readonly input: I;
  /** Aborts on the caller's cancellation or the attempt's deadline. Honour it if you can. */
  readonly signal: AbortSignal | undefined;
  /** 1 for the first attempt. */
  readonly attempt: number;
}

/**
 * The port other packages and apps implement to run a tool.
 *
 * It returns the tool's **raw** output and the operation's `normalise` turns that into the
 * canonical result, so an adapter never needs to know the canonical shape and the shape is
 * never re-implemented per tool. Throw the classes in `errors.ts` to say what went wrong; any
 * other throw is a `tool_failure`.
 *
 * Whatever implements this - spawning a process, calling a runner, reading a report - lives
 * outside this package. This package performs no I/O.
 */
export interface AgentAdapter<I = unknown> {
  readonly id: string;
  execute(call: AdapterCall<I>): Promise<unknown>;
}

export interface DispatchContext {
  /** The caller's cancellation. */
  signal?: AbortSignal;
  /** Replaces the backoff sleep, so a test does not wait it out. */
  sleep?: (ms: number) => Promise<void>;
}

export type DispatchResult<O> =
  { ok: true; value: O; attempts: number } | { ok: false; failure: ToolFailure };

export interface ToolRegistry {
  /**
   * Bind an adapter to an operation.
   * @throws {Error} if the pair already has one - two adapters for one pair is two authorities
   */
  register<I, O>(operation: ToolOperation<I, O>, adapter: AgentAdapter<I>): void;
  has(domain: string, action: string): boolean;
  /** Domains with at least one registered operation, in the contract's order. */
  configuredDomains(): AgentDomain[];
  /**
   * Validate, execute and normalise. Never throws: every outcome is a value, so a caller
   * cannot forget the failure path.
   */
  dispatch(
    domain: string,
    action: string,
    input: unknown,
    context?: DispatchContext,
  ): Promise<DispatchResult<unknown>>;
}

type Entry = (input: unknown, context: DispatchContext) => Promise<DispatchResult<unknown>>;

const key = (domain: string, action: string): string => `${domain}.${action}`;

export function createToolRegistry(): ToolRegistry {
  const entries = new Map<string, Entry>();
  const domains = new Set<AgentDomain>();

  return {
    register(operation, adapter) {
      const id = key(operation.domain, operation.action);
      if (entries.has(id)) throw new Error(`${id} is already registered`);
      entries.set(id, (input, context) => run(operation, adapter, input, context));
      domains.add(operation.domain);
    },
    has: (domain, action) => entries.has(key(domain, action)),
    configuredDomains: () => AGENT_DOMAINS.filter((domain) => domains.has(domain)),
    async dispatch(domain, action, input, context = {}) {
      const refusal = refuseUnknownRoute(domain, action);
      if (refusal !== undefined) return { ok: false, failure: refusal };
      const entry = entries.get(key(domain, action));
      if (entry === undefined) return { ok: false, failure: notConfigured(domain, action) };
      return entry(input, context);
    },
  };
}

/** The two 404s of `routes/agents.ts`, in its order: the domain is judged first. */
function refuseUnknownRoute(domain: string, action: string): ToolFailure | undefined {
  if (!AGENT_DOMAINS.some((known) => known === domain)) {
    return {
      kind: 'invalid_input',
      code: ROUTE_NOT_FOUND_CODE,
      message: 'Agent route is not implemented',
      domain,
      action,
      attempts: 0,
    };
  }
  if (!AGENT_ACTIONS.some((known) => known === action)) {
    return {
      kind: 'invalid_input',
      code: ACTION_NOT_FOUND_CODE,
      message: `Action is not available on any agent. Supported: ${AGENT_ACTIONS.join(', ')}`,
      domain,
      action,
      attempts: 0,
    };
  }
  return undefined;
}

async function run<I, O>(
  operation: ToolOperation<I, O>,
  adapter: AgentAdapter<I>,
  rawInput: unknown,
  context: DispatchContext,
): Promise<DispatchResult<unknown>> {
  const { domain, action } = operation;
  const fail = (
    kind: ToolFailure['kind'],
    code: string,
    message: string,
    attempts: number,
  ): DispatchResult<unknown> => ({
    ok: false,
    failure: { kind, code, message, domain, action, attempts },
  });

  const parsed = operation.input.safeParse(rawInput);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
      .join('; ');
    return fail('invalid_input', 'AGENT_INVALID_INPUT', message, 0);
  }
  const callerGaveUp = (): boolean => context.signal?.aborted === true;
  if (callerGaveUp()) {
    return fail('tool_failure', 'AGENT_CANCELLED', 'Tool operation cancelled', 0);
  }

  let attempt = 0;
  let raw: unknown;
  let attempts: number;
  try {
    const outcome = await executeWithRetry(
      (signal) => {
        attempt += 1;
        return raceAbort(
          adapter.execute({ domain, action, input: parsed.data, signal, attempt }),
          signal,
        );
      },
      {
        retries: operation.retries,
        idempotent: operation.idempotent,
        attemptTimeoutMs: operation.timeoutMs,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        ...(context.sleep === undefined ? {} : { sleep: context.sleep }),
      },
    );
    raw = outcome.value;
    attempts = outcome.attempts;
  } catch (error) {
    // `executeWithRetry` stamps the real count on the errors it gives up on; anything else
    // failed on the attempt that was running.
    const made = error instanceof ConnectorHttpError ? error.attempts : attempt;
    const classified = callerGaveUp()
      ? {
          kind: 'tool_failure' as const,
          code: 'AGENT_CANCELLED',
          message: 'Tool operation cancelled',
        }
      : classify(error);
    return fail(classified.kind, classified.code, classified.message, made);
  }

  let normalised: unknown;
  try {
    normalised = operation.normalise(raw, parsed.data);
  } catch (error) {
    return fail(
      'tool_failure',
      'AGENT_OUTPUT_INVALID',
      `${key(domain, action)} output could not be normalised: ${messageOf(error)}`,
      attempts,
    );
  }
  const output = operation.output.safeParse(normalised);
  if (!output.success) {
    const detail = output.error.issues
      .map((issue) => `${issue.path.join('.') || 'result'}: ${issue.message}`)
      .join('; ');
    return fail(
      'tool_failure',
      'AGENT_OUTPUT_INVALID',
      `${key(domain, action)} produced output that is not a valid result: ${detail}`,
      attempts,
    );
  }
  return { ok: true, value: output.data, attempts };
}

function classify(error: unknown): Pick<ToolFailure, 'kind' | 'code' | 'message'> {
  const message = messageOf(error);
  if (error instanceof ToolConfigurationError) {
    return { kind: 'configuration', code: NOT_CONFIGURED_CODE, message };
  }
  if (error instanceof ConnectorInputError) {
    return { kind: 'invalid_input', code: 'AGENT_INVALID_INPUT', message };
  }
  if (error instanceof ToolFailureError) {
    return { kind: 'tool_failure', code: error.code, message };
  }
  if (error instanceof ToolCancelledError) {
    return { kind: 'tool_failure', code: 'AGENT_CANCELLED', message };
  }
  if (error instanceof ConnectorHttpError && isRetryableStatus(error.status)) {
    const code = error instanceof ToolTimeoutError ? 'AGENT_TIMEOUT' : 'AGENT_UNAVAILABLE';
    return { kind: 'retryable', code, message };
  }
  return { kind: 'tool_failure', code: 'AGENT_TOOL_FAILED', message };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
