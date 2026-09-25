import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { ConnectorRegistry } from './registry.js';

describe('ConnectorRegistry hot reload', () => {
  it('unloads and reloads connector handlers', async () => {
    const registry = new ConnectorRegistry();

    registry.registerManifest({
      name: 'github',
      version: '0.1.0',
      displayName: 'GitHub',
      description: 'GitHub connector',
      icon: 'github',
      credentialSchema: z.object({}),
      tools: [{
        name: 'create_issue',
        description: 'Create issue',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text' as const, text: 'v1' }] }),
      }],
    });

    await registry.unload('github');

    await registry.reload({
      name: 'github',
      version: '0.1.0',
      displayName: 'GitHub',
      description: 'GitHub connector',
      icon: 'github',
      credentialSchema: z.object({}),
      tools: [{
        name: 'create_issue',
        description: 'Create issue',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text' as const, text: 'v2' }] }),
      }],
    });

    await expect(registry.dispatch('github.create_issue', {})).resolves.toEqual({
      content: [{ type: 'text', text: 'v2' }],
    });
  });
});
