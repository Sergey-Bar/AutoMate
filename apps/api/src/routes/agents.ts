import { Hono, type Context } from 'hono';
import { AgentAcceptedRunSchema } from '@automate/shared-contracts';
import {
  createToolRegistry,
  toAgentProblem,
  type ToolFailure,
  type ToolRegistry,
} from '@automate/tool-sdk';
import { AGENT_DOMAINS, createAgentCatalog, type AgentCatalog } from './agent-registry.js';

/**
 * The agent routes: a thin HTTP face over the tool-sdk registry.
 *
 * Every pair is dispatched through `registry.dispatch`, which decides — in this order — that
 * the domain exists, that the action exists, that an adapter is registered for the pair, that
 * the body is valid for it, and then runs it. The route renders the outcome:
 *
 * - an accepted run (an adapter that queued an execution job) -> `202` with `Location`;
 * - a refusal -> `toAgentProblem`'s status and flat body, which for the unknown-route and
 *   unconfigured cases is byte for byte what this file used to hand-write.
 *
 * The domains and actions are read from the contract (`AgentDomainSchema`, and the SDK's
 * `AGENT_ACTIONS`, which reads `AgentRequestSchema`) so adding one to the contract is served
 * without a second edit here — the same defect class the repository has fixed twice ("the
 * event allowlist is derived").
 *
 * The registry is injected: `index.ts` composes the one the process runs on, and an app built
 * with none has no adapters, so every pair answers `501 AGENT_NOT_CONFIGURED`.
 */
export interface AgentRoutesOptions {
  registry?: ToolRegistry;
}

/**
 * Large enough for any agent request - a handful of short fields - and the bound past which a
 * body is refused as invalid input without being parsed.
 */
const MAX_AGENT_BODY_BYTES = 64 * 1024;

/**
 * The one builder for the agent failure bodies the route itself decides (the `GET` ones).
 *
 * **Not** `domainErrorResponse` from `errors/boundary.ts`. These bodies are flat —
 * no `error` wrapper, no `requestId`, no nesting — so the boundary's shape would change
 * every byte on the wire. It is also wrong on status: 501 is `>= 500`, so
 * `DomainError.toBody` would replace every message with `'internal error'` and drop
 * `details` unless each error were built `callerSafe`.
 *
 * Key order is `status, implemented, code, …` and is **not** alphabetical. It is pinned by
 * `health-agents-consolidation.test.ts` rather than left to whatever a builder happens to emit.
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The JSON body, or `undefined` when there is none, it is not JSON or it is oversized — which
 * the operation's schema then refuses as invalid input, so a garbled body is a `400` and not a
 * `500`. The `Idempotency-Key` header is the runs API's way of supplying a key and is honoured
 * here the same way; a key in the body wins.
 */
async function readInput(c: Context): Promise<unknown> {
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_AGENT_BODY_BYTES) return undefined;
  const text = await c.req.text().catch(() => '');
  if (text.length > MAX_AGENT_BODY_BYTES) return undefined;
  const body = parseJson(text);
  const key = c.req.header('idempotency-key');
  if (key === undefined || typeof body !== 'object' || body === null || Array.isArray(body)) {
    return body;
  }
  return { idempotencyKey: key, ...body };
}

/** Insert `reason` immediately before `message`, keeping the flat body's key order. */
function withReason(body: Record<string, unknown>, reason: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).flatMap(([key, value]) =>
      key === 'message'
        ? [['reason', reason] as const, [key, value] as const]
        : [[key, value] as const],
    ),
  );
}

function refusal(c: Context, failure: ToolFailure, catalog: AgentCatalog): Response {
  const problem = toAgentProblem(failure);
  const reason =
    failure.kind === 'configuration'
      ? catalog.reasonFor(failure.domain, failure.action)
      : undefined;
  return c.json(
    reason === undefined ? problem.body : withReason(problem.body, reason),
    problem.httpStatus,
  );
}

function answer(c: Context, value: unknown): Response {
  const accepted = AgentAcceptedRunSchema.safeParse(value);
  if (!accepted.success) return c.json(value);
  c.header('Location', accepted.data.links.run);
  return c.json(accepted.data, 202);
}

function describeDomain(c: Context, domain: string, catalog: AgentCatalog): Response {
  if (!AGENT_DOMAINS.includes(domain)) {
    const error = agentError(
      'not_implemented',
      404,
      'AGENT_UNKNOWN',
      'Agent domain is not registered',
    );
    return c.json(error.body, error.httpStatus);
  }
  if (catalog.available(domain)) {
    return c.json({
      domain,
      status: 'configured',
      implemented: true,
      actions: catalog.actions(domain),
      unsupported: catalog.unsupportedReasons(domain),
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
}

export function createAgentRoutes(options: AgentRoutesOptions = {}): Hono {
  const registry = options.registry ?? createToolRegistry();
  const catalog = createAgentCatalog(registry);
  const app = new Hono();
  app.get('/api/v1/agents', (c) =>
    c.json({
      integrations: AGENT_DOMAINS.map((domain) =>
        catalog.available(domain)
          ? { domain, status: 'configured', implemented: true, actions: catalog.actions(domain) }
          : { domain, status: 'not_configured', implemented: false },
      ),
    }),
  );
  app.post('/api/v1/agents/:domain/:action', async (c) => {
    const result = await registry.dispatch(
      c.req.param('domain'),
      c.req.param('action'),
      await readInput(c),
    );
    return result.ok ? answer(c, result.value) : refusal(c, result.failure, catalog);
  });
  app.get('/api/v1/agents/:domain', (c) => describeDomain(c, c.req.param('domain'), catalog));
  return app;
}
