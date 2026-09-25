import { MCP_V1_TOOL_NAMES } from './contract.js';
import type { McpServerRegistry } from './gateway/registry.js';

export interface McpAuthContext {
  actor: string;
  source: 'api_key' | 'session';
  /** 'service' = machine-to-machine via DASHBOARD_SERVICE_ACCOUNT_KEY; 'user' = human operator */
  actorType: 'user' | 'service';
  authenticatedAt: string;
}

export interface McpPolicy {
  allowedTools: readonly string[];
  readOnly: boolean;
}

export const MCP_V1_ALLOWED_TOOLS: readonly string[] = Object.freeze([...MCP_V1_TOOL_NAMES]);

export function deriveMcpPolicy(_authContext: McpAuthContext, registry?: McpServerRegistry): McpPolicy {
  const externalTools = registry
    ? registry.getEnabled().flatMap((config) => {
        // We can't know all tool names at policy time, so we allow the prefix pattern
        return [`${config.toolPrefix}.*`];
      })
    : [];

  return {
    allowedTools: [...MCP_V1_ALLOWED_TOOLS, ...externalTools],
    readOnly: true,
  };
}

export function isToolAllowed(policy: McpPolicy, toolName: string): boolean {
  return policy.allowedTools.some((allowed) => {
    if (allowed.endsWith('.*')) {
      const prefix = allowed.slice(0, -2);
      return toolName.startsWith(`${prefix}.`);
    }
    return allowed === toolName;
  });
}
