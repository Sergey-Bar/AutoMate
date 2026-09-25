import { z } from 'zod/v4';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorRegistry } from './registry.js';
import type { ConnectorManifest } from '../../../../packages/connector-sdk/src/types.js';

function createManifest(
  name: string,
  tools: Array<{
    name: string;
    handler: ConnectorManifest['tools'][number]['handler'];
  }>,
): ConnectorManifest {
  return {
    name,
    version: '1.0',
    displayName: name,
    description: `Test ${name}`,
    icon: name,
    credentialSchema: z.object({}),
    tools: tools.map((tool) => ({
      name: tool.name,
      description: `Test tool ${tool.name}`,
      inputSchema: z.object({}),
      handler: tool.handler,
    })),
  };
}

describe('ConnectorRegistry', () => {
  it('registers local connector and dispatches by tool prefix', async () => {
    const registry = new ConnectorRegistry();

    registry.registerLocal('github', async (input: unknown) => {
      const payload = input as { title: string };
      return { content: [{ type: 'text', text: `created:${payload.title}` }] };
    });

    await expect(registry.dispatch('github.create_issue', { title: 'Bug' })).resolves.toEqual({
      content: [{ type: 'text', text: 'created:Bug' }],
    });
  });

  it('registerLocal stores expected manifest and tool metadata', () => {
    const registry = new ConnectorRegistry();

    registry.registerLocal('github', async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));

    const manifest = registry.listManifests()[0];

    expect(manifest?.version).toBe('local');
    expect(manifest?.description).toBe('Local connector wrapper for github');
    expect(manifest?.tools[0]?.name).toBe('__default');
    expect(manifest?.tools[0]?.description).toBe('Legacy local handler for github');
  });

  it('registerManifest registers a manifest that appears in listManifests', () => {
    const registry = new ConnectorRegistry();
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    const manifest = createManifest('alpha', [{ name: 'run', handler }]);

    registry.registerManifest(manifest);

    expect(registry.listManifests()).toEqual([manifest]);
  });

  it('listManifests returns empty array when no connectors are registered', () => {
    const registry = new ConnectorRegistry();

    expect(registry.listManifests()).toEqual([]);
  });

  it('listManifests returns all registered manifests', () => {
    const registry = new ConnectorRegistry();
    const one = createManifest('one', [
      { name: 'tool', handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'one' }] })) },
    ]);
    const two = createManifest('two', [
      { name: 'tool', handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'two' }] })) },
    ]);

    registry.registerManifest(one);
    registry.registerManifest(two);

    expect(registry.listManifests()).toEqual([one, two]);
  });

  it('getConnectorNames returns empty array when no connectors are registered', () => {
    const registry = new ConnectorRegistry();

    expect(registry.getConnectorNames()).toEqual([]);
  });

  it('getConnectorNames returns names of all registered connectors', () => {
    const registry = new ConnectorRegistry();

    registry.registerManifest(
      createManifest('a', [
        { name: 'tool', handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'a' }] })) },
      ]),
    );
    registry.registerManifest(
      createManifest('b', [
        { name: 'tool', handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'b' }] })) },
      ]),
    );

    expect(registry.getConnectorNames()).toEqual(['a', 'b']);
  });

  it('dispatch throws when connector is not loaded', async () => {
    const registry = new ConnectorRegistry();

    await expect(registry.dispatch('unknown.anything', {})).rejects.toThrow('Connector not loaded: unknown');
  });

  it('dispatch throws tool not found when connector has multiple tools and name does not match', async () => {
    const registry = new ConnectorRegistry();
    registry.registerManifest(
      createManifest('multi', [
        { name: 'first', handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'first' }] })) },
        { name: 'second', handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'second' }] })) },
      ]),
    );

    await expect(registry.dispatch('multi.missing', {})).rejects.toThrow(
      'Tool not found on connector multi: missing',
    );
  });

  it('dispatch with multiple tools selects the handler matching the tool name', async () => {
    const registry = new ConnectorRegistry();
    const firstHandler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'first' }] }));
    const secondHandler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'second' }] }));

    registry.registerManifest(
      createManifest('multi', [
        { name: 'first', handler: firstHandler },
        { name: 'second', handler: secondHandler },
      ]),
    );

    await expect(registry.dispatch('multi.second', { value: 2 })).resolves.toEqual({
      content: [{ type: 'text', text: 'second' }],
    });

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledWith(
      { value: 2 },
      expect.objectContaining({ abortSignal: expect.any(AbortSignal), credentials: {} }),
    );
  });

  it('dispatch without tool method on multi-tool connector includes <missing> in error', async () => {
    const registry = new ConnectorRegistry();
    registry.registerManifest(
      createManifest('multi', [
        { name: 'first', handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'first' }] })) },
        { name: 'second', handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'second' }] })) },
      ]),
    );

    await expect(registry.dispatch('multi', {})).rejects.toThrow('Tool not found on connector multi: <missing>');
  });

  it('dispatch falls back to the single tool when method does not match', async () => {
    const registry = new ConnectorRegistry();
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'fallback' }] }));
    registry.registerManifest(createManifest('single', [{ name: 'only', handler }]));

    await expect(registry.dispatch('single.not_the_tool_name', { x: 1 })).resolves.toEqual({
      content: [{ type: 'text', text: 'fallback' }],
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { x: 1 },
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
        credentials: {},
      }),
    );
  });

  it('dispatch passes credentials and an AbortSignal to tool handler', async () => {
    const registry = new ConnectorRegistry();
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    registry.registerManifest(createManifest('ctx', [{ name: 'run', handler }]));

    await registry.dispatch('ctx.run', { query: 'x' }, { token: 'secret' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { query: 'x' },
      expect.objectContaining({
        credentials: { token: 'secret' },
        abortSignal: expect.any(AbortSignal),
      }),
    );
  });

  it('dispatch works with registerManifest', async () => {
    const registry = new ConnectorRegistry();
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'manifest-call' }] }));
    registry.registerManifest(createManifest('api', [{ name: 'invoke', handler }]));

    await expect(registry.dispatch('api.invoke', { id: 42 })).resolves.toEqual({
      content: [{ type: 'text', text: 'manifest-call' }],
    });
  });

  it('unload removes connector and dispatch fails afterwards', async () => {
    const registry = new ConnectorRegistry();
    registry.registerManifest(
      createManifest('temp', [
        { name: 'run', handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'alive' }] })) },
      ]),
    );

    await registry.unload('temp');

    await expect(registry.dispatch('temp.run', {})).rejects.toThrow('Connector not loaded: temp');
  });

  it('reload replaces connector manifest so old handler is no longer accessible', async () => {
    const registry = new ConnectorRegistry();
    const oldHandler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'old' }] }));
    const newHandler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'new' }] }));

    registry.registerManifest(createManifest('swap', [{ name: 'oldTool', handler: oldHandler }]));
    await registry.reload(createManifest('swap', [{ name: 'newTool', handler: newHandler }]));

    await expect(registry.dispatch('swap.oldTool', {})).resolves.toEqual({
      content: [{ type: 'text', text: 'new' }],
    });
    await expect(registry.dispatch('swap.newTool', {})).resolves.toEqual({
      content: [{ type: 'text', text: 'new' }],
    });
    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).toHaveBeenCalledTimes(2);
  });

  it('dispatch with missing tool method (no dot) falls back to single tool', async () => {
    const registry = new ConnectorRegistry();
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'single-no-dot' }] }));
    registry.registerManifest(createManifest('nodot', [{ name: 'actual', handler }]));

    await expect(registry.dispatch('nodot', { ok: true })).resolves.toEqual({
      content: [{ type: 'text', text: 'single-no-dot' }],
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
