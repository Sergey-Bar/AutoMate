import { describe, expect, it } from 'vitest';
import { MCP_V1_TOOL_NAMES } from './contract.js';
import {
  deriveMcpPolicy,
  isToolAllowed,
  MCP_V1_ALLOWED_TOOLS,
  type McpAuthContext,
} from './policy.js';
import { McpServerRegistry } from './gateway/registry.js';

describe('mcp policy', () => {
  it('pins allowlist to exactly the v1 contract tool names', () => {
    expect(MCP_V1_ALLOWED_TOOLS).toEqual(MCP_V1_TOOL_NAMES);
  });

  it('derives read-only policy for authenticated actors', () => {
    const authContext: McpAuthContext = {
      actor: 'key-123',
      source: 'api_key',
      actorType: 'user',
      authenticatedAt: '2023-11-14T22:13:20.000Z',
    };

    const policy = deriveMcpPolicy(authContext);

    expect(policy.readOnly).toBe(true);
    expect(policy.allowedTools).toEqual(MCP_V1_ALLOWED_TOOLS);
  });

  it('derives read-only policy for service account actors', () => {
    const authContext: McpAuthContext = {
      actor: 'service-account-key',
      source: 'api_key',
      actorType: 'service',
      authenticatedAt: '2023-11-14T22:13:20.000Z',
    };

    const policy = deriveMcpPolicy(authContext);

    expect(policy.readOnly).toBe(true);
    expect(policy.allowedTools).toEqual(MCP_V1_ALLOWED_TOOLS);
  });

  it('allows every explicitly allowlisted tool', () => {
    const policy = deriveMcpPolicy({
      actor: 'session-key-abc',
      source: 'session',
      actorType: 'user',
      authenticatedAt: '2023-11-14T22:13:20.000Z',
    });

    for (const toolName of MCP_V1_ALLOWED_TOOLS) {
      expect(isToolAllowed(policy, toolName)).toBe(true);
    }
  });

  it('denies unknown tools by default', () => {
    const policy = deriveMcpPolicy({
      actor: 'key-999',
      source: 'api_key',
      actorType: 'user',
      authenticatedAt: '2023-11-14T22:13:20.000Z',
    });

    expect(isToolAllowed(policy, 'runs.delete')).toBe(false);
    expect(isToolAllowed(policy, 'admin.reset')).toBe(false);
    expect(isToolAllowed(policy, 'tests.write_snapshot')).toBe(false);
  });

  describe('with gateway registry', () => {
    const authContext: McpAuthContext = {
      actor: 'key-gateway',
      source: 'api_key',
      actorType: 'user',
      authenticatedAt: '2023-11-14T22:13:20.000Z',
    };

    it('includes wildcard pattern for enabled external server prefixes', () => {
      const registry = new McpServerRegistry();
      registry.register({
        id: 'mock-server',
        name: 'Mock Server',
        transport: 'stdio',
        command: 'mock',
        args: [],
        enabled: true,
        toolPrefix: 'mock',
      });

      const policy = deriveMcpPolicy(authContext, registry);

      expect(policy.allowedTools).toContain('mock.*');
      expect(policy.readOnly).toBe(true);
    });

    it('allows external tool with matching prefix via wildcard', () => {
      const registry = new McpServerRegistry();
      registry.register({
        id: 'mock-server',
        name: 'Mock Server',
        transport: 'stdio',
        command: 'mock',
        args: [],
        enabled: true,
        toolPrefix: 'mock',
      });

      const policy = deriveMcpPolicy(authContext, registry);

      expect(isToolAllowed(policy, 'mock.tool_a')).toBe(true);
      expect(isToolAllowed(policy, 'mock.tool_b')).toBe(true);
      expect(isToolAllowed(policy, 'mock.some_complex.tool')).toBe(true);
    });

    it('denies external tool when prefix does not match', () => {
      const registry = new McpServerRegistry();
      registry.register({
        id: 'mock-server',
        name: 'Mock Server',
        transport: 'stdio',
        command: 'mock',
        args: [],
        enabled: true,
        toolPrefix: 'mock',
      });

      const policy = deriveMcpPolicy(authContext, registry);

      expect(isToolAllowed(policy, 'other.tool_a')).toBe(false);
      expect(isToolAllowed(policy, 'mockish.tool_a')).toBe(false);
    });

    it('does not include disabled servers in the policy', () => {
      const registry = new McpServerRegistry();
      registry.register({
        id: 'disabled-server',
        name: 'Disabled Server',
        transport: 'stdio',
        command: 'noop',
        args: [],
        enabled: false,
        toolPrefix: 'disabled',
      });

      const policy = deriveMcpPolicy(authContext, registry);

      expect(policy.allowedTools).not.toContain('disabled.*');
      expect(isToolAllowed(policy, 'disabled.tool_a')).toBe(false);
    });

    it('includes internal tools alongside external wildcard entries', () => {
      const registry = new McpServerRegistry();
      registry.register({
        id: 'playwright',
        name: 'Playwright MCP',
        transport: 'stdio',
        command: 'npx',
        args: ['@playwright/mcp@latest'],
        enabled: true,
        toolPrefix: 'playwright',
      });

      const policy = deriveMcpPolicy(authContext, registry);

      // Internal tools still allowed
      expect(isToolAllowed(policy, 'runs.list_recent')).toBe(true);
      expect(isToolAllowed(policy, 'analytics.get_pass_rate')).toBe(true);
      // External wildcard also allowed
      expect(isToolAllowed(policy, 'playwright.screenshot')).toBe(true);
      expect(isToolAllowed(policy, 'playwright.navigate')).toBe(true);
    });

    it('wildcard does not match tool name equal to prefix without dot', () => {
      const registry = new McpServerRegistry();
      registry.register({
        id: 'mock-server',
        name: 'Mock Server',
        transport: 'stdio',
        command: 'mock',
        args: [],
        enabled: true,
        toolPrefix: 'mock',
      });

      const policy = deriveMcpPolicy(authContext, registry);

      // "mock" alone (no dot) should not match "mock.*"
      expect(isToolAllowed(policy, 'mock')).toBe(false);
    });
  });
});
