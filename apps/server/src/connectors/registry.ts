import { z } from 'zod/v4';
import type { ConnectorManifest } from '../../../../packages/connector-sdk/src/types.js';

type Handler = (input: unknown) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>;

export class ConnectorRegistry {
  private connectors = new Map<string, ConnectorManifest>();

  registerManifest(manifest: ConnectorManifest) {
    this.connectors.set(manifest.name, manifest);
  }

  listManifests(): ConnectorManifest[] {
    return [...this.connectors.values()];
  }

  /** @deprecated Use registerManifest() for connector-sdk manifests. */
  registerLocal(name: string, handler: Handler) {
    this.registerManifest({
      name,
      version: 'local',
      displayName: name,
      description: `Local connector wrapper for ${name}`,
      icon: name,
      credentialSchema: z.object({}),
      tools: [
        {
          name: '__default',
          description: `Legacy local handler for ${name}`,
          inputSchema: z.object({}),
          handler: async (input: unknown) => handler(input),
        },
      ],
    });
  }

  getConnectorNames(): string[] {
    return [...this.connectors.keys()];
  }

  async dispatch(toolName: string, input: unknown, credentials: Record<string, string> = {}) {
    const dotIndex = toolName.indexOf('.');
    const connectorName = dotIndex >= 0 ? toolName.slice(0, dotIndex) : toolName;
    const toolMethodName = dotIndex >= 0 ? toolName.slice(dotIndex + 1) : undefined;
    const manifest = this.connectors.get(connectorName);
    if (!manifest) {
      throw new Error(`Connector not loaded: ${connectorName}`);
    }

    const tool = manifest.tools.find(({ name }) => name === toolMethodName)
      ?? (manifest.tools.length === 1 ? manifest.tools[0] : undefined);

    if (!tool) {
      throw new Error(`Tool not found on connector ${connectorName}: ${toolMethodName ?? '<missing>'}`);
    }

    const abortController = new AbortController();
    return tool.handler(input, {
      credentials,
      abortSignal: abortController.signal,
    });
  }

  async unload(name: string) {
    this.connectors.delete(name);
  }

  async reload(manifest: ConnectorManifest) {
    await this.unload(manifest.name);
    this.registerManifest(manifest);
  }
}

export type { Handler };
