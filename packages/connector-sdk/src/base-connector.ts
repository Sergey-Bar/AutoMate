import type { ConnectorManifest, ToolResult, ToolContext } from './types.js';

export abstract class BaseConnector {
  abstract manifest: ConnectorManifest;
  protected abstract createContext(): ToolContext;

  getTools() {
    return this.manifest.tools;
  }

  async executeTool(toolName: string, input: unknown): Promise<ToolResult> {
    const tool = this.manifest.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        content: [{ type: 'text', text: parsed.error.message }],
        isError: true,
      };
    }

    try {
      return await tool.handler(parsed.data, this.createContext());
    } catch (err) {
      return {
        content: [{ type: 'text', text: (err as Error).message }],
        isError: true,
      };
    }
  }
}
