import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import type { ConnectorManifest } from '../../../../packages/connector-sdk/src/types.js';
import { adaptConnectorTools } from './tools-adapter.js';

describe('adaptConnectorTools', () => {
  it('adapts connector tools to dot-notation keys and executes handlers', async () => {
    const handler = vi.fn(async (input: unknown) => {
      const payload = input as { title: string };
      return {
        content: [{ type: 'text' as const, text: `Created issue: ${payload.title}` }],
      };
    });

    const manifest: ConnectorManifest = {
      name: 'github',
      version: '0.1.0',
      displayName: 'GitHub',
      description: 'GitHub connector',
      icon: 'github',
      credentialSchema: z.object({ token: z.string() }),
      tools: [
        {
          name: 'create_issue',
          description: 'Create a GitHub issue',
          inputSchema: z.object({ title: z.string() }),
          handler,
        },
      ],
    };

    const tools = adaptConnectorTools([manifest]);

    expect(tools).toHaveProperty('github.create_issue');

    const createIssueTool = tools['github.create_issue'] as unknown as {
      execute: (input: { title: string }) => Promise<unknown>;
    };

    const result = await createIssueTool.execute({ title: 'Bug report' });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Created issue: Bug report' }],
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { title: 'Bug report' },
      expect.objectContaining({ credentials: {}, abortSignal: expect.any(AbortSignal) }),
    );
  });

  it('passes credentials from vault to connector handler', async () => {
    const handler = vi.fn(async (_input: unknown, context: { credentials: unknown }) => {
      const creds = context.credentials as { token: string };
      return {
        content: [{ type: 'text' as const, text: `Token: ${creds.token}` }],
      };
    });

    const manifest: ConnectorManifest = {
      name: 'github',
      version: '0.1.0',
      displayName: 'GitHub',
      description: 'GitHub connector',
      icon: 'github',
      credentialSchema: z.object({ token: z.string() }),
      tools: [
        {
          name: 'test_creds',
          description: 'Test credentials',
          inputSchema: z.object({}),
          handler,
        },
      ],
    };

    const getCredentials = vi.fn(async (connectorName: string) => {
      if (connectorName === 'github') {
        return { token: 'ghp_secret123' };
      }
      return null;
    });

    const tools = adaptConnectorTools([manifest], { getCredentials });

    const tool = tools['github.test_creds'] as unknown as {
      execute: (input: Record<string, never>) => Promise<unknown>;
    };

    const result = await tool.execute({});

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Token: ghp_secret123' }],
    });
    expect(getCredentials).toHaveBeenCalledWith('github');
    expect(handler).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ credentials: { token: 'ghp_secret123' } }),
    );
  });

  it('handles missing credentials gracefully', async () => {
    const handler = vi.fn(async (_input: unknown, context: { credentials: unknown }) => {
      return {
        content: [{ type: 'text' as const, text: `Creds: ${JSON.stringify(context.credentials)}` }],
      };
    });

    const manifest: ConnectorManifest = {
      name: 'slack',
      version: '0.1.0',
      displayName: 'Slack',
      description: 'Slack connector',
      icon: 'slack',
      credentialSchema: z.object({ token: z.string() }),
      tools: [
        {
          name: 'send_message',
          description: 'Send message',
          inputSchema: z.object({ channel: z.string() }),
          handler,
        },
      ],
    };

    const getCredentials = vi.fn(async () => null);

    const tools = adaptConnectorTools([manifest], { getCredentials });

    const tool = tools['slack.send_message'] as unknown as {
      execute: (input: { channel: string }) => Promise<unknown>;
    };

    const result = await tool.execute({ channel: '#general' });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Creds: {}' }],
    });
    expect(handler).toHaveBeenCalledWith(
      { channel: '#general' },
      expect.objectContaining({ credentials: {} }),
    );
  });
});
