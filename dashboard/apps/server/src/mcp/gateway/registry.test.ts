import { describe, it, expect, beforeEach } from 'vitest';
import {
  McpServerRegistry,
  type ExternalMcpServerConfig,
} from './registry.js';

describe('McpServerRegistry', () => {
  let registry: McpServerRegistry;

  beforeEach(() => {
    registry = new McpServerRegistry();
  });

  describe('register', () => {
    it('registers a server config and makes it retrievable', () => {
      const config: ExternalMcpServerConfig = {
        id: 'playwright',
        name: 'Playwright MCP',
        transport: 'stdio',
        command: 'npx',
        args: ['@playwright/mcp@latest'],
        enabled: true,
        featureFlag: 'mcp-playwright',
        toolPrefix: 'playwright',
      };

      registry.register(config);
      expect(registry.get('playwright')).toEqual(config);
    });

    it('throws on duplicate id registration', () => {
      const config: ExternalMcpServerConfig = {
        id: 'playwright',
        name: 'Playwright MCP',
        transport: 'stdio',
        command: 'npx',
        args: [],
        enabled: true,
        toolPrefix: 'playwright',
      };

      registry.register(config);
      expect(() => registry.register(config)).toThrow(
        'MCP server "playwright" is already registered',
      );
    });

    it('throws when toolPrefix is a reserved internal prefix', () => {
      expect(() =>
        registry.register({
          id: 'bad-server',
          name: 'Bad',
          transport: 'stdio',
          command: 'x',
          args: [],
          enabled: true,
          toolPrefix: 'runs', // reserved
        }),
      ).toThrow('Tool prefix "runs" is reserved for internal tools');
    });
  });

  describe('getEnabled', () => {
    it('returns only enabled servers', () => {
      registry.register({
        id: 'server-a',
        name: 'A',
        transport: 'stdio',
        command: 'a',
        args: [],
        enabled: true,
        toolPrefix: 'a',
      });
      registry.register({
        id: 'server-b',
        name: 'B',
        transport: 'stdio',
        command: 'b',
        args: [],
        enabled: false,
        toolPrefix: 'b',
      });

      const enabled = registry.getEnabled();
      expect(enabled).toHaveLength(1);
      expect(enabled[0]?.id).toBe('server-a');
    });
  });

  describe('getAll', () => {
    it('returns all registered servers', () => {
      registry.register({
        id: 's1',
        name: 'S1',
        transport: 'stdio',
        command: 's1',
        args: [],
        enabled: true,
        toolPrefix: 's1',
      });
      registry.register({
        id: 's2',
        name: 'S2',
        transport: 'http',
        url: 'http://localhost:8931/mcp',
        enabled: false,
        toolPrefix: 's2',
      });

      expect(registry.getAll()).toHaveLength(2);
    });
  });

  describe('unregister', () => {
    it('removes a server by id', () => {
      registry.register({
        id: 'to-remove',
        name: 'Remove Me',
        transport: 'stdio',
        command: 'x',
        args: [],
        enabled: true,
        toolPrefix: 'remove',
      });

      registry.unregister('to-remove');
      expect(registry.get('to-remove')).toBeUndefined();
    });

    it('is a no-op for unknown ids', () => {
      expect(() => registry.unregister('unknown')).not.toThrow();
    });
  });

  describe('resolveToolServer', () => {
    it('finds the server owning a prefixed tool name', () => {
      registry.register({
        id: 'playwright',
        name: 'Playwright',
        transport: 'stdio',
        command: 'npx',
        args: ['@playwright/mcp@latest'],
        enabled: true,
        toolPrefix: 'playwright',
      });

      const result = registry.resolveToolServer('playwright.browser_navigate');
      expect(result).toBeDefined();
      expect(result?.serverId).toBe('playwright');
      expect(result?.originalToolName).toBe('browser_navigate');
    });

    it('returns undefined for internal tools', () => {
      expect(registry.resolveToolServer('runs.list_recent')).toBeUndefined();
    });

    it('returns undefined when tool name has no dot (covers dotIndex===-1 branch)', () => {
      // 'noDot' has no period → dotIndex is -1 → early return undefined
      expect(registry.resolveToolServer('noDot')).toBeUndefined();
    });

    it('returns undefined when matching-prefix server is disabled (covers enabled===false branch)', () => {
      registry.register({
        id: 'disabled-server',
        name: 'Disabled',
        transport: 'stdio',
        command: 'x',
        args: [],
        enabled: false, // disabled
        toolPrefix: 'disabled',
      });

      // toolPrefix 'disabled' matches, but server is disabled → undefined
      const result = registry.resolveToolServer('disabled.some_tool');
      expect(result).toBeUndefined();
    });
  });
});
