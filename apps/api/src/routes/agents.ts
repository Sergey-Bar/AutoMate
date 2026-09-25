import { Hono } from 'hono';

const DOMAINS = new Set(['browser', 'api', 'load', 'security', 'mobile']);
const ACTIONS = new Set(['generate', 'run', 'scan']);

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
      return c.json(
        {
          status: 'not_implemented',
          implemented: false,
          code: 'AGENT_ROUTE_NOT_FOUND',
          message: 'Agent route is not implemented',
        },
        404,
      );
    }
    return c.json(
      {
        status: 'not_configured',
        implemented: false,
        code: 'AGENT_NOT_CONFIGURED',
        domain,
        action,
        message: `${domain}.${action} has no configured execution adapter`,
      },
      501,
    );
  });
  app.get('/api/v1/agents/:domain', (c) => {
    const domain = c.req.param('domain');
    if (!DOMAINS.has(domain))
      return c.json(
        {
          status: 'not_implemented',
          implemented: false,
          code: 'AGENT_UNKNOWN',
          message: 'Agent domain is not registered',
        },
        404,
      );
    return c.json(
      {
        status: 'not_configured',
        implemented: false,
        code: 'AGENT_NOT_CONFIGURED',
        domain,
        message: `${domain} has no configured execution adapter`,
      },
      501,
    );
  });
  return app;
}
