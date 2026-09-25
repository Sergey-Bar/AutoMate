import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpToolProxy, type McpClientConnection } from './proxy.js';

describe('McpToolProxy', () => {
  let proxy: McpToolProxy;

  beforeEach(() => {
    proxy = new McpToolProxy();
  });

  describe('addConnection', () => {
    it('stores a client connection by server id', () => {
      const mockConnection: McpClientConnection = {
        serverId: 'test',
        listTools: vi.fn().mockResolvedValue([]),
        callTool: vi.fn().mockResolvedValue({ content: [] }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      proxy.addConnection(mockConnection);
      expect(proxy.hasConnection('test')).toBe(true);
    });
  });

  describe('removeConnection', () => {
    it('removes and closes a connection', async () => {
      const mockConnection: McpClientConnection = {
        serverId: 'test',
        listTools: vi.fn().mockResolvedValue([]),
        callTool: vi.fn().mockResolvedValue({ content: [] }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      proxy.addConnection(mockConnection);
      await proxy.removeConnection('test');
      expect(proxy.hasConnection('test')).toBe(false);
      expect(mockConnection.close).toHaveBeenCalled();
    });

    it('is a no-op for unknown connections', async () => {
      await expect(proxy.removeConnection('unknown')).resolves.toBeUndefined();
    });
  });

  describe('callTool', () => {
    it('delegates to the correct connection', async () => {
      const expectedResult = {
        content: [{ type: 'text' as const, text: '{"url":"https://example.com"}' }],
      };
      const mockConnection: McpClientConnection = {
        serverId: 'playwright',
        listTools: vi.fn(),
        callTool: vi.fn().mockResolvedValue(expectedResult),
        close: vi.fn(),
      };

      proxy.addConnection(mockConnection);

      const result = await proxy.callTool('playwright', 'browser_navigate', {
        url: 'https://example.com',
      });

      expect(mockConnection.callTool).toHaveBeenCalledWith('browser_navigate', {
        url: 'https://example.com',
      });
      expect(result).toEqual(expectedResult);
    });

    it('throws for unknown server', async () => {
      await expect(
        proxy.callTool('unknown', 'some_tool', {}),
      ).rejects.toThrow('No MCP connection for server "unknown"');
    });
  });

  describe('listAllTools', () => {
    it('aggregates tools from all connections with prefixes', async () => {
      const connA: McpClientConnection = {
        serverId: 'a',
        listTools: vi.fn().mockResolvedValue([
          { name: 'tool1', description: 'Tool 1', inputSchema: {} },
        ]),
        callTool: vi.fn(),
        close: vi.fn(),
      };
      const connB: McpClientConnection = {
        serverId: 'b',
        listTools: vi.fn().mockResolvedValue([
          { name: 'tool2', description: 'Tool 2', inputSchema: {} },
        ]),
        callTool: vi.fn(),
        close: vi.fn(),
      };

      proxy.addConnection(connA);
      proxy.addConnection(connB);

      const tools = await proxy.listAllTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['a.tool1', 'b.tool2']);
    });
  });

  describe('closeAll', () => {
    it('closes all connections', async () => {
      const closeA = vi.fn().mockResolvedValue(undefined);
      const closeB = vi.fn().mockResolvedValue(undefined);

      proxy.addConnection({
        serverId: 'a',
        listTools: vi.fn(),
        callTool: vi.fn(),
        close: closeA,
      });
      proxy.addConnection({
        serverId: 'b',
        listTools: vi.fn(),
        callTool: vi.fn(),
        close: closeB,
      });

      await proxy.closeAll();
      expect(closeA).toHaveBeenCalled();
      expect(closeB).toHaveBeenCalled();
      expect(proxy.hasConnection('a')).toBe(false);
    });

    it('resolves when there are no connections', async () => {
      await expect(proxy.closeAll()).resolves.toBeUndefined();
    });

    it('settles even when a close() call rejects', async () => {
      const closeOk = vi.fn().mockResolvedValue(undefined);
      const closeFail = vi.fn().mockRejectedValue(new Error('close failed'));

      proxy.addConnection({
        serverId: 'ok',
        listTools: vi.fn(),
        callTool: vi.fn(),
        close: closeOk,
      });
      proxy.addConnection({
        serverId: 'fail',
        listTools: vi.fn(),
        callTool: vi.fn(),
        close: closeFail,
      });

      // closeAll uses Promise.allSettled — must not throw even if one close rejects
      await expect(proxy.closeAll()).resolves.toBeUndefined();
      expect(closeOk).toHaveBeenCalled();
      expect(closeFail).toHaveBeenCalled();
    });
  });

  describe('hasConnection', () => {
    it('returns false when no connections have been added', () => {
      expect(proxy.hasConnection('anything')).toBe(false);
    });
  });

  describe('addConnection — overwrite', () => {
    it('replaces an existing connection with the same serverId', () => {
      const first: McpClientConnection = {
        serverId: 'server',
        listTools: vi.fn(),
        callTool: vi.fn(),
        close: vi.fn(),
      };
      const second: McpClientConnection = {
        serverId: 'server',
        listTools: vi.fn(),
        callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text' as const, text: 'v2' }] }),
        close: vi.fn(),
      };

      proxy.addConnection(first);
      proxy.addConnection(second);

      expect(proxy.hasConnection('server')).toBe(true);
      // After overwrite, callTool should use the second connection
      return expect(proxy.callTool('server', 'tool', {})).resolves.toEqual({
        content: [{ type: 'text', text: 'v2' }],
      });
    });
  });

  describe('callTool — upstream error', () => {
    it('propagates errors thrown by the upstream connection', async () => {
      const mockConnection: McpClientConnection = {
        serverId: 'broken',
        listTools: vi.fn(),
        callTool: vi.fn().mockRejectedValue(new Error('upstream timeout')),
        close: vi.fn(),
      };

      proxy.addConnection(mockConnection);

      await expect(proxy.callTool('broken', 'any_tool', {})).rejects.toThrow('upstream timeout');
    });
  });

  describe('listAllTools — edge cases', () => {
    it('returns an empty array when there are no connections', async () => {
      const tools = await proxy.listAllTools();
      expect(tools).toEqual([]);
    });

    it('returns an empty array when all connections report no tools', async () => {
      proxy.addConnection({
        serverId: 'empty',
        listTools: vi.fn().mockResolvedValue([]),
        callTool: vi.fn(),
        close: vi.fn(),
      });

      const tools = await proxy.listAllTools();
      expect(tools).toEqual([]);
    });

    it('propagates errors thrown by a connection listTools', async () => {
      proxy.addConnection({
        serverId: 'erroring',
        listTools: vi.fn().mockRejectedValue(new Error('connection lost')),
        callTool: vi.fn(),
        close: vi.fn(),
      });

      await expect(proxy.listAllTools()).rejects.toThrow('connection lost');
    });

    it('aggregates multiple tools from a single connection', async () => {
      proxy.addConnection({
        serverId: 'multi',
        listTools: vi.fn().mockResolvedValue([
          { name: 'alpha', description: 'Alpha', inputSchema: { type: 'object' } },
          { name: 'beta', description: 'Beta', inputSchema: { type: 'object' } },
        ]),
        callTool: vi.fn(),
        close: vi.fn(),
      });

      const tools = await proxy.listAllTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('multi.alpha');
      expect(tools[1].name).toBe('multi.beta');
    });

    it('preserves the original inputSchema when prefixing tool names', async () => {
      const schema = { type: 'object', properties: { url: { type: 'string' } } };

      proxy.addConnection({
        serverId: 'pw',
        listTools: vi.fn().mockResolvedValue([
          { name: 'navigate', description: 'Navigate to URL', inputSchema: schema },
        ]),
        callTool: vi.fn(),
        close: vi.fn(),
      });

      const tools = await proxy.listAllTools();
      expect(tools[0].inputSchema).toEqual(schema);
      expect(tools[0].description).toBe('Navigate to URL');
    });
  });
});
