import { Hono } from 'hono';
import { AgentRequestSchema } from '@automate/shared-contracts';
import { AGENT_DOMAINS } from './agent-registry.js';

/**
 * The registered domains and actions.
 *
 * Both are read from the contract that declares them, and the domains come from
 * `agent-registry.ts` so `/api/v1/features` — which used to answer
 * `features: {}` from a literal while this route listed five domains from a
 * hand-written array — cannot report a different set. One process, two
 * endpoints, one answer.
 *
 * They were hand-written arrays in this file beside the `AgentDomainSchema` and
 * `AgentRequestSchema` that declare exactly those values, in a route that served
 * them and imported neither. Adding a domain to the contract would have left this
 * endpoint rejecting it while the contract said it existed, and nothing would
 * have said so, because both files were individually correct. The same defect
 * class the repository has already fixed twice ("the event allowlist is derived").
 *
 * `AgentRequestSchema.shape.action` rather than a second exported constant: the
 * action vocabulary is a property of the request, so reading it from the request
 * is what makes the two impossible to separate.
 */
const DOMAINS = new Set<string>(AGENT_DOMAINS);
const ACTIONS = new Set<string>(
  (AgentRequestSchema.shape['action'] as { options: string[] }).options,
);

/**
 * The one builder for all four agent failure bodies.
 *
 * **Not** `domainErrorResponse` from `errors/boundary.ts`. These bodies are flat —
 * no `error` wrapper, no `requestId`, no nesting — so the boundary's shape would change
 * every byte on the wire. It is also wrong on status: 501 is `>= 500`, so
 * `DomainError.toBody` would replace every message with `'internal error'` and drop
 * `details` unless each error were built `callerSafe`.
 *
 * Key order is `status, implemented, code, …` and is **not** alphabetical. Nothing in
 * `apps/web` reads these bodies and `agents.test.ts` asserts only status codes and
 * `integrations.length`, so the order is free — which is exactly why it is pinned by a
 * test rather than left to whatever a builder happens to emit. The shape is preserved
 * deliberately, not tidied.
 */
function agentError(
  status: 'not_implemented' | 'not_configured',
  httpStatus: 404 | 501,
  code: string,
  message: string,
  extra: Record<string, string> = {},
): { body: Record<string, unknown>; httpStatus: 404 | 501 } {
  return {
    httpStatus,
    body: { status, implemented: false, code, ...extra, message },
  };
}

export function createAgentRoutes(): Hono {
  const app = new Hono();
  app.get('/api/v1/agents', (c) =>
    c.json({
      integrations: [...DOMAINS].map((domain) => ({
        domain,
        status: 'not_configured',
        implemented: false,
      })),
    }),
  );
  app.post('/api/v1/agents/:domain/:action', (c) => {
    const domain = c.req.param('domain');
    const action = c.req.param('action');
    // The two halves are refused separately. One opaque 404 for both meant a caller
    // could not tell "I do not know this tool" from "that verb does not exist on
    // any tool" — and the second is a bug in the caller that the first hides.
    if (!DOMAINS.has(domain)) {
      const error = agentError(
        'not_implemented',
        404,
        'AGENT_ROUTE_NOT_FOUND',
        'Agent route is not implemented',
      );
      return c.json(error.body, error.httpStatus);
    }
    if (!ACTIONS.has(action)) {
      const error = agentError(
        'not_implemented',
        404,
        'AGENT_ACTION_NOT_FOUND',
        `Action is not available on any agent. Supported: ${[...ACTIONS].join(', ')}`,
      );
      return c.json(error.body, error.httpStatus);
    }
    const error = agentError(
      'not_configured',
      501,
      'AGENT_NOT_CONFIGURED',
      `${domain}.${action} has no configured execution adapter`,
      { domain, action },
    );
    return c.json(error.body, error.httpStatus);
  });
  app.get('/api/v1/agents/:domain', (c) => {
    const domain = c.req.param('domain');
    if (!DOMAINS.has(domain)) {
      const error = agentError(
        'not_implemented',
        404,
        'AGENT_UNKNOWN',
        'Agent domain is not registered',
      );
      return c.json(error.body, error.httpStatus);
    }
    const error = agentError(
      'not_configured',
      501,
      'AGENT_NOT_CONFIGURED',
      `${domain} has no configured execution adapter`,
      { domain },
    );
    return c.json(error.body, error.httpStatus);
  });
  return app;
}
