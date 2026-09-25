import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServerRegistry } from '../mcp/gateway/registry.js';
import type { McpProcessLifecycle } from '../mcp/gateway/lifecycle.js';
import { requireFeature } from '../services/feature-flags.js';

interface McpManagementOptions {
  registry: McpServerRegistry;
  lifecycle: McpProcessLifecycle;
}

export async function mcpManagementRoutes(
  app: FastifyInstance,
  opts: McpManagementOptions,
): Promise<void> {
  // Gate all routes behind mcp-gateway feature flag
  app.addHook('preHandler', requireFeature('mcp-gateway'));

  // GET /api/mcp/servers — List all registered MCP servers
  app.get('/api/mcp/servers', async () => {
    return {
      servers: opts.registry.getAll().map((config) => ({
        id: config.id,
        name: config.name,
        transport: config.transport,
        enabled: config.enabled,
        toolPrefix: config.toolPrefix,
        running: opts.lifecycle.isRunning(config.id),
      })),
    };
  });

  // GET /api/mcp/servers/:id/status — Get detailed status for a specific server
  app.get('/api/mcp/servers/:id/status', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = request.params;
    const config = opts.registry.get(id);
    if (!config) {
      return reply.status(404).send({ error: `MCP server "${id}" not found` });
    }

    const handle = opts.lifecycle.getHandle(id);
    return {
      id: config.id,
      name: config.name,
      transport: config.transport,
      enabled: config.enabled,
      toolPrefix: config.toolPrefix,
      running: opts.lifecycle.isRunning(id),
      pid: handle?.pid ?? null,
    };
  });

  // POST /api/mcp/servers/:id/start — Start a specific MCP server
  app.post('/api/mcp/servers/:id/start', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = request.params;
    const config = opts.registry.get(id);
    if (!config) {
      return reply.status(404).send({ error: `MCP server "${id}" not found` });
    }
    if (!config.enabled) {
      return reply.status(400).send({ error: `MCP server "${id}" is disabled` });
    }
    if (opts.lifecycle.isRunning(id)) {
      return reply.status(409).send({ error: `MCP server "${id}" is already running` });
    }

    // Actual process spawning is handled by the gateway layer.
    // This endpoint returns 202 to indicate the start was accepted.
    return reply.status(202).send({ message: `MCP server "${id}" start requested` });
  });

  // POST /api/mcp/servers/:id/stop — Stop a specific MCP server
  app.post('/api/mcp/servers/:id/stop', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = request.params;
    const config = opts.registry.get(id);
    if (!config) {
      return reply.status(404).send({ error: `MCP server "${id}" not found` });
    }
    if (!opts.lifecycle.isRunning(id)) {
      return reply.status(409).send({ error: `MCP server "${id}" is not running` });
    }

    await opts.lifecycle.shutdown(id);
    return reply.status(200).send({ message: `MCP server "${id}" stopped` });
  });
}
