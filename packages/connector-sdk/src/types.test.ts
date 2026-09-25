import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import type { ConnectorManifest } from './types.js';
import { SDK_VERSION } from './index.js';

describe('SDK_VERSION', () => {
  it('exports a non-empty version string', () => {
    expect(typeof SDK_VERSION).toBe('string');
    expect(SDK_VERSION.length).toBeGreaterThan(0);
  });
});

describe('connector-sdk types', () => {
  it('constructs a ConnectorManifest with all required fields', () => {
    const manifest: ConnectorManifest = {
      name: 'dummy',
      version: '0.1.0',
      displayName: 'Dummy',
      description: 'Dummy connector',
      icon: 'dummy',
      credentialSchema: z.object({ token: z.string() }),
      tools: [
        {
          name: 'noop',
          description: 'No operation',
          inputSchema: z.object({ value: z.string().optional() }),
          handler: async () => ({
            content: [{ type: 'text', text: 'ok' }],
          }),
        },
      ],
    };

    expect(manifest.name).toBe('dummy');
    expect(manifest.tools).toHaveLength(1);
    expect(manifest.tools[0]?.name).toBe('noop');
  });
});
