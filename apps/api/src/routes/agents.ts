import { Hono } from 'hono';

const DOMAINS = new Set(['browser', 'api', 'load', 'security', 'mobile']);
const ACTIONS = new Set(['generate', 'run', 'scan']);

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
    if (!DOMAINS.has(domain) || !ACTIONS.has(action)) {
      const error = agentError(
        'not_implemented',
        404,
        'AGENT_ROUTE_NOT_FOUND',
        'Agent route is not implemented',
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
