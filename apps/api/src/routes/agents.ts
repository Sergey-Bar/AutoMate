import { Hono } from 'hono';
import { AgentRequestSchema } from '@automate/shared-contracts';
import { AGENT_DOMAINS } from './agent-registry.js';
import { domainFor } from '@automate/tool-sdk';
import { runApiAgent } from '../agents/api-adapter.js';

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

export function createAgentRoutes(workspaceId = 'default-workspace'): Hono {
  const app = new Hono();
  // The one domain this product genuinely implements, and the only reason this
  // route is not a uniform 501. `domainFor` is the tool-sdk's registry, so "is this
  // implemented" has one answer in one place — the alternative is a second list of
  // implemented domains beside the contract's, and that list drifts.
  const IMPLEMENTED = new Set<string>(
    (['browser', 'api', 'load', 'security', 'mobile'] as const).filter(
      (domain) => domainFor(domain) !== null,
    ),
  );
  app.get('/api/v1/agents', (c) =>
    c.json({
      integrations: [...DOMAINS].map((domain) => ({
        domain,
        status: IMPLEMENTED.has(domain) ? 'implemented' : 'not_configured',
        implemented: IMPLEMENTED.has(domain),
      })),
    }),
  );
  app.post('/api/v1/agents/:domain/:action', async (c) => {
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
    if (domain === 'api') {
      // The one real domain. It proposes a task that names a failing test and
      // never writes — see `agents/api-adapter.ts` for why the absence of a write
      // path is structural rather than a promise.
      const body = AgentRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) {
        // A malformed body is **not** a 404. Answering `AGENT_ACTION_NOT_FOUND`
        // here would tell a caller their verb was wrong when the pair was
        // registered — the same opacity the two-half refusal above exists to
        // remove, reintroduced through the parse path.
        return c.json(
          {
            status: 'not_configured',
            implemented: true,
            code: 'AGENT_INVALID_REQUEST',
            message:
              'The api domain asks for a valid agent request: a domain, an action, and ' +
              'either a specPath or a metadata.testLocation naming the failing test.',
          },
          400,
        );
      }
      const outcome = runApiAgent(
        {
          domain: 'api',
          action: body.data.action,
          specPath: body.data.specPath,
          targetUrl: body.data.targetUrl,
          metadata: { ...(body.data.metadata ?? {}), summary: body.data.prompt },
          workspaceId,
        },
        () => Date.now(),
        () => globalThis.crypto.randomUUID(),
      );
      if (!outcome.ok) {
        // The adapter's refusal, in this route's own shape. A caller that cannot be
        // offered a checkable proposal is told so rather than given a 501 it would
        // have to interpret.
        const status = outcome.failure.code === 'INVALID_REQUEST_BODY' ? 400 : 501;
        return c.json(
          {
            status: 'not_configured',
            implemented: true,
            code: outcome.failure.code,
            message: outcome.failure.message,
          },
          status,
        );
      }
      return c.json({ ...outcome.result, implemented: true }, 200);
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
    if (IMPLEMENTED.has(domain)) {
      return c.json({
        domain,
        status: 'implemented',
        implemented: true,
        capabilities: domainFor(domain)?.capabilities ?? [],
        description: domainFor(domain)?.description ?? '',
      });
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
