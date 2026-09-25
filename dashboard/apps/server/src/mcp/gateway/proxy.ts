export interface ExternalToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
}

export interface McpClientConnection {
  serverId: string;
  listTools: () => Promise<ExternalToolInfo[]>;
  callTool: (toolName: string, args: Record<string, unknown>) => Promise<ToolCallResult>;
  close: () => Promise<void>;
}

export class McpToolProxy {
  private readonly connections = new Map<string, McpClientConnection>();

  addConnection(connection: McpClientConnection): void {
    this.connections.set(connection.serverId, connection);
  }

  hasConnection(serverId: string): boolean {
    return this.connections.has(serverId);
  }

  async removeConnection(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) return;

    await connection.close();
    this.connections.delete(serverId);
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`No MCP connection for server "${serverId}"`);
    }

    return connection.callTool(toolName, args);
  }

  async listAllTools(): Promise<ExternalToolInfo[]> {
    const allTools: ExternalToolInfo[] = [];

    for (const connection of this.connections.values()) {
      const tools = await connection.listTools();
      for (const tool of tools) {
        allTools.push({
          ...tool,
          name: `${connection.serverId}.${tool.name}`,
        });
      }
    }

    return allTools;
  }

  async closeAll(): Promise<void> {
    const ids = Array.from(this.connections.keys());
    await Promise.allSettled(ids.map((id) => this.removeConnection(id)));
  }
}
