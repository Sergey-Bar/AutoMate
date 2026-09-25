import { isEnabled } from '../../services/feature-flags.js';
import { McpServerRegistry } from './registry.js';
import { McpProcessLifecycle } from './lifecycle.js';
import { McpToolProxy } from './proxy.js';
import { PlaywrightMcpManager } from './playwright.js';

export interface GatewayContext {
  registry: McpServerRegistry;
  lifecycle: McpProcessLifecycle;
  proxy: McpToolProxy;
}

export async function initializeGateway(): Promise<GatewayContext | undefined> {
  if (!isEnabled('mcp-gateway')) {
    return undefined;
  }

  const registry = new McpServerRegistry();
  const lifecycle = new McpProcessLifecycle();
  const proxy = new McpToolProxy();

  if (isEnabled('mcp-playwright')) {
    const manager = new PlaywrightMcpManager();
    const config = manager.getConfig();
    registry.register(config);
    // Note: actual process spawning and MCP client connection
    // will be implemented when we have the MCP client SDK integration.
    // For now, we register the config so tools/list shows the server exists.
  }

  return { registry, lifecycle, proxy };
}
