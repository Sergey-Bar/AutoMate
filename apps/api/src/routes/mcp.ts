import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { domainErrorResponse } from '../errors/boundary.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { createMcpServer, type McpLog } from '../mcp/server.js';
import type { McpScope } from '../mcp/tools.js';
import type { RepoHealthOptions } from '../services/repo-health-service.js';

/**
 * The read-only MCP server, over Streamable HTTP, at `/api/v1/mcp`.
 *
 * ## Who may call it
 *
 * **Not a public route.** The same caller resolver every route uses decides, and the guard is
 * `viewer`: an access token with the viewer role or above, the installation session, or —
 * with `ACCESS_CONTROL=open`, which the exposure policy confines to loopback — the single
 * operator ADR-006 describes. An `uploader` token is a CI credential that may send reports and
 * read nothing, so it is refused here as it is on every read route. A caller pinned to one
 * project (`uploaderFor`) reads only that project: the pin is carried into every tool.
 *
 * Every read is the workspace's: `health.workspaceId` is the composition root's, and a token
 * from another workspace does not authenticate at all.
 *
 * ## Stateless
 *
 * One server and one transport per request, no session id, JSON responses rather than an SSE
 * stream: a read-only server has nothing to push, so `GET` — the stream a server would push
 * on — answers 405 as the transport specification allows, after the caller is checked.
 */
export interface McpRouteOptions {
  access: CallerResolver;
  health: RepoHealthOptions;
  history?: McpScope['history'] | undefined;
  /** Where a tool's server-side failure is logged; console.error when absent. */
  log?: McpLog | undefined;
}

/** One JSON-RPC request is small; a megabyte is far above any tool call this server takes. */
export const MCP_MAX_BYTES = 1024 * 1024;

export function createMcpRoutes(options: McpRouteOptions): Hono {
  const app = new Hono();
  const viewer = requireRole('viewer', options.access);

  app.get('/api/v1/mcp', viewer, (context) =>
    context.json(
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'This server pushes nothing: POST JSON-RPC requests.' },
        id: null,
      },
      405,
      { allow: 'POST' },
    ),
  );

  app.post(
    '/api/v1/mcp',
    viewer,
    bodyLimit({
      maxSize: MCP_MAX_BYTES,
      onError: (context) =>
        domainErrorResponse(
          context,
          new DomainError(ErrorCode.PAYLOAD_TOO_LARGE, 'An MCP request larger than 1 MiB'),
        ),
    }),
    async (context) => {
      const caller = await callerOf(context, options.access);
      const server = createMcpServer(
        {
          health: options.health,
          ...(options.history === undefined ? {} : { history: options.history }),
          pinned: caller.uploaderFor,
        },
        options.log,
      );
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      try {
        return await transport.handleRequest(context.req.raw);
      } finally {
        await server.close();
      }
    },
  );

  return app;
}
