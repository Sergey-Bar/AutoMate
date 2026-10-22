import type { ToolErrorKind } from './errors.js';

/** A classified failure. Returned by dispatch, never thrown by it. */
export interface ToolFailure {
  kind: ToolErrorKind;
  /** Stable, caller-readable. `AGENT_*` for everything the SDK itself decides. */
  code: string;
  message: string;
  domain: string;
  action: string;
  /** Attempts actually made. 0 when the request never reached an adapter. */
  attempts: number;
}

export const NOT_CONFIGURED_CODE = 'AGENT_NOT_CONFIGURED';
export const ROUTE_NOT_FOUND_CODE = 'AGENT_ROUTE_NOT_FOUND';
export const ACTION_NOT_FOUND_CODE = 'AGENT_ACTION_NOT_FOUND';

/**
 * The failure for a pair nothing can execute, worded exactly as `routes/agents.ts` words its
 * `501`: `<domain>.<action> has no configured execution adapter`.
 */
export function notConfigured(domain: string, action: string): ToolFailure {
  return {
    kind: 'configuration',
    code: NOT_CONFIGURED_CODE,
    message: `${domain}.${action} has no configured execution adapter`,
    domain,
    action,
    attempts: 0,
  };
}

/** The HTTP-shaped rendering of a failure. Data only: this package serves nothing. */
export interface AgentProblem {
  httpStatus: 400 | 404 | 501 | 502 | 503;
  body: Record<string, unknown>;
}

/**
 * Render a failure in the flat body shape `routes/agents.ts` already answers with - no
 * `error` wrapper, no `requestId`, key order `status, implemented, code, ..., message`.
 *
 * - `configuration` -> 501 `not_configured`, byte for byte what the route sends today.
 * - the two route refusals -> 404 `not_implemented`, likewise.
 * - other `invalid_input` -> 400; `retryable` -> 503; `tool_failure` -> 502.
 *
 * Only the first two exist on the wire today; the rest are the answers an adapter makes
 * possible, chosen so a caller can tell "you were wrong" from "it is down" from "it broke".
 */
export function toAgentProblem(failure: ToolFailure): AgentProblem {
  if (failure.kind === 'invalid_input' && isRouteRefusal(failure.code)) {
    return {
      httpStatus: 404,
      body: {
        status: 'not_implemented',
        implemented: false,
        code: failure.code,
        message: failure.message,
      },
    };
  }
  if (failure.kind === 'configuration') {
    return {
      httpStatus: 501,
      body: {
        status: 'not_configured',
        implemented: false,
        code: failure.code,
        domain: failure.domain,
        action: failure.action,
        message: failure.message,
      },
    };
  }
  const answered = {
    implemented: true,
    code: failure.code,
    domain: failure.domain,
    action: failure.action,
    attempts: failure.attempts,
    message: failure.message,
  };
  if (failure.kind === 'invalid_input') {
    return { httpStatus: 400, body: { status: 'invalid_input', ...answered } };
  }
  if (failure.kind === 'retryable') {
    return { httpStatus: 503, body: { status: 'unavailable', ...answered } };
  }
  return { httpStatus: 502, body: { status: 'tool_failure', ...answered } };
}

function isRouteRefusal(code: string): boolean {
  return code === ROUTE_NOT_FOUND_CODE || code === ACTION_NOT_FOUND_CODE;
}
