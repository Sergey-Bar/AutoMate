/** Prefixes reserved for internal MCP tools — cannot be used by external servers */
export const RESERVED_PREFIXES = Object.freeze([
  'runs', 'tests', 'analytics', 'quarantine', 'schedules', 'integrations',
]);

export interface StdioMcpServerConfig {
  id: string;
  name: string;
  transport: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  featureFlag?: string;
  toolPrefix: string;
}

export interface HttpMcpServerConfig {
  id: string;
  name: string;
  transport: 'http';
  url: string;
  headers?: Record<string, string>;
  enabled: boolean;
  featureFlag?: string;
  toolPrefix: string;
}

export type ExternalMcpServerConfig = StdioMcpServerConfig | HttpMcpServerConfig;

export interface ToolResolution {
  serverId: string;
  originalToolName: string;
  config: ExternalMcpServerConfig;
}

export class McpServerRegistry {
  private readonly servers = new Map<string, ExternalMcpServerConfig>();

  register(config: ExternalMcpServerConfig): void {
    if (this.servers.has(config.id)) {
      throw new Error(`MCP server "${config.id}" is already registered`);
    }
    if ((RESERVED_PREFIXES as readonly string[]).includes(config.toolPrefix)) {
      throw new Error(
        `Tool prefix "${config.toolPrefix}" is reserved for internal tools`,
      );
    }
    this.servers.set(config.id, config);
  }

  unregister(id: string): void {
    this.servers.delete(id);
  }

  get(id: string): ExternalMcpServerConfig | undefined {
    return this.servers.get(id);
  }

  getAll(): ExternalMcpServerConfig[] {
    return Array.from(this.servers.values());
  }

  getEnabled(): ExternalMcpServerConfig[] {
    return this.getAll().filter((s) => s.enabled);
  }

  resolveToolServer(prefixedToolName: string): ToolResolution | undefined {
    const dotIndex = prefixedToolName.indexOf('.');
    if (dotIndex === -1) return undefined;

    const prefix = prefixedToolName.slice(0, dotIndex);
    const originalToolName = prefixedToolName.slice(dotIndex + 1);

    for (const config of this.servers.values()) {
      if (config.toolPrefix === prefix && config.enabled) {
        return {
          serverId: config.id,
          originalToolName,
          config,
        };
      }
    }

    return undefined;
  }
}
