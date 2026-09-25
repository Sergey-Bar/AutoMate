import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_CONTRACT_VERSION, MCP_ERROR_CODES, MCP_V1_TOOLS } from './contract.js';
import { mcpAuthHook } from './auth.js';
import { isToolAllowed } from './policy.js';
import { createToolHandlers } from './handlers.js';
import type { McpServerRegistry } from './gateway/registry.js';
import type { McpProcessLifecycle } from './gateway/lifecycle.js';
import type { McpToolProxy } from './gateway/proxy.js';

interface SessionContext {
  mcpServer: McpServer;
  transport: StreamableHTTPServerTransport;
}

interface JsonRpcLikeBody {
  method?: unknown;
  params?: {
    name?: unknown;
  };
}

export interface GatewayOptions {
  registry: McpServerRegistry;
  lifecycle: McpProcessLifecycle;
  proxy: McpToolProxy;
}

function extractSessionId(request: FastifyRequest): string | null {
  const header = request.headers['mcp-session-id'];
  if (typeof header === 'string' && header.trim().length > 0) return header;
  if (Array.isArray(header) && typeof header[0] === 'string' && header[0].trim().length > 0) return header[0];
  return null;
}

function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const candidate = body as JsonRpcLikeBody;
  return candidate.method === 'initialize';
}

function extractToolName(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const candidate = body as JsonRpcLikeBody;
  if (candidate.method !== 'tools/call') return null;
  return typeof candidate.params?.name === 'string' ? candidate.params.name : null;
}

function sendJsonRpcError(reply: FastifyReply, statusCode: number, code: number, message: string) {
  return reply.status(statusCode).send({
    jsonrpc: '2.0',
    error: {
      code,
      message,
    },
    id: null,
  });
}

async function createSessionContext(
  sessionStore: Map<string, SessionContext>,
  gateway?: GatewayOptions,
): Promise<SessionContext> {
  const handlers = createToolHandlers();
  const mcpServer = new McpServer(
    {
      name: 'automate-mcp',
      version: MCP_CONTRACT_VERSION,
    },
    {
      instructions: 'Automate MCP v1 read-only tools.',
    },
  );

  for (const [toolName, contract] of Object.entries(MCP_V1_TOOLS)) {
    mcpServer.registerTool(
      toolName,
      {
        description: `Automate read-only tool: ${toolName}`,
        inputSchema: contract.inputSchema,
      },
      async (args: unknown) => {
        const handler = handlers[toolName];
        if (!handler) throw new Error(`No handler registered for tool: ${toolName}`);
        return handler((args as Record<string, unknown>) ?? {});
      },
    );
  }

  if (gateway) {
    const externalTools = await gateway.proxy.listAllTools();
    for (const tool of externalTools) {
      mcpServer.registerTool(
        tool.name,
        {
          description: tool.description,
          // Use passthrough schema since external tools validate args themselves
          inputSchema: z.object({}).passthrough(),
        },
        async (args: unknown) => {
          const resolution = gateway.registry.resolveToolServer(tool.name);
          if (!resolution) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Tool not found' }) }],
            };
          }
          return gateway.proxy.callTool(
            resolution.serverId,
            resolution.originalToolName,
            (args as Record<string, unknown>) ?? {},
          );
        },
      );
    }
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: async (sessionId) => {
      sessionStore.set(sessionId, { mcpServer, transport });
    },
    onsessionclosed: async (sessionId) => {
      sessionStore.delete(sessionId);
    },
  });

  return { mcpServer, transport };
}

export async function registerMcpServer(app: FastifyInstance, gateway?: GatewayOptions): Promise<void> {
  const sessionStore = new Map<string, SessionContext>();
  const allSessions = new Set<SessionContext>();

  app.addHook('onClose', async () => {
    for (const session of allSessions) {
      await session.mcpServer.close();
      await session.transport.close();
    }
    allSessions.clear();
    sessionStore.clear();
    if (gateway) {
      await gateway.proxy.closeAll();
      await gateway.lifecycle.shutdownAll();
    }
  });

  const handleMcp = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const policy = request.mcpPolicy;
    if (!policy) {
      void reply.status(401).send({
        error: 'Unauthorized',
        code: MCP_ERROR_CODES.UNAUTHORIZED,
      });
      return;
    }

    const toolName = extractToolName(request.body);
    if (toolName && !isToolAllowed(policy, toolName)) {
      void reply.status(404).send({
        error: 'Tool not found',
        code: MCP_ERROR_CODES.TOOL_NOT_FOUND,
      });
      return;
    }

    let sessionContext: SessionContext | undefined;

    if (request.method === 'POST' && isInitializeRequest(request.body)) {
      sessionContext = await createSessionContext(sessionStore, gateway);
      allSessions.add(sessionContext);
      await sessionContext.mcpServer.connect(sessionContext.transport);
    } else {
      const sessionId = extractSessionId(request);
      if (!sessionId) {
        void sendJsonRpcError(reply, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
        return;
      }

      sessionContext = sessionStore.get(sessionId);
      if (!sessionContext) {
        void sendJsonRpcError(reply, 404, -32001, 'Session not found');
        return;
      }
    }

    reply.hijack();
    await sessionContext.transport.handleRequest(
      request.raw,
      reply.raw,
      request.body,
    );

    if (request.method === 'DELETE') {
      const deletedSessionId = extractSessionId(request);
      if (deletedSessionId) {
        const deletedContext = sessionStore.get(deletedSessionId);
        if (deletedContext) {
          sessionStore.delete(deletedSessionId);
          allSessions.delete(deletedContext);
        }
      }
    }
  };

  app.route({
    method: ['POST', 'GET', 'DELETE'],
    url: '/mcp',
    preHandler: mcpAuthHook,
    handler: handleMcp,
  });
}
