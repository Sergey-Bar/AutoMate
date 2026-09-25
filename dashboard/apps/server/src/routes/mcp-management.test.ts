import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { McpServerRegistry } from '../mcp/gateway/registry.js';
import { McpProcessLifecycle } from '../mcp/gateway/lifecycle.js';
import type { ProcessHandle } from '../mcp/gateway/lifecycle.js';
import type { StdioMcpServerConfig } from '../mcp/gateway/registry.js';

function makeStdioConfig(overrides: Partial<StdioMcpServerConfig> = {}): StdioMcpServerConfig {
  return {
    id: 'test-server',
    name: 'Test MCP Server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    enabled: true,
    toolPrefix: 'test',
    ...overrides,
  };
}

function makeProcessHandle(serverId: string, pid = 1234): ProcessHandle {
  return {
    serverId,
    pid,
    kill: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe('mcpManagementRoutes', () => {
  let app: FastifyInstance;
  let registry: McpServerRegistry;
  let lifecycle: McpProcessLifecycle;

  beforeAll(async () => {
    registry = new McpServerRegistry();
    lifecycle = new McpProcessLifecycle();

    const { mcpManagementRoutes } = await import('./mcp-management.js');
    app = Fastify();
    await app.register(mcpManagementRoutes, { registry, lifecycle });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Reset registry and lifecycle before each test
    // Re-create them and re-create the app in the per-test helpers when needed
    // For the shared app instance, we use a fresh registry/lifecycle per describe
  });

  describe('GET /api/mcp/servers', () => {
    it('returns empty array when no servers are registered', async () => {
      const freshRegistry = new McpServerRegistry();
      const freshLifecycle = new McpProcessLifecycle();
      const { mcpManagementRoutes } = await import('./mcp-management.js');

      const testApp = Fastify();
      await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
      await testApp.ready();

      const res = await testApp.inject({ method: 'GET', url: '/api/mcp/servers' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ servers: [] });

      await testApp.close();
    });

    it('returns server list with running status', async () => {
      const freshRegistry = new McpServerRegistry();
      const freshLifecycle = new McpProcessLifecycle();

      const config = makeStdioConfig({ id: 'srv-1', toolPrefix: 'srv1' });
      freshRegistry.register(config);
      freshLifecycle.registerHandle(makeProcessHandle('srv-1'));

      const secondConfig = makeStdioConfig({ id: 'srv-2', toolPrefix: 'srv2', enabled: false });
      freshRegistry.register(secondConfig);

      const { mcpManagementRoutes } = await import('./mcp-management.js');
      const testApp = Fastify();
      await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
      await testApp.ready();

      const res = await testApp.inject({ method: 'GET', url: '/api/mcp/servers' });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ servers: Array<{ id: string; running: boolean }> }>();
      expect(body.servers).toHaveLength(2);

      const running = body.servers.find((s) => s.id === 'srv-1');
      expect(running?.running).toBe(true);

      const stopped = body.servers.find((s) => s.id === 'srv-2');
      expect(stopped?.running).toBe(false);

      await testApp.close();
    });
  });

  describe('GET /api/mcp/servers/:id/status', () => {
    it('returns 404 for unknown server', async () => {
      const freshRegistry = new McpServerRegistry();
      const freshLifecycle = new McpProcessLifecycle();
      const { mcpManagementRoutes } = await import('./mcp-management.js');

      const testApp = Fastify();
      await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
      await testApp.ready();

      const res = await testApp.inject({ method: 'GET', url: '/api/mcp/servers/nonexistent/status' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'MCP server "nonexistent" not found' });

      await testApp.close();
    });

    it('returns detailed status for known server without pid when not running', async () => {
      const freshRegistry = new McpServerRegistry();
      const freshLifecycle = new McpProcessLifecycle();

      const config = makeStdioConfig({ id: 'my-server', toolPrefix: 'myserver' });
      freshRegistry.register(config);

      const { mcpManagementRoutes } = await import('./mcp-management.js');
      const testApp = Fastify();
      await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
      await testApp.ready();

      const res = await testApp.inject({ method: 'GET', url: '/api/mcp/servers/my-server/status' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: 'my-server',
        name: 'Test MCP Server',
        transport: 'stdio',
        enabled: true,
        toolPrefix: 'myserver',
        running: false,
        pid: null,
      });

      await testApp.close();
    });

    it('returns detailed status with pid when server is running', async () => {
      const freshRegistry = new McpServerRegistry();
      const freshLifecycle = new McpProcessLifecycle();

      const config = makeStdioConfig({ id: 'running-server', toolPrefix: 'runsvr' });
      freshRegistry.register(config);
      freshLifecycle.registerHandle(makeProcessHandle('running-server', 5678));

      const { mcpManagementRoutes } = await import('./mcp-management.js');
      const testApp = Fastify();
      await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
      await testApp.ready();

      const res = await testApp.inject({ method: 'GET', url: '/api/mcp/servers/running-server/status' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: 'running-server',
        running: true,
        pid: 5678,
      });

      await testApp.close();
    });
  });

  describe('POST /api/mcp/servers/:id/start', () => {
    it('returns 404 for unknown server', async () => {
      const freshRegistry = new McpServerRegistry();
      const freshLifecycle = new McpProcessLifecycle();
      const { mcpManagementRoutes } = await import('./mcp-management.js');

      const testApp = Fastify();
      await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
      await testApp.ready();

      const res = await testApp.inject({ method: 'POST', url: '/api/mcp/servers/nonexistent/start' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'MCP server "nonexistent" not found' });

      await testApp.close();
    });

    it('returns 400 when server is disabled', async () => {
      const freshRegistry = new McpServerRegistry();
      const freshLifecycle = new McpProcessLifecycle();

      const config = makeStdioConfig({ id: 'disabled-srv', toolPrefix: 'dissrv', enabled: false });
      freshRegistry.register(config);

      const { mcpManagementRoutes } = await import('./mcp-management.js');
      const testApp = Fastify();
      await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
      await testApp.ready();

      const res = await testApp.inject({ method: 'POST', url: '/api/mcp/servers/disabled-srv/start' });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'MCP server "disabled-srv" is disabled' });

      await testApp.close();
    });

    it('returns 409 when server is already running', async () => {
      const freshRegistry = new McpServerRegistry();
      const freshLifecycle = new McpProcessLifecycle();

      const config = makeStdioConfig({ id: 'already-running', toolPrefix: 'alrdyrun' });
      freshRegistry.register(config);
      freshLifecycle.registerHandle(makeProcessHandle('already-running'));

      const { mcpManagementRoutes } = await import('./mcp-management.js');
      const testApp = Fastify();
      await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
      await testApp.ready();

      const res = await testApp.inject({ method: 'POST', url: '/api/mcp/servers/already-running/start' });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'MCP server "already-running" is already running' });

      await testApp.close();
    });

    it('returns 202 for valid start request on enabled stopped server', async () => {
      const freshRegistry = new McpServerRegistry();
      const freshLifecycle = new McpProcessLifecycle();

      const config = makeStdioConfig({ id: 'start-me', toolPrefix: 'startme' });
      freshRegistry.register(config);

      const { mcpManagementRoutes } = await import('./mcp-management.js');
      const testApp = Fastify();
      await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
      await testApp.ready();

      const res = await testApp.inject({ method: 'POST', url: '/api/mcp/servers/start-me/start' });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ message: 'MCP server "start-me" start requested' });

      await testApp.close();
    });
  });

  describe('POST /api/mcp/servers/:id/stop', () => {
    it('returns 404 for unknown server', async () => {
      const freshRegistry = new McpServerRegistry();
      const freshLifecycle = new McpProcessLifecycle();
      const { mcpManagementRoutes } = await import('./mcp-management.js');

      const testApp = Fastify();
      await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
      await testApp.ready();

      const res = await testApp.inject({ method: 'POST', url: '/api/mcp/servers/nonexistent/stop' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'MCP server "nonexistent" not found' });

      await testApp.close();
    });

    it('returns 409 when server is not running', async () => {
      const freshRegistry = new McpServerRegistry();
      const freshLifecycle = new McpProcessLifecycle();

      const config = makeStdioConfig({ id: 'not-running', toolPrefix: 'notrun' });
      freshRegistry.register(config);

      const { mcpManagementRoutes } = await import('./mcp-management.js');
      const testApp = Fastify();
      await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
      await testApp.ready();

      const res = await testApp.inject({ method: 'POST', url: '/api/mcp/servers/not-running/stop' });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'MCP server "not-running" is not running' });

      await testApp.close();
    });

    it('returns 200 and calls lifecycle.shutdown when server is running', async () => {
      const freshRegistry = new McpServerRegistry();
      const freshLifecycle = new McpProcessLifecycle();

      const config = makeStdioConfig({ id: 'stop-me', toolPrefix: 'stopme' });
      freshRegistry.register(config);
      const handle = makeProcessHandle('stop-me', 9999);
      freshLifecycle.registerHandle(handle);

      const shutdownSpy = vi.spyOn(freshLifecycle, 'shutdown');

      const { mcpManagementRoutes } = await import('./mcp-management.js');
      const testApp = Fastify();
      await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
      await testApp.ready();

      const res = await testApp.inject({ method: 'POST', url: '/api/mcp/servers/stop-me/stop' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ message: 'MCP server "stop-me" stopped' });
      expect(shutdownSpy).toHaveBeenCalledWith('stop-me');

      await testApp.close();
    });
  });
});

describe('mcpManagementRoutes — feature flag gate', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    // Override NODE_ENV so requireFeature actually runs its check
    process.env.NODE_ENV = 'production';
    process.env.FEATURE_MCP_GATEWAY = 'false';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.FEATURE_MCP_GATEWAY;
  });

  it('returns 404 on all routes when mcp-gateway feature flag is disabled', async () => {
    // Need a fresh import after mocking the env
    const freshRegistry = new McpServerRegistry();
    const freshLifecycle = new McpProcessLifecycle();

    // Re-import to get the real requireFeature (not mocked)
    // The module is already imported; we rely on requireFeature reading process.env at call time
    const { mcpManagementRoutes } = await import('./mcp-management.js');
    const testApp = Fastify();
    await testApp.register(mcpManagementRoutes, { registry: freshRegistry, lifecycle: freshLifecycle });
    await testApp.ready();

    const res = await testApp.inject({ method: 'GET', url: '/api/mcp/servers' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('mcp-gateway') });

    await testApp.close();
  });
});
