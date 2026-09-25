import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { BaseConnector } from './base-connector.js';
import type { ConnectorManifest, ToolContext } from './types.js';

class DummyConnector extends BaseConnector {
  manifest: ConnectorManifest = {
    name: 'dummy',
    version: '0.1.0',
    displayName: 'Dummy',
    description: 'Dummy connector',
    icon: 'dummy',
    credentialSchema: z.object({ token: z.string() }),
    tools: [
      {
        name: 'echo',
        description: 'Echoes a message',
        inputSchema: z.object({ message: z.string() }),
        handler: async (input, context) => {
          const payload = input as { message: string };
          return {
            content: [
              {
                type: 'text',
                text: `${payload.message}:${context.credentials.token}`,
              },
            ],
          };
        },
      },
      {
        name: 'boom',
        description: 'Always throws',
        inputSchema: z.object({}),
        handler: async () => {
          throw new Error('handler exploded');
        },
      },
    ],
  };

  protected createContext(): ToolContext {
    return {
      credentials: { token: 'ctx-token' },
      abortSignal: AbortSignal.timeout(1_000),
    };
  }
}

describe('BaseConnector', () => {
  it('is instantiable through a subclass', () => {
    const connector = new DummyConnector();
    expect(connector).toBeInstanceOf(BaseConnector);
  });

  it('returns manifest tools via getTools', () => {
    const connector = new DummyConnector();
    expect(connector.getTools()).toHaveLength(2);
    expect(connector.getTools()[0]?.name).toBe('echo');
  });

  it('dispatches executeTool to matching handler', async () => {
    const connector = new DummyConnector();
    await expect(connector.executeTool('echo', { message: 'hello' })).resolves.toEqual({
      content: [{ type: 'text', text: 'hello:ctx-token' }],
    });
  });

  it('throws when executeTool is called with an unknown tool name', async () => {
    const connector = new DummyConnector();
    await expect(connector.executeTool('missing-tool', {})).rejects.toThrow('Tool not found: missing-tool');
  });

  it('returns isError when input fails validation', async () => {
    const connector = new DummyConnector();
    const result = await connector.executeTool('echo', { message: 123 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBeTruthy();
  });

  it('returns isError when handler throws', async () => {
    const connector = new DummyConnector();
    const result = await connector.executeTool('boom', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('handler exploded');
  });
});
