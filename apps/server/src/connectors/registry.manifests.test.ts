import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { ConnectorRegistry } from './registry.js';

const emptySchema = z.object({});
describe('ConnectorRegistry manifests', () => {
  it('lists registered connector manifests', () => {
    const registry = new ConnectorRegistry();
    registry.registerManifest({
      name: 'github',
      version: '0.1.0',
      displayName: 'GitHub',
      description: 'GitHub connector',
      icon: 'github',
      tools: [{ name: 'create_issue', description: 'Create issue', inputSchema: emptySchema, handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }) }],
      credentialSchema: emptySchema,
    });
    const manifests = registry.listManifests();
    expect(manifests).toHaveLength(1);
    expect(manifests[0].name).toBe('github');
  });

  it('dispatches to correct tool handler', async () => {
    const registry = new ConnectorRegistry();
    const mockHandler = async () => ({ content: [{ type: 'text' as const, text: 'created' }] });
    registry.registerManifest({
      name: 'github',
      version: '0.1.0',
      displayName: 'GitHub',
      description: 'GitHub connector',
      icon: 'github',
      tools: [{ name: 'create_issue', description: 'Create issue', inputSchema: emptySchema, handler: mockHandler }],
      credentialSchema: emptySchema,
    });
    const result = await registry.dispatch('github.create_issue', { title: 'bug' });
    expect(result.content[0].text).toBe('created');
  });
});
